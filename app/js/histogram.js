// Histogram panel widget (shared by Library and Develop).
import { on, P, S } from './store.js';
import { el } from './ui.js';
import { thumbUrl } from './imaging.js';

export function histogramWidget({ onClipToggle } = {}) {
  const cv = el('canvas', { width: 512, height: 220 });
  const clipL = el('div', { class: 'clip l', title: 'Show shadow clipping (J)' });
  const clipR = el('div', { class: 'clip r', title: 'Show highlight clipping (J)' });
  const box = el('div', { class: 'histo' }, cv, clipL, clipR);
  const info = el('div', { class: 'histo-info' });
  const root = el('div', {}, box, info);
  let last = null;
  const draw = (h) => {
    last = h;
    const x = cv.getContext('2d'), W = cv.width, H = cv.height;
    x.clearRect(0, 0, W, H);
    if (!h) return;
    // grid
    x.strokeStyle = 'rgba(255,255,255,.06)'; x.lineWidth = 1;
    for (let i = 1; i < 5; i++) { x.beginPath(); x.moveTo((W * i) / 5, 0); x.lineTo((W * i) / 5, H); x.stroke(); }
    let mx = 1;
    for (const ch of [h.r, h.g, h.b]) { const sorted = [...ch.slice(2, 254)].sort((a, b) => b - a); mx = Math.max(mx, sorted[10] || 1); }
    x.globalCompositeOperation = 'lighter';
    const plot = (arr, color) => {
      x.fillStyle = color; x.beginPath(); x.moveTo(0, H);
      for (let i = 0; i < 256; i++) x.lineTo((i / 255) * W, H - Math.min(1, Math.sqrt(arr[i] / mx)) * (H - 4));
      x.lineTo(W, H); x.closePath(); x.fill();
    };
    plot(h.r, 'rgba(200,50,50,.75)'); plot(h.g, 'rgba(50,170,60,.75)'); plot(h.b, 'rgba(60,90,220,.75)');
    x.globalCompositeOperation = 'source-over';
    clipL.style.borderLeftColor = clipL.style.borderTopColor = h.clipLo > 0.002 ? '#7af' : '';
    clipR.style.borderRightColor = clipR.style.borderTopColor = h.clipHi > 0.002 ? '#f77' : '';
  };
  const setInfo = (p) => {
    if (!p || !p.exif) { info.innerHTML = p ? `<span>${p.w ? p.w + ' × ' + p.h : ''}</span>` : ''; return; }
    const e = p.exif;
    info.innerHTML = `<span>${e.iso ? 'ISO ' + e.iso : ''}</span><span>${e.focal ? Math.round(e.focal) + ' mm' : ''}</span><span>${e.fnum ? 'ƒ/' + e.fnum : ''}</span><span>${e.shutter || ''}</span>`;
  };
  on('histogram', (h) => { if (root.isConnected) draw(h); });
  on('pixel', (e) => {
    if (!root.isConnected) return;
    if (!e) { setInfo(P(S.cur)); return; }
    const v = window.__viewer; if (!v || !v.photo) return;
    const px = v.sampleAt(e.clientX, e.clientY);
    info.innerHTML = `<span>R ${(px[0] / 2.55).toFixed(1)}%</span><span>G ${(px[1] / 2.55).toFixed(1)}%</span><span>B ${(px[2] / 2.55).toFixed(1)}%</span>`;
  });
  clipL.onclick = clipR.onclick = () => onClipToggle && onClipToggle();
  // compute from a thumbnail image (Library grid mode)
  const fromPhoto = (p) => {
    setInfo(p);
    if (!p) { draw(null); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const r = new Float32Array(256), g = new Float32Array(256), b = new Float32Array(256), l = new Float32Array(256);
      let hi = 0, lo = 0;
      for (let i = 0; i < d.length; i += 4) { r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++; if (d[i] > 253 || d[i + 1] > 253 || d[i + 2] > 253) hi++; if (d[i] < 2 && d[i + 1] < 2 && d[i + 2] < 2) lo++; }
      draw({ r, g, b, l, clipHi: hi / (d.length / 4), clipLo: lo / (d.length / 4) });
    };
    img.src = thumbUrl(p);
  };
  return { el: root, draw, fromPhoto, setInfo, setClip: (on) => { clipL.classList.toggle('on', on); clipR.classList.toggle('on', on); } };
}
