// Interactive Develop tools drawn on the overlay canvas: crop, spot heal, mask brushes/gradients, AI point select, pickers.
import { geomOutToRaw } from './engine.js';
import { composeMask, drawStroke, markLayer } from './maskraster.js';
import { loadPreview } from './imaging.js';
import { prefs } from './ui.js';

const dpr = () => devicePixelRatio || 1;

// ---------- raw-space pixel access (for auto source / color sampling / straighten) ----------
const rawCache = new Map();
export async function rawData(p, max = 1024) {
  const key = (p.master || p.id) + ':' + max;
  if (rawCache.has(key)) return rawCache.get(key);
  const bmp = await loadPreview(p);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d');
  x.drawImage(bmp, 0, 0, w, h);
  const d = { w, h, data: x.getImageData(0, 0, w, h).data };
  rawCache.clear(); rawCache.set(key, d);
  return d;
}
export function sampleRaw(d, rx, ry, rad = 2) {
  let r = 0, g = 0, b = 0, n = 0;
  const cx = Math.round(rx * (d.w - 1)), cy = Math.round(ry * (d.h - 1));
  for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) {
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) continue;
    const i = (y * d.w + x) * 4; r += d.data[i]; g += d.data[i + 1]; b += d.data[i + 2]; n++;
  }
  return n ? [r / n / 255, g / n / 255, b / n / 255] : [0, 0, 0];
}

// Detect horizon/vertical tilt (degrees, to apply as crop angle).
export async function autoStraightenAngle(p, s) {
  const d = await rawData(p, 700);
  const { w, h, data } = d;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const bins = new Float32Array(241); // -12..12 deg, 0.1 step
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1];
    const gy = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1];
    const m = Math.hypot(gx, gy);
    if (m < 60) continue;
    const line = (Math.atan2(gy, gx) * 180) / Math.PI + 90;
    const dev = ((((line + 45) % 90) + 90) % 90) - 45;
    if (Math.abs(dev) > 12) continue;
    bins[Math.round((dev + 12) * 10)] += m;
  }
  const sm = new Float32Array(241);
  for (let i = 0; i < 241; i++) for (let k = -4; k <= 4; k++) { const j = i + k; if (j >= 0 && j < 241) sm[i] += bins[j] * (5 - Math.abs(k)); }
  let best = 120; for (let i = 0; i < 241; i++) if (sm[i] > sm[best]) best = i;
  const avg = sm.reduce((a, b) => a + b, 0) / 241;
  if (sm[best] < avg * 2.2) return null;
  let dev = best / 10 - 12;
  if (s.orient.flipH !== s.orient.flipV) dev = -dev;
  return Math.abs(dev) < 0.15 ? 0 : -dev;
}

// ---------- CROP ----------
export function aspectValue(aspect, s, W, H) {
  const rot = s.orient.rot % 2, oW = rot ? H : W, oH = rot ? W : H;
  if (aspect === 'free') return null;
  if (aspect === 'original') return oW / oH;
  const [a, b] = aspect.split(':').map(Number);
  const r = a / b;
  // match current crop orientation
  const cur = (s.crop.w * oW) / (s.crop.h * oH);
  return (cur >= 1) === (r >= 1) ? r : 1 / r;
}
function cornersInside(c, s, W, H) {
  for (const [px, py] of [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]]) {
    const [rx, ry] = geomOutToRaw(s, W, H, px, py, true);
    if (rx < -1e-4 || ry < -1e-4 || rx > 1.0001 || ry > 1.0001) return false;
  }
  return true;
}
export function fitCrop(c, s, W, H) {
  c = { ...c };
  c.w = Math.min(1, c.w); c.h = Math.min(1, c.h);
  c.x = Math.min(1 - c.w, Math.max(0, c.x)); c.y = Math.min(1 - c.h, Math.max(0, c.y));
  if (cornersInside(c, s, W, H)) return c;
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2, t = { x: cx - (c.w * m) / 2, y: cy - (c.h * m) / 2, w: c.w * m, h: c.h * m };
    if (cornersInside(t, s, W, H)) lo = m; else hi = m;
  }
  // if shrinking about this center fails badly, pull toward image center
  let out = { x: cx - (c.w * lo) / 2, y: cy - (c.h * lo) / 2, w: c.w * lo, h: c.h * lo };
  if (lo < 0.5) {
    const t2 = fitCrop({ ...c, x: 0.5 - c.w / 2, y: 0.5 - c.h / 2 }, { ...s, crop: s.crop }, W, H);
    if (t2.w > out.w) out = t2;
  }
  return out;
}
export function constrainAspect(c, ratio, s, W, H) {
  if (!ratio) return c;
  const rot = s.orient.rot % 2, oW = rot ? H : W, oH = rot ? W : H;
  const k = (ratio * oH) / oW; // w_n / h_n
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  let w = c.w, h = c.w / k;
  if (h > 1) { h = 1; w = h * k; }
  if (w > 1) { w = 1; h = w / k; }
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function cropTool(D) {
  const t = { ignoreCrop: true, cursor: 'crosshair', pad: 48 * dpr(), lock: prefs.get('cropLock', true), overlay: prefs.get('cropOverlay', 'thirds') };
  let drag = null;
  const S = () => D.s;
  const WH = () => [D.viewer.engine.W, D.viewer.engine.H];
  const rectPx = (v) => { const c = S().crop; const [x0, y0] = v.outToCanvas(c.x, c.y); const [x1, y1] = v.outToCanvas(c.x + c.w, c.y + c.h); return [x0, y0, x1, y1]; };
  const HANDLES = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
  const hit = (e, v) => {
    const r = v.canvas.getBoundingClientRect(); const mx = (e.clientX - r.left) * dpr(), my = (e.clientY - r.top) * dpr();
    const [x0, y0, x1, y1] = rectPx(v), tol = 12 * dpr();
    for (const [k, [fx, fy]] of Object.entries(HANDLES)) if (Math.hypot(x0 + (x1 - x0) * fx - mx, y0 + (y1 - y0) * fy - my) < tol) return k;
    if (mx > x0 && mx < x1 && my > y0 && my < y1) return 'move';
    return 'rotate';
  };
  t.hover = (e, v) => {
    if ((e.ctrlKey || e.metaKey)) { v.overlay.style.cursor = 'crosshair'; return; }
    const h = hit(e, v);
    v.overlay.style.cursor = { move: 'move', rotate: 'alias', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }[h];
  };
  t.down = (e, v) => {
    const p = v.clientToOut(e.clientX, e.clientY);
    if ((e.ctrlKey || e.metaKey)) { drag = { mode: 'level', a: [e.clientX, e.clientY], b: [e.clientX, e.clientY] }; return; }
    const r = v.canvas.getBoundingClientRect();
    const c = S().crop;
    const [cx, cy] = v.outToCanvas(c.x + c.w / 2, c.y + c.h / 2);
    drag = { mode: hit(e, v), p, crop: { ...c }, angle: c.angle, a0: Math.atan2((e.clientY - r.top) * dpr() - cy, (e.clientX - r.left) * dpr() - cx), center: [cx, cy] };
  };
  t.move = (e, v) => {
    if (!drag) return;
    const s = S(), [W, H] = WH();
    if (drag.mode === 'level') { drag.b = [e.clientX, e.clientY]; v._overlay(); return; }
    if (drag.mode === 'rotate') {
      const r = v.canvas.getBoundingClientRect();
      const a = Math.atan2((e.clientY - r.top) * dpr() - drag.center[1], (e.clientX - r.left) * dpr() - drag.center[0]);
      let ang = drag.angle + ((a - drag.a0) * 180) / Math.PI;
      ang = Math.max(-45, Math.min(45, ang));
      s.crop.angle = +ang.toFixed(2);
      Object.assign(s.crop, fitCrop(constrainAspect(drag.crop, ratio(), s, W, H), s, W, H));
      D.update(); D.refreshControls(); return;
    }
    const p = v.clientToOut(e.clientX, e.clientY);
    const dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
    let c = { ...drag.crop };
    if (drag.mode === 'move') {
      c.x += dx; c.y += dy;
      c.x = Math.min(1 - c.w, Math.max(0, c.x)); c.y = Math.min(1 - c.h, Math.max(0, c.y));
      if (!cornersInside(c, s, W, H)) {
        const cx2 = { ...c, y: drag.crop.y }, cy2 = { ...c, x: drag.crop.x };
        c = cornersInside(cx2, s, W, H) ? cx2 : cornersInside(cy2, s, W, H) ? cy2 : { ...s.crop };
      }
      Object.assign(s.crop, c); D.update(); return;
    }
    const m = drag.mode;
    let x0 = c.x, y0 = c.y, x1 = c.x + c.w, y1 = c.y + c.h;
    if (m.includes('w')) x0 = Math.min(x1 - 0.02, x0 + dx);
    if (m.includes('e')) x1 = Math.max(x0 + 0.02, x1 + dx);
    if (m.includes('n')) y0 = Math.min(y1 - 0.02, y0 + dy);
    if (m.includes('s')) y1 = Math.max(y0 + 0.02, y1 + dy);
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(1, x1); y1 = Math.min(1, y1);
    const R = ratio();
    if (R) {
      const rot = s.orient.rot % 2, oW = rot ? H : W, oH = rot ? W : H, k = (R * oH) / oW;
      let w = x1 - x0, h = y1 - y0;
      if (m === 'n' || m === 's') w = h * k; else if (m === 'e' || m === 'w') h = w / k; else if (w / h > k) w = h * k; else h = w / k;
      if (m.includes('w')) x0 = x1 - w; else if (m === 'n' || m === 's') { const cx = (drag.crop.x * 2 + drag.crop.w) / 2; x0 = cx - w / 2; } else x1 = x0 + w;
      if (m.includes('n')) y0 = y1 - h; else if (m === 'e' || m === 'w') { const cy = (drag.crop.y * 2 + drag.crop.h) / 2; y0 = cy - h / 2; } else y1 = y0 + h;
      if (!m.includes('w') && m !== 'n' && m !== 's') x1 = x0 + w;
      if (!m.includes('n') && m !== 'e' && m !== 'w') y1 = y0 + h;
      if (x0 < 0 || y0 < 0 || x0 + w > 1 || y0 + h > 1) return;
      c = { x: x0, y: y0, w, h };
    } else c = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    if (!cornersInside(c, s, W, H)) return;
    Object.assign(s.crop, c); D.update();
  };
  t.up = (e, v) => {
    if (!drag) return;
    const s = S(), [W, H] = WH();
    if (drag.mode === 'level') {
      const dx = drag.b[0] - drag.a[0], dy = drag.b[1] - drag.a[1];
      if (Math.hypot(dx, dy) > 10) {
        let th = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (th > 90) th -= 180; if (th < -90) th += 180;
        const dev = Math.abs(th) > 45 ? (th > 0 ? th - 90 : th + 90) : th;
        s.crop.angle = Math.max(-45, Math.min(45, +(s.crop.angle - dev).toFixed(2)));
        Object.assign(s.crop, fitCrop(constrainAspect(s.crop, ratio(), s, W, H), s, W, H));
        D.update(); D.refreshControls(); D.commit('Straighten');
      }
      drag = null; v._overlay(); return;
    }
    D.commit(drag.mode === 'rotate' ? 'Crop Angle' : 'Crop Rectangle');
    drag = null;
  };
  t.dblclick = () => D.finishTool && D.finishTool();
  const ratio = () => (t.lock || S().crop.aspect !== 'free' ? aspectValue(S().crop.aspect === 'free' ? 'free' : S().crop.aspect, S(), ...WH()) : null);
  t.ratio = ratio;
  t.draw = (c, v) => {
    const [x0, y0, x1, y1] = rectPx(v);
    const [vx, vy, vw, vh] = v.view();
    c.fillStyle = 'rgba(0,0,0,.55)';
    c.beginPath(); c.rect(vx, vy, vw, vh); c.rect(x0, y0, x1 - x0, y1 - y0); c.fill('evenodd');
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 1 * dpr(); c.strokeRect(x0, y0, x1 - x0, y1 - y0);
    c.strokeStyle = 'rgba(255,255,255,.35)';
    const lines = (fr) => { for (const f of fr) { c.beginPath(); c.moveTo(x0 + (x1 - x0) * f, y0); c.lineTo(x0 + (x1 - x0) * f, y1); c.stroke(); c.beginPath(); c.moveTo(x0, y0 + (y1 - y0) * f); c.lineTo(x1, y0 + (y1 - y0) * f); c.stroke(); } };
    if (t.overlay === 'thirds' || (drag && drag.mode !== 'rotate')) lines([1 / 3, 2 / 3]);
    else if (t.overlay === 'grid' || (drag && drag.mode === 'rotate')) lines([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
    else if (t.overlay === 'golden') lines([0.382, 0.618]);
    else if (t.overlay === 'diagonal') { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.moveTo(x1, y0); c.lineTo(x0, y1); c.stroke(); }
    c.fillStyle = '#fff';
    const hs = 4 * dpr();
    for (const [fx, fy] of Object.values(HANDLES)) c.fillRect(x0 + (x1 - x0) * fx - hs, y0 + (y1 - y0) * fy - hs, hs * 2, hs * 2);
    if (drag?.mode === 'level') {
      const r = v.canvas.getBoundingClientRect();
      c.strokeStyle = '#e8a33d'; c.lineWidth = 2 * dpr(); c.beginPath();
      c.moveTo((drag.a[0] - r.left) * dpr(), (drag.a[1] - r.top) * dpr()); c.lineTo((drag.b[0] - r.left) * dpr(), (drag.b[1] - r.top) * dpr()); c.stroke();
    }
    const [W, H] = WH(), rot = S().orient.rot % 2;
    const pw = Math.round((rot ? H : W) * S().crop.w * v.origScale()), ph = Math.round((rot ? W : H) * S().crop.h * v.origScale());
    c.font = `${11 * dpr()}px Segoe UI`; c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(x0, y1 + 4 * dpr(), 120 * dpr(), 18 * dpr());
    c.fillStyle = '#ddd'; c.fillText(`${pw} × ${ph}  ${S().crop.angle ? S().crop.angle.toFixed(1) + '°' : ''}`, x0 + 5 * dpr(), y1 + 17 * dpr());
  };
  return t;
}

// ---------- SPOT REMOVAL ----------
export function spotTool(D) {
  const t = { cursor: 'none', size: prefs.get('spotSize', 0.015), mode: prefs.get('spotMode', 'heal'), feather: prefs.get('spotFeather', 0.5), opacity: 1, sel: -1, show: true };
  let drag = null, hover = null;
  const long = () => Math.max(D.viewer.engine.W, D.viewer.engine.H);
  const rpx = (v, r) => r * long() * v.scale(); // radius in canvas px
  const canvasPos = (e, v) => { const r = v.canvas.getBoundingClientRect(); return [(e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr()]; };
  const findHit = (e, v) => {
    const [mx, my] = canvasPos(e, v);
    const spots = D.s.spots;
    for (let i = spots.length - 1; i >= 0; i--) {
      const q = spots[i];
      const [dx, dy] = v.rawToCanvas(q.x, q.y), [sx, sy] = v.rawToCanvas(q.sx, q.sy), R = rpx(v, q.r);
      if (Math.hypot(mx - sx, my - sy) < R && i === t.sel) return { i, part: 'src' };
      if (Math.hypot(mx - dx, my - dy) < R) return { i, part: 'dst' };
      if (Math.hypot(mx - sx, my - sy) < R) return { i, part: 'src' };
    }
    return null;
  };
  async function autoSource(rx, ry, r) {
    const d = await rawData(D.p, 512);
    const W = D.viewer.engine.W, H = D.viewer.engine.H, L = Math.max(W, H);
    const rn = [(r * L) / W, (r * L) / H];
    const stats = (cx, cy, inner, outer) => {
      let s = 0, s2 = 0, n = 0;
      for (let a = 0; a < 24; a++) for (const f of [inner, (inner + outer) / 2, outer]) {
        const x = cx + Math.cos((a / 24) * Math.PI * 2) * rn[0] * f, y = cy + Math.sin((a / 24) * Math.PI * 2) * rn[1] * f;
        if (x < 0 || y < 0 || x > 1 || y > 1) return null;
        const [R, G, B] = sampleRaw(d, x, y, 1); const v = 0.3 * R + 0.59 * G + 0.11 * B; s += v; s2 += v * v; n++;
      }
      return [s / n, Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2))];
    };
    const ring = stats(rx, ry, 1.1, 1.6) || [0.5, 0];
    let best = null;
    for (let a = 0; a < 16; a++) for (const dist of [2.3, 3.2]) {
      const ang = (a / 16) * Math.PI * 2;
      const cx = rx + Math.cos(ang) * rn[0] * dist, cy = ry + Math.sin(ang) * rn[1] * dist;
      if (cx - rn[0] < 0 || cy - rn[1] < 0 || cx + rn[0] > 1 || cy + rn[1] > 1) continue;
      const st = stats(cx, cy, 0, 1); if (!st) continue;
      const score = Math.abs(st[0] - ring[0]) * 2 + Math.abs(st[1] - ring[1]) + dist * 0.004;
      if (!best || score < best.score) best = { cx, cy, score };
    }
    return best ? [best.cx, best.cy] : [Math.min(1, rx + rn[0] * 2.5), ry];
  }
  t.down = (e, v) => {
    const h = findHit(e, v);
    if (h) {
      t.sel = h.i; D.refreshTool();
      if (e.altKey) { D.s.spots.splice(h.i, 1); t.sel = -1; D.update(); D.commit('Delete Spot'); D.refreshTool(); return; }
      const [rx, ry] = v.clientToRaw(e.clientX, e.clientY), q = D.s.spots[h.i];
      drag = { i: h.i, part: h.part, start: [rx, ry], orig: { ...q } };
      return;
    }
    const [rx, ry] = v.clientToRaw(e.clientX, e.clientY);
    if (rx < 0 || ry < 0 || rx > 1 || ry > 1) return false;
    const q = { x: rx, y: ry, sx: rx, sy: ry, r: t.size, feather: t.feather, opacity: t.opacity, mode: t.mode };
    D.s.spots.push(q); t.sel = D.s.spots.length - 1;
    drag = { i: t.sel, part: 'new', start: [rx, ry] };
    autoSource(rx, ry, t.size).then(([sx, sy]) => { if (drag?.part === 'new' && !drag.moved) { q.sx = sx; q.sy = sy; D.update(); } });
  };
  t.move = (e, v) => {
    if (!drag) return;
    const [rx, ry] = v.clientToRaw(e.clientX, e.clientY), q = D.s.spots[drag.i];
    if (drag.part === 'new') { // dragging from new spot sets the source manually
      drag.moved = true; q.sx = rx; q.sy = ry;
    } else if (drag.part === 'dst') { q.x = drag.orig.x + rx - drag.start[0]; q.y = drag.orig.y + ry - drag.start[1]; }
    else { q.sx = drag.orig.sx + rx - drag.start[0]; q.sy = drag.orig.sy + ry - drag.start[1]; }
    D.update();
  };
  t.up = () => { if (!drag) return; D.commit(drag.part === 'new' ? 'Spot Removal' : 'Move Spot'); drag = null; D.refreshTool(); };
  t.hover = (e, v) => { hover = canvasPos(e, v); const h = findHit(e, v); v.overlay.style.cursor = h ? 'move' : 'none'; v._overlay(); };
  t.leave = (v) => { hover = null; v._overlay(); };
  t.wheel = (e, v) => { if ((e.ctrlKey || e.metaKey)) return false; t.size = Math.max(0.002, Math.min(0.2, t.size * (e.deltaY < 0 ? 1.1 : 0.9))); prefs.set('spotSize', t.size); if (t.sel >= 0) { D.s.spots[t.sel].r = t.size; D.update(); } v._overlay(); };
  t.draw = (c, v) => {
    if (!t.show) return;
    const spots = D.s.spots;
    spots.forEach((q, i) => {
      const [dx, dy] = v.rawToCanvas(q.x, q.y), [sx, sy] = v.rawToCanvas(q.sx, q.sy), R = rpx(v, q.r);
      c.lineWidth = (i === t.sel ? 2 : 1) * dpr();
      c.strokeStyle = i === t.sel ? '#fff' : 'rgba(255,255,255,.6)';
      c.beginPath(); c.arc(dx, dy, R, 0, Math.PI * 2); c.stroke();
      if (i === t.sel) {
        c.setLineDash([4 * dpr(), 3 * dpr()]); c.beginPath(); c.arc(sx, sy, R, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
        const a = Math.atan2(dy - sy, dx - sx);
        c.beginPath(); c.moveTo(sx + Math.cos(a) * R, sy + Math.sin(a) * R); c.lineTo(dx - Math.cos(a) * R, dy - Math.sin(a) * R); c.stroke();
      }
    });
    if (hover) { c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = dpr(); c.beginPath(); c.arc(hover[0], hover[1], rpx(v, t.size), 0, Math.PI * 2); c.stroke(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.beginPath(); c.arc(hover[0], hover[1], rpx(v, t.size) + dpr(), 0, Math.PI * 2); c.stroke(); }
  };
  return t;
}

// ---------- MASK TOOLS ----------
export function brushTool(D, mask) {
  const t = { cursor: 'none', size: prefs.get('brushSize', 0.03), feather: prefs.get('brushFeather', 0.5), flow: prefs.get('brushFlow', 1), erase: false };
  let live = null, stroke = null, hover = null, lastHover = null;
  const long = () => Math.max(D.viewer.engine.W, D.viewer.engine.H);
  t.down = async (e, v) => {
    const [rx, ry] = v.clientToRaw(e.clientX, e.clientY);
    const en = v.engine;
    stroke = { erase: t.erase || e.altKey, size: t.size, feather: t.feather, flow: t.flow, pts: [[+rx.toFixed(5), +ry.toFixed(5)]] };
    mask.strokes.push(stroke);
    const c = await composeMask({ ...mask, strokes: mask.strokes.slice(0, -1) }, en.maskW, en.maskH);
    if (!stroke) return;
    drawStroke(c.getContext('2d'), stroke, en.maskW, en.maskH); // everything painted while composing
    live = c;
    const L = en.layerOf.get(mask.id);
    if (L != null) { en.setMaskLayer(L, live); markLayer(en, mask); }
    v.requestRender();
  };
  const paintSeg = (v) => {
    if (!live || !stroke) return;
    const en = v.engine, ctx = live.getContext('2d');
    const pts = stroke.pts.slice(-2);
    drawStroke(ctx, { ...stroke, pts }, en.maskW, en.maskH);
    const L = en.layerOf.get(mask.id);
    if (L != null) { en.setMaskLayer(L, live); markLayer(en, mask); }
    v.requestRender();
  };
  t.move = (e, v) => {
    hover = [e.clientX, e.clientY];
    if (!stroke) return;
    const [rx, ry] = v.clientToRaw(e.clientX, e.clientY);
    const last = stroke.pts.at(-1);
    const minStep = (stroke.size * 0.15 * long()) / Math.max(D.viewer.engine.W, 1);
    if (Math.hypot(rx - last[0], ry - last[1]) < minStep * 0.5) return;
    stroke.pts.push([+rx.toFixed(5), +ry.toFixed(5)]);
    paintSeg(v);
  };
  t.up = (e, v) => { if (!stroke) return; stroke = null; live = null; D.commit(t.erase ? 'Mask Erase' : 'Mask Brush'); };
  t.hover = (e, v) => { hover = [e.clientX, e.clientY]; v._overlay(); };
  t.leave = (v) => { hover = null; v._overlay(); };
  t.wheel = (e, v) => { if ((e.ctrlKey || e.metaKey)) return false; t.size = Math.max(0.002, Math.min(0.3, t.size * (e.deltaY < 0 ? 1.1 : 0.9))); prefs.set('brushSize', t.size); v._overlay(); D.refreshTool(); };
  t.draw = (c, v) => {
    if (!hover) return;
    const r = v.canvas.getBoundingClientRect(), x = (hover[0] - r.left) * dpr(), y = (hover[1] - r.top) * dpr();
    const R = t.size * long() * v.scale();
    c.lineWidth = dpr();
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.45)'; c.beginPath(); c.arc(x, y, R * (1 - t.feather), 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#fff'; c.font = `${12 * dpr()}px Segoe UI`; c.fillText(t.erase ? '−' : '+', x - 3 * dpr(), y + 4 * dpr());
  };
  return t;
}

export function linearTool(D, mask) {
  const t = { cursor: 'crosshair' };
  let drag = null;
  const pts = (v) => { const L = mask.linear; if (!L) return null; return { a: v.rawToCanvas(L.x0, L.y0), b: v.rawToCanvas(L.x1, L.y1) }; };
  t.down = (e, v) => {
    const [rx, ry] = v.clientToRaw(e.clientX, e.clientY);
    const P = pts(v);
    const r = v.canvas.getBoundingClientRect(), mx = (e.clientX - r.left) * dpr(), my = (e.clientY - r.top) * dpr();
    if (P) {
      const tol = 12 * dpr();
      if (Math.hypot(mx - P.a[0], my - P.a[1]) < tol) { drag = { mode: 'a' }; return; }
      if (Math.hypot(mx - P.b[0], my - P.b[1]) < tol) { drag = { mode: 'b' }; return; }
      const cx = (P.a[0] + P.b[0]) / 2, cy = (P.a[1] + P.b[1]) / 2;
      if (Math.hypot(mx - cx, my - cy) < tol * 1.5) { drag = { mode: 'move', start: [rx, ry], orig: { ...mask.linear } }; return; }
    }
    if (P && !t.redraw) return false; // clicks away from the handles never replace an existing gradient
    mask.linear = { x0: rx, y0: ry, x1: rx, y1: ry + 0.001 };
    drag = { mode: 'b', fresh: true };
    D.update();
  };
  t.move = (e, v) => {
    if (!drag) return;
    const [rx, ry] = v.clientToRaw(e.clientX, e.clientY), L = mask.linear;
    if (drag.mode === 'a') { L.x0 = rx; L.y0 = ry; } else if (drag.mode === 'b') { L.x1 = rx; L.y1 = ry; }
    else { const dx = rx - drag.start[0], dy = ry - drag.start[1]; Object.assign(L, { x0: drag.orig.x0 + dx, y0: drag.orig.y0 + dy, x1: drag.orig.x1 + dx, y1: drag.orig.y1 + dy }); }
    D.update();
  };
  t.up = () => {
    if (!drag) return;
    const L = mask.linear;
    if (drag.fresh && Math.hypot(L.x1 - L.x0, L.y1 - L.y0) < 0.01) { mask.linear = null; D.update(); drag = null; return; } // a click, not a drag
    D.commit('Linear Gradient');
    if (drag.fresh) { t.redraw = false; t.onDrawn && t.onDrawn(); }
    drag = null;
  };
  t.draw = (c, v) => {
    const P = pts(v); if (!P) return;
    const dx = P.b[0] - P.a[0], dy = P.b[1] - P.a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, ext = 3000;
    c.lineWidth = 1.2 * dpr();
    for (const [pt, dash] of [[P.a, false], [[(P.a[0] + P.b[0]) / 2, (P.a[1] + P.b[1]) / 2], true], [P.b, false]]) {
      c.setLineDash(dash ? [6 * dpr(), 4 * dpr()] : []); c.strokeStyle = 'rgba(255,255,255,.85)';
      c.beginPath(); c.moveTo(pt[0] - nx * ext, pt[1] - ny * ext); c.lineTo(pt[0] + nx * ext, pt[1] + ny * ext); c.stroke();
    }
    c.setLineDash([]);
    for (const pt of [P.a, P.b, [(P.a[0] + P.b[0]) / 2, (P.a[1] + P.b[1]) / 2]]) { c.fillStyle = '#fff'; c.beginPath(); c.arc(pt[0], pt[1], 5 * dpr(), 0, Math.PI * 2); c.fill(); }
  };
  return t;
}

export function radialTool(D, mask) {
  const t = { cursor: 'crosshair' };
  let drag = null;
  const long = () => Math.max(D.viewer.engine.W, D.viewer.engine.H);
  const handles = (v) => {
    const R = mask.radial; if (!R) return null;
    const W = D.viewer.engine.W, H = D.viewer.engine.H, L = long();
    const ca = Math.cos(R.angle || 0), sa = Math.sin(R.angle || 0);
    const toRaw = (ox, oy) => [R.cx + (ca * ox - sa * oy) * L / W, R.cy + (sa * ox + ca * oy) * L / H];
    const h = { c: v.rawToCanvas(R.cx, R.cy), e: v.rawToCanvas(...toRaw(R.rx, 0)), w: v.rawToCanvas(...toRaw(-R.rx, 0)), s: v.rawToCanvas(...toRaw(0, R.ry)), n: v.rawToCanvas(...toRaw(0, -R.ry)) };
    // rotation knob: on a short stem beyond the top handle, following the ellipse's rotation
    const dx = h.n[0] - h.c[0], dy = h.n[1] - h.c[1], len = Math.hypot(dx, dy) || 1, stem = 30 * dpr();
    h.rot = [h.n[0] + (dx / len) * stem, h.n[1] + (dy / len) * stem];
    return h;
  };
  t.cursorAt = (e, v) => {
    const H = handles(v); if (!H) return null;
    const r = v.canvas.getBoundingClientRect(), mx = (e.clientX - r.left) * dpr(), my = (e.clientY - r.top) * dpr();
    if (Math.hypot(mx - H.rot[0], my - H.rot[1]) < 11 * dpr()) return 'grab';
    if (Math.hypot(mx - H.c[0], my - H.c[1]) < 14 * dpr()) return 'move';
    for (const k of ['e', 'w', 'n', 's']) if (Math.hypot(mx - H[k][0], my - H[k][1]) < 10 * dpr()) return 'pointer';
    return null;
  };
  t.down = (e, v) => {
    const [rx, ry] = v.clientToRaw(e.clientX, e.clientY);
    const r = v.canvas.getBoundingClientRect(), mx = (e.clientX - r.left) * dpr(), my = (e.clientY - r.top) * dpr();
    const H = handles(v);
    if (H) {
      if (Math.hypot(mx - H.rot[0], my - H.rot[1]) < 11 * dpr()) { drag = { mode: 'rot' }; return; }
      for (const k of ['e', 'w', 'n', 's']) if (Math.hypot(mx - H[k][0], my - H[k][1]) < 10 * dpr()) { drag = { mode: k, shift: e.shiftKey }; return; }
      if (Math.hypot(mx - H.c[0], my - H.c[1]) < 14 * dpr()) { drag = { mode: 'move', start: [rx, ry], orig: { ...mask.radial } }; return; }
    }
    if (H && !t.redraw) return false; // clicks away from the handles never replace an existing gradient
    drag = { prev: mask.radial };
    mask.radial = { cx: rx, cy: ry, rx: 0.001, ry: 0.001, angle: 0, feather: mask.radial?.feather ?? 0.5 };
    drag = { mode: 'new', start: [rx, ry], prev: drag.prev };
  };
  t.move = (e, v) => {
    if (!drag) return;
    const [rx, ry] = v.clientToRaw(e.clientX, e.clientY), R = mask.radial;
    const W = D.viewer.engine.W, H = D.viewer.engine.H, L = long();
    const dxp = (rx - R.cx) * W / L, dyp = (ry - R.cy) * H / L; // offset in long-side units
    if (drag.mode === 'new') { R.rx = Math.max(0.005, Math.abs(dxp)); R.ry = Math.max(0.005, Math.abs(dyp)); if (e.shiftKey) R.rx = R.ry = Math.max(R.rx, R.ry); }
    else if (drag.mode === 'move') { R.cx = drag.orig.cx + rx - drag.start[0]; R.cy = drag.orig.cy + ry - drag.start[1]; }
    else if (drag.mode === 'rot') {
      // the knob sits on the ellipse's local "up" axis, so its direction is angle − 90°
      let a = Math.atan2(dyp, dxp) + Math.PI / 2;
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12); // Shift: snap to 15°
      R.angle = Math.atan2(Math.sin(a), Math.cos(a)); // keep within −180°…180°
      D.onRadialAngle && D.onRadialAngle(R.angle);
    }
    else {
      const ca = Math.cos(R.angle || 0), sa = Math.sin(R.angle || 0);
      const lx = ca * dxp + sa * dyp, ly = -sa * dxp + ca * dyp;
      if (drag.mode === 'e' || drag.mode === 'w') {
        if ((e.ctrlKey || e.metaKey)) { R.angle = Math.atan2(dyp, dxp) + (drag.mode === 'w' ? Math.PI : 0); R.angle = Math.atan2(Math.sin(R.angle), Math.cos(R.angle)); D.onRadialAngle && D.onRadialAngle(R.angle); }
        else R.rx = Math.max(0.005, Math.abs(lx));
      } else R.ry = Math.max(0.005, Math.abs(ly));
      if (e.shiftKey) R.rx = R.ry = drag.mode === 'e' || drag.mode === 'w' ? R.rx : R.ry;
    }
    D.update();
  };
  t.up = () => {
    if (!drag) return;
    if (drag.mode === 'new' && mask.radial.rx < 0.006 && mask.radial.ry < 0.006) { mask.radial = drag.prev || null; D.update(); drag = null; return; } // a click, not a drag
    D.commit(drag.mode === 'rot' ? 'Rotate Radial Gradient' : 'Radial Gradient');
    if (drag.mode === 'new') { t.redraw = false; t.onDrawn && t.onDrawn(); }
    drag = null;
  };
  t.draw = (c, v) => {
    const H = handles(v); if (!H) return;
    const R = mask.radial;
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 1.2 * dpr();
    // approximate ellipse by sampling points
    const W = D.viewer.engine.W, Hh = D.viewer.engine.H, L = long(), ca = Math.cos(R.angle || 0), sa = Math.sin(R.angle || 0);
    for (const k of [1, 1 - (R.feather ?? 0.5)]) {
      c.setLineDash(k === 1 ? [] : [5 * dpr(), 4 * dpr()]);
      c.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2, ox = Math.cos(a) * R.rx * k, oy = Math.sin(a) * R.ry * k;
        const [x, y] = v.rawToCanvas(R.cx + (ca * ox - sa * oy) * L / W, R.cy + (sa * ox + ca * oy) * L / Hh);
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
    c.setLineDash([]);
    for (const k of ['e', 'w', 'n', 's']) { c.fillStyle = '#fff'; c.fillRect(H[k][0] - 4 * dpr(), H[k][1] - 4 * dpr(), 8 * dpr(), 8 * dpr()); }
    c.beginPath(); c.arc(H.c[0], H.c[1], 6 * dpr(), 0, Math.PI * 2); c.fill();
    // rotation knob: stem + ring with a small curved arrow
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 1.2 * dpr();
    c.beginPath(); c.moveTo(H.n[0], H.n[1]); c.lineTo(H.rot[0], H.rot[1]); c.stroke();
    c.fillStyle = 'rgba(30,30,30,.85)'; c.beginPath(); c.arc(H.rot[0], H.rot[1], 8 * dpr(), 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 1.5 * dpr();
    c.beginPath(); c.arc(H.rot[0], H.rot[1], 8 * dpr(), 0, Math.PI * 2); c.stroke();
    const ar = 4 * dpr(), a0 = -Math.PI * 0.9, a1 = Math.PI * 0.35;
    c.beginPath(); c.arc(H.rot[0], H.rot[1], ar, a0, a1); c.stroke();
    const tx = H.rot[0] + Math.cos(a1) * ar, ty = H.rot[1] + Math.sin(a1) * ar;
    c.beginPath(); c.moveTo(tx - 2.5 * dpr(), ty - 0.5 * dpr()); c.lineTo(tx, ty); c.lineTo(tx + 0.5 * dpr(), ty - 2.8 * dpr()); c.stroke();
  };
  return t;
}

// AI click-to-select (SlimSAM). onPoints(points) runs the model.
export function pointSelectTool(D, onPoints) {
  const t = { cursor: 'crosshair', points: [] };
  t.down = (e, v) => {
    const [rx, ry] = v.clientToRaw(e.clientX, e.clientY);
    if (rx < 0 || ry < 0 || rx > 1 || ry > 1) return false;
    t.points.push([rx, ry, e.altKey || e.button === 2 ? 0 : 1]);
    onPoints(t.points);
    v._overlay();
  };
  t.draw = (c, v) => {
    for (const [x, y, l] of t.points) { const [px, py] = v.rawToCanvas(x, y); c.fillStyle = l ? '#3c3' : '#e33'; c.strokeStyle = '#fff'; c.lineWidth = 2 * dpr(); c.beginPath(); c.arc(px, py, 6 * dpr(), 0, Math.PI * 2); c.fill(); c.stroke(); }
  };
  return t;
}

// Generic one-click picker (white balance, color range, targeted adjustment).
export function pickTool(onPick, cursor = 'crosshair') {
  return { cursor, down: (e, v) => { onPick(e, v); } };
}

// Targeted adjustment: drag up/down on the image to change the HSL bands under the cursor.
export function targetedTool(D, kind, sampleFn) {
  const t = { cursor: 'ns-resize' };
  let drag = null;
  t.down = (e, v) => { drag = { y: e.clientY, weights: sampleFn(e, v), base: D.s.hsl[kind].slice() }; };
  t.move = (e, v) => {
    if (!drag) return;
    const dy = (drag.y - e.clientY) * 0.5;
    D.s.hsl[kind] = drag.base.map((x, i) => Math.max(-100, Math.min(100, Math.round(x + dy * drag.weights[i]))));
    D.update(); D.refreshControls();
  };
  t.up = () => { if (drag) D.commit('Targeted ' + kind); drag = null; };
  return t;
}
