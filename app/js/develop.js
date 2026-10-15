// Develop module: all adjustment panels, tools (crop, heal, masking), presets, snapshots, history.
import { C, S, P, on, emit, save, uid, getSettings, setEdits, step, targets } from './store.js';
import { el, $, panel, slider, seg, sectionLabel, toast, contextMenu, prompt, confirmBox, prefs, modal, debounce } from './ui.js';
import { defaultSettings, defaultsFor, defaultMaskAdj, clone, normalize, applyPreset, pick, SETTING_GROUPS, BUILTIN_PRESETS, HSL_BANDS, BAND_COLORS, ASPECTS, autoTone } from './settings.js';
import { viewer } from './viewer.js';
import { histogramWidget } from './histogram.js';
import { curveEditor, colorWheel } from './widgets.js';
import { cropTool, spotTool, brushTool, linearTool, radialTool, pointSelectTool, pickTool, targetedTool, fitCrop, constrainAspect, aspectValue, autoStraightenAngle, rawData, sampleRaw } from './tools.js';
import { queueThumb, thumbUrl, canvasBlob } from './imaging.js';
import { syncMaskLayers, putBase } from './maskraster.js';
import { rasterKinds } from './engine.js';
import * as A from './actions.js';
import * as AI from './ai.js';
import { api, verifySession } from './api.js';
import { openExport } from './dialogs.js';
import { openDenoise } from './denoise-ui.js';
import { icon } from './icons.js';

const dev = {};
export default dev;

const D = {
  p: null, s: null, controls: [], refreshers: [], toolName: null, tool: null, activeMask: null, maskEdit: null, maskOverlay: prefs.get('maskOverlay2', false),
  presetAmount: 1,
  get viewer() { return viewer(); },
};
dev.D = D;

// ---------- path helpers & bound controls ----------
const getPath = (o, p) => (Array.isArray(p) ? p.reduce((a, k) => a?.[k], o) : o[p]);
const setPath = (o, p, v) => { if (!Array.isArray(p)) { o[p] = v; return; } let x = o; for (let i = 0; i < p.length - 1; i++) x = x[p[i]]; x[p.at(-1)] = v; };
D.update = () => { if (D.p) viewer().setSettings(D.s); };
D.updateMasks = () => { if (D.p) viewer().setSettings(D.s, { masks: true }); };
D.commit = (name) => {
  const p = D.p; if (!p) return;
  if (p.histPos > 0) { p.history.splice(0, p.histPos); p.histPos = 0; }
  setEdits(p, D.s, name);
  queueThumb(p.id);
  renderHistory();
};
D.refreshControls = () => {
  if (!D.s) return;
  for (const { path, ctl, obj } of D.controls) { const v = obj ? obj()?.[path] : getPath(D.s, path); if (v != null) ctl.set(v); }
  for (const f of D.refreshers) f();
};
D.refreshTool = () => renderToolPanel();
D.finishTool = () => setTool(null);

function S_(path, label, opts = {}) {
  const def = getPath(defaultSettings(), path);
  const ctl = slider({
    label, value: D.s ? getPath(D.s, path) : def, def, min: opts.min ?? -100, max: opts.max ?? 100, step: opts.step ?? 1, cls: opts.cls, fmt: opts.fmt,
    onInput: (v) => { if (!D.s) return; setPath(D.s, path, v); opts.after && opts.after(v); D.update(); },
    onCommit: () => D.commit(opts.hist || label),
  });
  D.controls.push({ path, ctl });
  return ctl.el;
}
// slider bound to a property of a dynamic object (e.g. active mask adjustments)
function O_(objFn, key, label, opts = {}) {
  const o = objFn();
  const ctl = slider({
    label, value: o?.[key] ?? opts.def ?? 0, def: opts.def ?? 0, min: opts.min ?? -100, max: opts.max ?? 100, step: opts.step ?? 1, cls: opts.cls, fmt: opts.fmt,
    onInput: (v) => { const t = objFn(); if (!t) return; t[key] = v; opts.after && opts.after(v); opts.masks ? D.updateMasks() : D.update(); },
    onCommit: () => D.commit(opts.hist || label),
  });
  return ctl.el;
}

// =============== LOAD PHOTO ===============
async function load(id) {
  const p = P(id); if (!p) { D.p = null; viewer().clear(); return; }
  if (D.p && D.p.id !== id) setTool(null, true);
  D.p = p; D.s = getSettings(p);
  if (!p.history?.length) { p.history = [{ name: p.edits ? 'Current Settings' : 'Import', t: Date.now(), s: clone(D.s) }]; p.histPos = 0; }
  D.activeMask = null; D.maskEdit = null;
  D.refreshControls();
  renderHistory(); renderSnapshots(); renderToolPanel(); updateNav(); renderDenoiseBox();
  await viewer().show(p, D.s);
}
dev.load = load;

// =============== TOOLS ===============
function toggleTool(name) { setTool(D.toolName === name ? null : name); }
function setTool(name, silent) {
  const v = viewer();
  if (D.tool?.isObjectSelect && !D.tool.saved) D.tool.save();
  D.toolName = name;
  let t = null;
  if (name === 'crop') t = cropTool(D);
  else if (name === 'spot') t = spotTool(D);
  else if (name === 'mask') { t = maskToolFor(activeMask()); AI.prewarm(); }
  else if (name === 'wb') t = pickTool(wbPick);
  D.tool = t;
  v.setTool(t);
  v.showMask = name === 'mask' && D.maskOverlay && D.activeMask ? D.activeMask : null;
  v.maskColor = prefs.get('maskColor', [1, 0.15, 0.15]);
  for (const b of document.querySelectorAll('.toolstrip button')) b.classList.toggle('on', b.dataset.tool === name);
  if (!silent) renderToolPanel();
  v.requestRender();
}
dev.setTool = setTool;

async function wbPick(e, v) {
  const [rx, ry] = v.clientToRaw(e.clientX, e.clientY);
  const d = await rawData(D.p);
  const c = sampleRaw(d, rx, ry, 3).map((x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  const [r, g, b] = c;
  let t = (b - r) / (0.3 * (r + b) + 1e-6); t = Math.max(-1, Math.min(1, t));
  const r2 = r * (1 + 0.3 * t), b2 = b * (1 - 0.3 * t);
  let ti = (1 - (r2 + b2) / 2 / Math.max(1e-6, g)) / 0.25; ti = Math.max(-1, Math.min(1, ti));
  D.s.temp = Math.round(t * 100); D.s.tint = Math.round(ti * 100);
  D.update(); D.refreshControls(); D.commit('White Balance (picker)');
  if (!prefs.get('wbStay', false)) setTool(null);
}

const activeMask = () => D.s?.masks.find((m) => m.id === D.activeMask) || null;
// What clicking on the photo does for the active mask. Nothing edits a mask unless a mode is armed:
//   'brush-add' / 'brush-erase' : paint   ·   'pick' : one-shot color/brightness sample   ·   'redraw' : draw a new gradient
// With no mode armed, clicks fall through to normal zoom / pan (only gradient handles stay draggable).
function defaultMaskEdit(m) {
  if (!m) return null;
  if (m.kind === 'brush') return 'brush-add';
  if ((m.kind === 'color' || m.kind === 'luminance') && !m.picked) return 'pick';
  return null;
}
function selectMask(id) {
  D.activeMask = id; D.maskEdit = defaultMaskEdit(activeMask());
  setTool('mask');
  flashOverlay();
}
function setMaskEdit(mode) { D.maskEdit = mode; setTool('mask'); }
function flashOverlay() {
  if (D.maskOverlay || !D.activeMask) return;
  const v = viewer(), id = D.activeMask;
  v.showMask = id; v.requestRender();
  clearTimeout(flashOverlay.t);
  flashOverlay.t = setTimeout(() => { if (!D.maskOverlay && v.showMask === id) { v.showMask = null; v.requestRender(); } }, 1200);
}
function maskToolFor(m) {
  if (!m) return null;
  const edit = D.maskEdit;
  if (m.kind === 'linear') { const t = linearTool(D, m); t.redraw = edit === 'redraw' || !m.linear; t.onDrawn = () => { D.maskEdit = null; renderToolPanel(); }; return t; }
  if (m.kind === 'radial') { const t = radialTool(D, m); t.redraw = edit === 'redraw' || !m.radial; t.onDrawn = () => { D.maskEdit = null; renderToolPanel(); }; return t; }
  const once = (fn) => pickTool(async (e, v) => { await fn(e, v); m.picked = true; D.update(); D.maskEdit = null; setTool('mask'); flashOverlay(); });
  if (m.kind === 'color' && edit === 'pick') return once(async (e, v) => { const [rx, ry] = v.clientToRaw(e.clientX, e.clientY); const d = await rawData(D.p); const [r, g, b] = sampleRaw(d, rx, ry, 2); m.color = { ...m.color, r, g, b }; D.commit('Color Range'); });
  if (m.kind === 'luminance' && edit === 'pick') return once(async (e, v) => { const [rx, ry] = v.clientToRaw(e.clientX, e.clientY); const d = await rawData(D.p); const [r, g, b] = sampleRaw(d, rx, ry, 2); const L = 0.2126 * r + 0.7152 * g + 0.0722 * b; m.range = { ...m.range, lo: Math.max(0, L - 0.1), hi: Math.min(1, L + 0.1) }; D.commit('Luminance Range'); });
  if (m.kind === 'object' && !m.raster && !m.strokes.length) return objectSelect(m);
  if (rasterKinds.has(m.kind) && (edit === 'brush-add' || edit === 'brush-erase')) { const t = brushTool(D, m); t.erase = edit === 'brush-erase'; return t; }
  return null;
}
function objectSelect(m) {
  let busy = false, queued = null, n = 0, pending = null;
  AI.warmSAM(D.p).catch(() => {});
  const run = async (points) => {
    if (busy) { queued = points; return; }
    busy = true; status('Selecting object…');
    try {
      const en = viewer().engine;
      const cv = await AI.aiMask(D.p, 'point', { w: en.maskW, h: en.maskH, points });
      const key = `m-${D.p.id}-${m.id}-${++n}.png`;
      putBase(key, cv);
      m.raster = key; pending = { key, cv };
      await syncMaskLayers(en, D.s);
      viewer().showMask = m.id; viewer().requestRender();
      status('Click to add more of the object, Alt+click to subtract. Press Done when finished.');
    } catch (e) { status('Selection failed: ' + e.message); }
    busy = false;
    if (queued) { const q = queued; queued = null; run(q); }
  };
  const t = pointSelectTool(D, (pts) => run([...pts]));
  t.save = async () => {
    t.saved = true;
    if (!pending) return;
    const { key, cv } = pending; pending = null;
    await api.cachePut(key, await canvasBlob(cv, 'image/png'));
    D.commit('Select Object');
  };
  t.finish = async () => { await t.save(); setTool('mask'); };
  t.isObjectSelect = true;
  return t;
}
let statusEl = null;
const status = (msg) => { if (statusEl) statusEl.textContent = msg; };

// =============== MASK CREATION ===============
async function newMask(kind, opts = {}) {
  if (!D.p) return;
  if (D.s.masks.length >= 8) { toast('Maximum of 8 masks per photo', true); return; }
  const names = { brush: 'Brush', linear: 'Linear Gradient', radial: 'Radial Gradient', subject: 'Subject', sky: 'Sky', object: 'Object', semantic: 'Landscape', color: 'Color Range', luminance: 'Luminance Range' };
  const m = { id: uid(), name: opts.name || names[kind] || kind, kind, invert: !!opts.invert, amount: 100, strokes: [], adj: defaultMaskAdj(), ...opts.extra };
  if (kind === 'color') m.color = { r: 0.5, g: 0.6, b: 0.8, tol: 0.25 };
  if (kind === 'luminance') m.range = { lo: 0.6, hi: 1, smooth: 0.1 };
  if (kind === 'radial') m.radial = null;
  const en = viewer().engine;
  if (opts.ai || opts.canvas) {
    const act = el('span', {}, el('span', { class: 'spinner' }), ' AI is finding ' + m.name.toLowerCase() + '…');
    if (statusEl) { statusEl.innerHTML = ''; statusEl.append(act); }
    try {
      const cv = opts.canvas || (await AI.aiMask(D.p, opts.ai, { w: en.maskW, h: en.maskH, labels: opts.labels }));
      const key = `m-${D.p.id}-${m.id}.png`;
      putBase(key, cv);
      await api.cachePut(key, await canvasBlob(cv, 'image/png'));
      m.raster = key;
    } catch (e) { if (await verifySession()) toast(e.message, true, 5000); status(''); return; }
    status('');
  }
  D.s.masks.push(m);
  await syncMaskLayers(en, D.s);
  if (!['object'].includes(kind) || m.raster) D.commit('New Mask: ' + m.name);
  selectMask(m.id);
}

// =============== RIGHT PANELS ===============
let histo = null, curveEd = null, toolBox = null;
function renderRight() {
  D.controls = []; D.refreshers = [];
  const root = $('#right-panels'); root.innerHTML = '';
  const hp = panel('Histogram', { id: 'dev-histo' });
  histo = histogramWidget({ onClipToggle: toggleClipping });
  hp.body.append(histo.el); root.append(hp.el);

  const strip = el('div', { class: 'toolstrip' },
    [['crop', 'crop', 'Crop & Straighten (R)'], ['spot', 'heal', 'Spot Removal / Heal (Q)'], ['mask', 'mask', 'Masking — AI Subject, Sky, Objects, Brush, Gradients (M)'], ['wb', 'eyedropper', 'White Balance Picker (W)']]
      .map(([k, ic, t]) => el('button', { 'data-tool': k, title: t, onclick: () => toggleTool(k) }, icon(ic, { cls: 'xl' }))));
  toolBox = el('div');
  root.append(strip, toolBox);

  // ---- Basic ----
  const basic = panel('Basic', { id: 'dev-basic' });
  const treat = seg([['color', 'Color'], ['bw', 'Black & White']], D.s?.profile || 'color', (v) => { D.s.profile = v; D.update(); D.commit('Treatment: ' + (v === 'bw' ? 'B&W' : 'Color')); renderHSLBody(); });
  D.refreshers.push(() => treat.setValue(D.s.profile));
  const wbSel = el('select', { onchange: async () => { if (wbSel.value === 'auto') { const a = await A.measureAuto(D.p); D.s.temp = a._wb.temp; D.s.tint = a._wb.tint; } else if (wbSel.value === 'shot') { D.s.temp = 0; D.s.tint = 0; } else { const pr = { daylight: [5, 0], cloudy: [15, 3], shade: [25, 5], tungsten: [-45, 5], fluorescent: [-25, 25], flash: [10, 0] }[wbSel.value]; if (pr) [D.s.temp, D.s.tint] = pr; } D.update(); D.refreshControls(); D.commit('White Balance: ' + wbSel.selectedOptions[0].text); wbSel.value = 'custom'; } },
    [['custom', 'Custom'], ['shot', 'As Shot'], ['auto', 'Auto'], ['daylight', 'Daylight'], ['cloudy', 'Cloudy'], ['shade', 'Shade'], ['tungsten', 'Tungsten'], ['fluorescent', 'Fluorescent'], ['flash', 'Flash']].map(([v, l]) => el('option', { value: v }, l)));
  basic.body.append(
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 8px' } }, el('span', { class: 'muted' }, 'Treatment'), treat),
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, el('span', { class: 'muted' }, 'WB'), wbSel, el('button', { class: 'btn small icon-only', title: 'White balance picker (W)', onclick: () => setTool('wb') }, icon('eyedropper'))),
    S_('temp', 'Temp', { cls: 'temp' }), S_('tint', 'Tint', { cls: 'tint' }),
    el('div', { class: 'section-label' }, 'Tone', el('button', { class: 'btn small', style: { marginLeft: 'auto' }, onclick: autoToneClick, title: 'Auto Tone (Ctrl+U)' }, 'Auto')),
    S_('exposure', 'Exposure', { min: -5, max: 5, step: 0.01, fmt: (v) => (v > 0 ? '+' : '') + Number(v).toFixed(2) }),
    S_('contrast', 'Contrast'), S_('highlights', 'Highlights'), S_('shadows', 'Shadows'), S_('whites', 'Whites'), S_('blacks', 'Blacks'),
    sectionLabel('Presence'), S_('texture', 'Texture'), S_('clarity', 'Clarity'), S_('dehaze', 'Dehaze'), S_('vibrance', 'Vibrance'), S_('saturation', 'Saturation'));
  root.append(basic.el);

  // ---- Tone curve ----
  const tc = panel('Tone Curve', { id: 'dev-curve' });
  curveEd = curveEditor({ get: () => D.s.curve, onChange: (ch, pts) => { D.s.curve[ch] = pts; D.update(); }, onCommit: () => D.commit('Tone Curve') });
  D.refreshers.push(() => curveEd.draw());
  const presetCurve = el('select', { onchange: () => { const v = presetCurve.value; const c = { linear: [[0, 0], [1, 1]], medium: [[0, 0], [0.25, 0.21], [0.75, 0.8], [1, 1]], strong: [[0, 0], [0.25, 0.17], [0.75, 0.84], [1, 1]], matte: [[0, 0.1], [0.3, 0.3], [1, 1]], fade: [[0, 0.08], [0.5, 0.5], [1, 0.92]] }[v]; if (c) { D.s.curve.rgb = c; D.update(); curveEd.draw(); D.commit('Point Curve: ' + v); } presetCurve.value = ''; } },
    el('option', { value: '' }, 'Point Curve preset…'), ['linear', 'medium', 'strong', 'matte', 'fade'].map((v) => el('option', { value: v }, v[0].toUpperCase() + v.slice(1) + ' Contrast'.replace(/ Contrast/, ['linear', 'medium', 'strong'].includes(v) ? ' Contrast' : ''))));
  tc.body.append(curveEd.el, el('div', { class: 'btnrow' }, presetCurve, el('button', { class: 'btn small', onclick: () => { D.s.curve = defaultSettings().curve; D.update(); D.refreshControls(); D.commit('Reset Curve'); } }, 'Reset')),
    sectionLabel('Parametric Regions'), S_(['curve', 'pHighlights'], 'Highlights'), S_(['curve', 'pLights'], 'Lights'), S_(['curve', 'pDarks'], 'Darks'), S_(['curve', 'pShadows'], 'Shadows'),
    S_(['curve', 'split', 0], 'Split 1', { min: 0.1, max: 0.4, step: 0.01 }), S_(['curve', 'split', 1], 'Split 2', { min: 0.4, max: 0.6, step: 0.01 }), S_(['curve', 'split', 2], 'Split 3', { min: 0.6, max: 0.9, step: 0.01 }));
  root.append(tc.el);

  // ---- HSL / Color / B&W ----
  const hsl = panel('HSL / Color / B&W', { id: 'dev-hsl' });
  hslBody = hsl.body; renderHSLBody();
  root.append(hsl.el);

  // ---- Color grading ----
  const cg = panel('Color Grading', { id: 'dev-grade', collapsed: true });
  const wheel = (key, label) => {
    const w = colorWheel({ label, get: () => D.s.grading[key], onChange: (v) => { D.s.grading[key].h = v.h; D.s.grading[key].s = v.s; D.update(); }, onCommit: () => D.commit('Color Grading ' + label),
      lum: el('div', { style: { width: '100%' } }, S_(['grading', key, 'l'], 'Lum', { hist: 'Color Grading ' + label })) });
    D.refreshers.push(w.place);
    return w.el;
  };
  cg.body.append(el('div', { class: 'wheels' }, wheel('shadows', 'Shadows'), wheel('midtones', 'Midtones'), wheel('highlights', 'Highlights')),
    el('div', { class: 'wheels single', style: { marginTop: '8px' } }, wheel('global', 'Global')),
    S_(['grading', 'blending'], 'Blending', { min: 0, max: 100 }), S_(['grading', 'balance'], 'Balance'));
  root.append(cg.el);

  // ---- Detail ----
  const dt = panel('Detail', { id: 'dev-detail', collapsed: true });
  dt.body.append(sectionLabel('Sharpening'), S_(['sharpen', 'amount'], 'Amount', { min: 0, max: 150 }), S_(['sharpen', 'radius'], 'Radius', { min: 0.5, max: 3, step: 0.1 }), S_(['sharpen', 'detail'], 'Detail', { min: 0, max: 100 }), S_(['sharpen', 'masking'], 'Masking', { min: 0, max: 100 }),
    sectionLabel('Noise Reduction'), S_(['nr', 'lum'], 'Luminance', { min: 0, max: 100 }), S_(['nr', 'detail'], 'Detail', { min: 0, max: 100 }), S_(['nr', 'color'], 'Color', { min: 0, max: 100 }),
    el('div', { class: 'muted small' }, 'Tip: zoom to 1:1 (click the image) to judge sharpening and noise.'),
    sectionLabel('AI Denoise'), dnBox = el('div'));
  root.append(dt.el);
  renderDenoiseBox();

  // ---- Lens ----
  const ln = panel('Lens Corrections', { id: 'dev-lens', collapsed: true });
  ln.body.append(S_(['lens', 'ca'], 'Chromatic Ab.', { hist: 'Chromatic Aberration' }), S_(['lens', 'distortion'], 'Distortion'), S_(['lens', 'vignette'], 'Vignetting', { hist: 'Lens Vignetting' }));
  root.append(ln.el);

  // ---- Transform ----
  const tr = panel('Transform', { id: 'dev-transform', collapsed: true });
  tr.body.append(el('div', { class: 'btnrow grow' },
    el('button', { class: 'btn small', onclick: () => autoStraighten('Upright: Level') }, 'Level (Auto)'),
    el('button', { class: 'btn small', onclick: () => { D.s.transform = defaultSettings().transform; D.update(); D.refreshControls(); D.commit('Reset Transform'); } }, 'Off')),
    S_(['transform', 'vertical'], 'Vertical'), S_(['transform', 'horizontal'], 'Horizontal'), S_(['transform', 'rotate'], 'Rotate', { min: -10, max: 10, step: 0.1 }),
    S_(['transform', 'aspect'], 'Aspect'), S_(['transform', 'scale'], 'Scale', { min: 50, max: 150 }), S_(['transform', 'x'], 'Offset X'), S_(['transform', 'y'], 'Offset Y'));
  root.append(tr.el);

  // ---- Effects ----
  const fx = panel('Effects', { id: 'dev-effects', collapsed: true });
  fx.body.append(sectionLabel('Post-Crop Vignetting'), S_(['vignette', 'amount'], 'Amount'), S_(['vignette', 'midpoint'], 'Midpoint', { min: 0, max: 100 }), S_(['vignette', 'roundness'], 'Roundness'), S_(['vignette', 'feather'], 'Feather', { min: 0, max: 100 }), S_(['vignette', 'highlights'], 'Highlights', { min: 0, max: 100 }),
    sectionLabel('Grain'), S_(['grain', 'amount'], 'Amount', { min: 0, max: 100 }), S_(['grain', 'size'], 'Size', { min: 0, max: 100 }), S_(['grain', 'roughness'], 'Roughness', { min: 0, max: 100 }));
  root.append(fx.el);

  // ---- Calibration ----
  const cal = panel('Calibration', { id: 'dev-calib', collapsed: true });
  cal.body.append(sectionLabel('Shadows'), S_(['calib', 'shadowTint'], 'Tint', { cls: 'tint' }),
    sectionLabel('Red Primary'), S_(['calib', 'redHue'], 'Hue', { cls: 'hue-red' }), S_(['calib', 'redSat'], 'Saturation'),
    sectionLabel('Green Primary'), S_(['calib', 'greenHue'], 'Hue', { cls: 'hue-green' }), S_(['calib', 'greenSat'], 'Saturation'),
    sectionLabel('Blue Primary'), S_(['calib', 'blueHue'], 'Hue', { cls: 'hue-blue' }), S_(['calib', 'blueSat'], 'Saturation'));
  root.append(cal.el);

  root.append(el('div', { class: 'btnrow grow', style: { padding: '10px 12px' } },
    el('button', { class: 'btn', title: 'Apply settings of the previous photo', onclick: () => { A.pastePrevious(); load(S.cur); } }, 'Previous'),
    el('button', { class: 'btn', onclick: () => { D.s = defaultsFor(D.p); D.updateMasks(); D.refreshControls(); D.commit('Reset'); } }, 'Reset')));
}

// ---------- AI Denoise section ----------
let dnBox = null;
function renderDenoiseBox() {
  if (!dnBox) return;
  dnBox.innerHTML = '';
  const base = D.p && (C.photos[D.p.master] || D.p);
  if (!base) return;
  const dn = base.denoise;
  if (!dn) {
    dnBox.append(el('div', { class: 'muted small', style: { marginBottom: '6px' } }, 'AI noise removal for high-ISO and low-light shots. Processes the full-resolution image once; edits stay fully adjustable.'),
      el('button', { class: 'btn ai', style: { width: '100%' }, onclick: () => openDenoise([D.p.id]) }, icon('denoise'), 'AI Denoise…'));
    return;
  }
  const reload = debounce(async () => { save(); await viewer().reloadSource(); queueThumb(D.p.id); }, 350);
  dnBox.append(
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: dn.on, onchange: (e) => { dn.on = e.target.checked; reload(); renderDenoiseBox(); } }), `Enabled (${dn.model === 'detailed' ? 'Detailed' : 'Natural'} model)`),
    dn.on ? slider({ label: 'Amount', min: 0, max: 100, value: dn.amount ?? 75, def: 75, onInput: (v) => { dn.amount = v; }, onCommit: () => reload() }).el : null,
    el('div', { class: 'btnrow grow' },
      el('button', { class: 'btn small', onclick: () => openDenoise([D.p.id]) }, 'Re-run…'),
      el('button', { class: 'btn small', onclick: async () => { const { removeDenoise } = await import('./denoise.js'); await removeDenoise(base); await viewer().reloadSource(); queueThumb(D.p.id); renderDenoiseBox(); } }, 'Remove')));
}

let hslBody = null, hslTab = prefs.get('hslTab', 'hue');
function renderHSLBody() {
  if (!hslBody) return;
  hslBody.innerHTML = '';
  D.controls = D.controls.filter((c) => !c.hsl);
  const push = (elm) => { D.controls.at(-1).hsl = true; return elm; };
  if (D.s?.profile === 'bw') {
    hslBody.append(el('div', { class: 'muted small' }, 'Black & White Mix — brighten or darken how each original color converts to gray.'),
      ...HSL_BANDS.map((b, i) => push(S_(['bwMix', i], b[0].toUpperCase() + b.slice(1), { cls: 'lum', hist: 'B&W Mix' }))),
      el('div', { class: 'btnrow' }, el('button', { class: 'btn small', onclick: () => { D.s.bwMix = defaultSettings().bwMix; D.update(); D.refreshControls(); D.commit('B&W Auto Mix'); } }, 'Auto Mix')));
    return;
  }
  const tabs = el('div', { class: 'hsl-tabs' }, [['hue', 'Hue'], ['sat', 'Saturation'], ['lum', 'Luminance'], ['all', 'All']].map(([k, l]) => el('button', { class: hslTab === k ? 'on' : '', onclick: () => { hslTab = k; prefs.set('hslTab', k); renderHSLBody(); } }, l)),
    hslTab !== 'all' ? el('button', { title: 'Targeted adjustment: drag up/down on the photo', style: { marginLeft: 'auto' }, onclick: () => startTAT(hslTab) }, icon('target'), ' Target') : null);
  hslBody.append(tabs);
  const group = (kind, title) => {
    const box = el('div');
    if (title) box.append(sectionLabel(title));
    HSL_BANDS.forEach((b, i) => {
      const cls = kind === 'hue' ? 'hue-' + b : kind === 'sat' ? 'sat' : 'lum';
      const row = push(S_(['hsl', kind, i], b[0].toUpperCase() + b.slice(1), { cls, hist: { hue: 'Hue', sat: 'Saturation', lum: 'Luminance' }[kind] + ' ' + b }));
      row.style.setProperty('--c', BAND_COLORS[i]);
      box.append(row);
    });
    return box;
  };
  if (hslTab === 'all') hslBody.append(group('hue', 'Hue'), group('sat', 'Saturation'), group('lum', 'Luminance'));
  else hslBody.append(group(hslTab));
  hslBody.append(el('div', { class: 'btnrow' }, el('button', { class: 'btn small', onclick: () => { D.s.hsl = defaultSettings().hsl; D.update(); D.refreshControls(); D.commit('Reset HSL'); } }, 'Reset HSL')));
}
function startTAT(kind) {
  const v = viewer();
  const t = targetedTool(D, kind, (e) => {
    const px = v.sampleAt(e.clientX, e.clientY);
    const r = px[0] / 255, g = px[1] / 255, b = px[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0; const d = mx - mn;
    if (d > 1e-6) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
    const CEN = [0, 30, 60, 120, 180, 240, 270, 300, 360]; const w = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 8; i++) if (h >= CEN[i] && h < CEN[i + 1]) { const tt = (h - CEN[i]) / (CEN[i + 1] - CEN[i]); w[i] = 1 - tt; w[(i + 1) % 8] += tt; }
    return w;
  });
  D.toolName = 'tat'; D.tool = t; v.setTool(t);
  toast('Drag up/down on the photo to adjust ' + kind + ' of the colors under the cursor. Esc to finish.', false, 3500);
}

// ---------- tool panel (crop / spot / mask) ----------
function renderToolPanel() {
  if (!toolBox) return;
  toolBox.innerHTML = '';
  statusEl = null;
  const n = D.toolName;
  if (!n || n === 'wb' || n === 'tat' || !D.s) return;
  const box = el('div', { class: 'tool-panel' });
  toolBox.append(box);
  if (n === 'crop') {
    const t = D.tool, W = viewer().engine.W, H = viewer().engine.H;
    const aspSel = el('select', { onchange: () => { D.s.crop.aspect = aspSel.value; applyAspect(); } }, ASPECTS.map(([v, l]) => el('option', { value: v, selected: D.s.crop.aspect === v }, l)));
    const lock = el('input', { type: 'checkbox', checked: t.lock, onchange: () => { t.lock = lock.checked; prefs.set('cropLock', t.lock); if (!t.lock) { D.s.crop.aspect = 'free'; aspSel.value = 'free'; } } });
    const ov = el('select', { onchange: () => { t.overlay = ov.value; prefs.set('cropOverlay', ov.value); viewer().requestRender(); } }, [['thirds', 'Rule of Thirds'], ['grid', 'Grid'], ['golden', 'Golden Ratio'], ['diagonal', 'Diagonal'], ['none', 'None']].map(([v, l]) => el('option', { value: v, selected: t.overlay === v }, l)));
    const angle = slider({ label: 'Angle', min: -45, max: 45, step: 0.05, value: D.s.crop.angle, def: 0, fmt: (v) => Number(v).toFixed(2) + '°',
      onInput: (v) => { D.s.crop.angle = v; Object.assign(D.s.crop, fitCrop(constrainAspect(D.s.crop, t.ratio(), D.s, W, H), D.s, W, H)); D.update(); }, onCommit: () => D.commit('Straighten') });
    D.refreshers.push(() => angle.set(D.s.crop.angle));
    box.append(el('h4', {}, 'Crop & Straighten', el('button', { class: 'btn small primary', onclick: () => setTool(null) }, 'Done')),
      el('div', { class: 'field' }, el('label', {}, 'Aspect'), el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, aspSel, el('label', { class: 'check', title: 'Lock aspect ratio' }, lock, icon('lock')))),
      angle.el,
      el('div', { class: 'btnrow grow' },
        el('button', { class: 'btn small', onclick: () => autoStraighten('Auto Straighten') }, 'Auto Straighten'),
        el('button', { class: 'btn small', title: 'Swap crop orientation (X)', onclick: swapCropOrientation }, icon('swap'), 'Orientation'),
        el('button', { class: 'btn small', onclick: () => { D.s.crop = { ...defaultSettings().crop, aspect: D.s.crop.aspect }; D.update(); D.refreshControls(); D.commit('Reset Crop'); } }, 'Reset')),
      el('div', { class: 'btnrow grow' },
        el('button', { class: 'btn small', title: 'Rotate left 90°', onclick: () => { A.rotate(-1); reloadFromStore(); } }, icon('rotate-ccw'), '90°'), el('button', { class: 'btn small', title: 'Rotate right 90°', onclick: () => { A.rotate(1); reloadFromStore(); } }, icon('rotate-cw'), '90°'),
        el('button', { class: 'btn small', title: 'Flip horizontal', onclick: () => { A.flipH(); reloadFromStore(); } }, icon('flip-h'), 'Flip H'), el('button', { class: 'btn small', title: 'Flip vertical', onclick: () => { A.flipV(); reloadFromStore(); } }, icon('flip-v'), 'Flip V')),
      el('div', { class: 'field' }, el('label', {}, 'Overlay'), ov),
      el('div', { class: 'muted small' }, 'Drag corners/edges to crop, drag outside to rotate, Ctrl+drag a line along the horizon to straighten. Enter or double-click when done.'));
  } else if (n === 'spot') {
    const t = D.tool;
    const sel = () => (t.sel >= 0 ? D.s.spots[t.sel] : null);
    const modeSeg = seg([['heal', 'Heal'], ['clone', 'Clone']], sel()?.mode || t.mode, (v) => { t.mode = v; prefs.set('spotMode', v); const q = sel(); if (q) { q.mode = v; D.update(); D.commit('Spot Mode'); } });
    box.append(el('h4', {}, 'Spot Removal', el('button', { class: 'btn small primary', onclick: () => setTool(null) }, 'Done')),
      el('div', { style: { margin: '4px 0 8px' } }, modeSeg),
      slider({ label: 'Size', min: 0.2, max: 20, step: 0.1, value: +(t.size * 100).toFixed(1), def: 1.5, onInput: (v) => { t.size = v / 100; prefs.set('spotSize', t.size); const q = sel(); if (q) { q.r = t.size; D.update(); } viewer().requestRender(); }, onCommit: () => sel() && D.commit('Spot Size') }).el,
      slider({ label: 'Feather', min: 0, max: 100, value: Math.round((sel()?.feather ?? t.feather) * 100), def: 50, onInput: (v) => { t.feather = v / 100; prefs.set('spotFeather', t.feather); const q = sel(); if (q) { q.feather = t.feather; D.update(); } }, onCommit: () => sel() && D.commit('Spot Feather') }).el,
      slider({ label: 'Opacity', min: 0, max: 100, value: Math.round((sel()?.opacity ?? 1) * 100), def: 100, onInput: (v) => { t.opacity = v / 100; const q = sel(); if (q) { q.opacity = t.opacity; D.update(); } }, onCommit: () => sel() && D.commit('Spot Opacity') }).el,
      el('div', { class: 'btnrow grow' },
        el('button', { class: 'btn small', disabled: t.sel < 0, onclick: () => { D.s.spots.splice(t.sel, 1); t.sel = -1; D.update(); D.commit('Delete Spot'); renderToolPanel(); } }, 'Delete Selected'),
        el('button', { class: 'btn small', onclick: () => { D.s.spots = []; t.sel = -1; D.update(); D.commit('Clear Spots'); renderToolPanel(); } }, 'Clear All')),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: t.show, onchange: (e) => { t.show = e.target.checked; viewer().requestRender(); } }), 'Show overlay'),
      el('div', { class: 'muted small' }, `${D.s.spots.length} spot(s). Click a blemish to heal it (source is found automatically) or click-drag to choose the source. Drag circles to move, Alt+click to delete, mouse wheel or [ ] for size.`));
  } else if (n === 'mask') renderMaskPanel(box);
}
function reloadFromStore() { D.s = getSettings(D.p); D.update(); D.refreshControls(); renderHistory(); }
function applyAspect() {
  const t = D.tool, W = viewer().engine.W, H = viewer().engine.H;
  if (D.s.crop.aspect !== 'free') t.lock = true;
  D.s.crop = { ...D.s.crop, ...fitCrop(constrainAspect(D.s.crop, aspectValue(D.s.crop.aspect, D.s, W, H), D.s, W, H), D.s, W, H) };
  if (D.s.crop.aspect !== 'free') { // grow to the largest crop of this ratio
    const big = constrainAspect({ x: 0, y: 0, w: 1, h: 1 }, aspectValue(D.s.crop.aspect, { ...D.s, crop: { ...D.s.crop } }, W, H), D.s, W, H);
    D.s.crop = { ...D.s.crop, ...fitCrop(big, D.s, W, H) };
  }
  D.update(); D.commit('Crop Aspect');
}
function swapCropOrientation() {
  const W = viewer().engine.W, H = viewer().engine.H, c = D.s.crop, rot = D.s.orient.rot % 2, oW = rot ? H : W, oH = rot ? W : H;
  const pw = c.w * oW, ph = c.h * oH;
  const nc = { x: 0, y: 0, w: Math.min(1, ph / oW), h: Math.min(1, pw / oH) };
  const R = ph / pw;
  D.s.crop = { ...c, ...fitCrop(constrainAspect({ ...nc, x: 0.5 - nc.w / 2, y: 0.5 - nc.h / 2 }, R, D.s, W, H), D.s, W, H) };
  D.update(); D.commit('Crop Orientation');
}
async function autoStraighten(name) {
  const a = await autoStraightenAngle(D.p, D.s);
  if (a == null) { toast('Could not detect a horizon or verticals to level', true); return; }
  const W = viewer().engine.W, H = viewer().engine.H;
  D.s.crop.angle = +a.toFixed(2);
  const R = D.s.crop.aspect === 'free' ? null : aspectValue(D.s.crop.aspect, D.s, W, H);
  D.s.crop = { ...D.s.crop, ...fitCrop(constrainAspect({ x: 0, y: 0, w: 1, h: 1 }, R, D.s, W, H), D.s, W, H) };
  D.update(); D.refreshControls(); D.commit(name);
  toast(`Straightened by ${a.toFixed(2)}°`);
}

function renderMaskPanel(box) {
  const masks = D.s.masks, m = activeMask();
  statusEl = el('div', { class: 'muted small', style: { minHeight: '16px', margin: '4px 0' } });
  const head = el('h4', {}, 'Masks', el('span', { style: { display: 'flex', gap: '4px' } },
    el('label', { class: 'check small', title: 'Show mask overlay (O)' }, el('input', { type: 'checkbox', checked: D.maskOverlay, onchange: (e) => { D.maskOverlay = e.target.checked; prefs.set('maskOverlay2', D.maskOverlay); viewer().showMask = D.maskOverlay ? D.activeMask : null; viewer().requestRender(); } }), 'Overlay'),
    el('button', { class: 'btn small primary', onclick: () => { if (D.tool?.finish) D.tool.finish(); else setTool(null); } }, D.tool?.isObjectSelect ? 'Done' : 'Close')));
  const list = el('div', { class: 'mask-list' });
  masks.forEach((mk) => {
    const it = el('div', { class: 'mask-item' + (mk.id === D.activeMask ? ' on' : ''), onclick: () => selectMask(mk.id),
      onmouseenter: () => { viewer().showMask = mk.id; viewer().requestRender(); }, onmouseleave: () => { viewer().showMask = D.maskOverlay ? D.activeMask : null; viewer().requestRender(); } },
      el('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: mk.enabled === false ? '#555' : '#e8a33d' } }),
      el('span', { class: 'mname' }, mk.name + (mk.invert ? ' (inverted)' : '')),
      el('span', { class: 'micons' },
        el('button', { title: 'Enable/disable', onclick: (e) => { e.stopPropagation(); mk.enabled = mk.enabled === false; D.updateMasks(); D.commit('Toggle Mask'); renderToolPanel(); } }, icon(mk.enabled === false ? 'eye-off' : 'eye')),
        el('button', { title: 'Invert', onclick: (e) => { e.stopPropagation(); mk.invert = !mk.invert; D.update(); D.commit('Invert Mask'); renderToolPanel(); } }, icon('invert')),
        el('button', { title: 'Duplicate', onclick: (e) => { e.stopPropagation(); if (masks.length >= 8) return; const c = clone(mk); c.id = uid(); c.name += ' copy'; masks.push(c); D.updateMasks(); D.commit('Duplicate Mask'); selectMask(c.id); } }, icon('copy')),
        el('button', { title: 'Delete', onclick: (e) => { e.stopPropagation(); D.s.masks = masks.filter((x) => x !== mk); if (D.activeMask === mk.id) D.activeMask = D.s.masks.at(-1)?.id || null; D.updateMasks(); D.commit('Delete Mask'); setTool('mask'); } }, icon('trash'))));
    it.addEventListener('dblclick', async () => { const n = await prompt('Rename Mask', mk.name); if (n) { mk.name = n; D.commit('Rename Mask'); renderToolPanel(); } });
    list.append(it);
  });
  const nb = (ic, label, fn, cls = '') => el('button', { class: 'btn small ' + cls, onclick: fn }, icon(ic), label);
  const withIcon = (ic, sel) => el('div', { class: 'sel-ic' }, icon(ic), sel);
  const landSel = el('select', { onchange: () => { const k = landSel.value; landSel.value = ''; if (k) newMask('semantic', { ai: 'landscape', labels: AI.LANDSCAPE[k], name: k }); } }, el('option', { value: '' }, 'Landscape…'), Object.keys(AI.LANDSCAPE).map((k) => el('option', { value: k }, k)));
  const objBox = el('div', { class: 'chips' });
  box.append(head, list, statusEl,
    sectionLabel('Create New Mask'),
    el('div', { class: 'mask-new' },
      nb('subject', 'Subject', () => newMask('subject', { ai: 'subject' }), 'ai'), nb('sky', 'Sky', () => newMask('sky', { ai: 'sky' }), 'ai'),
      nb('background', 'Background', () => newMask('subject', { ai: 'subject', invert: true, name: 'Background' }), 'ai'), nb('object', 'Object (click)', () => newMask('object', { name: 'Object' }), 'ai'),
      nb('person', 'People', () => newMask('semantic', { ai: 'people', name: 'People' }), 'ai'), withIcon('landscape', landSel),
      nb('brush', 'Brush', () => newMask('brush')), nb('linear-gradient', 'Linear Gradient', () => newMask('linear')),
      nb('radial-gradient', 'Radial Gradient', () => newMask('radial')), nb('palette', 'Color Range', () => newMask('color')),
      nb('sun', 'Luminance Range', () => newMask('luminance')), nb('scan', 'Detect Objects', async () => {
        objBox.innerHTML = ''; objBox.append(el('span', { class: 'spinner' }), ' detecting…');
        try {
          const en = viewer().engine;
          const objs = await AI.detectObjects(D.p, en.maskW, en.maskH);
          objBox.innerHTML = '';
          if (!objs.length) objBox.append(el('span', { class: 'muted small' }, 'No objects detected'));
          objs.sort((a, b) => b.area - a.area).forEach((o) => objBox.append(el('span', { class: 'chip ai', title: `${Math.round(o.area * 100)}% of frame`, onclick: () => newMask('object', { canvas: o.canvas, name: o.label }),
            onmouseenter: () => { const c = viewer().overlay.getContext('2d'); viewer()._overlay(); const [x0, y0] = viewer().rawToCanvas(o.box[0], o.box[1]); const [x1, y1] = viewer().rawToCanvas(o.box[2], o.box[3]); c.strokeStyle = '#e8a33d'; c.lineWidth = 2 * devicePixelRatio; c.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); },
            onmouseleave: () => viewer()._overlay() }, o.label)));
        } catch (e) { objBox.innerHTML = ''; toast('Object detection failed: ' + e.message, true); }
      })),
    objBox);
  if (!m) { box.append(el('div', { class: 'muted small' }, masks.length ? 'Select a mask to edit it.' : 'AI masks run locally on your GPU. The first use downloads each model once.')); return; }
  if (D.tool?.isObjectSelect) status('Click on the object you want to select (Alt+click to exclude areas), then press Done.');

  // refinement controls
  const ref = el('div');
  ref.append(sectionLabel(m.name + ' — Mask'));
  ref.append(O_(activeMask, 'amount', 'Amount', { min: 0, max: 100, def: 100, hist: 'Mask Amount' }));
  const armed = (label, mode, hint, ic = 'refresh') => el('div', { class: 'btnrow' },
    el('button', { class: 'btn small' + (D.maskEdit === mode ? ' active' : ''), onclick: () => setMaskEdit(D.maskEdit === mode ? null : mode) }, icon(D.maskEdit === mode ? 'x' : ic), D.maskEdit === mode ? 'Cancel' : label),
    el('span', { class: 'muted small', style: { alignSelf: 'center' } }, D.maskEdit === mode ? hint : ''));
  if (m.kind === 'radial') {
    if (m.radial) {
      ref.append(O_(() => activeMask()?.radial, 'feather', 'Feather', { min: 0, max: 1, step: 0.01, def: 0.5, hist: 'Radial Feather' }));
      // Angle in degrees, backed by the mask's radians; kept in sync while the rotation knob is dragged.
      const deg = () => { const R = activeMask()?.radial; return R && { get angle() { return Math.round(((R.angle || 0) * 180) / Math.PI); }, set angle(v) { R.angle = (v * Math.PI) / 180; } }; };
      const angleEl = O_(deg, 'angle', 'Angle', { min: -180, max: 180, step: 1, def: 0, hist: 'Rotate Radial Gradient', fmt: (v) => `${Math.round(v)}°` });
      ref.append(angleEl);
      D.onRadialAngle = (a) => { const inp = angleEl.querySelector('input[type=range]'), num = angleEl.querySelector('input:not([type=range]), .val'); const v = Math.round((a * 180) / Math.PI); if (inp) inp.value = v; if (num) ('value' in num ? (num.value = v + '°') : (num.textContent = v + '°')); };
    }
    ref.append(el('div', { class: 'muted small' }, m.radial ? 'Drag the square handles to resize, the center to move, and the round knob to rotate (Shift = circle / snap to 15°).' : 'Drag on the photo to draw the gradient.'));
    if (m.radial) ref.append(armed('Redraw', 'redraw', 'drag on the photo'));
  }
  if (m.kind === 'linear') {
    ref.append(el('div', { class: 'muted small' }, m.linear ? 'Drag the end lines to adjust, the center dot to move.' : 'Drag on the photo to draw the gradient.'));
    if (m.linear) ref.append(armed('Redraw', 'redraw', 'drag on the photo'));
  }
  if (m.kind === 'color') ref.append(O_(() => activeMask()?.color, 'tol', 'Range', { min: 0.03, max: 1, step: 0.01, def: 0.25, hist: 'Color Range' }), armed('Pick Color', 'pick', 'click the color on the photo', 'eyedropper'));
  if (m.kind === 'luminance') ref.append(O_(() => activeMask()?.range, 'lo', 'Low', { min: 0, max: 1, step: 0.01, def: 0.6 }), O_(() => activeMask()?.range, 'hi', 'High', { min: 0, max: 1, step: 0.01, def: 1 }), O_(() => activeMask()?.range, 'smooth', 'Smoothness', { min: 0, max: 0.5, step: 0.01, def: 0.1 }), armed('Sample Brightness', 'pick', 'click a spot on the photo', 'eyedropper'));
  if (rasterKinds.has(m.kind) && !D.tool?.isObjectSelect) {
    const mode = D.maskEdit === 'brush-add' ? 'add' : D.maskEdit === 'brush-erase' ? 'erase' : 'off';
    ref.append(el('div', { style: { margin: '6px 0', display: 'flex', alignItems: 'center', gap: '8px' } }, el('span', { class: 'muted' }, 'Brush'),
      seg([['off', 'Off'], ['add', '+ Add'], ['erase', '− Subtract']], mode, (v) => setMaskEdit(v === 'off' ? null : 'brush-' + v))));
    if (mode === 'off') ref.append(el('div', { class: 'muted small' }, 'Turn the brush on to paint in or remove parts of this mask. While it is off, clicking the photo just zooms.'));
    const bt = D.tool;
    if (bt && mode !== 'off') {
      ref.append(
        slider({ label: 'Brush Size', min: 0.2, max: 30, step: 0.1, value: +(bt.size * 100).toFixed(1), def: 3, onInput: (v) => { bt.size = v / 100; prefs.set('brushSize', bt.size); } }).el,
        slider({ label: 'Feather', min: 0, max: 100, value: Math.round(bt.feather * 100), def: 50, onInput: (v) => { bt.feather = v / 100; prefs.set('brushFeather', bt.feather); } }).el,
        slider({ label: 'Flow', min: 1, max: 100, value: Math.round(bt.flow * 100), def: 100, onInput: (v) => { bt.flow = v / 100; prefs.set('brushFlow', bt.flow); } }).el,
        el('div', { class: 'muted small' }, 'Paint to add, Alt+paint to subtract. Mouse wheel resizes.'));
    }
    if (m.strokes.length) ref.append(el('button', { class: 'btn small', onclick: () => { m.strokes = []; D.updateMasks(); D.commit('Clear Brush'); } }, 'Clear Brush Strokes'));
  }
  const rf = m.refine || (m.refine = { on: false, lo: 0, hi: 1, smooth: 0.1 });
  ref.append(el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: rf.on, onchange: (e) => { rf.on = e.target.checked; D.update(); D.commit('Mask Refine'); renderToolPanel(); } }), 'Intersect with luminance range'));
  if (rf.on) ref.append(O_(() => activeMask()?.refine, 'lo', 'Lum Low', { min: 0, max: 1, step: 0.01, def: 0 }), O_(() => activeMask()?.refine, 'hi', 'Lum High', { min: 0, max: 1, step: 0.01, def: 1 }), O_(() => activeMask()?.refine, 'smooth', 'Smooth', { min: 0, max: 0.5, step: 0.01, def: 0.1 }));
  box.append(ref);

  // local adjustments
  const adj = () => activeMask()?.adj;
  const local = el('div');
  const presetSel = el('select', { onchange: () => { const v = presetSel.value; presetSel.value = ''; const a = adj(); if (!a) return; const P2 = { reset: defaultMaskAdj(), brighten: { exposure: 0.5 }, darken: { exposure: -0.6 }, pop: { contrast: 20, clarity: 25, texture: 15, saturation: 10 }, soften: { texture: -50, clarity: -30, sharpness: -30 }, 'sky-blue': { temp: -15, saturation: 20, exposure: -0.3, highlights: -30, dehaze: 15 }, 'warm-light': { temp: 20, exposure: 0.25 }, 'teeth-whiten': { saturation: -50, exposure: 0.3 }, 'iris-enhance': { exposure: 0.35, clarity: 30, saturation: 20 }, 'remove-haze': { dehaze: 40, contrast: 10 } }[v]; Object.assign(a, P2); D.update(); renderToolPanel(); D.commit('Mask Preset'); } },
    el('option', { value: '' }, 'Effect preset…'), [['reset', 'Reset adjustments'], ['brighten', 'Brighten'], ['darken', 'Darken'], ['pop', 'Pop'], ['soften', 'Soften Skin'], ['sky-blue', 'Deep Blue Sky'], ['warm-light', 'Warm Light'], ['teeth-whiten', 'Teeth Whiten'], ['iris-enhance', 'Iris Enhance'], ['remove-haze', 'Remove Haze']].map(([v, l]) => el('option', { value: v }, l)));
  local.append(el('div', { class: 'section-label' }, 'Adjustments', presetSel),
    O_(adj, 'temp', 'Temp', { cls: 'temp' }), O_(adj, 'tint', 'Tint', { cls: 'tint' }),
    O_(adj, 'exposure', 'Exposure', { min: -4, max: 4, step: 0.01, fmt: (v) => (v > 0 ? '+' : '') + Number(v).toFixed(2) }),
    O_(adj, 'contrast', 'Contrast'), O_(adj, 'highlights', 'Highlights'), O_(adj, 'shadows', 'Shadows'), O_(adj, 'whites', 'Whites'), O_(adj, 'blacks', 'Blacks'),
    O_(adj, 'texture', 'Texture'), O_(adj, 'clarity', 'Clarity'), O_(adj, 'dehaze', 'Dehaze'),
    O_(adj, 'hue', 'Hue', { cls: 'hue-red' }), O_(adj, 'saturation', 'Saturation'),
    O_(adj, 'sharpness', 'Sharpness'), O_(adj, 'noise', 'Noise', { min: 0, max: 100 }),
    O_(adj, 'colorH', 'Color Hue', { min: 0, max: 360, def: 0 }), O_(adj, 'colorS', 'Color Amt', { min: 0, max: 100 }));
  box.append(local);
}

// =============== LEFT PANELS ===============
let navCanvas = null, histBox = null, snapBox = null;
function renderLeft() {
  const root = $('#left-panels'); root.innerHTML = '';
  const nav = panel('Navigator', { id: 'dev-nav' });
  navCanvas = el('canvas', { style: { width: '100%', height: '150px', display: 'block', background: '#1d1d1d', cursor: 'pointer' } });
  navCanvas.addEventListener('pointerdown', navClick);
  navCanvas.addEventListener('pointermove', (e) => { if (e.buttons) navClick(e); });
  const zb = (z, l) => el('button', { class: 'btn small', onclick: () => viewer().setZoom(z) }, l);
  nav.body.append(navCanvas, el('div', { class: 'btnrow grow' }, zb('fit', 'Fit'), zb('fill', 'Fill'), zb(0.5, '1:2'), zb(1, '1:1'), zb(2, '2:1'), zb(4, '4:1')));
  root.append(nav.el);

  // Presets
  const pr = panel('Presets', { id: 'dev-presets', tools: [{ icon: 'plus', title: 'Create preset from current settings', onClick: createPreset }, { icon: 'more', title: 'Import / export presets', onClick: (e) => contextMenu(e.clientX, e.clientY, [{ label: 'Export My Presets…', action: exportPresets }, { label: 'Import Presets…', action: importPresets }]) }] });
  const amt = slider({ label: 'Amount', min: 0, max: 200, value: D.presetAmount * 100, def: 100, onInput: (v) => (D.presetAmount = v / 100) });
  pr.body.append(amt.el, el('div', { class: 'muted small', style: { marginBottom: '4px' } }, 'Hover a preset to preview it on the photo.'));
  const list = el('div', { class: 'preset-list' });
  const all = [...BUILTIN_PRESETS, ...C.presets];
  const groups = [...new Set(all.map((p) => p.group))];
  for (const g of groups) {
    const gk = 'pg:' + g, open = prefs.get(gk, g === 'User Presets' || g === 'Color');
    const items = el('div', { style: { display: open ? '' : 'none' } });
    const gh = el('div', { class: 'pgroup', onclick: () => { const o = items.style.display === 'none'; items.style.display = o ? '' : 'none'; gh.firstChild.replaceChildren(icon(o ? 'chevron-down' : 'chevron-right', { cls: 'sm' })); prefs.set(gk, o); } }, el('span', {}, icon(open ? 'chevron-down' : 'chevron-right', { cls: 'sm' })), ' ' + g);
    for (const p of all.filter((x) => x.group === g)) {
      const it = el('div', { class: 'pitem', onclick: () => { if (!D.p) return; D.s = normalize(applyPreset(D.s, p.settings, D.presetAmount)); D.update(); D.refreshControls(); renderHSLBody(); D.commit('Preset: ' + p.name); },
        onmouseenter: () => { if (D.p) viewer().setSettings(normalize(applyPreset(D.s, p.settings, D.presetAmount))); }, onmouseleave: () => D.update() }, p.name);
      if (!p.builtin) it.addEventListener('contextmenu', (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [
        { label: 'Update with Current Settings', action: () => { p.settings = pick(D.s, Object.keys(SETTING_GROUPS).filter((k) => Object.keys(p.settings).some((s) => SETTING_GROUPS[k].includes(s)))); save(); toast('Preset updated'); } },
        { label: 'Rename…', action: async () => { const n = await prompt('Rename Preset', p.name); if (n) { p.name = n; save(); renderLeft(); } } },
        { label: 'Delete', action: async () => { if (await confirmBox('Delete Preset', `Delete “${p.name}”?`, 'Delete')) { C.presets = C.presets.filter((x) => x !== p); save(); renderLeft(); } } },
      ]); });
      items.append(it);
    }
    list.append(gh, items);
  }
  pr.body.append(list);
  root.append(pr.el);

  const sn = panel('Snapshots', { id: 'dev-snaps', tools: [{ icon: 'plus', title: 'Create snapshot', onClick: async () => { if (!D.p) return; const n = await prompt('New Snapshot', new Date().toLocaleString()); if (n) { D.p.snapshots = D.p.snapshots || []; D.p.snapshots.unshift({ name: n, s: clone(D.s) }); save(); renderSnapshots(); } } }] });
  snapBox = sn.body; root.append(sn.el);
  const hi = panel('History', { id: 'dev-history', tools: [{ icon: 'trash', title: 'Clear history', onClick: () => { if (!D.p) return; D.p.history = [{ name: 'Current Settings', t: Date.now(), s: clone(D.s) }]; D.p.histPos = 0; save(); renderHistory(); } }] });
  histBox = hi.body; root.append(hi.el);
  root.append(el('div', { class: 'btnrow grow', style: { padding: '10px 12px' } }, el('button', { class: 'btn', onclick: () => A.copySettings() }, 'Copy…'), el('button', { class: 'btn', onclick: () => { A.pasteSettings(); reloadFromStore(); } }, 'Paste')));
  renderHistory(); renderSnapshots(); updateNav();
}
function renderHistory() {
  if (!histBox || !D.p) return;
  histBox.innerHTML = '';
  const box = el('div', { class: 'history-list' });
  (D.p.history || []).forEach((h, i) => box.append(el('div', { class: 'list-item' + (i === (D.p.histPos || 0) ? ' on' : ''), onclick: () => gotoHistory(i), onmouseenter: () => viewer().setSettings(normalize(h.s)), onmouseleave: () => D.update() }, el('span', {}, h.name), el('span', { class: 'count' }, new Date(h.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })))));
  histBox.append(box);
}
function gotoHistory(i) {
  const p = D.p, h = p.history[i]; if (!h) return;
  p.histPos = i; D.s = normalize(h.s);
  p.edits = JSON.stringify(D.s) === JSON.stringify(defaultsFor(p)) ? null : clone(D.s);
  save(); queueThumb(p.id);
  D.updateMasks(); D.refreshControls(); renderHSLBody(); renderHistory(); renderToolPanel();
}
function undo() { if (D.p && (D.p.histPos || 0) < D.p.history.length - 1) gotoHistory((D.p.histPos || 0) + 1); }
function redo() { if (D.p && (D.p.histPos || 0) > 0) gotoHistory(D.p.histPos - 1); }
function renderSnapshots() {
  if (!snapBox || !D.p) return;
  snapBox.innerHTML = '';
  const snaps = D.p.snapshots || [];
  if (!snaps.length) snapBox.append(el('div', { class: 'muted small' }, 'Save versions of your edit to come back to.'));
  snaps.forEach((sn, i) => snapBox.append(el('div', { class: 'list-item', onclick: () => { D.s = normalize(sn.s); D.updateMasks(); D.refreshControls(); renderHSLBody(); D.commit('Snapshot: ' + sn.name); }, onmouseenter: () => viewer().setSettings(normalize(sn.s)), onmouseleave: () => D.update() },
    el('span', {}, sn.name), el('span', { class: 'x', onclick: (e) => { e.stopPropagation(); snaps.splice(i, 1); save(); renderSnapshots(); } }, icon('x', { cls: 'sm' })))));
}
async function createPreset() {
  if (!D.s) return;
  const name = el('input', { type: 'text', value: 'My Preset', style: { width: '100%' } });
  const groupIn = el('input', { type: 'text', value: 'User Presets', style: { width: '100%' }, list: 'pgroups' });
  const dl = el('datalist', { id: 'pgroups' }, [...new Set([...C.presets.map((p) => p.group), 'User Presets'])].map((g) => el('option', { value: g })));
  for (const i of [name, groupIn]) i.addEventListener('keydown', (e) => e.stopPropagation());
  const defaults = Object.keys(SETTING_GROUPS).filter((g) => !['Crop', 'Orientation', 'Spot Removal', 'Masks', 'Transform'].includes(g));
  const boxes = Object.keys(SETTING_GROUPS).map((g) => [g, el('input', { type: 'checkbox', checked: defaults.includes(g) })]);
  modal('New Develop Preset', el('div', {}, el('div', { class: 'field' }, el('label', {}, 'Preset Name'), name), el('div', { class: 'field' }, el('label', {}, 'Group'), groupIn, dl),
    el('div', { class: 'section-label' }, 'Settings to include'), el('div', { style: { columns: 2 } }, boxes.map(([g, cb]) => el('label', { class: 'check' }, cb, g)))), {
    cls: 'small', buttons: [{ label: 'Cancel' }, { label: 'Create', cls: 'primary', onClick: () => {
      const gs = boxes.filter(([, c]) => c.checked).map(([g]) => g);
      C.presets.push({ id: uid(), name: name.value || 'Preset', group: groupIn.value || 'User Presets', settings: pick(D.s, gs) });
      save(); renderLeft(); toast('Preset created');
    } }],
  });
}
function exportPresets() {
  const blob = new Blob([JSON.stringify({ lightbench: 'presets', presets: C.presets }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'lightbench-presets.json'; a.click();
}
function importPresets() {
  const inp = el('input', { type: 'file', accept: '.json,application/json' });
  inp.onchange = async () => {
    try {
      const d = JSON.parse(await inp.files[0].text());
      const arr = d.presets || d;
      for (const p of arr) if (p.name && p.settings) C.presets.push({ id: uid(), name: p.name, group: p.group || 'Imported', settings: p.settings });
      save(); renderLeft(); toast(`Imported ${arr.length} preset(s)`);
    } catch (e) { toast('Invalid preset file', true); }
  };
  inp.click();
}

// navigator
function updateNav() {
  if (!navCanvas || !D.p) return;
  const img = new Image();
  img.onload = () => { navCanvas._img = img; drawNav(); };
  img.src = thumbUrl(D.p);
}
function navGeom() {
  const c = navCanvas, img = c._img; if (!img) return null;
  const W = c.width = c.clientWidth * devicePixelRatio, H = c.height = c.clientHeight * devicePixelRatio;
  const k = Math.min(W / img.width, H / img.height), w = img.width * k, h = img.height * k;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}
function drawNav() {
  const g = navGeom(); if (!g) return;
  const x = navCanvas.getContext('2d');
  x.drawImage(navCanvas._img, g.x, g.y, g.w, g.h);
  const v = viewer();
  if (v.zoom !== 'fit' && v.photo && !v.ignoreCrop) {
    const [vx, vy, vw, vh] = v.view(), cw = v.canvas.width, ch = v.canvas.height;
    const fx0 = Math.max(0, -vx / vw), fy0 = Math.max(0, -vy / vh), fx1 = Math.min(1, (cw - vx) / vw), fy1 = Math.min(1, (ch - vy) / vh);
    x.fillStyle = 'rgba(0,0,0,.45)';
    x.beginPath(); x.rect(g.x, g.y, g.w, g.h); x.rect(g.x + fx0 * g.w, g.y + fy0 * g.h, (fx1 - fx0) * g.w, (fy1 - fy0) * g.h); x.fill('evenodd');
    x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.strokeRect(g.x + fx0 * g.w, g.y + fy0 * g.h, (fx1 - fx0) * g.w, (fy1 - fy0) * g.h);
  }
}
function navClick(e) {
  const g = navGeom(); if (!g) return;
  const r = navCanvas.getBoundingClientRect();
  const fx = ((e.clientX - r.left) * devicePixelRatio - g.x) / g.w, fy = ((e.clientY - r.top) * devicePixelRatio - g.y) / g.h;
  const v = viewer();
  if (v.zoom === 'fit') v.setZoom(1);
  const [, , vw, vh] = v.view(), cw = v.canvas.width, ch = v.canvas.height;
  v.pan = [cw / 2 - fx * vw - (cw - vw) / 2, ch / 2 - fy * vh - (ch - vh) / 2];
  v.requestRender();
}
on('zoom', () => drawNav());

// =============== TOOLBAR ===============
function renderToolbar() {
  const tb = $('#toolbar'); tb.innerHTML = '';
  const v = viewer();
  const ba = seg([['off', [icon('image'), ' After'], 'Show your edit'], ['full', [icon('loupe'), ' Before'], 'Before (\\)'], ['side', [icon('compare'), ' Side by Side'], 'Before and After side by side (Y)'], ['split', [icon('beforeafter'), ' Split'], 'Before | After split on one photo (Shift+Y)']], v.before, (x) => { v.before = x; v.requestRender(); $('#ba-label').classList.toggle('hidden', x !== 'full'); $('#ba-label').textContent = 'Before'; });
  dev._ba = ba;
  tb.append(el('button', { class: 'btn small', title: 'Back to Library (G)', onclick: () => emit('module', 'library') }, icon('grid'), 'Library'), ba,
    el('button', { class: 'btn small' + (v.clipping ? ' active' : ''), title: 'Show clipping (J)', onclick: toggleClipping }, icon('clipping'), 'Clipping'),
    el('button', { class: 'btn small', title: 'Toggle zoom (Z)', onclick: () => v.toggleZoom() }, icon('zoom'), 'Zoom'),
    el('span', { style: { flex: 1 } }),
    el('button', { class: 'btn small icon-only', title: 'Previous photo (←)', onclick: () => step(-1) }, icon('chevron-left')),
    el('button', { class: 'btn small icon-only', title: 'Next photo (→)', onclick: () => step(1) }, icon('chevron-right')),
    el('button', { class: 'btn small', onclick: () => A.virtualCopy() }, icon('copy'), 'Virtual Copy'),
    el('button', { class: 'btn small primary', onclick: () => openExport(targets()) }, icon('export'), 'Export…'));
}
function toggleClipping() { const v = viewer(); v.clipping = !v.clipping; histo?.setClip(v.clipping); v.requestRender(); renderToolbar(); }
async function autoToneClick() {
  const a = await A.measureAuto(D.p);
  for (const k of ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance']) D.s[k] = a[k];
  D.update(); D.refreshControls(); D.commit('Auto Tone');
}

// =============== LIFECYCLE ===============
dev.enter = async () => {
  for (const p of ['grid', 'compare', 'survey', 'empty']) $('#' + p).classList.add('hidden');
  $('#loupe').classList.remove('hidden');
  $('#filterbar').classList.add('hidden');
  window.__viewer = viewer();
  const p = P(S.cur);
  D.s = p ? getSettings(p) : defaultSettings();
  renderLeft(); renderRight(); renderToolbar();
  if (p) await load(p.id); else viewer().clear();
};
dev.leave = () => {
  setTool(null, true);
  const v = viewer(); v.before = 'off'; v.clipping = false;
  $('#ba-label').classList.add('hidden');
  histo = null; toolBox = null; hslBody = null; navCanvas = null; histBox = null; snapBox = null;
};

dev.key = (e) => {
  const k = e.key.toLowerCase(), v = viewer();
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && k === 'z') { undo(); return true; }
  if (((e.ctrlKey || e.metaKey) && k === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'z')) { redo(); return true; }
  if ((e.ctrlKey || e.metaKey) && k === 'u') { autoToneClick(); return true; }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'r') { D.s = defaultsFor(D.p); D.updateMasks(); D.refreshControls(); D.commit('Reset'); return true; }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'v') { A.pasteSettings(); reloadFromStore(); return true; }
  if ((e.ctrlKey || e.metaKey)) return false;
  if (k === 'r' && !e.shiftKey) { toggleTool('crop'); return true; }
  if (k === 'q') { toggleTool('spot'); return true; }
  if (k === 'm' || (e.shiftKey && k === 'w')) { toggleTool('mask'); return true; }
  if (k === 'w') { toggleTool('wb'); return true; }
  if (k === 'j') { toggleClipping(); return true; }
  if (k === 'z') { v.toggleZoom(v.lastMouse); return true; }
  if (k === '\\') { v.before = v.before === 'full' ? 'off' : 'full'; dev._ba?.setValue(v.before); $('#ba-label').classList.toggle('hidden', v.before !== 'full'); $('#ba-label').textContent = 'Before'; v.requestRender(); return true; }
  if (k === 'y') { const m = e.shiftKey ? 'split' : 'side'; v.before = v.before === m ? 'off' : m; dev._ba?.setValue(v.before); $('#ba-label').classList.add('hidden'); v.requestRender(); return true; }
  if (k === 'o' && D.toolName === 'mask') { D.maskOverlay = !D.maskOverlay; prefs.set('maskOverlay2', D.maskOverlay); v.showMask = D.maskOverlay ? D.activeMask : null; v.requestRender(); renderToolPanel(); return true; }
  if (k === 'x' && D.toolName === 'crop') { swapCropOrientation(); return true; }
  if (k === 'enter' && D.toolName) { if (D.tool?.finish) D.tool.finish(); else setTool(null); return true; }
  if (k === 'escape' && D.toolName) { if (D.toolName === 'crop') { D.s = getSettings(D.p); D.update(); } setTool(null); return true; }
  if ((k === '[' || k === ']') && D.tool && 'size' in D.tool) { D.tool.size = Math.max(0.002, Math.min(0.3, D.tool.size * (k === ']' ? 1.15 : 0.87))); prefs.set(D.toolName === 'spot' ? 'spotSize' : 'brushSize', D.tool.size); v._overlay(); renderToolPanel(); return true; }
  if ((k === 'delete' || k === 'backspace') && D.toolName === 'spot' && D.tool.sel >= 0) { D.s.spots.splice(D.tool.sel, 1); D.tool.sel = -1; D.update(); D.commit('Delete Spot'); renderToolPanel(); return true; }
  if ((k === 'delete' || k === 'backspace') && D.toolName === 'mask' && D.activeMask) { D.s.masks = D.s.masks.filter((m) => m.id !== D.activeMask); D.activeMask = D.s.masks.at(-1)?.id || null; D.updateMasks(); D.commit('Delete Mask'); setTool('mask'); return true; }
  return false;
};

on('current', (id) => { if (S.module === 'develop') load(id); });
on('edits', (id) => {
  // settings changed from outside the develop panels (paste, sync, presets from library…)
  if (S.module === 'develop' && D.p && id === D.p.id) {
    const s = getSettings(D.p);
    if (JSON.stringify(s) !== JSON.stringify(normalize(D.s))) { D.s = s; D.updateMasks(); D.refreshControls(); renderHistory(); }
  }
});
on('thumb', (id) => { if (S.module === 'develop' && D.p && id === D.p.id) updateNav(); });
on('denoised', async (id) => { if (S.module === 'develop' && D.p && (D.p.id === id || D.p.master === id)) { renderDenoiseBox(); await viewer().reloadSource(); } });
on('histogram', (h) => { if (S.module === 'develop' && curveEd) curveEd.setHistogram(h); });
