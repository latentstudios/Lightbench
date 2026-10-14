// AI Denoise worker: SCUNet (Zhang et al. 2022, Apache-2.0) via ONNX Runtime Web (WebGPU, WASM fallback).
import * as ort from '../vendor/ort/ort.webgpu.min.mjs'; // onnxruntime-web 1.30.0, bundled for offline use

ort.env.wasm.wasmPaths = self.location.origin + '/vendor/ort/';
ort.env.logLevel = 'error';

// Models come from Lightbench's local model store (downloaded once, then offline) — see server.js.
// Preferred on GPUs with fp16 support: Lightbench's optimized build (fixed 768 px tiles, shape logic pre-computed,
// half-size weights) — ~30% faster, identical output. Otherwise the original SCUNet export.
const ORIGINAL = '/models/hf/Heliosoph/scunet-onnx/resolve/main/';
const NAMES = { natural: 'scunet_color_real_psnr', detailed: 'scunet_color_real_gan' };
const FIXED = 768; // must match TILE in denoise.js
const sessions = {};

async function fetchModel(url, label) {
  const r = await fetch(url);
  if (!r.ok) { const e = new Error(`${label} is not available (${r.status === 503 ? 'offline — download it in Lightbench menu → AI Models' : 'error ' + r.status})`); e.status = r.status; throw e; }
  const total = Number(r.headers.get('content-length')) || 0;
  const reader = r.body.getReader(); const parts = []; let got = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    parts.push(value); got += value.length;
    if (total && Date.now() - last > 200) { last = Date.now(); self.postMessage({ type: 'download', label, loaded: got, total }); }
  }
  if (total) self.postMessage({ type: 'download', label, loaded: got, total: got, done: true });
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}

async function gpuInfo() {
  try { const a = self.navigator?.gpu && (await navigator.gpu.requestAdapter()); return a ? { gpu: true, f16: a.features.has('shader-f16') } : { gpu: false }; }
  catch { return { gpu: false }; }
}

async function session(model) {
  if (sessions[model]) return sessions[model];
  sessions[model] = (async () => {
    const name = NAMES[model] || NAMES.natural;
    const { gpu, f16 } = await gpuInfo();
    const base = { graphOptimizationLevel: 'all' };
    if (gpu && f16) {
      try {
        const g = await fetchModel(`/models/gh/${name}_${FIXED}_fp16.onnx`, 'AI Denoise model');
        return { s: await ort.InferenceSession.create(g, { ...base, executionProviders: ['webgpu'] }), ep: 'webgpu', fixed: FIXED };
      } catch (e) { console.warn('Optimized denoise model unavailable, using the original', e); }
    }
    const [graph, data] = await Promise.all([fetchModel(ORIGINAL + name + '.onnx', 'AI Denoise model'), fetchModel(ORIGINAL + name + '.onnx.data', 'AI Denoise model')]);
    const opts = (ep) => ({ ...base, executionProviders: [ep], externalData: [{ path: name + '.onnx.data', data }] });
    if (gpu) {
      try { return { s: await ort.InferenceSession.create(graph, opts('webgpu')), ep: 'webgpu', fixed: 0 }; }
      catch (e) { console.warn('WebGPU denoise unavailable, using CPU', e); }
    }
    return { s: await ort.InferenceSession.create(graph, opts('wasm')), ep: 'wasm', fixed: 0 };
  })();
  sessions[model].catch(() => delete sessions[model]);
  return sessions[model];
}

self.onmessage = async (e) => {
  const { id, task, args } = e.data;
  try {
    if (task === 'load') { const { ep, fixed } = await session(args.model); self.postMessage({ id, result: { ep, fixed } }); return; }
    if (task === 'tile') {
      const { s } = await session(args.model);
      const { data, w, h } = args; // Float32 planar [3,h,w], values 0..1, w/h multiples of 8 (or exactly the fixed size)
      const out = await s.run({ image: new ort.Tensor('float32', data, [1, 3, h, w]) });
      const res = out.denoised || out[s.outputNames[0]];
      const arr = new Float32Array(res.data);
      self.postMessage({ id, result: { data: arr } }, [arr.buffer]);
      return;
    }
    throw new Error('unknown task ' + task);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
