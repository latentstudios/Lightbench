// AI model packs: what each AI feature needs, whether it's downloaded, and "download everything for offline use".
// Files are stored by the local server (see server.js "AI model store"); once present, the feature works offline.
import { api } from './api.js';
import { el, toast, modal, prefs, activity } from './ui.js';
import { icon } from './icons.js';

const HF = (repo, files) => files.map((f) => `hf/${repo}/resolve/main/${f}`);
let devP = null;
// The AI workers pick WebGPU (full-precision files) or CPU (smaller quantized files); download what this computer will use.
export function device() {
  return devP ||= (async () => {
    try { const a = navigator.gpu && (await navigator.gpu.requestAdapter()); return a ? { gpu: true, f16: a.features.has('shader-f16') } : { gpu: false, f16: false }; }
    catch { return { gpu: false, f16: false }; }
  })();
}
let ghOK = null; // is Lightbench's optimized denoise build published? (falls back to the original model if not)
async function optimizedDenoise() {
  if (ghOK === null) { try { ghOK = (await api.json('models/probe?rel=' + encodeURIComponent('gh/scunet_color_real_psnr_768_fp16.onnx'))).ok; } catch { ghOK = false; } }
  return ghOK;
}

export async function packs() {
  const d = await device();
  const q = (f) => (d.gpu ? f : f.replace(/\.onnx$/, '_quantized.onnx'));
  const fast = d.gpu && d.f16 && (await optimizedDenoise());
  const denoise = (n) => (fast ? [`gh/${n}_768_fp16.onnx`] : HF('Heliosoph/scunet-onnx', [`${n}.onnx`, `${n}.onnx.data`]));
  return [
    { id: 'subject', name: 'Subject & Background', what: 'Select Subject and Select Background masks', mb: 168, files: HF('imgly/isnet-general-onnx', ['preprocessor_config.json', 'onnx/model.onnx']) },
    { id: 'scene', name: 'Sky, People & Landscape', what: 'Sky, People and Landscape masks, Detect Objects', mb: d.gpu ? 164 : 42, files: HF('Xenova/detr-resnet-50-panoptic', ['config.json', 'preprocessor_config.json', q('onnx/model.onnx')]) },
    { id: 'sam', name: 'Click to Select', what: 'Object masks — click anything to select it', mb: d.gpu ? 38 : 13, files: HF('Xenova/slimsam-77-uniform', ['config.json', 'preprocessor_config.json', q('onnx/vision_encoder.onnx'), q('onnx/prompt_encoder_mask_decoder.onnx')]) },
    { id: 'clip', name: 'Smart Search & Auto-Tagging', what: 'Search photos by description, auto keywords, find similar', mb: 149, files: HF('Xenova/clip-vit-base-patch32', ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'preprocessor_config.json', 'onnx/text_model_quantized.onnx', 'onnx/vision_model_quantized.onnx']) },
    { id: 'denoise', name: 'AI Denoise', what: 'Remove noise from high-ISO photos (Natural style)', mb: fast ? 83 : 73, files: denoise('scunet_color_real_psnr') },
    { id: 'denoise-detailed', name: 'AI Denoise — Detailed style', what: 'Optional second denoise style that keeps more fine texture', mb: fast ? 83 : 73, optional: true, files: denoise('scunet_color_real_gan') },
  ];
}
export async function status(list) {
  const all = list.flatMap((p) => p.files);
  return api.json('models/status', { method: 'POST', body: JSON.stringify(all) });
}
export async function packReady(id) {
  const p = (await packs()).find((x) => x.id === id); if (!p) return false;
  const st = await status([p]);
  return p.files.every((f) => st.files[f]?.have);
}

// ---------- background download (survives closing the dialog) ----------
let act = null, poller = null;
const listeners = new Set();
export function onProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); }
async function poll(list) {
  let st;
  try { st = await status(list); } catch { return; }
  const totalMB = list.reduce((a, p) => a + p.mb, 0);
  let have = 0;
  for (const p of list) for (const f of p.files) { const s = st.files[f]; if (s) have += s.have ? s.size : s.loading; }
  const doneMB = have / 1048576, frac = Math.min(1, doneMB / totalMB);
  for (const fn of listeners) fn(st);
  if (st.job.running) { act ||= activity('Downloading AI features…'); act.update(`Downloading AI features for offline use — ${Math.round(doneMB)} / ~${Math.round(totalMB)} MB`, frac); return; }
  clearInterval(poller); poller = null;
  if (act) { act.done(); act = null; }
  if (st.job.error) toast('AI download stopped: ' + st.job.error + '. Resume it from Lightbench menu → AI Models.', true, 8000);
  else toast('AI features downloaded — they now work offline.', false, 5000);
}
export async function downloadAll({ includeOptional = false } = {}) {
  const list = (await packs()).filter((p) => includeOptional || !p.optional || prefs.get('models:detailed', false));
  await api.json('models/download', { method: 'POST', body: JSON.stringify(list.flatMap((p) => p.files)) });
  if (!poller) poller = setInterval(() => poll(list), 700);
  poll(list);
}
export async function allReady() {
  const list = (await packs()).filter((p) => !p.optional);
  const st = await status(list);
  return list.every((p) => p.files.every((f) => st.files[f]?.have));
}

// ---------- one-time move from the old in-browser cache (Lightbench 1.0.x) ----------
export async function migrateBrowserCache() {
  if (prefs.get('models:migrated', false) || typeof caches === 'undefined') return;
  for (const name of ['transformers-cache', 'lightbench-models']) {
    try {
      if (!(await caches.has(name))) continue;
      const c = await caches.open(name);
      for (const req of await c.keys()) {
        const m = /^https:\/\/huggingface\.co\/(.+)$/.exec(req.url);
        if (!m) continue;
        const r = await c.match(req);
        if (r) await api.json('models/import?rel=' + encodeURIComponent('hf/' + m[1]), { method: 'PUT', body: await r.blob() }).catch(() => {});
      }
      await caches.delete(name);
    } catch (e) { console.warn('model cache migration', e); return; }
  }
  prefs.set('models:migrated', true);
}

// ---------- AI Models dialog ----------
export async function showModels() {
  const list = await packs();
  const rows = el('div', { class: 'models-list' });
  const foot = el('span', { class: 'muted grow' });
  const detailed = el('input', { type: 'checkbox', checked: prefs.get('models:detailed', false), onchange: () => prefs.set('models:detailed', detailed.checked) });
  const render = (st) => {
    rows.textContent = '';
    let disk = 0;
    for (const p of list) {
      const fs = p.files.map((f) => st.files[f] || {});
      const have = fs.every((s) => s.have), size = fs.reduce((a, s) => a + (s.have ? s.size : 0), 0), loading = fs.some((s) => s.loading);
      disk += size;
      const state = have ? el('span', { class: 'm-ok' }, icon('check'), ' Downloaded') : loading ? el('span', { class: 'm-dl' }, el('span', { class: 'spinner' }), ' Downloading…') : el('span', { class: 'muted' }, 'Not downloaded');
      rows.append(el('div', { class: 'models-row' },
        el('div', {}, el('b', {}, p.name, p.optional ? el('span', { class: 'muted' }, ' (optional)') : null), el('div', { class: 'muted' }, p.what)),
        el('div', { class: 'm-size muted' }, `${have ? Math.round(size / 1048576) : '~' + p.mb} MB`),
        el('div', { class: 'm-state' }, state)));
    }
    const err = st.job.error ? ` · Last download stopped: ${st.job.error}` : '';
    foot.textContent = `${Math.round(disk / 1048576)} MB on disk${err}`;
  };
  const refresh = async () => { try { render(await status(list)); } catch {} };
  const off = onProgress(render);
  const m = modal('AI Models', el('div', {},
    el('p', { class: 'muted', style: { marginTop: 0 } }, 'Lightbench\'s AI runs entirely on your computer. Each feature needs its model downloaded once; after that it works offline. Models are free and stay on your computer.'),
    rows,
    el('label', { class: 'fb-check' }, detailed, ' Also download the optional Detailed denoise style'),
  ), {
    cls: 'models-modal', foot,
    onClose: () => off(),
    buttons: [
      { label: 'Delete Models…', onClick: async () => {
        if (!confirm('Delete all downloaded AI models? They will be downloaded again the next time you use an AI feature.')) return false;
        try { await api.json('models/delete', { method: 'POST' }); toast('AI models deleted'); } catch (e) { toast(e.message, true); }
        refresh(); return false;
      } },
      { label: 'Close' },
      { label: 'Download All', cls: 'primary', onClick: async () => { await downloadAll({ includeOptional: detailed.checked }); setTimeout(refresh, 300); return false; } },
    ],
  });
  refresh();
  return m;
}
