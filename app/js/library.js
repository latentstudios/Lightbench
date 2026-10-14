// Library module: grid / loupe / compare / survey, filter bar, catalog panels, metadata, keywording, AI insights.
import { C, S, P, on, emit, save, refreshList, setCurrent, targets, folderTree, getSettings, aiText, photoDate, smartMatch } from './store.js';
import { el, $, panel, slider, sectionLabel, toast, contextMenu, prompt, confirmBox, LABEL_COLORS, fmtDate, fmtBytes, debounce, prefs, modal } from './ui.js';
import { thumbUrl, importFiles, queueThumb, loadSource } from './imaging.js';
import { histogramWidget } from './histogram.js';
import { viewer } from './viewer.js';
import { Engine } from './engine.js';
import * as A from './actions.js';
import * as AI from './ai.js';
import { api } from './api.js';
import { openImport, openExport } from './dialogs.js';
import { openDenoise } from './denoise-ui.js';
import { icon, iconHTML, starsHTML } from './icons.js';
import { REVEAL_LABEL } from './platform.js';

const lib = { view: 'grid' };
export default lib;

// =============== GRID ===============
const grid = $('#grid');
const cells = new Map();
function cellFor(p, idx) {
  const img = el('img', { loading: 'lazy', draggable: false, src: p.thumbV ? thumbUrl(p) : '' });
  img.onerror = () => { img.style.display = 'none'; };
  img.onload = () => { img.style.display = ''; };
  const cell = el('div', { class: 'cell', draggable: true, 'data-id': p.id },
    el('div', { class: 'num' }, idx + 1),
    el('div', { class: 'img' }, p.thumbV ? img : el('div', { class: 'placeholder' })),
    el('div', { class: 'badges' }),
    el('div', { class: 'flag' }),
    el('div', { class: 'meta' }, el('span', { class: 'stars' }), el('span', { class: 'ext' })));
  cell._img = img;
  decorate(cell, p);
  return cell;
}
function decorate(cell, p) {
  cell.classList.toggle('sel', S.sel.has(p.id));
  cell.classList.toggle('cur', S.cur === p.id);
  cell.classList.toggle('rejected', p.flag === -1);
  for (const c of Object.keys(LABEL_COLORS)) cell.classList.toggle('label-' + c, p.label === c);
  const r = p.rating || 0;
  cell.querySelector('.stars').innerHTML = starsHTML(r, 'sm');
  cell.querySelector('.ext').textContent = (p.copyName ? p.copyName + ' · ' : '') + p.ext.toUpperCase();
  cell.querySelector('.flag').innerHTML = p.flag === 1 ? iconHTML('flag') : p.flag === -1 ? iconHTML('reject') : '';
  cell.querySelector('.flag').style.color = p.flag === -1 ? '#e66' : '#fff';
  const b = cell.querySelector('.badges'); b.innerHTML = '';
  if (p.edits) b.append(el('span', { class: 'badge', title: 'Has adjustments' }, icon('settings', { cls: 'sm' })));
  if (p.master) b.append(el('span', { class: 'badge', title: 'Virtual copy' }, icon('copy', { cls: 'sm' })));
  if (C.quick.includes(p.id)) b.append(el('span', { class: 'badge', title: 'In Quick Collection' }, icon('quick', { cls: 'sm' })));
  if ((C.photos[p.master] || p).denoise?.on) b.append(el('span', { class: 'badge', title: 'AI Denoised', style: { color: '#9fd' } }, icon('denoise', { cls: 'sm' })));
  if (p.ai?.blurry) b.append(el('span', { class: 'badge', title: 'AI: possibly blurry', style: { color: '#fb6' } }, icon('warning', { cls: 'sm' })));
  if (p.ai?.at) b.append(el('span', { class: 'badge', title: 'AI analyzed: ' + aiText(p), style: { color: '#9af' } }, icon('sparkles', { cls: 'sm' })));
  if (p.error) b.append(el('span', { class: 'badge', title: p.error, style: { color: '#f66' } }, icon('warning', { cls: 'sm' })));
  if (p.missing) b.append(el('span', { class: 'badge', title: 'File missing', style: { color: '#f66' } }, icon('help', { cls: 'sm' })));
}
function updateCell(id) {
  const cell = cells.get(id), p = P(id); if (!cell || !p) return;
  if (p.thumbV) {
    const src = thumbUrl(p);
    if (!cell._img.isConnected) { const box = cell.querySelector('.img'); box.innerHTML = ''; box.append(cell._img); }
    if (cell._img.getAttribute('src') !== src) cell._img.src = src;
  }
  decorate(cell, p);
}
export function renderGrid() {
  grid.innerHTML = ''; cells.clear();
  const frag = document.createDocumentFragment();
  S.list.forEach((id, i) => { const c = cellFor(P(id), i); cells.set(id, c); frag.append(c); });
  grid.append(frag);
  grid.style.setProperty('--cell-size', prefs.get('cellSize', 190) + 'px');
  scrollToCurrent();
}
function scrollToCurrent() { const c = cells.get(S.cur); if (c) c.scrollIntoView({ block: 'nearest' }); }
grid.addEventListener('mousedown', (e) => {
  const cell = e.target.closest('.cell'); if (!cell) return;
  if (e.button === 2 && S.sel.has(cell.dataset.id)) return;
  setCurrent(cell.dataset.id, { additive: (e.ctrlKey || e.metaKey), range: e.shiftKey, toggle: (e.ctrlKey || e.metaKey) && !e.shiftKey });
});
grid.addEventListener('dblclick', (e) => { const cell = e.target.closest('.cell'); if (cell) setView('loupe'); });
grid.addEventListener('contextmenu', (e) => { e.preventDefault(); const cell = e.target.closest('.cell'); if (cell) photoMenu(e.clientX, e.clientY); });
grid.addEventListener('dragstart', (e) => { const cell = e.target.closest('.cell'); if (!cell) return; if (!S.sel.has(cell.dataset.id)) setCurrent(cell.dataset.id); e.dataTransfer.setData('text/lightbench-ids', JSON.stringify(targets())); e.dataTransfer.effectAllowed = 'copy'; });
export function gridColumns() {
  const first = grid.querySelector('.cell'); if (!first) return 1;
  const w = first.getBoundingClientRect().width + 6;
  return Math.max(1, Math.floor((grid.clientWidth - 16) / w));
}

export function photoMenu(x, y) {
  const p = P(S.cur); if (!p) return;
  const cols = Object.values(C.collections).filter((c) => !c.smart);
  contextMenu(x, y, [
    { label: 'Open in Loupe', key: 'E', action: () => setView('loupe') },
    { label: 'Edit in Develop', key: 'D', action: () => emit('module', 'develop') },
    '-',
    { label: 'Set Flag: Pick', key: 'P', action: () => A.setFlag(1) },
    { label: 'Set Flag: Rejected', key: 'X', action: () => A.setFlag(-1) },
    { label: 'Remove Flag', key: 'U', action: () => A.setFlag(0) },
    '-',
    { label: 'Rotate Left', key: 'Ctrl+[', action: () => A.rotate(-1) },
    { label: 'Rotate Right', key: 'Ctrl+]', action: () => A.rotate(1) },
    { label: 'Create Virtual Copy', key: "Ctrl+'", action: () => A.virtualCopy() },
    '-',
    { label: 'Copy Settings…', key: 'Ctrl+Shift+C', action: () => A.copySettings() },
    { label: 'Paste Settings', key: 'Ctrl+Shift+V', action: () => A.pasteSettings() },
    { label: 'Sync Settings…', key: 'Ctrl+Shift+S', action: () => A.syncSettings() },
    { label: 'Auto Settings', key: 'Ctrl+U', action: () => A.autoSettings() },
    { label: 'Reset Settings', key: 'Ctrl+Shift+R', action: () => A.resetSettings() },
    '-',
    { label: 'AI Analyze (tags, objects, sharpness)', action: () => AI.analyze(targets(), { force: true }) },
    { label: 'AI: Find Similar Photos', action: () => findSimilar() },
    { label: 'AI Denoise…', action: () => openDenoise(targets()) },
    '-',
    { label: 'Add to Quick Collection', key: 'B', action: () => A.toggleQuick() },
    ...cols.slice(0, 12).map((c) => ({ label: `Add to “${c.name}”`, action: () => A.addToCollection(c.id) })),
    { label: 'New Collection from Selection…', action: () => A.newCollection(true) },
    '-',
    { label: 'Export…', key: 'Ctrl+Shift+E', action: () => openExport(targets()) },
    { label: 'Show in Explorer', key: 'Ctrl+R', action: () => A.showInExplorer() },
    { label: 'Remove from Catalog', key: 'Del', action: () => A.removeSelected() },
  ]);
}

// =============== VIEWS ===============
const panes = ['grid', 'loupe', 'compare', 'survey', 'empty'];
export function setView(v) {
  if (!S.list.length && v !== 'grid') v = 'grid';
  lib.view = v;
  emit('lib-view', v);
  if (S.module === 'library') showPane();
}
export function showPane() {
  const empty = !Object.keys(C.photos).length;
  const v = empty ? 'empty' : lib.view;
  for (const p of panes) $('#' + p).classList.toggle('hidden', p !== v);
  $('#filterbar').classList.toggle('hidden', v !== 'grid');
  if (v === 'loupe') { viewer().setTool(null); showLoupe(); }
  if (v === 'compare') renderCompare();
  if (v === 'survey') renderSurvey();
  if (v === 'grid') scrollToCurrent();
  if (v === 'empty') renderEmpty();
  renderToolbar();
}
function showLoupe() {
  const p = P(S.cur); if (!p) { viewer().clear(); return; }
  viewer().show(p);
  updateLoupeInfo();
}
let infoMode = prefs.get('loupeInfo', 1);
function updateLoupeInfo() {
  const p = P(S.cur), box = $('#loupe-info');
  if (!p || !infoMode) { box.textContent = ''; return; }
  const e = p.exif || {};
  box.textContent = infoMode === 1
    ? `${p.name}${p.copyName ? ' / ' + p.copyName : ''}\n${fmtDate(photoDate(p))}\n${p.w ? p.w + ' × ' + p.h : ''}`
    : `${p.name}\n${[e.shutter, e.fnum && 'ƒ/' + e.fnum, e.iso && 'ISO ' + e.iso, e.focal && Math.round(e.focal) + 'mm'].filter(Boolean).join('  ')}\n${[e.make, e.model].filter(Boolean).join(' ')}  ${e.lens || ''}`;
}
export function cycleInfo() { infoMode = (infoMode + 1) % 3; prefs.set('loupeInfo', infoMode); updateLoupeInfo(); }

// ---- compare ----
const cmp = { a: null, b: null };
function cmpEngine(k) { if (!cmp[k]) cmp[k] = new Engine($('#cmp-' + k), { bg: [0.184, 0.184, 0.184] }); return cmp[k]; }
async function drawCmp(k, id) {
  const p = P(id), cv = $('#cmp-' + k), en = cmpEngine(k);
  const r = cv.getBoundingClientRect(); cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio;
  if (!p) { const gl = en.gl; gl.clearColor(0.18, 0.18, 0.18, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
  en.setSource(await loadSource(p));
  const s = getSettings(p);
  const { syncMaskLayers } = await import('./maskraster.js');
  await syncMaskLayers(en, s);
  const [ow, oh] = en.outputSize(s), sc = Math.min((cv.width - 20) / ow, (cv.height - 20) / oh);
  en.render(s, { view: [(cv.width - ow * sc) / 2, (cv.height - oh * sc) / 2, ow * sc, oh * sc] });
  const tag = cv.parentElement.querySelector('.cmp-tag');
  tag.textContent = (k === 'a' ? 'Select: ' : 'Candidate: ') + p.name + '  ';
  tag.insertAdjacentHTML('beforeend', iconHTML('star-fill', 'sm').repeat(p.rating || 0) + (p.flag === 1 ? ' ' + iconHTML('flag') : p.flag === -1 ? ' ' + iconHTML('reject') : ''));
}
function renderCompare() {
  const sel = targets();
  if (!S.compare.select || !P(S.compare.select)) S.compare.select = S.cur;
  if (!S.compare.candidate || S.compare.candidate === S.compare.select || !P(S.compare.candidate)) {
    const others = sel.filter((x) => x !== S.compare.select);
    S.compare.candidate = others[0] || S.list[S.list.indexOf(S.compare.select) + 1] || null;
  }
  drawCmp('a', S.compare.select); drawCmp('b', S.compare.candidate);
}
export function compareStep(d) {
  const i = S.list.indexOf(S.compare.candidate);
  let n = S.list[i + d]; if (n === S.compare.select) n = S.list[i + 2 * d];
  if (n) { S.compare.candidate = n; S.cur = n; emit('selection'); renderCompare(); }
}
export function compareSwap() { [S.compare.select, S.compare.candidate] = [S.compare.candidate, S.compare.select]; renderCompare(); }
export function compareMakeSelect() { S.compare.select = S.compare.candidate; S.compare.candidate = null; renderCompare(); }
new ResizeObserver(() => { if (lib.view === 'compare' && S.module === 'library') renderCompare(); }).observe($('#compare'));

// ---- survey ----
function renderSurvey() {
  const box = $('#survey'); box.innerHTML = '';
  const ids = targets().slice(0, 30);
  const n = ids.length, W = box.clientWidth - 32, H = box.clientHeight - 32;
  let best = 1;
  for (let cols = 1; cols <= n; cols++) { const rows = Math.ceil(n / cols); const s = Math.min(W / cols, H / rows); if (s > best) best = s; }
  const size = best - 16;
  for (const id of ids) {
    const p = P(id);
    box.append(el('div', { class: 'sv' + (id === S.cur ? ' cur' : ''), style: { width: size + 'px', height: size + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onmousedown: () => { S.cur = id; emit('current', id); renderSurvey(); }, ondblclick: () => setView('loupe') },
      el('img', { src: thumbUrl(p), style: { maxWidth: '100%', maxHeight: '100%' } }),
      el('span', { class: 'x', title: 'Remove from survey', onclick: (e) => { e.stopPropagation(); S.sel.delete(id); emit('selection'); renderSurvey(); } }, icon('x'))));
  }
}

function renderEmpty() {
  const box = $('#empty'); box.innerHTML = '';
  box.append(el('h2', {}, 'Welcome to Lightbench'), el('div', {}, 'Your photos stay where they are — Lightbench references them in place.'),
    el('div', { class: 'btnrow' }, el('button', { class: 'btn primary', onclick: () => openImport() }, 'Import Photos…')),
    el('div', { class: 'muted small' }, 'Or drag & drop photo files anywhere in this window. JPEG, PNG, WebP, TIFF and RAW (embedded preview) are supported.'));
}

// =============== FILTER BAR ===============
function renderFilterBar() {
  const fb = $('#filterbar'); fb.innerHTML = '';
  const f = S.filter;
  const apply = () => { refreshList(); };
  const text = el('input', { type: 'text', placeholder: 'Search text, keywords, AI tags…', value: f.text, oninput: debounce(() => { f.text = text.value; apply(); }, 200) });
  text.addEventListener('keydown', (e) => e.stopPropagation());
  const starBtns = [1, 2, 3, 4, 5].map((n) => el('button', { class: 'star-btn' + (f.rating >= n ? ' on' : ''), title: `Rating ${f.ratingOp} ${n}`, onclick: () => { f.rating = f.rating === n ? 0 : n; renderFilterBar(); apply(); } }, icon(f.rating >= n ? 'star-fill' : 'star')));
  const opSel = el('select', { onchange: () => { f.ratingOp = opSel.value; apply(); } }, ['>=', '=', '<='].map((o) => el('option', { value: o, selected: f.ratingOp === o }, o === '>=' ? '≥' : o === '<=' ? '≤' : '=')));
  const flagBtn = (v, t, sym) => el('button', { class: 'flag-btn' + (f.flag === v ? ' on' : ''), title: t, onclick: () => { f.flag = f.flag === v ? 'any' : v; renderFilterBar(); apply(); } }, sym);
  const lbl = (c) => el('button', { class: 'lbl-btn' + (f.labels.includes(c) ? ' on' : ''), title: c, style: { background: LABEL_COLORS[c] || '#777' }, onclick: () => { f.labels = f.labels.includes(c) ? f.labels.filter((x) => x !== c) : [...f.labels, c]; renderFilterBar(); apply(); } });
  const cams = [...new Set(Object.values(C.photos).map((p) => p.exif?.model).filter(Boolean))].sort();
  const camSel = el('select', { onchange: () => { f.camera = camSel.value; apply(); } }, el('option', { value: '' }, 'All cameras'), cams.map((c) => el('option', { value: c, selected: f.camera === c }, c)));
  const editSel = el('select', { onchange: () => { f.edited = editSel.value; apply(); } }, [['any', 'Any edit state'], ['yes', 'Edited'], ['no', 'Unedited']].map(([v, l]) => el('option', { value: v, selected: f.edited === v }, l)));
  const kindSel = el('select', { onchange: () => { f.kind = kindSel.value; apply(); } }, [['any', 'All kinds'], ['raw', 'Raw only'], ['master', 'Masters'], ['virtual', 'Virtual copies']].map(([v, l]) => el('option', { value: v, selected: f.kind === v }, l)));
  const ai = el('input', { type: 'text', placeholder: 'AI search: “dog on a beach at sunset”', value: f.ai });
  ai.addEventListener('keydown', async (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      f.ai = ai.value.trim();
      if (!f.ai) { S.aiRank = null; apply(); return; }
      const r = await AI.semanticSearch(f.ai);
      S.aiRank = r; apply();
    }
    if (e.key === 'Escape') { ai.value = ''; f.ai = ''; S.aiRank = null; apply(); }
  });
  const anyActive = f.text || f.rating || f.flag !== 'any' || f.labels.length || f.edited !== 'any' || f.camera || f.kind !== 'any' || S.aiRank;
  fb.append(...[
    el('div', { class: 'fgroup' }, el('span', {}, 'Text'), text),
    el('div', { class: 'fgroup' }, el('span', {}, 'Attribute'), flagBtn('pick', 'Picks only', icon('flag')), flagBtn('unflagged', 'Unflagged only', icon('flag-outline')), flagBtn('rejected', 'Rejected only', icon('reject')), opSel, ...starBtns, ...['red', 'yellow', 'green', 'blue', 'purple'].map(lbl), editSel),
    el('div', { class: 'fgroup' }, el('span', {}, 'Metadata'), camSel, kindSel),
    el('div', { class: 'fgroup ai-search' }, ai, S.aiRank ? el('button', { class: 'btn small', onclick: () => { f.ai = ''; S.aiRank = null; renderFilterBar(); apply(); } }, 'Clear AI') : null),
    anyActive ? el('button', { class: 'btn small', onclick: () => { Object.assign(f, { text: '', rating: 0, ratingOp: '>=', flag: 'any', labels: [], edited: 'any', camera: '', kind: 'any', ai: '' }); S.aiRank = null; renderFilterBar(); apply(); } }, 'Filters Off') : null,
  ].filter(Boolean));
}
export function toggleFilterBar() { const fb = $('#filterbar'); fb.dataset.off = fb.dataset.off ? '' : '1'; fb.style.display = fb.dataset.off ? 'none' : ''; }
export { renderFilterBar };

// =============== TOOLBAR ===============
function renderToolbar() {
  if (S.module !== 'library') return;
  const tb = $('#toolbar'); tb.innerHTML = '';
  const vb = (v, t, k) => el('button', { class: 'btn small' + (lib.view === v ? ' active' : ''), title: `${t} (${k})`, onclick: () => setView(v) }, icon(v), t);
  tb.append(vb('grid', 'Grid', 'G'), vb('loupe', 'Loupe', 'E'), vb('compare', 'Compare', 'C'), vb('survey', 'Survey', 'N'));
  tb.append(el('span', { class: 'muted' }, ' Sort:'));
  const sortSel = el('select', { onchange: () => { S.sort.by = sortSel.value; prefs.set('sort', S.sort); refreshList(); } },
    [['captureTime', 'Capture Time'], ['importedAt', 'Added Order'], ['editedAt', 'Edit Time'], ['name', 'File Name'], ['rating', 'Rating'], ['flag', 'Pick'], ['label', 'Color Label'], ['size', 'File Size'], ['aspect', 'Aspect Ratio']].map(([v, l]) => el('option', { value: v, selected: S.sort.by === v }, l)));
  tb.append(sortSel, el('button', { class: 'btn small', title: 'Sort direction', onclick: () => { S.sort.dir *= -1; prefs.set('sort', S.sort); refreshList(); renderToolbar(); } }, S.sort.dir > 0 ? 'A→Z' : 'Z→A'));
  tb.append(el('span', { style: { width: '10px' } }),
    el('button', { class: 'btn small icon-only', title: 'Flag as Pick (P)', onclick: () => A.setFlag(1) }, icon('flag')),
    el('button', { class: 'btn small icon-only', title: 'Reject (X)', onclick: () => A.setFlag(-1) }, icon('reject')),
    ...[1, 2, 3, 4, 5].map((n) => el('button', { class: 'btn small', title: `Rate ${n} (${n})`, onclick: () => A.setRating(n) }, String(n), icon('star-fill', { cls: 'sm' }))),
    el('button', { class: 'btn small icon-only', title: 'Rotate left (Ctrl+[)', onclick: () => A.rotate(-1) }, icon('rotate-ccw')),
    el('button', { class: 'btn small icon-only', title: 'Rotate right (Ctrl+])', onclick: () => A.rotate(1) }, icon('rotate-cw')));
  if (lib.view === 'compare') tb.append(el('button', { class: 'btn small', onclick: compareSwap }, icon('swap'), 'Swap'), el('button', { class: 'btn small', onclick: compareMakeSelect }, icon('check'), 'Make Select'), el('button', { class: 'btn small icon-only', title: 'Previous candidate', onclick: () => compareStep(-1) }, icon('chevron-left')), el('button', { class: 'btn small icon-only', title: 'Next candidate', onclick: () => compareStep(1) }, icon('chevron-right')));
  tb.append(el('span', { style: { flex: 1 } }));
  if (lib.view === 'grid') {
    const sz = el('input', { type: 'range', min: 100, max: 420, value: prefs.get('cellSize', 190), style: { width: '120px' }, oninput: () => { grid.style.setProperty('--cell-size', sz.value + 'px'); prefs.set('cellSize', +sz.value); } });
    tb.append(el('span', { class: 'muted' }, 'Thumbnails'), sz);
  }
  tb.append(el('button', { class: 'btn small', onclick: () => openImport() }, icon('import'), 'Import…'), el('button', { class: 'btn small primary', onclick: () => openExport(targets()) }, icon('export'), 'Export…'));
}

// =============== LEFT PANELS ===============
let navImg = null;
function renderLeft() {
  const root = $('#left-panels'); root.innerHTML = '';
  // Navigator
  const nav = panel('Navigator', { id: 'lib-nav' });
  navImg = el('img', { style: { width: '100%', maxHeight: '170px', objectFit: 'contain', display: 'block', background: '#1d1d1d' } });
  nav.body.append(navImg);
  root.append(nav.el);
  updateNav();

  // Catalog
  const cat = panel('Catalog', { id: 'lib-catalog' });
  const total = Object.keys(C.photos).length;
  const recent = Object.values(C.photos).reduce((m, p) => Math.max(m, p.importedAt || 0), 0);
  const item = (type, label, count, value) => el('div', { class: 'list-item' + (S.source.type === type && (value == null || S.source.value === value) ? ' on' : ''), onclick: () => { S.source = { type, value }; S.aiRank = null; refreshList(false); renderLeft(); } }, el('span', {}, label), el('span', { class: 'count' }, count));
  cat.body.append(item('all', 'All Photographs', total), dropTarget(item('quick', 'Quick Collection +', C.quick.length), (ids) => { for (const id of ids) if (!C.quick.includes(id)) C.quick.push(id); save(); renderLeft(); }),
    item('recent', 'Previous Import', Object.values(C.photos).filter((p) => recent - (p.importedAt || 0) < 120000).length),
    item('edited', 'Edited Photos', Object.values(C.photos).filter((p) => p.edits).length));
  const missingN = Object.values(C.photos).filter((p) => p.missing).length;
  if (missingN) cat.body.append(item('missing', 'Missing Photographs', missingN));
  root.append(cat.el);

  // Folders
  const fol = panel('Folders', { id: 'lib-folders', tools: [{ icon: 'plus', title: 'Add folder (import)', onClick: () => openImport() }, { icon: 'refresh', title: 'Check for missing / new files', onClick: () => syncFolders() }] });
  const tree = folderTree();
  if (!tree.length) fol.body.append(el('div', { class: 'muted small' }, 'No folders yet.'));
  const sep = S.info.sep;
  // group by drive/root for readability
  for (const f of tree) {
    const parts = f.path.split(sep);
    const label = parts.length > 3 ? '…' + sep + parts.slice(-2).join(sep) : f.path;
    const it = el('div', { class: 'tree-item' + (S.source.type === 'folder' && S.source.value === f.path ? ' on' : ''), title: f.path, onclick: () => { S.source = { type: 'folder', value: f.path }; S.aiRank = null; refreshList(false); renderLeft(); } },
      el('span', { class: 'tw' }, icon('folder')), el('span', {}, label), el('span', { class: 'count' }, f.count));
    it.addEventListener('contextmenu', (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [
      { label: 'Synchronize Folder (import new files)', action: () => syncFolder(f.path) },
      { label: 'Show in Explorer', action: () => api.reveal(f.path) },
      { label: 'Remove Folder from Catalog', action: async () => { if (await confirmBox('Remove Folder', `Remove all ${f.count} photos in ${f.path} from the catalog? Files stay on disk.`, 'Remove')) { const { removePhotos } = await import('./store.js'); removePhotos(Object.values(C.photos).filter((p) => p.folder === f.path).map((p) => p.id)); S.source = { type: 'all' }; refreshList(false); renderLeft(); } } },
    ]); });
    fol.body.append(it);
  }
  root.append(fol.el);

  // Collections
  const col = panel('Collections', { id: 'lib-collections', tools: [{ icon: 'plus', title: 'Create collection', onClick: (e) => contextMenu(e.clientX, e.clientY, [{ label: 'Create Collection…', action: () => A.newCollection(targets().length > 0) }, { label: 'Create Smart Collection…', action: () => A.smartCollectionDialog() }]) }] });
  const colls = Object.values(C.collections).sort((a, b) => a.name.localeCompare(b.name));
  if (!colls.length) col.body.append(el('div', { class: 'muted small' }, 'Drag photos onto a collection to add them.'));
  for (const c of colls) {
    const count = c.smart ? Object.values(C.photos).filter((p) => smartCount(p, c)).length : c.ids.length;
    const it = el('div', { class: 'list-item' + (S.source.type === 'collection' && S.source.value === c.id ? ' on' : ''), onclick: () => { S.source = { type: 'collection', value: c.id }; S.aiRank = null; refreshList(false); renderLeft(); } },
      el('span', {}, icon(c.smart ? 'smart-collection' : 'collection'), ' ' + c.name + (S.targetCollection === c.id ? ' +' : '')), el('span', { class: 'count' }, count));
    it.addEventListener('contextmenu', (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [
      { label: 'Rename…', action: async () => { const n = await prompt('Rename Collection', c.name); if (n) { c.name = n; save(); renderLeft(); } } },
      c.smart ? { label: 'Edit Smart Collection…', action: () => A.smartCollectionDialog(c) } : { label: 'Set as Target Collection', action: () => { S.targetCollection = S.targetCollection === c.id ? null : c.id; renderLeft(); } },
      !c.smart ? { label: 'Add Selected Photos', action: () => A.addToCollection(c.id) } : null,
      { label: 'Export This Collection…', action: () => openExport(c.smart ? Object.values(C.photos).filter((p) => smartCount(p, c)).map((p) => p.id) : c.ids) },
      { label: 'Delete Collection', action: async () => { if (await confirmBox('Delete Collection', `Delete “${c.name}”? Photos are not removed from the catalog.`, 'Delete')) { delete C.collections[c.id]; if (S.source.value === c.id) S.source = { type: 'all' }; save(); refreshList(); renderLeft(); } } },
    ]); });
    col.body.append(c.smart ? it : dropTarget(it, (ids) => { A.addToCollection(c.id, ids); renderLeft(); }));
  }
  root.append(col.el);

  // Keyword list
  const kw = panel('Keyword List', { id: 'lib-keywords', collapsed: true });
  const counts = new Map();
  for (const p of Object.values(C.photos)) for (const k of p.keywords || []) counts.set(k, (counts.get(k) || 0) + 1);
  if (!counts.size) kw.body.append(el('div', { class: 'muted small' }, 'No keywords yet.'));
  for (const [k, n] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    kw.body.append(el('div', { class: 'list-item' + (S.source.type === 'keyword' && S.source.value === k ? ' on' : ''), onclick: () => { S.source = { type: 'keyword', value: k }; refreshList(false); renderLeft(); } }, el('span', {}, k), el('span', { class: 'count' }, n)));
  }
  root.append(kw.el);

  // AI tags
  const ai = panel('AI Tags & Objects', { id: 'lib-ai' });
  const tc = new Map();
  for (const p of Object.values(C.photos)) {
    for (const t of p.ai?.tags || []) tc.set(t.label, (tc.get(t.label) || 0) + 1);
    for (const o of p.ai?.objects || []) if (o.area > 0.01) tc.set(o.label, (tc.get(o.label) || 0) + 1);
  }
  const analyzed = Object.values(C.photos).filter((p) => p.ai?.at).length;
  ai.body.append(el('div', { class: 'muted small' }, `${analyzed} of ${total} photos analyzed`),
    el('div', { class: 'btnrow grow' }, el('button', { class: 'btn ai', onclick: () => AI.analyze(Object.keys(C.photos)) }, icon('sparkles'), 'Analyze All'), el('button', { class: 'btn ai', onclick: () => AI.analyze(targets(), { force: true }) }, icon('sparkles'), 'Selected')));
  const chips = el('div', { class: 'chips' });
  for (const [k, n] of [...tc].sort((a, b) => b[1] - a[1]).slice(0, 60)) chips.append(el('span', { class: 'chip ai' + (S.source.type === 'aitag' && S.source.value === k ? ' on' : ''), onclick: () => { S.source = { type: 'aitag', value: k }; refreshList(false); renderLeft(); } }, k, el('span', { class: 'score' }, n)));
  ai.body.append(chips);
  root.append(ai.el);
}
function smartCount(p, c) { return smartMatch(p, c.smart); }
function dropTarget(node, onDrop) {
  node.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/lightbench-ids')) { e.preventDefault(); node.style.outline = '1px solid #e8a33d'; } });
  node.addEventListener('dragleave', () => (node.style.outline = ''));
  node.addEventListener('drop', (e) => { node.style.outline = ''; const d = e.dataTransfer.getData('text/lightbench-ids'); if (d) { e.preventDefault(); onDrop(JSON.parse(d)); } });
  return node;
}
function updateNav() { const p = P(S.cur); if (navImg) { if (p && p.thumbV) navImg.src = thumbUrl(p); else navImg.removeAttribute('src'); } }

async function syncFolder(dir) {
  const files = await api.scan(dir, false);
  await importFiles(files);
  refreshList(); renderLeft();
}
async function syncFolders() {
  const ps = Object.values(C.photos).filter((p) => !p.master);
  const ex = await api.exists(ps.map((p) => p.path));
  let missing = 0;
  ps.forEach((p, i) => { p.missing = !ex[i]; if (!ex[i]) missing++; for (const v of Object.values(C.photos)) if (v.master === p.id) v.missing = p.missing; });
  save(); renderLeft();
  toast(missing ? `${missing} photo(s) are missing on disk (see Catalog › Missing Photographs)` : 'All photos found on disk');
}

// =============== RIGHT PANELS ===============
let histo = null;
function renderRight() {
  const root = $('#right-panels'); root.innerHTML = '';
  const h = panel('Histogram', { id: 'lib-histo' });
  histo = histogramWidget();
  h.body.append(histo.el);
  root.append(h.el);

  // Keywording
  const kw = panel('Keywording', { id: 'lib-kw' });
  kwBody = kw.body;
  root.append(kw.el);

  // Metadata
  const md = panel('Metadata', { id: 'lib-meta' });
  mdBody = md.body;
  root.append(md.el);
  updateRight();
}
let kwBody, mdBody;
function updateRight() {
  const p = P(S.cur);
  if (histo) histo.fromPhoto(lib.view === 'loupe' ? null : p);
  if (!kwBody) return;
  // keywording
  kwBody.innerHTML = '';
  if (p) {
    const ids = targets();
    const common = ids.map((id) => new Set(P(id).keywords || [])).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
    const chips = el('div', { class: 'chips' }, [...common].map((k) => el('span', { class: 'chip' }, k, el('span', { class: 'x', title: 'Remove keyword', onclick: () => A.removeKeyword(k) }, icon('x', { cls: 'sm' })))));
    const inp = el('input', { type: 'text', placeholder: 'Add keywords (comma separated)…', style: { width: '100%' }, list: 'kwlist' });
    const dl = el('datalist', { id: 'kwlist' }, C.keywords.map((k) => el('option', { value: k })));
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && inp.value.trim()) { A.addKeywords(inp.value.split(',')); inp.value = ''; } });
    const sugg = new Set([...(p.ai?.tags || []).map((t) => t.label), ...(p.ai?.objects || []).filter((o) => o.area > 0.01).map((o) => o.label)]);
    for (const k of p.keywords || []) sugg.delete(k);
    kwBody.append(el('div', { class: 'muted small' }, ids.length > 1 ? `Keywords shared by ${ids.length} photos` : 'Keyword Tags'), chips, inp, dl);
    if (sugg.size) kwBody.append(sectionLabel('AI Suggestions (click to add)'), el('div', { class: 'chips' }, [...sugg].slice(0, 16).map((k) => el('span', { class: 'chip ai', onclick: () => A.addKeywords([k]) }, '+ ' + k))));
    const recent = C.keywords.slice(0, 12);
    if (recent.length) kwBody.append(sectionLabel('Keyword Set'), el('div', { class: 'chips' }, recent.map((k) => el('span', { class: 'chip', onclick: () => A.addKeywords([k]) }, k))));
  }
  // metadata
  mdBody.innerHTML = '';
  if (p) {
    const e = p.exif || {};
    const titleIn = el('input', { type: 'text', value: p.title || '', placeholder: 'Title', style: { width: '100%' } });
    const capIn = el('textarea', { rows: 2, placeholder: 'Caption', style: { width: '100%' } }); capIn.value = p.caption || '';
    for (const x of [titleIn, capIn]) x.addEventListener('keydown', (ev) => ev.stopPropagation());
    titleIn.addEventListener('change', () => A.metaSet('title', titleIn.value));
    capIn.addEventListener('change', () => A.metaSet('caption', capIn.value));
    const lbls = el('div', { style: { display: 'flex', gap: '4px' } }, ['red', 'yellow', 'green', 'blue', 'purple'].map((c) => el('button', { class: 'lbl-btn' + (p.label === c ? ' on' : ''), style: { background: LABEL_COLORS[c] }, onclick: () => A.setLabel(c) })));
    const starsRow = el('div', {}, [1, 2, 3, 4, 5].map((n) => el('button', { class: 'star-btn' + ((p.rating || 0) >= n ? ' on' : ''), onclick: () => A.setRating(p.rating === n ? 0 : n) }, icon((p.rating || 0) >= n ? 'star-fill' : 'star'))));
    const kv = (k, v) => (v ? [el('div', {}, k), el('div', {}, v)] : []);
    mdBody.append(titleIn, capIn, el('div', { class: 'kv', style: { marginTop: '8px' } },
      el('div', {}, 'Rating'), starsRow, el('div', {}, 'Label'), lbls,
      ...kv('File Name', p.name + (p.copyName ? ` (${p.copyName})` : '')), ...kv('Folder', p.folder), ...kv('File Size', fmtBytes(p.size)),
      ...kv('Dimensions', p.w ? `${p.w} × ${p.h}` : ''), ...kv('Cropped', p.edits ? (() => { const s = getSettings(p); const rot = s.orient.rot % 2; const W = rot ? p.h : p.w, H = rot ? p.w : p.h; return `${Math.round(W * s.crop.w)} × ${Math.round(H * s.crop.h)}`; })() : ''),
      ...kv('Capture Time', fmtDate(p.captureTime)), ...kv('Camera', [e.make, e.model].filter(Boolean).join(' ')), ...kv('Lens', e.lens),
      ...kv('Exposure', [e.shutter, e.fnum && 'ƒ/' + e.fnum].filter(Boolean).join(' at ')), ...kv('ISO', e.iso), ...kv('Focal Length', e.focal && `${Math.round(e.focal)} mm${e.focal35 ? ` (${e.focal35} mm eq.)` : ''}`),
      ...kv('Exposure Bias', e.bias != null && e.bias !== '' ? `${e.bias} EV` : ''), ...kv('Flash', e.flash), ...kv('Program', e.program), ...kv('Metering', e.metering),
      ...kv('Artist', e.artist), ...kv('Copyright', e.copyright), ...kv('Software', e.software),
      ...kv('GPS', p.gps ? `${p.gps.lat.toFixed(5)}, ${p.gps.lng.toFixed(5)}` : ''), ...kv('Imported', fmtDate(p.importedAt)),
      ...kv('Status', p.error ? 'Error: ' + p.error : p.missing ? 'File missing' : ''),
    ), el('div', { class: 'btnrow' }, el('button', { class: 'btn small', onclick: () => A.showInExplorer() }, REVEAL_LABEL), p.gps ? el('button', { class: 'btn small', onclick: () => emit('module', 'map') }, 'Show on Map') : null));
  }
}

async function findSimilar() {
  const p = P(S.cur); if (!p) return;
  const r = await AI.findSimilar(p);
  if (!r) return;
  S.source = { type: 'all' }; S.aiRank = r; S.filter.ai = `similar to ${p.name}`;
  refreshList(); renderFilterBar(); setView('grid');
  toast(`${r.size - 1} similar photo(s) found`);
}
// =============== module lifecycle ===============
lib.enter = () => {
  renderLeft(); renderRight(); renderFilterBar(); renderGrid(); showPane();
};
lib.leave = () => { kwBody = mdBody = null; histo = null; };
lib.refreshPanels = () => { if (S.module === 'library') { renderLeft(); updateRight(); } };

on('list', () => { if (S.module !== 'library') return; renderGrid(); if (lib.view === 'loupe') showLoupe(); updateRight(); updateNav(); });
on('current', () => {
  if (S.module !== 'library') return;
  for (const [id, c] of cells) { c.classList.toggle('cur', id === S.cur); c.classList.toggle('sel', S.sel.has(id)); }
  scrollToCurrent(); updateNav(); updateRight();
  if (lib.view === 'loupe') showLoupe();
  if (lib.view === 'compare') { S.compare.candidate = S.cur === S.compare.select ? S.compare.candidate : S.cur; renderCompare(); }
});
on('selection', () => { if (S.module !== 'library') return; for (const [id, c] of cells) { c.classList.toggle('sel', S.sel.has(id)); c.classList.toggle('cur', id === S.cur); } if (lib.view === 'survey') renderSurvey(); updateRight(); });
on('thumb', (id) => { updateCell(id); if (id === S.cur) { updateNav(); if (S.module === 'library' && lib.view === 'grid' && histo) histo.fromPhoto(P(id)); } });
on('meta', (ids) => { for (const id of ids || []) updateCell(id); if (S.module === 'library') { updateRight(); if (lib.view === 'loupe' && ids?.includes(S.cur)) { viewer().show(P(S.cur)); updateLoupeInfo(); } } });
on('ai', (id) => { updateCell(id); if (id === S.cur && S.module === 'library') updateRight(); });
on('collections', () => lib.refreshPanels());
on('keywords', () => lib.refreshPanels());
on('list-changed', () => { if (S.module === 'library') { refreshList(); renderLeft(); renderFilterBar(); showPane(); } });
on('imported', () => { if (S.module === 'library') { S.source = { type: 'recent' }; refreshList(false); renderLeft(); showPane(); } });
