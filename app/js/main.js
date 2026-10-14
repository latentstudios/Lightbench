// App shell: boot, module switching, filmstrip, keyboard shortcuts, drag & drop.
import { C, S, P, on, emit, save, loadCatalog, refreshList, setCurrent, step, targets, srcId } from './store.js';
import { el, $, $$, toast, modal, prefs, contextMenu } from './ui.js';
import { icon, iconHTML } from './icons.js';
import { keyLabel, REVEAL_LABEL } from './platform.js';
import { thumbUrl, queueThumb } from './imaging.js';
import { viewer } from './viewer.js';
import lib, { setView, cycleInfo, gridColumns, compareStep, photoMenu, toggleFilterBar } from './library.js';
import dev from './develop.js';
import mapMod from './map.js';
import ssMod from './slideshow.js';
import printMod from './print.js';
import * as A from './actions.js';
import { openImport, openExport, importDropped } from './dialogs.js';
import { mdToHtml } from './markdown.js';
import { installErrorCapture, showFeedback, checkForUpdates, showWelcome } from './help.js';
installErrorCapture();

const MODULES = { library: lib, develop: dev, map: mapMod, slideshow: ssMod, print: printMod };

function setModule(m) {
  if (!MODULES[m]) return;
  if (m === 'develop' && !S.cur) { toast('Import or select a photo first', true); return; }
  if (S.module === m) { if (m === 'library') lib.enter(); return; }
  MODULES[S.module]?.leave?.();
  S.module = m;
  for (const b of $$('#modules button')) b.classList.toggle('active', b.dataset.module === m);
  document.body.dataset.module = m;
  MODULES[m].enter();
  renderFilmstrip();
}
on('module', setModule);
$('#modules').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setModule(b.dataset.module); });

// ---------- filmstrip ----------
const film = $('#filmstrip');
const fcells = new Map();
function renderFilmstrip() {
  film.innerHTML = ''; fcells.clear();
  const frag = document.createDocumentFragment();
  for (const id of S.list) {
    const p = P(id);
    const c = el('div', { class: 'fcell', draggable: true, 'data-id': id, title: p.name },
      el('img', { loading: 'lazy', src: p.thumbV ? thumbUrl(p) : '', draggable: false, onerror: (e) => (e.target.style.visibility = 'hidden') }),
      el('span', { class: 'fstars' }), el('span', { class: 'fflag' }));
    decorateF(c, p); fcells.set(id, c); frag.append(c);
  }
  film.append(frag);
  scrollFilm();
  info();
}
function decorateF(c, p) {
  c.classList.toggle('sel', S.sel.has(p.id)); c.classList.toggle('cur', p.id === S.cur); c.classList.toggle('rejected', p.flag === -1);
  c.querySelector('.fstars').innerHTML = iconHTML('star-fill').repeat(p.rating || 0);
  c.querySelector('.fflag').innerHTML = p.flag === 1 ? iconHTML('flag') : p.flag === -1 ? iconHTML('reject') : '';
  c.querySelector('.fflag').style.color = p.flag === -1 ? '#e66' : '';
  c.style.borderBottom = p.label ? `3px solid ${{ red: '#d9443f', yellow: '#e2c43a', green: '#55a84a', blue: '#4a78c9', purple: '#9452b8' }[p.label]}` : '';
}
function scrollFilm() { const c = fcells.get(S.cur); if (c) c.scrollIntoView({ block: 'nearest', inline: 'center' }); }
film.addEventListener('mousedown', (e) => {
  const c = e.target.closest('.fcell'); if (!c) return;
  if (e.button === 2 && S.sel.has(c.dataset.id)) return;
  setCurrent(c.dataset.id, { additive: (e.ctrlKey || e.metaKey), range: e.shiftKey, toggle: (e.ctrlKey || e.metaKey) && !e.shiftKey });
});
film.addEventListener('dblclick', (e) => { if (e.target.closest('.fcell') && S.module === 'library') setView('loupe'); });
film.addEventListener('contextmenu', (e) => { e.preventDefault(); if (e.target.closest('.fcell')) photoMenu(e.clientX, e.clientY); });
film.addEventListener('dragstart', (e) => { const c = e.target.closest('.fcell'); if (!c) return; if (!S.sel.has(c.dataset.id)) setCurrent(c.dataset.id); e.dataTransfer.setData('text/lightbench-ids', JSON.stringify(targets())); });
film.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { film.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
function info() {
  const src = S.source, p = P(S.cur);
  const name = { all: 'All Photographs', quick: 'Quick Collection', recent: 'Previous Import', edited: 'Edited Photos', missing: 'Missing Photographs' }[src.type]
    || (src.type === 'folder' ? 'Folder: ' + src.value.split(S.info.sep).pop() : src.type === 'collection' ? 'Collection: ' + (C.collections[src.value]?.name || '') : src.type === 'keyword' ? 'Keyword: ' + src.value : src.type === 'aitag' ? 'AI: ' + src.value : '');
  $('#film-info').innerHTML = '';
  $('#film-info').append(el('span', { style: { display: 'contents' } }, el('b', {}, name), el('span', {}, `${S.list.length} photos`), el('span', {}, `${S.sel.size} selected`), p ? el('span', {}, '/ ' + p.name + (p.copyName ? ` (${p.copyName})` : '')) : null,
    S.aiRank ? el('span', { style: { color: '#9af' } }, icon('sparkles', { cls: 'sm' }), ' AI search active') : null,
    el('span', { style: { marginLeft: 'auto' } }, A.autoAdvance.on ? 'Auto-advance ON (Caps Lock)' : '')));
}
on('list', () => renderFilmstrip());
on('current', () => { for (const [id, c] of fcells) { c.classList.toggle('cur', id === S.cur); c.classList.toggle('sel', S.sel.has(id)); } scrollFilm(); info(); MODULES[S.module]?.onCurrent?.(); });
on('selection', () => { for (const [id, c] of fcells) { c.classList.toggle('sel', S.sel.has(id)); c.classList.toggle('cur', id === S.cur); } info(); MODULES[S.module]?.onSelection?.(); });
on('thumb', (id) => { const c = fcells.get(id), p = P(id); if (c && p) { const img = c.querySelector('img'); img.style.visibility = ''; img.src = thumbUrl(p); } });
on('meta', (ids) => { for (const id of ids || []) { const c = fcells.get(id); if (c && P(id)) decorateF(c, P(id)); } });
on('toast', (m) => toast(m));

// ---------- panel toggles ----------
function togglePanels(which) {
  if (which === 'left' || which === 'both') document.body.classList.toggle('hide-left');
  if (which === 'right' || which === 'both') document.body.classList.toggle('hide-right');
  setTimeout(() => viewer().requestRender(), 30);
}
$$('.edge-toggle').forEach((t) => t.addEventListener('click', () => togglePanels(t.dataset.toggle)));
let lights = 0;
function cycleLights() { lights = (lights + 1) % 3; document.body.classList.toggle('lights-dim', lights === 1); document.body.classList.toggle('lights-out', lights === 2); }

// ---------- keyboard ----------
const isTyping = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
window.addEventListener('keydown', (e) => {
  if ($('#modal-root').children.length) return;
  if (isTyping()) return;
  if (document.activeElement?.type === 'range' && /Arrow/.test(e.key)) return;
  const k = e.key.toLowerCase();
  if (S.module === 'develop' && dev.key(e)) { e.preventDefault(); return; }
  const caps = e.getModifierState && e.getModifierState('CapsLock');
  const adv = () => { if (caps) step(1); };
  // modules
  if ((e.ctrlKey || e.metaKey) && e.altKey && /^[1-5]$/.test(e.key)) { setModule(['library', 'develop', 'map', 'slideshow', 'print'][+e.key - 1]); e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
    if (k === 'c') A.copySettings(); else if (k === 'v') A.pasteSettings(); else if (k === 's') A.syncSettings(); else if (k === 'e') openExport(targets()); else if (k === 'i') openImport(); else if (k === 'r') A.resetSettings(); else return;
    e.preventDefault(); return;
  }
  if ((e.ctrlKey || e.metaKey)) {
    if (k === 'a') { S.sel = new Set(S.list); emit('selection'); }
    else if (k === 'd') { S.sel = new Set(S.cur ? [S.cur] : []); emit('selection'); }
    else if (k === "'") A.virtualCopy();
    else if (k === '[') A.rotate(-1);
    else if (k === ']') A.rotate(1);
    else if (k === 'r') A.showInExplorer();
    else if (k === 'u') A.autoSettings();
    else if (k === 'f') { const t = document.querySelector('#filterbar input'); if (S.module === 'library') { setView('grid'); setTimeout(() => document.querySelector('#filterbar input')?.focus(), 30); } else t?.focus(); }
    else if (k === 'n') A.newCollection(true);
    else if (k === 'e') openExport(targets());
    else return;
    e.preventDefault(); return;
  }
  if (e.altKey) return;
  if (/^[0-5]$/.test(e.key)) { A.setRating(+e.key); adv(); }
  else if (/^[6-9]$/.test(e.key)) { A.setLabel(['red', 'yellow', 'green', 'blue'][+e.key - 6]); adv(); }
  else if (k === 'p') { A.setFlag(1); adv(); }
  else if (k === 'x') { A.setFlag(-1); adv(); }
  else if (k === 'u') { A.setFlag(0); adv(); }
  else if (e.key === '`') { const p = P(S.cur); if (p) { A.setFlag(p.flag === 1 ? 0 : 1); } }
  else if (k === '[' || k === ']') A.bumpRating(k === ']' ? 1 : -1);
  else if (k === 'b') A.toggleQuick();
  else if (k === 'g') { setModule('library'); setView('grid'); }
  else if (k === 'e') { setModule('library'); setView('loupe'); }
  else if (k === 'c') { setModule('library'); setView('compare'); }
  else if (k === 'n') { setModule('library'); setView('survey'); }
  else if (k === 'd') setModule('develop');
  else if (k === 'i' && S.module === 'library') cycleInfo();
  else if (k === 'l') cycleLights();
  else if (k === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }
  else if (k === 'z' && S.module === 'library') { if (lib.view !== 'loupe') setView('loupe'); else viewer().toggleZoom(viewer().lastMouse); }
  else if (k === '\\' && S.module === 'library' && lib.view === 'grid') toggleFilterBar();
  else if (e.key === 'Tab') { togglePanels(e.shiftKey ? 'both' : 'both'); if (e.shiftKey) document.body.classList.toggle('film-hidden'); }
  else if (e.key === 'F5') return;
  else if (e.key === 'F6') { document.body.classList.toggle('film-hidden'); setTimeout(() => viewer().requestRender(), 30); }
  else if (e.key === 'F7') togglePanels('left');
  else if (e.key === 'F8') togglePanels('right');
  else if (e.key === 'ArrowRight') { if (S.module === 'library' && lib.view === 'compare') compareStep(1); else step(1); }
  else if (e.key === 'ArrowLeft') { if (S.module === 'library' && lib.view === 'compare') compareStep(-1); else step(-1); }
  else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && S.module === 'library' && lib.view === 'grid') step((e.key === 'ArrowDown' ? 1 : -1) * gridColumns());
  else if (e.key === 'Home') { if (S.list[0]) setCurrent(S.list[0]); }
  else if (e.key === 'End') { if (S.list.length) setCurrent(S.list.at(-1)); }
  else if (e.key === 'Delete' || e.key === 'Backspace') A.removeSelected();
  else if (e.key === 'Escape') { if (S.module === 'library' && lib.view !== 'grid') setView('grid'); else if (lights) { lights = 2; cycleLights(); } }
  else if (e.key === '?' || e.key === 'F1') showHelp();
  else return;
  e.preventDefault();
});
window.addEventListener('keydown', (e) => { if (e.key === 'CapsLock') setTimeout(() => { A.autoAdvance.on = e.getModifierState('CapsLock'); info(); }, 0); });

function showHelp() {
  const keys = [
    ['G / E / C / N', 'Grid / Loupe / Compare / Survey'], ['D', 'Develop'], ['Ctrl+Alt+1…5', 'Switch module'], ['0–5', 'Set rating'], ['[ / ]', 'Rating − / +'],
    ['P / X / U', 'Pick / Reject / Unflag'], ['6 7 8 9', 'Red / Yellow / Green / Blue label'], ['Caps Lock', 'Auto-advance after rating'], ['B', 'Quick Collection'],
    ['← → ↑ ↓', 'Navigate photos'], ['Ctrl+A / Ctrl+D', 'Select all / none'], ["Ctrl+'", 'Virtual copy'], ['Ctrl+[ / ]', 'Rotate left / right'],
    ['Ctrl+Shift+C / V', 'Copy / paste settings'], ['Ctrl+Shift+S', 'Sync settings'], ['Ctrl+U', 'Auto tone'], ['Ctrl+Shift+R', 'Reset settings'],
    ['Ctrl+Shift+I', 'Import'], ['Ctrl+Shift+E', 'Export'], ['Ctrl+F', 'Search'], ['Ctrl+N', 'New collection'], ['Ctrl+R', 'Show in Explorer'],
    ['Delete', 'Remove from catalog / collection'], ['Tab / Shift+Tab', 'Hide panels'], ['F6 / F7 / F8', 'Filmstrip / left / right panel'], ['L', 'Lights dim / out'], ['F', 'Full screen'],
    ['I', 'Cycle loupe info'], ['Z / click', 'Zoom 1:1 ↔ fit'], ['Space+drag', 'Pan when zoomed'],
    ['R', 'Crop & straighten'], ['Q', 'Spot removal / heal'], ['M', 'Masking'], ['W', 'White balance picker'], ['J', 'Clipping warning'], ['\\', 'Before / after'], ['Y', 'Before | after split'],
    ['O', 'Mask overlay'], ['[ ]', 'Brush / spot size'], ['Alt (painting)', 'Erase brush'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['X (crop)', 'Swap crop orientation'], ['Ctrl+drag (crop)', 'Straighten along a line'],
  ];
  modal('Keyboard Shortcuts', el('div', { class: 'help-grid' }, keys.map(([k, d]) => el('div', {}, el('span', {}, d.replace('Show in Explorer', REVEAL_LABEL)), el('span', { class: 'kbd' }, keyLabel(k))))), { buttons: [{ label: 'Close', cls: 'primary' }] });
}

// ---------- drag & drop import ----------
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; $('#dropzone').classList.remove('hidden'); } });
window.addEventListener('dragleave', (e) => { if (e.dataTransfer.types.includes('Files') && --dragDepth <= 0) { dragDepth = 0; $('#dropzone').classList.add('hidden'); } });
window.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault(); dragDepth = 0; $('#dropzone').classList.add('hidden');
  importDropped(e.dataTransfer.files);
});
document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input,textarea')) e.preventDefault(); });

// ---------- brand menu ----------
$('.brand').addEventListener('click', (e) => contextMenu(e.clientX, e.clientY + 10, [
  { label: 'Import Photos…', key: 'Ctrl+Shift+I', action: () => openImport() },
  { label: 'Export Selected…', key: 'Ctrl+Shift+E', action: () => openExport(targets()) },
  '-',
  { label: 'Remove All Rejected Photos…', action: () => A.removeRejected() },
  { label: 'Re-render All Thumbnails', action: () => { for (const id of Object.keys(C.photos)) queueThumb(id); toast('Rebuilding thumbnails in the background'); } },
  { label: 'Show Catalog Folder', action: async () => { const { api } = await import('./api.js'); api.reveal(S.info.dataDir); } },
  '-',
  { label: 'Welcome Guide', action: () => showWelcome({ openImport }) },
  { label: 'Keyboard Shortcuts', key: '?', action: showHelp },
  { label: 'Send Feedback / Report a Problem…', action: () => showFeedback() },
  { label: 'AI Models…', action: () => import('./models.js').then((m) => m.showModels()) },
  { label: 'Check for Updates…', action: () => checkForUpdates({ manual: true }) },
  { label: 'About & Licenses…', action: () => showAbout() },
]));
$('.brand').style.cursor = 'pointer';

// ---------- About & Licenses ----------
async function showAbout() {
  const doc = el('div', { class: 'legal' });
  const load = async (file) => {
    doc.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const t = await (await fetch('legal/' + file)).text();
      doc.innerHTML = file.endsWith('.md') ? mdToHtml(t) : `<pre>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
    } catch { doc.textContent = 'Could not load ' + file; }
    doc.scrollTop = 0;
  };
  const tab = (label, file) => el('button', { class: 'btn small', onclick: () => load(file) }, label);
  const body = el('div', {},
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '12px' } },
      el('img', { src: 'img/logo.svg', style: { width: '56px', height: '56px' } }),
      el('div', {}, el('div', { style: { fontSize: '18px', color: '#eee' } }, 'Lightbench'), el('div', { class: 'muted' }, 'Photo library, RAW editor and AI masking · by Latent Studios · © 2026 Latent Studios'))),
    el('div', { class: 'btnrow' }, tab('Open-Source Credits', 'THIRD_PARTY_NOTICES.md'), tab('License Agreement', 'LICENSE.txt'), tab('Privacy', 'PRIVACY.md'),
      tab('Apache-2.0', 'Apache-2.0.txt'), tab('LibRaw (CDDL)', 'LibRaw-CDDL-1.0.txt')),
    doc);
  modal('About Lightbench', body, { buttons: [{ label: 'Close', cls: 'primary' }] });
  load('THIRD_PARTY_NOTICES.md');
}

// ---------- boot ----------
(async function boot() {
  try {
    await loadCatalog();
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px;color:#ddd;font:15px Segoe UI">Could not connect to the Lightbench server.<br><br>Start it with <b>Start Lightbench.bat</b> and reload this page.<br><br><span style="color:#888">${e.message}</span></div>`;
    return;
  }
  window.__viewer = viewer();
  S.sort = prefs.get('sort', S.sort);
  refreshList(false);
  document.body.dataset.module = 'library';
  lib.enter();
  renderFilmstrip();
  // First launch: the welcome guide. Otherwise a quiet daily update check once things have settled.
  if (!prefs.get('welcome:v1', false)) setTimeout(() => showWelcome({ openImport, firstRun: true }), 600);
  else setTimeout(() => checkForUpdates().catch(() => {}), 8000);
  // AI models: move any from the old in-browser cache to the model store, then (once) suggest the offline download.
  setTimeout(async () => {
    const M = await import('./models.js');
    await M.migrateBrowserCache();
    if (prefs.get('welcome:v1', false) && !prefs.get('models:offered', false) && !(await M.allReady())) {
      prefs.set('models:offered', true);
      toast(el('span', {}, 'New: AI features can now work offline. ', el('a', { href: '#', class: 'toast-link', onclick: (e) => { e.preventDefault(); M.showModels(); } }, 'Download them')), false, 12000);
    }
  }, 3000);
  // resume any photos whose previews never finished
  // (also upgrades RAW photos imported before true RAW decoding existed)
  const broken = Object.values(C.photos).filter((p) => !p.master && ((!p.previewReady && !p.error) || (p.raw && !p.rawMode)));
  if (broken.length) {
    const { buildPreviews } = await import('./imaging.js');
    for (const p of broken) {
      try { await buildPreviews(p); emit('thumb', p.id); if (p.edits) queueThumb(p.id); for (const v of Object.values(C.photos)) if (v.master === p.id) queueThumb(v.id); }
      catch (e) { p.error = e.message; }
    }
    if (broken.length) save();
  }
  // rebuild thumbnails for edited photos whose thumbnail predates the edit
  for (const p of Object.values(C.photos)) if (p.master && !p.thumbV) queueThumb(p.id);
})();
