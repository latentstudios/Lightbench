// Previews, thumbnails, EXIF, import pipeline, background thumbnail rendering.
import exifr from '../vendor/exifr/full.esm.mjs'; // exifr 7.1.3, bundled for offline use
import { api } from './api.js';
import { C, S, P, save, emit, uid, srcId, getSettings } from './store.js';
import { Engine } from './engine.js';
import { syncMaskLayers } from './maskraster.js';
import { activity } from './ui.js';
import { decodeRaw, exifFromMeta, fullDims } from './raw.js';
import { applyDenoise } from './denoise.js';
import { defaultsFor } from './settings.js';

export const PREVIEW_SIZE = 2560;
export const THUMB_SIZE = 420;
const RAW = new Set(['cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw', 'x3f', '3fr', 'iiq', 'rwl', 'erf', 'kdc', 'mrw', 'mef', 'mos']);
export const isRawExt = (e) => RAW.has(e);

export const thumbUrl = (p) => api.cacheUrl(`t-${p.id}.jpg`, p.thumbV || 0);
export const previewKey = (p) => `p-${srcId(p)}.jpg`;

async function blobToBitmap(blob) {
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}
function orientBitmap(bmp, o) {
  if (!o || o === 1) return bmp;
  const swap = o >= 5;
  const c = document.createElement('canvas');
  c.width = swap ? bmp.height : bmp.width; c.height = swap ? bmp.width : bmp.height;
  const x = c.getContext('2d');
  const W = bmp.width, H = bmp.height;
  switch (o) {
    case 2: x.transform(-1, 0, 0, 1, W, 0); break;
    case 3: x.transform(-1, 0, 0, -1, W, H); break;
    case 4: x.transform(1, 0, 0, -1, 0, H); break;
    case 5: x.transform(0, 1, 1, 0, 0, 0); break;
    case 6: x.transform(0, 1, -1, 0, H, 0); break;
    case 7: x.transform(0, -1, -1, 0, H, W); break;
    case 8: x.transform(0, -1, 1, 0, 0, W); break;
  }
  x.drawImage(bmp, 0, 0);
  return c;
}
function scaled(img, max) {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
  // step down for quality
  let src = img, w = img.width, h = img.height;
  while (w / 2 > c.width * 1.1) {
    const t = document.createElement('canvas'); t.width = Math.round(w / 2); t.height = Math.round(h / 2);
    const tx = t.getContext('2d'); tx.imageSmoothingQuality = 'high'; tx.drawImage(src, 0, 0, t.width, t.height);
    src = t; w = t.width; h = t.height;
  }
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
export const canvasBlob = (c, type = 'image/jpeg', q = 0.9) => new Promise((res) => c.toBlob(res, type, q));

// Full-resolution original, oriented (EXIF orientation applied).
export async function loadOriginal(p) {
  const r = await fetch(api.fileUrl(p.path, p.raw));
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error; } catch {} throw new Error(m || 'Cannot read file'); }
  const bmp = await blobToBitmap(await r.blob());
  return p.raw ? orientBitmap(bmp, p.rawOrient) : bmp;
}

// ---------- preview cache (memory LRU) ----------
const memo = new Map();
export async function loadPreview(p) {
  const key = previewKey(p);
  if (memo.has(key)) { const v = memo.get(key); memo.delete(key); memo.set(key, v); return v; }
  const pr = (async () => {
    let r = await api.cacheGet(key);
    if (!r) { await buildPreviews(C.photos[srcId(p)] || p); r = await api.cacheGet(key); }
    if (!r) throw new Error('Preview unavailable');
    return blobToBitmap(await r.blob());
  })();
  memo.set(key, pr);
  pr.catch(() => memo.delete(key));
  while (memo.size > 8) memo.delete(memo.keys().next().value);
  return pr;
}
export function forgetPreview(p) { memo.delete(previewKey(p)); }

export async function readExif(p) {
  try {
    const url = p.raw ? api.rawUrl(p.path) : api.fileUrl(p.path);
    const x = await exifr.parse(url, { tiff: true, exif: true, gps: true, ifd1: false, xmp: false, icc: false, iptc: true, translateValues: true, reviveValues: true, mergeOutput: true });
    if (!x) return;
    const date = x.DateTimeOriginal || x.CreateDate || x.ModifyDate;
    p.captureTime = date instanceof Date && !isNaN(date) ? date.getTime() : p.captureTime;
    const fmtShutter = (t) => (!t ? '' : t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}s`);
    p.exif = {
      make: x.Make || '', model: x.Model || '', lens: x.LensModel || x.Lens || '',
      iso: x.ISO || x.ISOSpeedRatings || 0, fnum: x.FNumber || 0, shutter: fmtShutter(x.ExposureTime), exposureTime: x.ExposureTime || 0,
      focal: x.FocalLength || 0, focal35: x.FocalLengthIn35mmFormat || 0, bias: x.ExposureCompensation ?? null,
      flash: typeof x.Flash === 'string' ? x.Flash : '', program: x.ExposureProgram || '', metering: x.MeteringMode || '',
      wb: x.WhiteBalance || '', software: x.Software || '', artist: x.Artist || '', copyright: x.Copyright || '',
      dims: x.ExifImageWidth ? `${x.ExifImageWidth} x ${x.ExifImageHeight}` : '',
    };
    if (x.Orientation && p.raw) p.rawOrient = typeof x.Orientation === 'number' ? x.Orientation : { 'Horizontal (normal)': 1, 'Rotate 180': 3, 'Rotate 90 CW': 6, 'Rotate 270 CW': 8 }[x.Orientation] || 1;
    if (typeof x.latitude === 'number' && typeof x.longitude === 'number' && !(x.latitude === 0 && x.longitude === 0)) p.gps = { lat: x.latitude, lng: x.longitude, alt: x.GPSAltitude || null };
    if (x.Keywords && !p.keywords?.length) p.keywords = [].concat(x.Keywords).map(String);
    if (x.ObjectName && !p.title) p.title = String(x.ObjectName);
    if (x.Caption && !p.caption) p.caption = String(x.Caption);
  } catch (e) { /* no exif */ }
}

// Engine source for a photo. RAW → LibRaw-decoded half-float image (half size unless full); others → bitmap.
export async function loadSource(p, { full = false, noDenoise = false } = {}) {
  const base = C.photos[srcId(p)] || p;
  if (!noDenoise && base.denoise?.on) {
    const orig = await loadSource(base, { full, noDenoise: true });
    try { return await applyDenoise(base, full, orig); }
    catch (e) { console.warn('AI Denoise data unavailable', e); return orig; }
  }
  if (base.raw && base.rawMode !== 'embedded') {
    try { return await decodeRaw(base.path, { full }); }
    catch (e) { console.warn('LibRaw failed, using embedded preview', base.path, e); base.rawMode = 'embedded'; save(); }
  }
  return full ? loadOriginal(base) : loadPreview(base);
}

let previewEngine = null;
async function buildRawPreviews(p) {
  const img = await decodeRaw(p.path);
  const m = img.meta;
  const dims = fullDims(m);
  if (dims) { p.w = dims[0]; p.h = dims[1]; } else { p.w = img.width * 2; p.h = img.height * 2; }
  if (!p.exif?.model) { p.exif = { ...(exifFromMeta(m) || {}), ...(p.exif || {}) }; if (m?.timestamp instanceof Date && !isNaN(m.timestamp) && !p.captureTime) p.captureTime = m.timestamp.getTime(); }
  if (!previewEngine) previewEngine = new Engine(document.createElement('canvas'));
  previewEngine.setSource(img);
  const k = Math.min(1, PREVIEW_SIZE / Math.max(img.width, img.height));
  const prev = previewEngine.renderFull(defaultsFor(p), Math.round(img.width * k), Math.round(img.height * k));
  await api.cachePut(`p-${p.id}.jpg`, await canvasBlob(prev, 'image/jpeg', 0.92));
  const th = scaled(prev, THUMB_SIZE);
  await api.cachePut(`t-${p.id}.jpg`, await canvasBlob(th, 'image/jpeg', 0.85));
  p.rawMode = 'libraw';
  p.thumbV = (p.thumbV || 0) + 1;
  p.previewReady = true;
}

export async function buildPreviews(p) {
  if (p.raw && p.rawMode !== 'embedded') {
    try { await buildRawPreviews(p); memo.delete(previewKey(p)); return; }
    catch (e) { console.warn('LibRaw could not decode', p.path, e); p.rawMode = 'embedded'; }
  }
  if (p.raw && p.rawOrient == null) await readExif(p);
  const img = await loadOriginal(p);
  p.w = img.width; p.h = img.height;
  const prev = scaled(img, PREVIEW_SIZE);
  await api.cachePut(`p-${p.id}.jpg`, await canvasBlob(prev, 'image/jpeg', 0.92));
  const th = scaled(prev, THUMB_SIZE);
  await api.cachePut(`t-${p.id}.jpg`, await canvasBlob(th, 'image/jpeg', 0.85));
  p.thumbV = (p.thumbV || 0) + 1;
  p.previewReady = true;
  if (img.close) img.close();
  return prev;
}

// ---------- import ----------
export async function importFiles(files, { recursiveRoot } = {}) {
  const existing = new Set(Object.values(C.photos).filter((p) => !p.master).map((p) => p.path.toLowerCase()));
  const sep = S.info.sep;
  const fresh = [];
  const batchTime = Date.now();
  for (const f of files) {
    if (existing.has(f.path.toLowerCase())) continue;
    const name = f.path.split(sep).pop();
    const ext = name.split('.').pop().toLowerCase();
    const p = {
      id: uid(), path: f.path, name, ext, folder: f.path.slice(0, f.path.length - name.length - 1),
      size: f.size, mtime: f.mtime, importedAt: batchTime, raw: isRawExt(ext), rating: 0, flag: 0, label: '', keywords: [],
      title: '', caption: '', edits: null, history: [], snapshots: [], thumbV: 0,
    };
    C.photos[p.id] = p; fresh.push(p);
    existing.add(f.path.toLowerCase());
  }
  if (!fresh.length) { emit('toast', 'No new photos to import'); return []; }
  save();
  emit('imported', fresh.map((p) => p.id));
  let done = 0, failed = 0;
  const act = activity(`Importing ${fresh.length} photos`);
  const queue = [...fresh];
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift();
      try {
        await readExif(p);
        await buildPreviews(p);
      } catch (e) { console.warn(p.path, e); p.error = String(e.message || e); failed++; }
      done++;
      act.update(`Importing ${done}/${fresh.length}${failed ? ` (${failed} failed)` : ''}`, done / fresh.length);
      emit('thumb', p.id);
      if (done % 10 === 0) save();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  act.done(`Imported ${fresh.length - failed} photos${failed ? `, ${failed} could not be read` : ''}`);
  save();
  emit('list-changed');
  return fresh;
}

// ---------- background rendering of edited thumbnails ----------
let thumbEngine = null;
const thumbQueue = new Set();
let thumbBusy = false;
export function queueThumb(id) { thumbQueue.add(id); if (!thumbBusy) setTimeout(runThumbs, 300); }
async function runThumbs() {
  if (thumbBusy) return;
  thumbBusy = true;
  try {
    while (thumbQueue.size) {
      const id = thumbQueue.values().next().value; thumbQueue.delete(id);
      const p = P(id); if (!p) continue;
      try { await renderThumb(p); } catch (e) { console.warn('thumb', e); }
    }
  } finally { thumbBusy = false; }
}
export async function renderThumb(p) {
  const bmp = await loadSource(p);
  if (!thumbEngine) thumbEngine = new Engine(document.createElement('canvas'));
  const s = getSettings(p);
  thumbEngine.setSource(bmp);
  await syncMaskLayers(thumbEngine, s);
  const [ow, oh] = thumbEngine.outputSize(s);
  const k = Math.min(1, THUMB_SIZE / Math.max(ow, oh));
  const c = thumbEngine.renderFull(s, Math.max(1, Math.round(ow * k)), Math.max(1, Math.round(oh * k)));
  await api.cachePut(`t-${p.id}.jpg`, await canvasBlob(c, 'image/jpeg', 0.85));
  p.thumbV = (p.thumbV || 0) + 1;
  save();
  emit('thumb', p.id);
}

// Render a full-size (or scaled) final image for export.
let exportEngine = null;
export async function renderFinal(p, { maxW = 0, maxH = 0, longEdge = 0, shortEdge = 0, megapixels = 0, useOriginal = true, sharpenBoost = 0 } = {}) {
  let img;
  try { img = await loadSource(p, { full: useOriginal }); }
  catch (e) { if (!useOriginal) throw e; img = await loadSource(p); } // original missing → fall back to preview
  if (!exportEngine) exportEngine = new Engine(document.createElement('canvas'));
  const s = getSettings(p);
  if (sharpenBoost) s.sharpen.amount = Math.min(150, s.sharpen.amount + sharpenBoost);
  exportEngine.setSource(img);
  exportEngine._sig && exportEngine._sig.clear();
  await syncMaskLayers(exportEngine, s);
  let [ow, oh] = exportEngine.outputSize(s);
  let k = 1;
  if (longEdge) k = Math.min(1, longEdge / Math.max(ow, oh));
  if (shortEdge) k = Math.min(1, shortEdge / Math.min(ow, oh));
  if (maxW || maxH) k = Math.min(1, maxW ? maxW / ow : 1, maxH ? maxH / oh : 1);
  if (megapixels) k = Math.min(1, Math.sqrt((megapixels * 1e6) / (ow * oh)));
  const w = Math.max(1, Math.round(ow * k)), h = Math.max(1, Math.round(oh * k));
  const c = exportEngine.renderFull(s, w, h);
  if (img.close) img.close();
  return c;
}
