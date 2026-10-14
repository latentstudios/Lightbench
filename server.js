// Lightbench local server — serves the app, reads photos from disk, stores the catalog, writes exports.
// Zero dependencies. Bound to 127.0.0.1 only and protected with a per-run token + Host check.
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

let PORT = Number(process.env.LIGHTBENCH_PORT || 5199);
const ROOT = __dirname;
const APP_DIR = path.join(ROOT, 'app');
const DATA_DIR = process.env.LIGHTBENCH_DATA || path.join(os.homedir(), 'Pictures', 'Lightbench Library');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const RAWJPG_DIR = path.join(CACHE_DIR, 'rawjpg');
const CATALOG = path.join(DATA_DIR, 'catalog.json');
const TOKEN = crypto.randomBytes(18).toString('hex');

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'tif', 'tiff', 'jfif']);
const RAW_EXT = new Set(['cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw', 'x3f', '3fr', 'iiq', 'rwl', 'erf', 'kdc', 'mrw', 'mef', 'mos']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.avif': 'image/avif', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.ico': 'image/x-icon',
  '.bin': 'application/octet-stream', '.wasm': 'application/wasm',
};

for (const d of [DATA_DIR, CACHE_DIR, RAWJPG_DIR]) fs.mkdirSync(d, { recursive: true });

const extOf = (p) => path.extname(p).slice(1).toLowerCase();
const isPhoto = (p) => IMAGE_EXT.has(extOf(p)) || RAW_EXT.has(extOf(p));

function send(res, code, body, type = 'application/json') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}
function readBody(req, limit = 1024 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const safeKey = (k) => /^[a-zA-Z0-9._-]{1,160}$/.test(k) && !k.includes('..');

// ---------- RAW: extract the largest embedded (baseline/progressive) JPEG preview ----------
function jpegEnd(buf, s) {
  let p = s + 2, sof = -1;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) return null;
    const m = buf[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xd9) return { end: p + 2, sof };
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { p += 2; continue; }
    const len = buf.readUInt16BE(p + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) sof = m;
    if (m === 0xda) {
      p += 2 + len;
      while (p + 1 < buf.length) {
        if (buf[p] === 0xff) {
          const n = buf[p + 1];
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { p += 2; continue; }
          if (n === 0xff) { p++; continue; }
          break;
        }
        p++;
      }
      continue;
    }
    p += 2 + len;
  }
  return null;
}
function extractLargestJpeg(buf) {
  const sig = Buffer.from([0xff, 0xd8, 0xff]);
  let i = 0, best = null;
  while (true) {
    i = buf.indexOf(sig, i);
    if (i < 0) break;
    const r = jpegEnd(buf, i);
    if (r && (r.sof === 0xc0 || r.sof === 0xc1 || r.sof === 0xc2) && r.end - i > 20000) {
      if (!best || r.end - i > best[1] - best[0]) best = [i, r.end];
      i = r.end;
    } else i += 3;
  }
  return best ? buf.subarray(best[0], best[1]) : null;
}
async function rawPreviewPath(file) {
  const st = await fsp.stat(file);
  const key = crypto.createHash('sha1').update(file + '|' + st.size + '|' + st.mtimeMs).digest('hex');
  const out = path.join(RAWJPG_DIR, key + '.jpg');
  try { await fsp.access(out); return out; } catch {}
  const buf = await fsp.readFile(file);
  const jpg = extractLargestJpeg(buf);
  if (!jpg) return null;
  await fsp.writeFile(out, jpg);
  return out;
}

// ---------- file streaming with Range support ----------
async function streamFile(req, res, file, type) {
  const st = await fsp.stat(file);
  const headers = { 'Content-Type': type || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    let start = range[1] === '' ? st.size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : st.size - 1;
    if (range[1] === '') end = st.size - 1;
    start = Math.max(0, start); end = Math.min(st.size - 1, end);
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  }
}

async function listDir(dir) {
  const ents = await fsp.readdir(dir, { withFileTypes: true });
  const dirs = [], images = [];
  for (const e of ents) {
    if (e.name.startsWith('$') || e.name.startsWith('.')) continue;
    if (e.isDirectory()) dirs.push(e.name);
    else if (e.isFile() && isPhoto(e.name)) images.push(e.name);
  }
  dirs.sort((a, b) => a.localeCompare(b)); images.sort((a, b) => a.localeCompare(b));
  return { dir, parent: path.dirname(dir) === dir ? null : path.dirname(dir), dirs, images };
}
async function scan(dir, recursive, out = [], depth = 0) {
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('$') || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory() && recursive && depth < 12) await scan(full, recursive, out, depth + 1);
    else if (e.isFile() && isPhoto(e.name)) {
      try { const st = await fsp.stat(full); out.push({ path: full, size: st.size, mtime: st.mtimeMs }); } catch {}
    }
  }
  return out;
}
async function uniquePath(p) {
  let candidate = p, i = 1;
  const ext = path.extname(p), base = p.slice(0, p.length - ext.length);
  while (true) { try { await fsp.access(candidate); candidate = `${base}-${i++}${ext}`; } catch { return candidate; } }
}

let lastBackup = 0;
async function writeCatalog(buf) {
  JSON.parse(buf.toString('utf8')); // validate
  const tmp = CATALOG + '.tmp';
  await fsp.writeFile(tmp, buf);
  if (Date.now() - lastBackup > 10 * 60 * 1000) {
    try { await fsp.copyFile(CATALOG, path.join(DATA_DIR, 'catalog.backup.json')); lastBackup = Date.now(); } catch {}
  }
  await fsp.rename(tmp, CATALOG);
}

async function api(req, res, url) {
  const q = url.searchParams;
  const route = url.pathname.slice(5);
  if (route === 'info') {
    const pics = path.join(os.homedir(), 'Pictures');
    return send(res, 200, { home: os.homedir(), pictures: fs.existsSync(pics) ? pics : os.homedir(), dataDir: DATA_DIR, sep: path.sep, raw: [...RAW_EXT] });
  }
  if (route === 'drives') {
    const drives = [];
    if (process.platform === 'win32') {
      for (let c = 65; c <= 90; c++) { const d = String.fromCharCode(c) + ':\\'; try { fs.accessSync(d); drives.push(d); } catch {} }
    } else {
      drives.push('/');
      // macOS: mounted disks, SD cards and network shares live under /Volumes
      if (process.platform === 'darwin') { try { for (const v of fs.readdirSync('/Volumes')) drives.push(path.join('/Volumes', v)); } catch {} }
    }
    return send(res, 200, drives);
  }
  if (route === 'ls') return send(res, 200, await listDir(path.resolve(q.get('dir'))));
  if (route === 'scan') return send(res, 200, await scan(path.resolve(q.get('dir')), q.get('recursive') === '1'));
  if (route === 'exists') {
    const paths = JSON.parse((await readBody(req)).toString('utf8'));
    return send(res, 200, paths.map((p) => fs.existsSync(p)));
  }
  if (route === 'file') {
    const file = path.resolve(q.get('path'));
    if (!isPhoto(file)) return send(res, 403, { error: 'not a photo' });
    if (RAW_EXT.has(extOf(file))) {
      const prev = await rawPreviewPath(file);
      if (!prev) return send(res, 415, { error: 'No decodable preview embedded in this RAW file' });
      if (q.get('preview') === '1') return streamFile(req, res, prev, 'image/jpeg');
    }
    return streamFile(req, res, file);
  }
  if (route === 'rawmeta') { // original raw bytes for EXIF parsing (range requests)
    const file = path.resolve(q.get('path'));
    if (!isPhoto(file)) return send(res, 403, { error: 'not a photo' });
    return streamFile(req, res, file, 'application/octet-stream');
  }
  if (route === 'catalog') {
    if (req.method === 'GET') {
      try { return send(res, 200, await fsp.readFile(CATALOG)); } catch { return send(res, 200, 'null'); }
    }
    if (req.method === 'PUT') { await writeCatalog(await readBody(req)); return send(res, 200, { ok: true }); }
  }
  if (route.startsWith('cache/')) {
    const key = decodeURIComponent(route.slice(6));
    if (!safeKey(key)) return send(res, 400, { error: 'bad key' });
    const file = path.join(CACHE_DIR, key);
    if (req.method === 'GET') { try { return await streamFile(req, res, file); } catch { return send(res, 404, { error: 'missing' }); } }
    if (req.method === 'PUT') { await fsp.writeFile(file, await readBody(req)); return send(res, 200, { ok: true }); }
    if (req.method === 'DELETE') { try { await fsp.unlink(file); } catch {} return send(res, 200, { ok: true }); }
  }
  if (route === 'write' && req.method === 'POST') {
    let file = path.resolve(q.get('path'));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    if (q.get('overwrite') !== '1') file = await uniquePath(file);
    await fsp.writeFile(file, await readBody(req));
    return send(res, 200, { path: file });
  }
  if (route === 'mkdir' && req.method === 'POST') {
    await fsp.mkdir(path.resolve(q.get('path')), { recursive: true });
    return send(res, 200, { ok: true });
  }
  if (route === 'upload' && req.method === 'POST') {
    const name = path.basename(q.get('name') || 'photo.jpg');
    if (!isPhoto(name)) return send(res, 400, { error: 'unsupported file type' });
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(DATA_DIR, 'Imports', day);
    await fsp.mkdir(dir, { recursive: true });
    const file = await uniquePath(path.join(dir, name));
    await fsp.writeFile(file, await readBody(req));
    const st = await fsp.stat(file);
    return send(res, 200, { path: file, size: st.size, mtime: st.mtimeMs });
  }
  if (route === 'reveal' && req.method === 'POST') {
    const p = path.resolve(q.get('path'));
    const isFile = fs.existsSync(p) && fs.statSync(p).isFile();
    if (process.platform === 'win32') spawn('explorer.exe', [isFile ? `/select,${p}` : p], { detached: true });
    else if (process.platform === 'darwin') spawn('open', isFile ? ['-R', p] : [p], { detached: true });
    else spawn('xdg-open', [isFile ? path.dirname(p) : p], { detached: true });
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'unknown route' });
}

const server = http.createServer(async (req, res) => {
  try {
    const host = (req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return send(res, 403, 'forbidden host', 'text/plain');
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname.startsWith('/api/')) {
      const tok = req.headers['x-lightbench'] || url.searchParams.get('t');
      if (tok !== TOKEN) return send(res, 401, { error: 'bad token' });
      return await api(req, res, url);
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.join(APP_DIR, path.normalize(rel));
    if (!file.startsWith(APP_DIR)) return send(res, 403, 'forbidden', 'text/plain');
    if (rel === '/index.html') {
      const html = (await fsp.readFile(file, 'utf8')).replace('%%TOKEN%%', TOKEN);
      return send(res, 200, html, MIME['.html']);
    }
    try { await fsp.access(file); } catch { return send(res, 404, 'not found', 'text/plain'); }
    return streamFile(req, res, file);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: String(e.message || e) });
    else res.end();
  }
});

function openApp() {
  const url = `http://127.0.0.1:${PORT}/`;
  if (process.platform === 'win32') {
    const p = spawn('cmd', ['/c', 'start', '', 'msedge', `--app=${url}`, '--start-maximized'], { detached: true, stdio: 'ignore' });
    p.on('error', () => spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }));
  } else if (process.platform === 'darwin') spawn('open', [url]);
  else spawn('xdg-open', [url]);
  console.log(`Lightbench running at ${url}`);
}

// Start the server (used by the desktop app). Resolves with the app URL.
function start({ port = PORT } = {}) {
  PORT = port;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => { server.off('error', reject); resolve({ url: `http://127.0.0.1:${PORT}/`, dataDir: DATA_DIR }); });
  });
}
module.exports = { start, DATA_DIR };

// Command-line use: `node server.js [--open]`
if (require.main === module) {
  start().then(({ url }) => {
    console.log(`Catalog: ${DATA_DIR}`);
    if (process.argv.includes('--open')) openApp(); else console.log(`Lightbench running at ${url}`);
  }).catch((e) => {
    if (e.code === 'EADDRINUSE') { console.log('Lightbench is already running — opening it.'); if (process.argv.includes('--open')) openApp(); setTimeout(() => process.exit(0), 500); }
    else throw e;
  });
}
