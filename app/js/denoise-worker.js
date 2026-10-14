// AI Denoise worker: SCUNet (Zhang et al. 2022, Apache-2.0) via ONNX Runtime Web (WebGPU, WASM fallback).
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs';

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
ort.env.logLevel = 'error';

const REPO = 'https://huggingface.co/Heliosoph/scunet-onnx/resolve/main/';
const MODELS = { natural: 'scunet_color_real_psnr', detailed: 'scunet_color_real_gan' };
const sessions = {};

async function cachedFetch(url, label) {
  const cache = await caches.open('lightbench-models');
  let r = await cache.match(url);
  if (!r) {
    const net = await fetch(url);
    if (!net.ok) throw new Error(`Download failed (${net.status}) for ${label}`);
    const total = Number(net.headers.get('content-length')) || 0;
    const reader = net.body.getReader(); const parts = []; let got = 0, last = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      parts.push(value); got += value.length;
      if (total && Date.now() - last > 200) { last = Date.now(); self.postMessage({ type: 'download', label, loaded: got, total }); }
    }
    const blob = new Blob(parts);
    await cache.put(url, new Response(blob, { headers: { 'content-type': 'application/octet-stream' } }));
    self.postMessage({ type: 'download', label, loaded: got, total: got, done: true });
    r = await cache.match(url);
  }
  return new Uint8Array(await r.arrayBuffer());
}

async function session(model) {
  if (sessions[model]) return sessions[model];
  sessions[model] = (async () => {
    const name = MODELS[model] || MODELS.natural;
    const [graph, data] = await Promise.all([cachedFetch(REPO + name + '.onnx', 'AI Denoise model'), cachedFetch(REPO + name + '.onnx.data', 'AI Denoise model')]);
    const opts = (ep) => ({ executionProviders: [ep], graphOptimizationLevel: 'all', externalData: [{ path: name + '.onnx.data', data }] });
    let gpu = false;
    try { if (self.navigator?.gpu && (await navigator.gpu.requestAdapter())) gpu = true; } catch {}
    if (gpu) {
      try { const s = await ort.InferenceSession.create(graph, opts('webgpu')); return { s, ep: 'webgpu' }; }
      catch (e) { console.warn('WebGPU denoise unavailable, using CPU', e); }
    }
    return { s: await ort.InferenceSession.create(graph, opts('wasm')), ep: 'wasm' };
  })();
  sessions[model].catch(() => delete sessions[model]);
  return sessions[model];
}

self.onmessage = async (e) => {
  const { id, task, args } = e.data;
  try {
    if (task === 'load') { const { ep } = await session(args.model); self.postMessage({ id, result: { ep } }); return; }
    if (task === 'tile') {
      const { s } = await session(args.model);
      const { data, w, h } = args; // Float32 planar [3,h,w], values 0..1, w/h multiples of 8
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
