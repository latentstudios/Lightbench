// Tone curve editor and color wheels.
import { el } from './ui.js';
import { curveFn } from './settings.js';

// Point-curve editor. get() -> {rgb,r,g,b}, channel selectable. onChange(live), onCommit.
export function curveEditor({ get, onChange, onCommit, histogram }) {
  const cv = el('canvas', { class: 'curve-canvas', width: 520, height: 520 });
  let ch = 'rgb';
  const tabs = el('div', { class: 'curve-tabs' });
  const colors = { rgb: '#ddd', r: '#e55', g: '#5c5', b: '#58f' };
  for (const c of ['rgb', 'r', 'g', 'b']) tabs.append(el('button', { class: c === ch ? 'on' : '', style: { background: c === 'rgb' ? 'linear-gradient(135deg,#e55,#5c5,#58f)' : colors[c] }, title: c.toUpperCase(), onclick: (e) => { ch = c; [...tabs.children].forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); draw(); } }));
  const W = cv.width, H = cv.height, pad = 8;
  const toPx = (x, y) => [pad + x * (W - 2 * pad), H - pad - y * (H - 2 * pad)];
  const fromPx = (px, py) => [Math.min(1, Math.max(0, (px - pad) / (W - 2 * pad))), Math.min(1, Math.max(0, (H - pad - py) / (H - 2 * pad)))];
  let hist = null;
  function draw() {
    const x = cv.getContext('2d');
    x.clearRect(0, 0, W, H);
    if (hist) {
      const arr = hist[ch === 'rgb' ? 'l' : ch] || hist.l; let mx = 1;
      for (let i = 3; i < 253; i++) mx = Math.max(mx, arr[i]);
      x.fillStyle = 'rgba(255,255,255,.08)'; x.beginPath(); x.moveTo(pad, H - pad);
      for (let i = 0; i < 256; i++) x.lineTo(pad + (i / 255) * (W - 2 * pad), H - pad - Math.min(1, Math.sqrt(arr[i] / mx)) * (H - 2 * pad) * 0.9);
      x.lineTo(W - pad, H - pad); x.fill();
    }
    x.strokeStyle = 'rgba(255,255,255,.1)'; x.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const [a] = toPx(i / 4, 0); const [, b] = toPx(0, i / 4); x.beginPath(); x.moveTo(a, pad); x.lineTo(a, H - pad); x.stroke(); x.beginPath(); x.moveTo(pad, b); x.lineTo(W - pad, b); x.stroke(); }
    x.strokeStyle = 'rgba(255,255,255,.15)'; x.beginPath(); x.moveTo(...toPx(0, 0)); x.lineTo(...toPx(1, 1)); x.stroke();
    const pts = get()[ch];
    const f = curveFn(pts);
    x.strokeStyle = colors[ch]; x.lineWidth = 2.5; x.beginPath();
    for (let i = 0; i <= 200; i++) { const t = i / 200; const [px, py] = toPx(t, Math.min(1, Math.max(0, f(t)))); i ? x.lineTo(px, py) : x.moveTo(px, py); }
    x.stroke();
    for (const [i, p] of pts.entries()) { const [px, py] = toPx(p[0], p[1]); x.fillStyle = i === drag ? '#fff' : '#ccc'; x.beginPath(); x.arc(px, py, 7, 0, Math.PI * 2); x.fill(); }
  }
  let drag = -1;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]; };
  cv.addEventListener('pointerdown', (e) => {
    const pts = get()[ch].map((p) => [...p]);
    const [mx, my] = pos(e);
    drag = pts.findIndex((p) => { const [px, py] = toPx(p[0], p[1]); return Math.hypot(px - mx, py - my) < 14; });
    if (e.button === 2) {
      if (drag > 0 && drag < pts.length - 1) { pts.splice(drag, 1); onChange(ch, pts); onCommit(); }
      drag = -1; draw(); return;
    }
    if (drag < 0) {
      const [x, y] = fromPx(mx, my);
      pts.push([x, curveFn(pts)(x)]); pts.sort((a, b) => a[0] - b[0]);
      drag = pts.findIndex((p) => p[0] === x);
      onChange(ch, pts);
    }
    cv.setPointerCapture(e.pointerId);
    draw();
  });
  cv.addEventListener('pointermove', (e) => {
    if (drag < 0) return;
    const pts = get()[ch].map((p) => [...p]);
    let [x, y] = fromPx(...pos(e));
    const lo = drag > 0 ? pts[drag - 1][0] + 0.01 : 0, hi = drag < pts.length - 1 ? pts[drag + 1][0] - 0.01 : 1;
    if (drag === 0) x = Math.min(x, hi); else if (drag === pts.length - 1) x = Math.max(x, lo); else x = Math.min(hi, Math.max(lo, x));
    pts[drag] = [x, y];
    onChange(ch, pts); draw();
  });
  cv.addEventListener('pointerup', () => { if (drag >= 0) onCommit(); drag = -1; draw(); });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('dblclick', (e) => {
    const pts = get()[ch].map((p) => [...p]);
    const [mx, my] = pos(e);
    const i = pts.findIndex((p) => { const [px, py] = toPx(p[0], p[1]); return Math.hypot(px - mx, py - my) < 14; });
    if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); onChange(ch, pts); onCommit(); draw(); }
  });
  return { el: el('div', { class: 'curve-wrap' }, cv, tabs), draw, setHistogram: (h) => { hist = h; draw(); }, get channel() { return ch; } };
}

// Hue/saturation color wheel. value {h (0-360), s (0-100)}.
export function colorWheel({ label, get, onChange, onCommit, lum }) {
  const dot = el('div', { class: 'dot' });
  const wheel = el('div', { class: 'wheel', title: 'Drag to choose hue & saturation. Shift = saturation only, double-click to reset' }, dot);
  const place = () => {
    const v = get(); const a = (v.h * Math.PI) / 180, r = (v.s / 100) * 50;
    dot.style.left = 50 + Math.cos(a) * r + '%'; dot.style.top = 50 - Math.sin(a) * r + '%';
    const c = `hsl(${v.h},${40 + v.s * 0.6}%,55%)`; dot.style.background = v.s ? c : 'transparent';
  };
  let dragging = false, startH = 0;
  const upd = (e) => {
    const r = wheel.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width - 0.5, dy = 0.5 - (e.clientY - r.top) / r.height;
    let h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360, s = Math.min(100, (Math.hypot(dx, dy) / 0.5) * 100);
    if (e.shiftKey) h = startH;
    onChange({ h: Math.round(h), s: Math.round(s) }); place();
  };
  wheel.addEventListener('pointerdown', (e) => { dragging = true; startH = get().h; wheel.setPointerCapture(e.pointerId); upd(e); });
  wheel.addEventListener('pointermove', (e) => dragging && upd(e));
  wheel.addEventListener('pointerup', () => { if (dragging) { dragging = false; onCommit(); } });
  wheel.addEventListener('dblclick', () => { onChange({ h: 0, s: 0 }); place(); onCommit(); });
  place();
  return { el: el('div', { class: 'wheel-box' }, el('div', { class: 'wl' }, label), wheel, lum || null), place };
}
