// Import and Export dialogs.
import { C, S, P, save, emit, uid, refreshList } from './store.js';
import { el, modal, browseFolder, toast, activity, prefs, slider, icon } from './ui.js';
import { importFiles, renderFinal, canvasBlob, queueThumb } from './imaging.js';
import { applyPresetTo, addKeywords } from './actions.js';
import { BUILTIN_PRESETS } from './settings.js';
import { api } from './api.js';
import { REVEAL_LABEL } from './platform.js';

// =============== IMPORT ===============
export async function openImport() {
  const recursive = el('input', { type: 'checkbox', checked: prefs.get('importRecursive', true) });
  const kw = el('input', { type: 'text', placeholder: 'e.g. vacation, 2025', style: { width: '260px' } });
  kw.addEventListener('keydown', (e) => e.stopPropagation());
  const presetSel = el('select', {}, el('option', { value: '' }, 'None'), [...BUILTIN_PRESETS, ...C.presets].map((p) => el('option', { value: p.id }, `${p.group} › ${p.name}`)));
  const aiCb = el('input', { type: 'checkbox', checked: prefs.get('importAI', false) });
  const extra = el('div', { style: { marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 18px' } },
    el('label', { class: 'check' }, recursive, 'Include subfolders'),
    el('label', { class: 'check', title: 'Downloads AI models on first use (one-time)' }, aiCb, icon('sparkles', { cls: 'ai-ic' }), 'Auto-tag with AI after import'),
    el('div', { class: 'field' }, el('label', {}, 'Keywords'), kw),
    el('div', { class: 'field' }, el('label', {}, 'Develop preset'), presetSel),
    el('div', { class: 'muted small', style: { gridColumn: '1 / -1' } }, 'Photos are added in place (no copying). Tip: you can also drag & drop files into the window to copy them into the Lightbench Imports folder.'));
  const dir = await browseFolder({ title: 'Import Photos — choose a folder', extra });
  if (!dir) return;
  prefs.set('importRecursive', recursive.checked); prefs.set('importAI', aiCb.checked);
  const act = activity('Scanning ' + dir);
  let files;
  try { files = await api.scan(dir, recursive.checked); } catch (e) { act.done(); toast('Scan failed: ' + e.message, true); return; }
  act.done();
  if (!files.length) { toast('No photos found in that folder', true); return; }
  const fresh = await importFiles(files);
  postImport(fresh, kw.value, presetSel.value, aiCb.checked);
}
async function postImport(fresh, kwText, presetId, ai) {
  if (!fresh.length) return;
  const ids = fresh.map((p) => p.id).filter((id) => P(id) && !P(id).error);
  if (kwText.trim()) addKeywords(kwText.split(','), ids);
  if (presetId) { const pr = [...BUILTIN_PRESETS, ...C.presets].find((p) => p.id === presetId); if (pr) applyPresetTo(ids, pr); }
  if (ai) { const { analyze } = await import('./ai.js'); analyze(ids); }
}

// drag & drop of files (copied to the Imports folder through the server)
export async function importDropped(fileList) {
  const files = [...fileList].filter((f) => /\.(jpe?g|jfif|png|webp|gif|bmp|avif|tiff?|cr2|cr3|crw|nef|nrw|arw|srf|sr2|dng|raf|orf|rw2|pef|srw|x3f|3fr|iiq|rwl|erf|kdc|mrw|mef|mos)$/i.test(f.name));
  if (!files.length) { toast('No supported photo files dropped', true); return; }
  const act = activity(`Copying ${files.length} files`);
  const out = [];
  for (let i = 0; i < files.length; i++) {
    try { out.push(await api.upload(files[i].name, files[i])); } catch (e) { toast(`${files[i].name}: ${e.message}`, true); }
    act.update(`Copying ${i + 1}/${files.length}`, (i + 1) / files.length);
  }
  act.done();
  const fresh = await importFiles(out);
  postImport(fresh, '', '', prefs.get('importAI', false));
}

// =============== EXPORT ===============
const BUILTIN_EXPORT = [
  { id: 'b-full', name: 'Full-Size JPEG', o: { format: 'jpeg', quality: 92, resize: false } },
  { id: 'b-web', name: 'Web (2048 px)', o: { format: 'jpeg', quality: 85, resize: true, mode: 'long', size: 2048, sharpen: 'screen' } },
  { id: 'b-insta', name: 'Instagram (1080 px wide)', o: { format: 'jpeg', quality: 90, resize: true, mode: 'width', size: 1080, sharpen: 'screen' } },
  { id: 'b-4k', name: '4K Wallpaper (3840 px)', o: { format: 'jpeg', quality: 92, resize: true, mode: 'long', size: 3840 } },
  { id: 'b-png', name: 'Full-Size PNG (lossless)', o: { format: 'png', resize: false } },
  { id: 'b-webp', name: 'WebP (2560 px)', o: { format: 'webp', quality: 85, resize: true, mode: 'long', size: 2560 } },
];
const DEFAULT_OPTS = {
  dest: '', sameFolder: false, subfolder: false, subName: 'Lightbench Export', naming: 'filename', custom: 'Photo', start: 1, suffix: '',
  format: 'jpeg', quality: 90, resize: false, mode: 'long', size: 2048, size2: 2048, mp: 12, sharpen: 'none',
  watermark: false, wmText: '© ' + new Date().getFullYear(), wmSize: 3, wmOpacity: 60, wmPos: 'br', wmColor: '#ffffff',
  overwrite: false, reveal: true, download: false,
};

export function openExport(ids) {
  ids = (ids || []).filter((id) => P(id));
  if (!ids.length) { toast('Select photos to export', true); return; }
  const o = { ...DEFAULT_OPTS, ...prefs.get('exportOpts', {}) };
  if (!o.dest) o.dest = (S.info?.pictures || '') + (S.info?.sep || '\\') + 'Lightbench Exports';
  const body = el('div', { class: 'export-grid' });
  const presetList = el('div');
  const form = el('div');
  body.append(el('div', {}, el('div', { class: 'section-label' }, 'Export Presets'), presetList,
    el('button', { class: 'btn small', style: { marginTop: '8px' }, onclick: async () => { const { prompt } = await import('./ui.js'); const n = await prompt('Save Export Preset', 'My Export'); if (n) { C.exportPresets.push({ id: uid(), name: n, o: { ...o } }); save(); drawPresets(); } } }, '+ Save Current as Preset')), form);
  const drawPresets = () => {
    presetList.innerHTML = '';
    for (const p of [...BUILTIN_EXPORT, ...C.exportPresets]) presetList.append(el('div', { class: 'list-item', onclick: () => { Object.assign(o, p.o); drawForm(); } }, p.name,
      C.exportPresets.includes(p) ? el('span', { class: 'x', onclick: (e) => { e.stopPropagation(); C.exportPresets = C.exportPresets.filter((x) => x !== p); save(); drawPresets(); } }, '×') : null));
  };
  const f = (label, input) => el('div', { class: 'field' }, el('label', {}, label), input);
  const txt = (k, attrs = {}) => { const i = el('input', { type: 'text', value: o[k], oninput: () => (o[k] = i.value), ...attrs }); i.addEventListener('keydown', (e) => e.stopPropagation()); return i; };
  const num = (k, attrs = {}) => { const i = el('input', { type: 'number', value: o[k], oninput: () => (o[k] = Number(i.value)), style: { width: '90px' }, ...attrs }); i.addEventListener('keydown', (e) => e.stopPropagation()); return i; };
  const chk = (k, label, redraw) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: o[k], onchange: (e) => { o[k] = e.target.checked; if (redraw) drawForm(); } }), label);
  const sel = (k, opts, redraw) => { const s = el('select', { onchange: () => { o[k] = s.value; if (redraw) drawForm(); } }, opts.map(([v, l]) => el('option', { value: v, selected: o[k] === v }, l))); return s; };
  const drawForm = () => {
    form.innerHTML = '';
    const destIn = txt('dest', { style: { flex: 1 } });
    form.append(
      el('fieldset', {}, el('legend', {}, 'Export Location'),
        chk('download', 'Save through the browser (Downloads folder) instead', true),
        o.download ? null : el('div', {}, chk('sameFolder', 'Put in the same folder as the original photo', true),
          o.sameFolder ? null : el('div', { style: { display: 'flex', gap: '6px', margin: '4px 0' } }, destIn, el('button', { class: 'btn', onclick: async () => { const d = await browseFolder({ title: 'Export To', start: o.dest, showImages: false }); if (d) { o.dest = d; drawForm(); } } }, 'Choose…')),
          el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, chk('subfolder', 'Put in subfolder:', true), o.subfolder ? txt('subName') : null),
          chk('overwrite', 'Overwrite existing files (otherwise a unique name is used)'))),
      el('fieldset', {}, el('legend', {}, 'File Naming'),
        f('Template', sel('naming', [['filename', 'Filename'], ['filename-seq', 'Filename - Sequence'], ['custom-seq', 'Custom Name - Sequence'], ['date-filename', 'Date - Filename'], ['custom', 'Custom Name (x of y)']], true)),
        /custom/.test(o.naming) ? f('Custom Text', txt('custom')) : null,
        /seq|custom/.test(o.naming) ? f('Start Number', num('start')) : null,
        f('Suffix', txt('suffix', { placeholder: 'optional, e.g. -web' })),
        el('div', { class: 'muted small' }, 'Example: ' + fileName(P(ids[0]), 0, ids.length, o))),
      el('fieldset', {}, el('legend', {}, 'File Settings'),
        f('Image Format', sel('format', [['jpeg', 'JPEG'], ['png', 'PNG'], ['webp', 'WebP']], true)),
        o.format !== 'png' ? slider({ label: 'Quality', min: 10, max: 100, value: o.quality, def: 90, onInput: (v) => (o.quality = v) }).el : null),
      el('fieldset', {}, el('legend', {}, 'Image Sizing'),
        chk('resize', 'Resize to Fit', true),
        o.resize ? el('div', {}, f('Mode', sel('mode', [['long', 'Long Edge'], ['short', 'Short Edge'], ['width', 'Width'], ['height', 'Height'], ['wh', 'Width & Height'], ['mp', 'Megapixels']], true)),
          o.mode === 'mp' ? f('Megapixels', num('mp')) : f(o.mode === 'wh' ? 'W × H (px)' : 'Pixels', el('div', { style: { display: 'flex', gap: '6px' } }, num('size'), o.mode === 'wh' ? num('size2') : null))) : null,
        el('div', { class: 'muted small' }, 'Photos are never enlarged.')),
      el('fieldset', {}, el('legend', {}, 'Output Sharpening'), f('Sharpen For', sel('sharpen', [['none', 'None'], ['screen', 'Screen (Standard)'], ['screen-high', 'Screen (High)'], ['print', 'Matte / Glossy Print']]))),
      el('fieldset', {}, el('legend', {}, 'Watermarking'), chk('watermark', 'Add text watermark', true),
        o.watermark ? el('div', {}, f('Text', txt('wmText')), f('Position', sel('wmPos', [['br', 'Bottom Right'], ['bl', 'Bottom Left'], ['bc', 'Bottom Center'], ['tr', 'Top Right'], ['tl', 'Top Left'], ['c', 'Center']])),
          slider({ label: 'Size %', min: 1, max: 15, step: 0.5, value: o.wmSize, def: 3, onInput: (v) => (o.wmSize = v) }).el,
          slider({ label: 'Opacity', min: 5, max: 100, value: o.wmOpacity, def: 60, onInput: (v) => (o.wmOpacity = v) }).el,
          f('Color', el('input', { type: 'color', value: o.wmColor, oninput: (e) => (o.wmColor = e.target.value) }))) : null),
      el('fieldset', {}, el('legend', {}, 'Post-Processing'), chk('reveal', REVEAL_LABEL + ' when done')),
    );
  };
  drawPresets(); drawForm();
  modal(`Export ${ids.length} Photo${ids.length > 1 ? 's' : ''}`, body, {
    buttons: [{ label: 'Cancel' }, { label: 'Export', cls: 'primary', onClick: () => { prefs.set('exportOpts', o); runExport(ids, { ...o }); } }],
  });
}

function fileName(p, i, n, o) {
  const base = p.name.replace(/\.[^.]+$/, '') + (p.copyName ? '-' + p.copyName.replace(/\s+/g, '') : '');
  const seq = String(o.start + i).padStart(String(o.start + n).length, '0');
  const d = new Date(p.captureTime || p.mtime || Date.now());
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const stem = { filename: base, 'filename-seq': `${base}-${seq}`, 'custom-seq': `${o.custom}-${seq}`, 'date-filename': `${date}-${base}`, custom: `${o.custom} (${i + 1} of ${n})` }[o.naming] || base;
  const ext = { jpeg: 'jpg', png: 'png', webp: 'webp' }[o.format];
  return (stem + (o.suffix || '')).replace(/[\\/:*?"<>|]/g, '_') + '.' + ext;
}

function watermark(canvas, o) {
  const c = canvas instanceof HTMLCanvasElement && canvas.getContext('2d') ? canvas : (() => { const t = document.createElement('canvas'); t.width = canvas.width; t.height = canvas.height; t.getContext('2d').drawImage(canvas, 0, 0); return t; })();
  const x = c.getContext('2d');
  const size = Math.max(10, (Math.min(c.width, c.height) * o.wmSize) / 100);
  x.font = `600 ${size}px "Segoe UI", sans-serif`;
  x.globalAlpha = o.wmOpacity / 100; x.fillStyle = o.wmColor;
  x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = size * 0.15;
  const m = x.measureText(o.wmText), pad = size * 0.8;
  const pos = { br: [c.width - m.width - pad, c.height - pad], bl: [pad, c.height - pad], bc: [(c.width - m.width) / 2, c.height - pad], tr: [c.width - m.width - pad, pad + size], tl: [pad, pad + size], c: [(c.width - m.width) / 2, c.height / 2] }[o.wmPos];
  x.fillText(o.wmText, pos[0], pos[1]);
  x.globalAlpha = 1;
  return c;
}

export async function runExport(ids, o) {
  const sep = S.info.sep;
  const act = activity(`Exporting ${ids.length} photo(s)`);
  let last = null, ok = 0, fails = 0;
  const sizing = !o.resize ? {} : o.mode === 'long' ? { longEdge: o.size } : o.mode === 'short' ? { shortEdge: o.size } : o.mode === 'width' ? { maxW: o.size } : o.mode === 'height' ? { maxH: o.size } : o.mode === 'wh' ? { maxW: o.size, maxH: o.size2 } : { megapixels: o.mp };
  const boost = { none: 0, screen: 15, 'screen-high': 30, print: 25 }[o.sharpen] || 0;
  for (let i = 0; i < ids.length; i++) {
    const p = P(ids[i]);
    act.update(`Exporting ${i + 1}/${ids.length}: ${p.name}`, i / ids.length);
    try {
      let c = await renderFinal(p, { ...sizing, sharpenBoost: boost });
      if (o.watermark && o.wmText) c = watermark(c, o);
      else if (!(c instanceof HTMLCanvasElement) || c.getContext('2d') == null) { /* webgl canvas is fine for toBlob */ }
      const type = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[o.format];
      const blob = await canvasBlob(c, type, (o.quality || 90) / 100);
      const name = fileName(p, i, ids.length, o);
      if (o.download) {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } else {
        let dir = o.sameFolder ? p.folder : o.dest;
        if (o.subfolder && o.subName) dir += sep + o.subName;
        const r = await api.write(dir + sep + name, blob, o.overwrite);
        last = r.path;
      }
      ok++;
    } catch (e) { console.error(e); fails++; toast(`Export failed for ${p.name}: ${e.message}`, true, 5000); }
  }
  act.done(`Exported ${ok} photo(s)${fails ? `, ${fails} failed` : ''}`);
  if (o.reveal && last) api.reveal(last);
}
