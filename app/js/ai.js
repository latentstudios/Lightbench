// Main-thread AI client: masks, auto-tagging, semantic search, similarity, sharpness culling.
import { api } from './api.js';
import { C, P, S, save, emit, srcId } from './store.js';
import { previewKey, loadPreview } from './imaging.js';
import { activity, toast } from './ui.js';

let worker = null, seq = 0;
const pending = new Map();
const dl = new Map(); let dlAct = null;
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const d = e.data;
    if (d.type === 'progress') {
      if (d.done) dl.delete(d.model);
      else dl.set(d.model + d.file, { model: d.model, loaded: d.loaded, total: d.total });
      const items = [...dl.values()];
      if (items.length) {
        if (!dlAct) dlAct = activity('Loading AI model…');
        const L = items.reduce((a, b) => a + b.loaded, 0), T = items.reduce((a, b) => a + b.total, 0);
        // the same progress fires whether the file comes from disk (fast) or the internet (first time only)
        dlAct.update(`Loading ${items[0].model} — ${(L / 1048576).toFixed(0)} / ${(T / 1048576).toFixed(0)} MB`, L / T);
        if (L >= T) { for (const [k, v] of dl) if (v.loaded >= v.total) dl.delete(k); }
      }
      if (!dl.size && dlAct) { dlAct.done(); dlAct = null; }
      return;
    }
    const p = pending.get(d.id); if (!p) return;
    pending.delete(d.id);
    d.error ? p.reject(new Error(d.error)) : p.resolve(d.result);
  };
  worker.onerror = (e) => { console.error('AI worker error', e); toast('AI engine failed to start: ' + (e.message || 'see console'), true, 6000); };
  return worker;
}
export function run(task, args) {
  const w = getWorker(), id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); w.postMessage({ id, task, args }); });
}

const prevUrl = (p) => location.origin + api.cacheUrl(previewKey(p));

// ---------- masks ----------
// Region groups → COCO-panoptic (DETR) base labels.
export const LANDSCAPE = {
  Sky: ['sky', 'clouds', 'fog'],
  Water: ['water', 'sea', 'river', 'waterdrops'],
  Vegetation: ['tree', 'grass', 'bush', 'leaves', 'flower', 'plant', 'moss', 'potted plant', 'branch'],
  Mountains: ['mountain', 'hill', 'rock', 'stone'],
  Architecture: ['building', 'house', 'roof', 'bridge', 'skyscraper', 'tent', 'fence', 'wall', 'wall brick', 'wall stone', 'wall concrete', 'wall panel', 'wall tile', 'wall wood', 'window', 'door stuff', 'structural'],
  'Natural Ground': ['dirt', 'sand', 'snow', 'gravel', 'mud', 'ground', 'playingfield', 'straw'],
  'Artificial Ground': ['road', 'pavement', 'railroad', 'platform', 'floor', 'floor wood', 'floor tile', 'floor stone', 'floor marble', 'rug', 'carpet', 'stairs', 'mat'],
};

// Sky completion: learn the sky's colour from the confidently detected region, then grow into
// connected pixels of similar colour (catches sky between branches that the coarse detector misses).
async function growSky(p, u8, w, h) {
  const bmp = await loadPreview(p);
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d');
  x.drawImage(bmp, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, n = w * h;
  let sr = 0, sg = 0, sb = 0, cnt = 0;
  for (let i = 0; i < n; i++) if (u8[i] > 200) { sr += d[i * 4]; sg += d[i * 4 + 1]; sb += d[i * 4 + 2]; cnt++; }
  if (cnt < 50) return u8;
  const mr = sr / cnt, mg = sg / cnt, mb = sb / cnt;
  let vs = 0;
  for (let i = 0; i < n; i++) if (u8[i] > 200) { const dr = d[i * 4] - mr, dg = d[i * 4 + 1] - mg, db = d[i * 4 + 2] - mb; vs += dr * dr + dg * dg + db * db; }
  const tol = Math.min(70, Math.max(22, 2.5 * Math.sqrt(vs / cnt))); // colour tolerance (0-255 units)
  const minLum = Math.min(mr, mg, mb) * 0.55;
  const out = new Uint8Array(u8), queue = new Int32Array(n); let qh = 0, qt = 0;
  for (let i = 0; i < n; i++) if (u8[i] > 200) queue[qt++] = i;
  const ok = (j) => { const dr = d[j * 4] - mr, dg = d[j * 4 + 1] - mg, db = d[j * 4 + 2] - mb; return Math.sqrt(dr * dr + dg * dg + db * db) < tol && Math.min(d[j * 4], d[j * 4 + 1], d[j * 4 + 2]) > minLum; };
  while (qh < qt) {
    const j = queue[qh++], jx = j % w;
    for (const k of [j - 1, j + 1, j - w, j + w]) {
      if (k < 0 || k >= n || out[k] > 200 || (k === j - 1 && jx === 0) || (k === j + 1 && jx === w - 1)) continue;
      if (ok(k)) { out[k] = 255; queue[qt++] = k; }
    }
  }
  return out;
}

// Sky can't be below the horizon: drop detached "sky" patches whose centre lies below the bottom
// of the main sky region (bright foreground reeds/water the detector sometimes mislabels).
function pruneBelowHorizon(u8, w, h) {
  const n = w * h, lab = new Int32Array(n), stack = new Int32Array(n), comps = [null];
  for (let i = 0; i < n; i++) {
    if (u8[i] < 128 || lab[i]) continue;
    const id = comps.length; let sp = 0, size = 0, sumY = 0, maxY = 0;
    stack[sp++] = i; lab[i] = id;
    while (sp) {
      const j = stack[--sp], x = j % w, y = (j / w) | 0; size++; sumY += y; if (y > maxY) maxY = y;
      if (x > 0 && !lab[j - 1] && u8[j - 1] >= 128) { lab[j - 1] = id; stack[sp++] = j - 1; }
      if (x < w - 1 && !lab[j + 1] && u8[j + 1] >= 128) { lab[j + 1] = id; stack[sp++] = j + 1; }
      if (y > 0 && !lab[j - w] && u8[j - w] >= 128) { lab[j - w] = id; stack[sp++] = j - w; }
      if (y < h - 1 && !lab[j + w] && u8[j + w] >= 128) { lab[j + w] = id; stack[sp++] = j + w; }
    }
    comps.push({ size, cy: sumY / size, maxY });
  }
  if (comps.length < 3) return u8;
  let main = 1; for (let k = 2; k < comps.length; k++) if (comps[k].size > comps[main].size) main = k;
  const horizon = comps[main].maxY + h * 0.02, big = comps[main].size * 0.3;
  const drop = new Uint8Array(comps.length);
  for (let k = 1; k < comps.length; k++) if (k !== main && comps[k].cy > horizon && comps[k].size < big) drop[k] = 1;
  const out = new Uint8Array(u8);
  // remove dropped components plus their soft (sub-threshold) fringe
  const kill = new Uint8Array(n); for (let i = 0; i < n; i++) if (lab[i] && drop[lab[i]]) kill[i] = 1;
  const grow = dilate(kill, w, h, Math.max(2, Math.round(Math.max(w, h) * 0.006)));
  for (let i = 0; i < n; i++) if (grow[i] && !(lab[i] && !drop[lab[i]])) out[i] = 0;
  return out;
}

// Edge-aware refinement (guided filter, He et al. 2010): snaps a coarse mask to edges in the photo.
async function refineToEdges(p, u8, w, h) {
  const bmp = await loadPreview(p);
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d');
  x.drawImage(bmp, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, n = w * h;
  const I = new Float32Array(n), P = new Float32Array(n);
  for (let i = 0; i < n; i++) { I[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255; P[i] = u8[i] / 255; }
  const r = Math.max(2, Math.round(Math.max(w, h) * 0.006)), eps = 2e-3;
  const box = (src) => { // mean over (2r+1)^2 window, separable running sums
    const tmp = new Float32Array(n), out = new Float32Array(n);
    for (let y = 0; y < h; y++) { let s = 0; const o = y * w; for (let k = -r; k <= r; k++) s += src[o + Math.min(w - 1, Math.max(0, k))]; for (let xx = 0; xx < w; xx++) { tmp[o + xx] = s; s += src[o + Math.min(w - 1, xx + r + 1)] - src[o + Math.max(0, xx - r)]; } }
    const k2 = (2 * r + 1) * (2 * r + 1);
    for (let xx = 0; xx < w; xx++) { let s = 0; for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + xx]; for (let y = 0; y < h; y++) { out[y * w + xx] = s / k2; s += tmp[Math.min(h - 1, y + r + 1) * w + xx] - tmp[Math.max(0, y - r) * w + xx]; } }
    return out;
  };
  const mI = box(I), mP = box(P), IP = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { IP[i] = I[i] * P[i]; II[i] = I[i] * I[i]; }
  const mIP = box(IP), mII = box(II), a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = mII[i] - mI[i] * mI[i]; a[i] = (mIP[i] - mI[i] * mP[i]) / (v + eps); b[i] = mP[i] - a[i] * mI[i]; }
  const ma = box(a), mb = box(b), out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, Math.round((ma[i] * I[i] + mb[i]) * 255)));
  return out;
}

// ---------- mask cleanup ----------
// Removes stray speckles / islands so AI masks don't "spill" onto unrelated parts of the photo.
//  minFrac: drop regions smaller than this fraction of the image
//  relLargest: drop regions smaller than this fraction of the largest region
//  seeds: [[x,y] normalized] — if given, keep only regions containing (or very near) a seed, plus big regions
export function cleanMask(u8, w, h, { minFrac = 0.002, relLargest = 0, seeds = null, floor = 14 } = {}) {
  const n = w * h, lab = new Int32Array(n), sizes = [0];
  const stack = new Int32Array(n);
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (u8[i] < 128 || lab[i]) continue;
    next++; let sp = 0, size = 0; stack[sp++] = i; lab[i] = next;
    while (sp) {
      const j = stack[--sp]; size++;
      const x = j % w, y = (j / w) | 0;
      if (x > 0 && !lab[j - 1] && u8[j - 1] >= 128) { lab[j - 1] = next; stack[sp++] = j - 1; }
      if (x < w - 1 && !lab[j + 1] && u8[j + 1] >= 128) { lab[j + 1] = next; stack[sp++] = j + 1; }
      if (y > 0 && !lab[j - w] && u8[j - w] >= 128) { lab[j - w] = next; stack[sp++] = j - w; }
      if (y < h - 1 && !lab[j + w] && u8[j + w] >= 128) { lab[j + w] = next; stack[sp++] = j + w; }
    }
    sizes.push(size);
  }
  if (!next) return { mask: u8, area: 0 };
  const largest = Math.max(...sizes);
  const keep = new Uint8Array(next + 1);
  for (let k = 1; k <= next; k++) keep[k] = sizes[k] >= Math.max(minFrac * n, relLargest * largest) ? 1 : 0;
  if (seeds?.length) {
    const near = new Uint8Array(next + 1);
    for (const [sx, sy] of seeds) {
      const cx = Math.round(sx * (w - 1)), cy = Math.round(sy * (h - 1)), r = Math.max(2, Math.round(Math.min(w, h) * 0.01));
      for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) { const l = lab[y * w + x]; if (l) near[l] = 1; }
    }
    if (near.some((v) => v)) for (let k = 1; k <= next; k++) keep[k] = near[k] || sizes[k] >= largest * 0.5 ? 1 : 0;
  }
  // soft (sub-threshold) edge pixels follow the nearest kept region: dilate the kept set a few px
  const kept = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (lab[i] && keep[lab[i]]) kept[i] = 1;
  const grow = dilate(kept, w, h, Math.max(2, Math.round(Math.max(w, h) * 0.006)));
  const out = new Uint8Array(n); let area = 0;
  for (let i = 0; i < n; i++) { const v = u8[i] < floor ? 0 : u8[i]; out[i] = lab[i] ? (keep[lab[i]] ? v : 0) : grow[i] ? v : 0; if (out[i] >= 128) area++; }
  return { mask: out, area: area / n };
}
function dilate(bin, w, h, r) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let run = -1e9; for (let x = 0; x < w; x++) { if (bin[y * w + x]) run = x; tmp[y * w + x] = x - run <= r ? 1 : 0; } run = 1e9; for (let x = w - 1; x >= 0; x--) { if (bin[y * w + x]) run = x; if (run - x <= r) tmp[y * w + x] = 1; } }
  for (let x = 0; x < w; x++) { let run = -1e9; for (let y = 0; y < h; y++) { if (tmp[y * w + x]) run = y; out[y * w + x] = y - run <= r ? 1 : 0; } run = 1e9; for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) run = y; if (run - y <= r) out[y * w + x] = 1; } }
  return out;
}

function maskCanvas(u8, w, h, feather = 0) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(w, h);
  for (let i = 0; i < u8.length; i++) { const j = i * 4; id.data[j] = id.data[j + 1] = id.data[j + 2] = 255; id.data[j + 3] = u8[i]; }
  ctx.putImageData(id, 0, 0);
  if (feather > 0) {
    const t = document.createElement('canvas'); t.width = w; t.height = h;
    const tx = t.getContext('2d'); tx.filter = `blur(${feather}px)`; tx.drawImage(c, 0, 0);
    return t;
  }
  return c;
}
export async function aiMask(p, kind, { w, h, labels, points } = {}) {
  await loadPreview(p); // ensures preview exists on server
  const url = prevUrl(p);
  let r, clean, refine = false;
  if (kind === 'subject') { r = await run('subject', { url, w, h }); clean = { minFrac: 0.004, relLargest: 0.08 }; }
  // Sky/landscape regions are legitimately fragmented (sky through leaves), so only remove tiny specks.
  else if (kind === 'sky') { r = await run('semantic', { url, w, h, labels: LANDSCAPE.Sky }); clean = { minFrac: 0.00012 }; refine = true; }
  else if (kind === 'landscape') { r = await run('semantic', { url, w, h, labels }); clean = { minFrac: 0.00012 }; refine = true; }
  else if (kind === 'people') {
    r = await run('semantic', { url, w, h, labels: ['person'] });
    if (!r.found) throw new Error('No people were detected in this photo');
    clean = { minFrac: 0.002 }; refine = true;
  }
  else if (kind === 'point') { r = await run('samPoint', { url, w, h, points }); clean = { minFrac: 0.0005, seeds: points.filter((p) => (p[2] ?? 1) === 1) }; }
  else throw new Error('unknown mask kind');
  if (r.found === 0) throw new Error('Nothing of that kind was detected in this photo');
  let c = cleanMask(r.mask, w, h, clean);
  if (c.area < 0.0005 && kind !== 'point') throw new Error('Nothing of that kind was detected in this photo');
  if (kind === 'sky') c = { ...c, mask: pruneBelowHorizon(await growSky(p, pruneBelowHorizon(c.mask, w, h), w, h), w, h) };
  if (refine) c = { ...c, mask: await refineToEdges(p, c.mask, w, h) };
  return maskCanvas(c.mask, w, h, kind === 'point' ? 0.6 : refine ? 0.4 : 0.8);
}
export async function detectObjects(p, w, h) {
  await loadPreview(p);
  const r = await run('objects', { url: prevUrl(p), w, h, withMasks: true });
  return r.objects.map((o) => ({ ...o, canvas: maskCanvas(cleanMask(o.mask, w, h, { minFrac: 0.0005, relLargest: 0.15 }).mask, w, h, 0.6) }));
}
export async function presentRegions(p) {
  await loadPreview(p);
  return run('present', { url: prevUrl(p) });
}
export function warmSAM(p) { return loadPreview(p).then(() => run('samEmbed', { url: prevUrl(p) })); }
// Opening the Masking panel loads the one-click mask models in the background (only if already downloaded),
// so the first Subject / Sky click doesn't wait for model loading.
let prewarmed = false;
export async function prewarm() {
  if (prewarmed) return; prewarmed = true;
  try {
    const { packReady } = await import('./models.js');
    for (const [pack, which] of [['subject', 'subject'], ['scene', 'panoptic']]) if (await packReady(pack)) await run('warm', { which });
  } catch { prewarmed = false; }
}

// ---------- vocabulary for auto-tagging ----------
const VOCAB = {
  scene: ['beach', 'mountains', 'forest', 'city street', 'city skyline', 'desert', 'snowy landscape', 'lake', 'river', 'ocean', 'waterfall', 'meadow', 'garden', 'park', 'countryside', 'farm', 'vineyard', 'living room', 'bedroom', 'kitchen', 'restaurant', 'cafe', 'bar', 'concert', 'stadium', 'office', 'classroom', 'church', 'temple', 'museum', 'airport', 'train station', 'highway', 'bridge', 'harbor', 'island', 'cave', 'canyon', 'night sky with stars', 'aurora', 'sunset', 'sunrise', 'foggy landscape', 'rainy street', 'thunderstorm', 'underwater', 'wedding', 'party', 'festival', 'market', 'shopping mall', 'gym', 'swimming pool', 'playground', 'zoo', 'aquarium', 'studio backdrop', 'construction site', 'parking lot', 'alley', 'rooftop', 'castle', 'ruins', 'jungle', 'savanna', 'glacier', 'volcano', 'cliffs', 'coastline'],
  subject: ['person', 'portrait of a face', 'group of people', 'child', 'baby', 'couple', 'selfie', 'crowd', 'dog', 'cat', 'bird', 'horse', 'cow', 'sheep', 'wild animal', 'insect', 'butterfly', 'fish', 'flowers', 'tree', 'food', 'dessert', 'drink', 'coffee', 'car', 'motorcycle', 'bicycle', 'boat', 'airplane', 'train', 'building', 'architecture', 'house', 'interior design', 'street art', 'sculpture', 'text document', 'screenshot', 'painting', 'toy', 'computer', 'smartphone', 'book', 'fashion', 'shoes', 'jewelry', 'watch', 'sports', 'soccer', 'basketball', 'skiing', 'surfing', 'hiking', 'camping tent', 'fireworks', 'christmas decorations', 'birthday cake', 'musical instrument', 'guitar', 'camera', 'moon', 'clouds', 'rainbow', 'lightning', 'snow', 'leaves', 'mushroom', 'fruit', 'vegetables', 'pizza', 'sushi', 'wine', 'beer', 'cocktail', 'bride', 'graduation', 'baby animal', 'pet', 'reptile', 'statue', 'lighthouse', 'tower', 'stairs', 'window', 'door', 'road', 'sign', 'neon lights'],
  style: ['black and white photo', 'macro close-up', 'aerial drone view', 'long exposure', 'silhouette', 'bokeh background', 'minimalist', 'night photography', 'golden hour light', 'blue hour', 'vintage film look', 'motion blur', 'wide landscape', 'symmetry', 'reflection', 'high key bright', 'low key dark', 'vibrant colorful', 'pastel colors', 'abstract', 'pattern texture', 'candid street photography', 'studio lighting', 'backlit', 'panorama'],
};
const THRESH = { scene: 0.22, subject: 0.1, style: 0.3 };
const MAX = { scene: 2, subject: 4, style: 2 };
let vocabEmb = null;
async function getVocab() {
  if (vocabEmb) return vocabEmb;
  const all = Object.entries(VOCAB).flatMap(([g, ls]) => ls.map((l) => ({ g, l })));
  const key = 'vocab-' + all.length + '-' + all.map((x) => x.l).join('').length + '.bin';
  let embs = null;
  const r = await api.cacheGet(key);
  if (r) {
    const buf = new Float32Array(await r.arrayBuffer());
    if (buf.length === all.length * 512) embs = all.map((_, i) => buf.subarray(i * 512, (i + 1) * 512));
  }
  if (!embs) {
    embs = [];
    for (let i = 0; i < all.length; i += 32) {
      const { embeddings } = await run('clipText', { texts: all.slice(i, i + 32).map((x) => `a photo of ${x.l}`) });
      embs.push(...embeddings);
    }
    const flat = new Float32Array(all.length * 512); embs.forEach((e, i) => flat.set(e, i * 512));
    api.cachePut(key, flat);
  }
  vocabEmb = all.map((x, i) => ({ ...x, e: embs[i] }));
  return vocabEmb;
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// ---------- embeddings store ----------
const embMem = new Map();
const embKey = (p) => `e-${srcId(p)}.bin`;
export async function getEmbedding(p, compute = false) {
  const k = embKey(p);
  if (embMem.has(k)) return embMem.get(k);
  if (p.ai?.emb || C.photos[srcId(p)]?.ai?.emb) {
    const r = await api.cacheGet(k);
    if (r) { const e = new Float32Array(await r.arrayBuffer()); embMem.set(k, e); return e; }
  }
  if (!compute) return null;
  await loadPreview(p);
  const { embedding } = await run('clipImage', { url: prevUrl(p) });
  embMem.set(k, embedding);
  await api.cachePut(k, embedding);
  return embedding;
}

// Laplacian-variance sharpness score from a downsampled preview.
async function sharpness(p) {
  const bmp = await loadPreview(p);
  const k = 512 / Math.max(bmp.width, bmp.height);
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d');
  x.drawImage(bmp, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  // use the sharpest 3x3 tiles (subject is often only part of the frame)
  const tiles = [];
  const tw = Math.floor(w / 3), th = Math.floor(h / 3);
  for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) {
    let s = 0, s2 = 0, n = 0;
    for (let y = Math.max(1, ty * th); y < Math.min(h - 1, (ty + 1) * th); y++) for (let x2 = Math.max(1, tx * tw); x2 < Math.min(w - 1, (tx + 1) * tw); x2++) {
      const i = y * w + x2, L = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      s += L; s2 += L * L; n++;
    }
    tiles.push(n ? s2 / n - (s / n) ** 2 : 0);
  }
  tiles.sort((a, b) => b - a);
  return (tiles[0] + tiles[1]) / 2;
}

// ---------- analysis (auto-tag) ----------
let analyzing = false;
const analyzeQueue = [];
export function analyze(ids, { force = false } = {}) {
  for (const id of ids) { const p = P(id); if (p && (force || !p.ai?.at) && !analyzeQueue.includes(id)) analyzeQueue.push(id); }
  if (!analyzing) runAnalysis();
  else toast(`Added to AI analysis queue (${analyzeQueue.length} waiting)`);
}
async function runAnalysis() {
  if (!analyzeQueue.length) { toast('All selected photos are already analyzed'); return; }
  analyzing = true;
  const total = analyzeQueue.length; let done = 0;
  const act = activity('AI analysis: loading models…');
  try {
    const vocab = await getVocab();
    while (analyzeQueue.length) {
      const p = P(analyzeQueue.shift()); if (!p) continue;
      act.update(`AI analysis ${done + 1}/${done + 1 + analyzeQueue.length}: ${p.name}`, done / (done + 1 + analyzeQueue.length));
      try {
        const emb = await getEmbedding(p, true);
        const tags = [];
        for (const g of Object.keys(VOCAB)) {
          const items = vocab.filter((v) => v.g === g).map((v) => ({ l: v.l, s: dot(emb, v.e) * 100 }));
          const mx = Math.max(...items.map((i) => i.s));
          const ex = items.map((i) => ({ l: i.l, p: Math.exp(i.s - mx) }));
          const Z = ex.reduce((a, b) => a + b.p, 0);
          ex.forEach((i) => (i.p /= Z));
          ex.sort((a, b) => b.p - a.p).slice(0, MAX[g]).filter((i) => i.p >= THRESH[g]).forEach((i) => tags.push({ label: i.l, score: +i.p.toFixed(3), group: g }));
        }
        let objects = [];
        try {
          const r = await run('objects', { url: prevUrl(p), w: 8, h: 8, withMasks: false });
          const best = new Map();
          for (const o of r.objects) if (o.area > 0.004 && o.score >= 0.9) { const b = best.get(o.label); if (!b) best.set(o.label, { label: o.label, score: +o.score.toFixed(3), count: 1, box: o.box, area: o.area }); else { b.count++; b.area += o.area; } }
          objects = [...best.values()].sort((a, b) => b.area - a.area);
        } catch (e) { console.warn('objects', e); }
        const sharp = await sharpness(p);
        const target = C.photos[p.id];
        target.ai = { at: Date.now(), emb: true, tags, objects, sharp: +sharp.toFixed(1), blurry: sharp < 60 };
        // propagate to virtual copies that share the source
        for (const v of Object.values(C.photos)) if (v.master === p.id) v.ai = target.ai;
        emit('ai', p.id);
      } catch (e) { console.warn('analyze', p.path, e); toast(`AI analysis failed for ${p.name}: ${e.message}`, true); }
      done++;
      if (done % 5 === 0) save();
    }
  } catch (e) { toast('AI analysis failed: ' + e.message, true, 6000); }
  analyzing = false;
  save();
  act.done(`AI analysis finished (${done} photos)`);
  emit('list-changed');
}

// ---------- semantic search & similarity ----------
async function rank(vec, ids) {
  const scores = new Map();
  for (const id of ids) {
    const p = P(id); if (!p?.ai?.emb) continue;
    const e = await getEmbedding(p); if (!e) continue;
    scores.set(id, dot(vec, e));
  }
  return scores;
}
export async function semanticSearch(query) {
  const all = Object.keys(C.photos);
  const analyzed = all.filter((id) => P(id).ai?.emb);
  if (!analyzed.length) { toast('Run “AI Analyze” on your photos first to enable natural-language search', true, 5000); return null; }
  const act = activity('AI search…');
  try {
    const { embeddings } = await run('clipText', { texts: [`a photo of ${query}`, query] });
    const q = embeddings[0].map((v, i) => (v + embeddings[1][i]) / 2);
    const scores = await rank(q, analyzed);
    const max = Math.max(...scores.values());
    const res = new Map([...scores].filter(([, s]) => s >= Math.max(0.18, max - 0.05)));
    act.done(`AI search: ${res.size} matches${analyzed.length < all.length ? ` (${all.length - analyzed.length} photos not analyzed yet)` : ''}`);
    return res;
  } catch (e) { act.done(); toast('AI search failed: ' + e.message, true); return null; }
}
export async function findSimilar(p, threshold = 0.86) {
  const e = await getEmbedding(p, true);
  const ids = Object.keys(C.photos).filter((id) => P(id).ai?.emb || id === p.id);
  const scores = await rank(e, ids);
  scores.set(p.id, 1);
  return new Map([...scores].filter(([, s]) => s >= threshold));
}
// Group near-duplicates among ids (for culling).
export async function duplicateGroups(ids, threshold = 0.94) {
  const embs = [];
  for (const id of ids) { const p = P(id); const e = p?.ai?.emb ? await getEmbedding(p) : null; if (e) embs.push([id, e]); }
  const used = new Set(), groups = [];
  for (let i = 0; i < embs.length; i++) {
    if (used.has(embs[i][0])) continue;
    const g = [embs[i][0]];
    for (let j = i + 1; j < embs.length; j++) if (!used.has(embs[j][0]) && dot(embs[i][1], embs[j][1]) >= threshold) { g.push(embs[j][0]); used.add(embs[j][0]); }
    if (g.length > 1) groups.push(g);
    used.add(embs[i][0]);
  }
  return groups;
}
