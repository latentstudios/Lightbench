// Composes raster masks (AI base + brush strokes) into engine texture layers.
import { api } from './api.js';
import { rasterKinds, MASK_LAYERS } from './engine.js';

const baseCache = new Map(); // cache key -> HTMLImageElement
export function loadBase(key) {
  if (baseCache.has(key)) return baseCache.get(key);
  const pr = new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('mask missing: ' + key));
    img.src = api.cacheUrl(key);
  });
  baseCache.set(key, pr);
  pr.catch(() => baseCache.delete(key));
  return pr;
}
export function putBase(key, canvasOrImg) {
  baseCache.set(key, Promise.resolve(canvasOrImg));
}

export function drawStroke(ctx, st, W, H) {
  const long = Math.max(W, H);
  const r = Math.max(0.5, st.size * long);
  const hard = 1 - (st.feather ?? 0.5);
  ctx.save();
  ctx.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
  const dab = (x, y) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = st.flow ?? 1;
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(Math.min(0.99, Math.max(0, hard)), `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  };
  const pts = st.pts;
  if (!pts.length) { ctx.restore(); return; }
  let [px, py] = [pts[0][0] * W, pts[0][1] * H];
  dab(px, py);
  const spacing = Math.max(1, r * 0.2);
  for (let i = 1; i < pts.length; i++) {
    const x = pts[i][0] * W, y = pts[i][1] * H;
    const d = Math.hypot(x - px, y - py);
    const n = Math.floor(d / spacing);
    for (let k = 1; k <= n; k++) dab(px + (x - px) * (k / n), py + (y - py) * (k / n));
    if (n > 0) { px = x; py = y; }
  }
  ctx.restore();
}

export async function composeMask(m, W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (m.raster) {
    try { const img = await loadBase(m.raster); ctx.drawImage(img, 0, 0, W, H); } catch (e) { console.warn(e); }
  }
  for (const st of m.strokes || []) drawStroke(ctx, st, W, H);
  return c;
}

// Uploads all raster masks of settings `s` into engine layers. Cheap when nothing changed.
export async function syncMaskLayers(engine, s) {
  if (!engine.ready) return;
  engine._sig = engine._sig || new Map();
  const masks = s.masks.filter((m) => m.enabled !== false && rasterKinds.has(m.kind)).slice(0, MASK_LAYERS);
  const used = new Set();
  let layer = 0;
  for (const m of masks) {
    const sig = maskSig(m, engine);
    // stable layer per mask id when possible
    let L = engine.layerOf.get(m.id);
    if (L == null || used.has(L)) { while (used.has(layer)) layer++; L = layer; }
    used.add(L);
    engine.layerOf.set(m.id, L);
    if (engine._sig.get(L) !== sig) {
      const c = await composeMask(m, engine.maskW, engine.maskH);
      engine.setMaskLayer(L, c);
      engine._sig.set(L, sig);
    }
  }
}
export function maskSig(m, engine) {
  const last = m.strokes.at(-1);
  return m.id + '|' + (m.raster || '') + '|' + m.strokes.length + '|' + (last ? last.pts.length + ':' + last.size + ':' + last.erase : '') + '|' + engine.maskW;
}
// Mark a layer as already up to date (after live painting uploaded it directly).
export function markLayer(engine, m) {
  engine._sig = engine._sig || new Map();
  const L = engine.layerOf.get(m.id);
  if (L != null) engine._sig.set(L, maskSig(m, engine));
}
export function invalidateLayers(engine) { if (engine._sig) engine._sig.clear(); }
