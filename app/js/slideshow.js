// Slideshow module.
import { S, P, emit, targets } from './store.js';
import { el, $, panel, slider, prefs, toast, icon } from './ui.js';
import { renderFinal, canvasBlob } from './imaging.js';

const mod = {};
export default mod;
const o = Object.assign({ duration: 4, fade: 0.8, caption: 'filename', shuffle: false, bg: '#000000', selectedOnly: false, loop: true }, prefs.get('slideshow', {}));
let playing = false, timer = null, idx = 0, order = [], urls = new Map(), keyHandler = null;

async function slideUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const pr = (async () => {
    const long = Math.max(screen.width, screen.height) * (devicePixelRatio || 1);
    const c = await renderFinal(P(id), { useOriginal: false, longEdge: Math.min(2560, long) });
    return URL.createObjectURL(await canvasBlob(c, 'image/jpeg', 0.9));
  })();
  urls.set(id, pr);
  return pr;
}
function caption(p) {
  if (o.caption === 'none') return '';
  if (o.caption === 'title') return p.title || p.caption || '';
  if (o.caption === 'exif') { const e = p.exif || {}; return [e.model, e.shutter, e.fnum && 'ƒ/' + e.fnum, e.iso && 'ISO ' + e.iso].filter(Boolean).join('  ·  '); }
  return p.name;
}
async function show(i, box) {
  const id = order[i]; if (!id) return;
  const url = await slideUrl(id);
  const img = el('img', { src: url, style: { opacity: 0, transition: `opacity ${o.fade}s` } });
  const old = [...box.querySelectorAll('img')];
  box.append(img);
  await img.decode().catch(() => {});
  requestAnimationFrame(() => { img.style.opacity = 1; old.forEach((x) => { x.style.opacity = 0; setTimeout(() => x.remove(), o.fade * 1000 + 50); }); });
  let cap = box.querySelector('.ss-caption'); if (!cap) { cap = el('div', { class: 'ss-caption' }); box.append(cap); }
  cap.textContent = caption(P(id));
  if (order[i + 1]) slideUrl(order[i + 1]);
}
function stop() {
  playing = false; clearTimeout(timer);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (keyHandler) { window.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
  renderPreview();
}
async function play() {
  order = o.selectedOnly && targets().length > 1 ? targets() : [...S.list];
  if (!order.length) { toast('No photos to show', true); return; }
  if (o.shuffle) order.sort(() => Math.random() - 0.5);
  idx = Math.max(0, order.indexOf(S.cur)); if (o.shuffle) idx = 0;
  const box = $('#slideshow'); box.innerHTML = ''; box.style.background = o.bg;
  playing = true;
  try { await box.requestFullscreen(); } catch {}
  const next = async (d = 1) => {
    clearTimeout(timer);
    idx += d;
    if (idx >= order.length) { if (o.loop) idx = 0; else { stop(); return; } }
    if (idx < 0) idx = order.length - 1;
    await show(idx, box);
    if (playing) timer = setTimeout(() => next(1), o.duration * 1000);
  };
  keyHandler = (e) => {
    if (!playing) return;
    e.stopPropagation(); e.preventDefault();
    if (e.key === 'Escape') stop();
    else if (e.key === 'ArrowRight') next(1);
    else if (e.key === 'ArrowLeft') next(-1);
    else if (e.key === ' ') { if (timer) { clearTimeout(timer); timer = null; } else next(1); }
  };
  window.addEventListener('keydown', keyHandler, true);
  document.addEventListener('fullscreenchange', function f() { if (!document.fullscreenElement) { document.removeEventListener('fullscreenchange', f); if (playing) stop(); } });
  await show(idx, box);
  timer = setTimeout(() => next(1), o.duration * 1000);
}
async function renderPreview() {
  const box = $('#slideshow'); box.innerHTML = ''; box.style.background = o.bg;
  const p = P(S.cur); if (!p) return;
  box.append(el('img', { src: await slideUrl(p.id), style: { opacity: 1 } }), el('div', { class: 'ss-caption' }, caption(p)));
}

mod.enter = () => {
  for (const p of ['grid', 'loupe', 'compare', 'survey', 'empty', 'map', 'print']) $('#' + p).classList.add('hidden');
  $('#slideshow').classList.remove('hidden'); $('#filterbar').classList.add('hidden');
  const save = () => prefs.set('slideshow', o);
  $('#left-panels').innerHTML = '';
  const lp = panel('Slideshow', { id: 'ss-info' });
  lp.body.append(el('div', { class: 'muted small' }, 'Plays the photos of the current source (with all edits applied). Use ←/→ to navigate, Space to pause, Esc to exit.'));
  $('#left-panels').append(lp.el);
  const rp = panel('Options', { id: 'ss-opts' });
  const capSel = el('select', { onchange: () => { o.caption = capSel.value; save(); renderPreview(); } }, [['filename', 'File name'], ['title', 'Title / caption'], ['exif', 'Exposure info'], ['none', 'None']].map(([v, l]) => el('option', { value: v, selected: o.caption === v }, l)));
  rp.body.append(
    slider({ label: 'Duration (s)', min: 1, max: 20, step: 0.5, value: o.duration, def: 4, onInput: (v) => { o.duration = v; save(); } }).el,
    slider({ label: 'Fade (s)', min: 0, max: 3, step: 0.1, value: o.fade, def: 0.8, onInput: (v) => { o.fade = v; save(); } }).el,
    el('div', { class: 'field' }, el('label', {}, 'Caption'), capSel),
    el('div', { class: 'field' }, el('label', {}, 'Background'), el('input', { type: 'color', value: o.bg, oninput: (e) => { o.bg = e.target.value; save(); $('#slideshow').style.background = o.bg; } })),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: o.shuffle, onchange: (e) => { o.shuffle = e.target.checked; save(); } }), 'Random order'),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: o.loop, onchange: (e) => { o.loop = e.target.checked; save(); } }), 'Repeat'),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: o.selectedOnly, onchange: (e) => { o.selectedOnly = e.target.checked; save(); } }), 'Selected photos only'),
    el('div', { class: 'btnrow grow' }, el('button', { class: 'btn primary', onclick: play }, icon('play'), 'Play')));
  $('#right-panels').innerHTML = ''; $('#right-panels').append(rp.el);
  $('#toolbar').innerHTML = '';
  $('#toolbar').append(el('button', { class: 'btn small', onclick: () => emit('module', 'library') }, icon('grid'), 'Library'), el('button', { class: 'btn small primary', onclick: play }, icon('play'), 'Play Slideshow'));
  renderPreview();
};
mod.leave = () => { stop(); $('#slideshow').classList.add('hidden'); for (const u of urls.values()) u.then((x) => URL.revokeObjectURL(x)); urls.clear(); };
mod.onCurrent = () => { if (!playing) renderPreview(); };
