// True RAW decoding with LibRaw (WebAssembly). Produces 16-bit-precision, scene-linear-based
// half-float images with highlight headroom for the engine.
import LibRaw from '../vendor/libraw/index.js';
import { api } from './api.js';

// LibRaw output is scaled down by this factor so reconstructed highlights above sensor clip
// fit into the 16-bit output (4x = 2 stops of headroom).
const BRIGHT = 0.25;
const HAS_F16 = typeof Float16Array !== 'undefined';

let lib = null;
let chain = Promise.resolve();
const cache = new Map(); // key -> Promise<image>

let LUT = null;
function lut() {
  if (LUT) return LUT;
  const f = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) {
    const v = i / 65535 / BRIGHT; // linear, 1.0 = sensor white
    f[i] = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; // sRGB-encoded, may exceed 1
  }
  LUT = HAS_F16 ? new Uint16Array(Float16Array.from(f).buffer) : f;
  return LUT;
}
const ONE = HAS_F16 ? new Uint16Array(Float16Array.from([1]).buffer)[0] : 1;

const settings = (full) => ({
  halfSize: !full, useCameraWb: true, useCameraMatrix: 1, outputColor: 1, outputBps: 16,
  gamm: [1, 1], noAutoBright: true, bright: BRIGHT, highlight: 2, userFlip: -1, userQual: full ? 3 : 0,
});

async function decode(path, full) {
  const r = await fetch(api.fileUrl(path));
  if (!r.ok) throw new Error('Cannot read RAW file');
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!lib) lib = new LibRaw();
  try {
    await lib.open(bytes, settings(full));
    const meta = await lib.metadata();
    const img = await lib.imageData();
    if (!img || !img.data) throw new Error('LibRaw returned no image');
    const { width, height, colors } = img;
    let d = img.data;
    if (img.bits === 8) d = Uint16Array.from(d, (x) => x * 257);
    const L = lut(), n = width * height;
    const out = HAS_F16 ? new Uint16Array(n * 4) : new Float32Array(n * 4);
    for (let i = 0, j = 0, k = 0; i < n; i++, j += colors, k += 4) {
      out[k] = L[d[j]]; out[k + 1] = L[d[j + 1 < d.length ? j + 1 : j]]; out[k + 2] = L[d[j + 2 < d.length ? j + 2 : j]]; out[k + 3] = ONE;
    }
    return { raw: true, half: HAS_F16, width, height, data: out, meta };
  } catch (e) {
    try { lib.dispose(); } catch {}
    lib = null;
    throw e;
  }
}

// Decode a RAW file. full=false gives a fast half-size (binned, no demosaic) image for editing previews.
export function decodeRaw(path, { full = false } = {}) {
  const key = path + (full ? '|full' : '|half');
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  const pr = (chain = chain.then(() => decode(path, full), () => decode(path, full)));
  cache.set(key, pr);
  pr.catch(() => cache.delete(key));
  // keep memory bounded: 3 half-size + 1 full-size
  const halves = [...cache.keys()].filter((k) => k.endsWith('|half')), fulls = [...cache.keys()].filter((k) => k.endsWith('|full'));
  while (halves.length > 3) cache.delete(halves.shift());
  while (fulls.length > 1) cache.delete(fulls.shift());
  return pr;
}
export function forgetRaw(path) { for (const k of [...cache.keys()]) if (k.startsWith(path + '|')) cache.delete(k); }

// Convert LibRaw metadata into Lightbench's exif fields (fallback when exifr can't parse a format).
export function exifFromMeta(m) {
  if (!m) return null;
  const sh = m.shutter;
  return {
    make: m.camera_make || '', model: m.camera_model || '', lens: m.lens?.Lens || '',
    iso: m.iso_speed || 0, fnum: m.aperture ? +m.aperture.toFixed(1) : 0,
    shutter: !sh ? '' : sh >= 1 ? `${sh}s` : `1/${Math.round(1 / sh)}s`, exposureTime: sh || 0,
    focal: m.focal_len || 0, artist: m.artist || '',
  };
}
export function fullDims(m) {
  if (!m) return null;
  const swap = m.flip === 5 || m.flip === 6;
  return swap ? [m.height, m.width] : [m.width, m.height];
}
