// AI Denoise: tiles the full-resolution source through SCUNet, stores a 16-bit (half-float) result,
// and serves it (blended with the original by Amount) as the photo's editing source.
import { api } from './api.js';
import { C, srcId, save, emit } from './store.js';
import { activity } from './ui.js';

const HAS_F16 = typeof Float16Array !== 'undefined';
let worker = null, seq = 0;
const pending = new Map();
let dlAct = null;
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./denoise-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const d = e.data;
    if (d.type === 'download') {
      if (!dlAct) dlAct = activity('Downloading AI Denoise model (one-time)…');
      dlAct.update(`Downloading AI Denoise model — ${(d.loaded / 1048576).toFixed(0)} / ${(d.total / 1048576).toFixed(0)} MB (one-time)`, d.loaded / d.total);
      if (d.done) { dlAct.done(); dlAct = null; }
      return;
    }
    const p = pending.get(d.id); if (!p) return;
    pending.delete(d.id);
    d.error ? p.reject(new Error(d.error)) : p.resolve(d.result);
  };
  return worker;
}
function call(task, args, transfer = []) {
  const id = ++seq, w = getWorker();
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); w.postMessage({ id, task, args }, transfer); });
}

// ---------- pixel helpers ----------
// → { w, h, data: Float32Array RGB interleaved (sRGB-encoded, may exceed 1 for RAW) }
function toFloatRGB(src) {
  const w = src.width, h = src.height, n = w * h, out = new Float32Array(n * 3);
  if (src.data) {
    const s = src.half ? new Float16Array(src.data.buffer, src.data.byteOffset, src.data.length) : src.data;
    for (let i = 0, j = 0; i < n; i++, j += 4) { out[i * 3] = s[j]; out[i * 3 + 1] = s[j + 1]; out[i * 3 + 2] = s[j + 2]; }
  } else {
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    const d = x.getImageData(0, 0, w, h).data;
    for (let i = 0; i < n; i++) { out[i * 3] = d[i * 4] / 255; out[i * 3 + 1] = d[i * 4 + 1] / 255; out[i * 3 + 2] = d[i * 4 + 2] / 255; }
  }
  return { w, h, data: out };
}
// Area-average resample of an RGB float image.
function resample(src, w, h, tw, th) {
  if (w === tw && h === th) return src;
  const tmp = new Float32Array(tw * h * 3), out = new Float32Array(tw * th * 3);
  const sx = w / tw, sy = h / th;
  for (let y = 0; y < h; y++) for (let x = 0; x < tw; x++) {
    const a = x * sx, b = a + sx; let r = 0, g = 0, bl = 0, ws = 0;
    for (let i = Math.floor(a); i < Math.min(w, Math.ceil(b)); i++) { const wt = Math.min(b, i + 1) - Math.max(a, i); const k = (y * w + i) * 3; r += src[k] * wt; g += src[k + 1] * wt; bl += src[k + 2] * wt; ws += wt; }
    const o = (y * tw + x) * 3; tmp[o] = r / ws; tmp[o + 1] = g / ws; tmp[o + 2] = bl / ws;
  }
  for (let y = 0; y < th; y++) {
    const a = y * sy, b = a + sy;
    for (let x = 0; x < tw; x++) {
      let r = 0, g = 0, bl = 0, ws = 0;
      for (let j = Math.floor(a); j < Math.min(h, Math.ceil(b)); j++) { const wt = Math.min(b, j + 1) - Math.max(a, j); const k = (j * tw + x) * 3; r += tmp[k] * wt; g += tmp[k + 1] * wt; bl += tmp[k + 2] * wt; ws += wt; }
      const o = (y * tw + x) * 3; out[o] = r / ws; out[o + 1] = g / ws; out[o + 2] = bl / ws;
    }
  }
  return out;
}
async function gzip(buf) { return new Response(new Blob([buf]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(); }
async function gunzip(blob) { return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); }

// ---------- run ----------
// Large tiles amortize per-inference GPU overhead (benchmarked: 768px ≈ 2× faster per megapixel than 320px).
const TILE = 768, OV = 32;
export async function runDenoise(p, { model = 'natural', loadSource, onProgress, isCancelled } = {}) {
  if (!HAS_F16) throw new Error('This version of the app is too old for AI Denoise (needs Float16 support).');
  const base = C.photos[srcId(p)] || p;
  const { ep } = await call('load', { model });
  const src = await loadSource(base, { full: true, noDenoise: true });
  const { w, h, data } = toFloatRGB(src);
  // headroom scale (RAW values above 1 = highlights beyond sensor white)
  let S = 1;
  if (src.raw) { const v = []; for (let i = 0; i < data.length; i += 3 * 97) v.push(Math.max(data[i], data[i + 1], data[i + 2])); v.sort((a, b) => a - b); S = Math.max(1, v[Math.floor(v.length * 0.9995)] || 1); }
  const out = new Float32Array(w * h * 3), wsum = new Float32Array(w * h);
  const step = TILE - 2 * OV;
  const xs = [], ys = [];
  for (let x = 0; x < w; x += step) { xs.push(Math.min(x, Math.max(0, w - TILE))); if (x + TILE >= w) break; }
  for (let y = 0; y < h; y += step) { ys.push(Math.min(y, Math.max(0, h - TILE))); if (y + TILE >= h) break; }
  const total = xs.length * ys.length; let done = 0;
  const t0 = performance.now();
  for (const y0 of ys) for (const x0 of xs) {
    if (isCancelled && isCancelled()) throw new Error('cancelled');
    const tw = Math.min(TILE, w - x0), th = Math.min(TILE, h - y0);
    const pw = Math.ceil(tw / 8) * 8, ph = Math.ceil(th / 8) * 8; // pad to multiple of 8 (edge clamp)
    const inp = new Float32Array(3 * pw * ph);
    for (let y = 0; y < ph; y++) {
      const sy = y0 + Math.min(y, th - 1);
      for (let x = 0; x < pw; x++) {
        const k = (sy * w + x0 + Math.min(x, tw - 1)) * 3, o = y * pw + x;
        inp[o] = Math.min(1, data[k] / S); inp[pw * ph + o] = Math.min(1, data[k + 1] / S); inp[2 * pw * ph + o] = Math.min(1, data[k + 2] / S);
      }
    }
    const { data: res } = await call('tile', { model, data: inp, w: pw, h: ph }, [inp.buffer]);
    for (let y = 0; y < th; y++) {
      const wy = Math.min(1, y0 === 0 ? 1 : (y + 1) / OV, y0 + th >= h ? 1 : (th - y) / OV);
      for (let x = 0; x < tw; x++) {
        const wt = Math.max(1e-3, Math.min(wy, x0 === 0 ? 1 : (x + 1) / OV, x0 + tw >= w ? 1 : (tw - x) / OV));
        const i = (y0 + y) * w + x0 + x, o = y * pw + x;
        out[i * 3] += res[o] * S * wt; out[i * 3 + 1] += res[pw * ph + o] * S * wt; out[i * 3 + 2] += res[2 * pw * ph + o] * S * wt;
        wsum[i] += wt;
      }
    }
    done++;
    const el = (performance.now() - t0) / 1000;
    onProgress && onProgress(done / total, Math.round((el / done) * (total - done)), ep);
  }
  for (let i = 0; i < w * h; i++) {
    const ws = wsum[i] || 1, k = i * 3;
    // keep the original where it exceeded the model's input range (recoverable RAW highlights)
    if (Math.max(data[k], data[k + 1], data[k + 2]) > S * 0.98) continue;
    data[k] = out[k] / ws; data[k + 1] = out[k + 1] / ws; data[k + 2] = out[k + 2] / ws;
  }
  // store full + editing-size versions as gzip'd half floats
  const half = await loadSource(base, { full: false, noDenoise: true });
  const hw = half.width, hh = half.height;
  const small = resample(data, w, h, hw, hh);
  const at = Date.now();
  await api.cachePut(`dn-${base.id}.f16gz`, await gzip(Float16Array.from(data).buffer));
  await api.cachePut(`dnh-${base.id}.f16gz`, await gzip(Float16Array.from(small).buffer));
  base.denoise = { on: true, amount: base.denoise?.amount ?? 75, model, w, h, hw, hh, at, ep };
  for (const v of Object.values(C.photos)) if (v.master === base.id) v.denoise = base.denoise;
  mem.clear();
  save();
  return base.denoise;
}

// ---------- serve denoised sources ----------
const mem = new Map();
async function loadStored(base, full) {
  const key = (full ? 'dn-' : 'dnh-') + base.id + '.f16gz';
  const mk = key + base.denoise.at;
  if (!mem.has(mk)) {
    const pr = (async () => {
      const r = await api.cacheGet(key);
      if (!r) throw new Error('Denoised data missing — run AI Denoise again');
      return new Float16Array(await gunzip(await r.blob()));
    })();
    mem.set(mk, pr); pr.catch(() => mem.delete(mk));
    const ks = [...mem.keys()]; while (ks.length > 3) mem.delete(ks.shift());
  }
  return mem.get(mk);
}
// base image (un-denoised source object) + stored result → blended half-float RGBA source
export async function applyDenoise(photo, full, baseSrc) {
  const base = C.photos[srcId(photo)] || photo, dn = base.denoise;
  const f = await loadStored(base, full);
  const w = full ? dn.w : dn.hw, h = full ? dn.h : dn.hh;
  if (baseSrc.width !== w || baseSrc.height !== h) return baseSrc; // dimensions changed (e.g. file edited) → fall back
  const amt = Math.max(0, Math.min(1, (dn.amount ?? 100) / 100));
  const orig = amt < 1 ? toFloatRGB(baseSrc).data : null;
  const out = new Float16Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const k = i * 3, o = i * 4;
    if (orig) { out[o] = orig[k] + (f[k] - orig[k]) * amt; out[o + 1] = orig[k + 1] + (f[k + 1] - orig[k + 1]) * amt; out[o + 2] = orig[k + 2] + (f[k + 2] - orig[k + 2]) * amt; }
    else { out[o] = f[k]; out[o + 1] = f[k + 1]; out[o + 2] = f[k + 2]; }
    out[o + 3] = 1;
  }
  return { raw: !!baseSrc.raw, half: true, width: w, height: h, data: new Uint16Array(out.buffer), meta: baseSrc.meta };
}
export async function removeDenoise(p) {
  const base = C.photos[srcId(p)] || p;
  delete base.denoise;
  for (const v of Object.values(C.photos)) if (v.master === base.id) delete v.denoise;
  try { await api.cacheDel(`dn-${base.id}.f16gz`); await api.cacheDel(`dnh-${base.id}.f16gz`); } catch {}
  mem.clear(); save();
}
