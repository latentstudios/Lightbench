// Print module: single image or contact sheet layouts, printed through the system print dialog.
import { S, P, emit, targets } from './store.js';
import { el, $, panel, slider, prefs, toast, activity, icon } from './ui.js';
import { renderFinal, canvasBlob } from './imaging.js';

const mod = {};
export default mod;
const o = Object.assign({ paper: 'letter', landscape: false, rows: 1, cols: 1, margin: 0.5, gap: 0.2, fit: 'fit', caption: false, selectedOnly: true, page: 0 }, prefs.get('print', {}));
const PAPERS = { letter: [8.5, 11, 'Letter'], legal: [8.5, 14, 'Legal'], a4: [8.27, 11.69, 'A4'], a3: [11.69, 16.54, 'A3'], '4x6': [4, 6, '4 × 6 in'], '5x7': [5, 7, '5 × 7 in'], '8x10': [8, 10, '8 × 10 in'], tabloid: [11, 17, 'Tabloid'] };
const urls = new Map();
async function url(id) {
  if (!urls.has(id)) urls.set(id, (async () => URL.createObjectURL(await canvasBlob(await renderFinal(P(id), { useOriginal: o.rows * o.cols === 1, longEdge: o.rows * o.cols === 1 ? 4800 : 1800 }), 'image/jpeg', 0.95)))());
  return urls.get(id);
}
const ids = () => (o.selectedOnly && targets().length ? targets() : S.list);

async function layout() {
  const page = $('#print-page'); page.innerHTML = '';
  const [w0, h0] = PAPERS[o.paper];
  const [w, h] = o.landscape ? [h0, w0] : [w0, h0];
  const view = $('#print');
  const scale = Math.min((view.clientWidth - 48) / w, (view.clientHeight - 48) / h);
  page.style.width = w * scale + 'px'; page.style.height = h * scale + 'px';
  page.style.padding = o.margin * scale + 'px';
  page.style.gridTemplateColumns = `repeat(${o.cols}, 1fr)`; page.style.gridTemplateRows = `repeat(${o.rows}, 1fr)`;
  page.style.gap = o.gap * scale + 'px';
  page.dataset.scale = scale;
  const per = o.rows * o.cols, list = ids(), pages = Math.max(1, Math.ceil(list.length / per));
  o.page = Math.min(o.page, pages - 1);
  const slice = list.slice(o.page * per, o.page * per + per);
  for (const id of slice) {
    const img = el('img', { style: { objectFit: o.fit === 'fill' ? 'cover' : 'contain', width: o.fit === 'fill' ? '100%' : '', height: o.fit === 'fill' ? '100%' : '' } });
    const cell = el('div', { class: 'pcell' }, img, o.caption ? el('div', { class: 'pcap' }, P(id).name) : null);
    page.append(cell);
    url(id).then((u) => (img.src = u));
  }
  if (pageInfo) pageInfo.textContent = `Page ${o.page + 1} of ${pages} · ${list.length} photo(s)`;
  // real page size for printing
  let st = document.getElementById('print-page-style');
  if (!st) { st = document.createElement('style'); st.id = 'print-page-style'; document.head.append(st); }
  st.textContent = `@media print { @page { size: ${w}in ${h}in; margin: 0; } #print-page { width: ${w}in !important; height: ${h}in !important; padding: ${o.margin}in !important; gap: ${o.gap}in !important; } }`;
}
let pageInfo = null;
async function doPrint() {
  const per = o.rows * o.cols, list = ids();
  const act = activity('Preparing print…');
  await Promise.all(list.slice(o.page * per, o.page * per + per).map(url));
  await layout();
  await new Promise((r) => setTimeout(r, 300));
  act.done();
  window.print();
}
mod.enter = () => {
  for (const p of ['grid', 'loupe', 'compare', 'survey', 'empty', 'map', 'slideshow']) $('#' + p).classList.add('hidden');
  $('#print').classList.remove('hidden'); $('#filterbar').classList.add('hidden');
  const save = () => { prefs.set('print', o); layout(); };
  $('#left-panels').innerHTML = '';
  const tp = panel('Layout Templates', { id: 'pr-tpl' });
  for (const [n, r, c] of [['Single Image', 1, 1], ['2 × 1', 2, 1], ['2 × 2', 2, 2], ['3 × 3 Contact Sheet', 3, 3], ['4 × 5 Contact Sheet', 5, 4], ['5 × 8 Contact Sheet', 8, 5]]) tp.body.append(el('div', { class: 'list-item', onclick: () => { o.rows = r; o.cols = c; o.caption = r * c > 4; o.page = 0; save(); mod.enter(); } }, n));
  $('#left-panels').append(tp.el);
  const rp = panel('Page Setup', { id: 'pr-setup' });
  const paper = el('select', { onchange: () => { o.paper = paper.value; save(); } }, Object.entries(PAPERS).map(([k, v]) => el('option', { value: k, selected: o.paper === k }, v[2])));
  rp.body.append(el('div', { class: 'field' }, el('label', {}, 'Paper'), paper),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: o.landscape, onchange: (e) => { o.landscape = e.target.checked; save(); } }), 'Landscape'),
    slider({ label: 'Rows', min: 1, max: 10, value: o.rows, def: 1, onInput: (v) => { o.rows = v; save(); } }).el,
    slider({ label: 'Columns', min: 1, max: 10, value: o.cols, def: 1, onInput: (v) => { o.cols = v; save(); } }).el,
    slider({ label: 'Margin (in)', min: 0, max: 2, step: 0.05, value: o.margin, def: 0.5, onInput: (v) => { o.margin = v; save(); } }).el,
    slider({ label: 'Spacing (in)', min: 0, max: 1, step: 0.05, value: o.gap, def: 0.2, onInput: (v) => { o.gap = v; save(); } }).el,
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: o.fit === 'fill', onchange: (e) => { o.fit = e.target.checked ? 'fill' : 'fit'; save(); } }), 'Zoom to fill cell'),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: o.caption, onchange: (e) => { o.caption = e.target.checked; save(); } }), 'Show file names'),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: o.selectedOnly, onchange: (e) => { o.selectedOnly = e.target.checked; o.page = 0; save(); } }), 'Selected photos only'),
    el('div', { class: 'btnrow grow' }, el('button', { class: 'btn primary', onclick: doPrint }, icon('printer'), 'Print…')),
    el('div', { class: 'muted small' }, 'Tip: choose “Save as PDF” in the print dialog to make a PDF.'));
  $('#right-panels').innerHTML = ''; $('#right-panels').append(rp.el);
  pageInfo = el('span', { class: 'muted' });
  $('#toolbar').innerHTML = '';
  $('#toolbar').append(el('button', { class: 'btn small', onclick: () => emit('module', 'library') }, icon('grid'), 'Library'),
    el('button', { class: 'btn small icon-only', title: 'Previous page', onclick: () => { o.page = Math.max(0, o.page - 1); layout(); } }, icon('chevron-left')), pageInfo,
    el('button', { class: 'btn small icon-only', title: 'Next page', onclick: () => { o.page++; layout(); } }, icon('chevron-right')), el('span', { style: { flex: 1 } }), el('button', { class: 'btn small primary', onclick: doPrint }, icon('printer'), 'Print…'));
  layout();
};
mod.leave = () => { $('#print').classList.add('hidden'); for (const u of urls.values()) u.then((x) => URL.revokeObjectURL(x)); urls.clear(); };
mod.onCurrent = () => layout();
mod.onSelection = () => { if (o.selectedOnly) layout(); };
