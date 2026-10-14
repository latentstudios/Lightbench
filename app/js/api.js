// Thin client for the local Lightbench server.
export const TOKEN = document.querySelector('meta[name="lightbench-token"]').content;
const H = { 'x-lightbench': TOKEN };

// The page's session token no longer matches the running engine (it was restarted underneath us):
// reload once to reconnect instead of leaving every photo request failing.
export function recoverSession() {
  let last = 0;
  try { last = Number(sessionStorage.getItem('lightbench:recovered') || 0); } catch {}
  if (Date.now() - last > 15000) {
    try { sessionStorage.setItem('lightbench:recovered', String(Date.now())); } catch {}
    location.reload();
  } else {
    const s = document.getElementById('catalog-status');
    if (s) s.textContent = 'Lost connection to the Lightbench engine — please restart Lightbench';
  }
}
// Called when a photo fails to load: tells a broken session apart from a genuinely unreadable file.
export async function verifySession() {
  try {
    const r = await fetch('/api/info', { headers: H });
    if (r.status === 401) { recoverSession(); return false; }
    return r.ok;
  } catch { return false; }
}

async function check(r) {
  if (r.status === 401) recoverSession();
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return r;
}
export const api = {
  async json(route, opts = {}) { return (await check(await fetch('/api/' + route, { ...opts, headers: { ...H, ...(opts.headers || {}) } }))).json(); },
  info() { return this.json('info'); },
  drives() { return this.json('drives'); },
  ls(dir) { return this.json('ls?dir=' + encodeURIComponent(dir)); },
  scan(dir, recursive) { return this.json(`scan?dir=${encodeURIComponent(dir)}&recursive=${recursive ? 1 : 0}`); },
  exists(paths) { return this.json('exists', { method: 'POST', body: JSON.stringify(paths) }); },
  async loadCatalog() { return this.json('catalog'); },
  async saveCatalog(obj) { return this.json('catalog', { method: 'PUT', body: JSON.stringify(obj) }); },
  fileUrl(path, preview = false) { return `/api/file?t=${TOKEN}&path=${encodeURIComponent(path)}${preview ? '&preview=1' : ''}`; },
  rawUrl(path) { return `/api/rawmeta?t=${TOKEN}&path=${encodeURIComponent(path)}`; },
  cacheUrl(key, bust) { return `/api/cache/${encodeURIComponent(key)}?t=${TOKEN}${bust ? '&v=' + bust : ''}`; },
  async cacheGet(key) { const r = await fetch(this.cacheUrl(key)); return r.ok ? r : null; },
  async cachePut(key, body) { return this.json('cache/' + encodeURIComponent(key), { method: 'PUT', body }); },
  async cacheDel(key) { return this.json('cache/' + encodeURIComponent(key), { method: 'DELETE' }); },
  async write(path, blob, overwrite = false) { return this.json(`write?path=${encodeURIComponent(path)}${overwrite ? '&overwrite=1' : ''}`, { method: 'POST', body: blob }); },
  async upload(name, blob) { return this.json('upload?name=' + encodeURIComponent(name), { method: 'POST', body: blob }); },
  async reveal(path) { return this.json('reveal?path=' + encodeURIComponent(path), { method: 'POST' }); },
};
