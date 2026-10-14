// AI worker: runs all ML models off the UI thread (WebGPU when available, WASM otherwise).
import {
  env, pipeline, AutoModel, AutoProcessor, RawImage, SamModel, Tensor, AutoTokenizer,
  CLIPTextModelWithProjection, CLIPVisionModelWithProjection,
} from '../vendor/transformers/transformers.min.js'; // @huggingface/transformers 3.8.1, bundled for offline use

// Models come from Lightbench's local model store (downloaded once, then offline) — see server.js "AI model store".
env.allowLocalModels = false;
env.remoteHost = self.location.origin + '/models/hf/';
env.remotePathTemplate = '{model}/resolve/{revision}/';
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = self.location.origin + '/vendor/transformers/';

let gpuOK = null;
async function hasGPU() {
  if (gpuOK !== null) return gpuOK;
  try { gpuOK = !!(self.navigator?.gpu && (await navigator.gpu.requestAdapter())); } catch { gpuOK = false; }
  return gpuOK;
}
const progress = (name) => (p) => {
  if (p.status === 'progress' && p.total) self.postMessage({ type: 'progress', model: name, file: p.file, loaded: p.loaded, total: p.total });
  if (p.status === 'ready') self.postMessage({ type: 'progress', model: name, done: true });
};
async function devOpts(preferGPU = true) {
  return preferGPU && (await hasGPU()) ? { device: 'webgpu', dtype: 'fp32' } : { device: 'wasm', dtype: 'q8' };
}
// Load with WebGPU, falling back to WASM if the GPU path fails.
async function load(name, loader, preferGPU = true) {
  const o = await devOpts(preferGPU);
  try { return await loader({ ...o, progress_callback: progress(name) }); }
  catch (e) {
    if (o.device !== 'webgpu') throw e;
    console.warn(name, 'webgpu failed, using wasm', e);
    return loader({ device: 'wasm', dtype: 'q8', progress_callback: progress(name) });
  }
}

const models = {};
function lazy(key, fn) { if (!models[key]) models[key] = fn().catch((e) => { delete models[key]; throw e; }); return models[key]; }

// All models below are licensed for commercial use (see THIRD_PARTY_NOTICES.md):
//   IS-Net (Apache-2.0) · DETR panoptic (Apache-2.0) · SlimSAM (Apache-2.0) · CLIP (MIT)
// (BiRefNet, also MIT, was evaluated but exceeds ONNX Runtime Web's WebGPU shader limits.)
const SUBJECT_ID = 'imgly/isnet-general-onnx';
const getSubject = () => lazy('subject', async () => {
  const model = await load('Subject model (IS-Net)', (o) => AutoModel.from_pretrained(SUBJECT_ID, { ...o, dtype: 'fp32', config: { model_type: 'custom' } }));
  const processor = await AutoProcessor.from_pretrained(SUBJECT_ID);
  return { model, processor };
});
const getPanoptic = () => lazy('panoptic', () => load('Object detection (DETR)', (o) => pipeline('image-segmentation', 'Xenova/detr-resnet-50-panoptic', o)));
const getSAM = () => lazy('sam', async () => {
  const model = await load('Object selection (SlimSAM)', (o) => SamModel.from_pretrained('Xenova/slimsam-77-uniform', o));
  const processor = await AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform');
  return { model, processor };
});
const getCLIP = () => lazy('clip', async () => {
  const id = 'Xenova/clip-vit-base-patch32';
  const o = { device: 'wasm', dtype: 'q8', progress_callback: progress('Tagging & search (CLIP)') };
  const [tokenizer, processor, text, vision] = await Promise.all([
    AutoTokenizer.from_pretrained(id), AutoProcessor.from_pretrained(id),
    CLIPTextModelWithProjection.from_pretrained(id, o), CLIPVisionModelWithProjection.from_pretrained(id, o),
  ]);
  return { tokenizer, processor, text, vision };
});

// ---------- helpers ----------
const imgCache = new Map();
// max: downscale long side (segmentation pipelines upsample every class map to the input size)
async function readImage(url, max = 0) {
  const key = url + '|' + max;
  if (imgCache.has(key)) return imgCache.get(key);
  const p = (async () => {
    const img = await RawImage.fromURL(url);
    const k = max ? Math.min(1, max / Math.max(img.width, img.height)) : 1;
    return k < 1 ? img.resize(Math.round(img.width * k), Math.round(img.height * k)) : img;
  })();
  imgCache.set(key, p);
  p.catch(() => imgCache.delete(key));
  while (imgCache.size > 4) imgCache.delete(imgCache.keys().next().value);
  return p;
}
// RawImage (1 channel) -> Uint8Array at w x h
async function maskTo(raw, w, h) {
  let m = raw;
  if (m.channels !== 1) m = m.grayscale();
  if (m.width !== w || m.height !== h) m = await m.resize(w, h);
  return new Uint8Array(m.data);
}
function unionInto(dst, src) { for (let i = 0; i < dst.length; i++) if (src[i] > dst[i]) dst[i] = src[i]; }
const norm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, (x) => x / s); };

// The DETR export names its merged "stuff" classes LABEL_184…LABEL_200; these are the official
// COCO-panoptic names for those ids (cocodataset/panopticapi, panoptic_coco_categories.json).
const MERGED = { 184: 'tree-merged', 185: 'fence-merged', 186: 'ceiling-merged', 187: 'sky-other-merged', 188: 'cabinet-merged', 189: 'table-merged', 190: 'floor-other-merged', 191: 'pavement-merged', 192: 'mountain-merged', 193: 'grass-merged', 194: 'dirt-merged', 195: 'paper-merged', 196: 'food-other-merged', 197: 'building-other-merged', 198: 'rock-merged', 199: 'wall-other-merged', 200: 'rug-merged' };
// COCO-panoptic labels like "sky-other-merged" / "wall-brick" → "sky" / "wall brick"
const baseLabel = (l) => {
  const m = /^LABEL_(\d+)$/i.exec(String(l));
  const name = m ? MERGED[m[1]] || String(l) : String(l);
  return name.toLowerCase().replace(/-(merged|other|stuff)/g, '').replace(/-/g, ' ').trim();
};

const segCache = new Map();
async function segment(kind, url) {
  const key = kind + '|' + url;
  if (segCache.has(key)) return segCache.get(key);
  const pr = (async () => {
    const img = await readImage(url, 800);
    const pipe = await getPanoptic();
    // low threshold so "stuff" regions (sky, grass, water…) are kept; object listings filter by score themselves
    const out = await pipe(img, { threshold: 0.5 });
    return { out, w: img.width, h: img.height };
  })();
  segCache.set(key, pr);
  pr.catch(() => segCache.delete(key));
  while (segCache.size > 6) segCache.delete(segCache.keys().next().value);
  return pr;
}

// ---------- tasks ----------
const tasks = {
  async subject({ url, w, h }) {
    const { model, processor } = await getSubject();
    const img = await readImage(url, 1024);
    const { pixel_values } = await processor(img);
    const { output } = await model({ input: pixel_values });
    const raw = await RawImage.fromTensor(output[0].clamp(0, 1).mul(255).to('uint8'));
    return { mask: await maskTo(raw, w, h) };
  },
  // Union of panoptic regions whose (base) label is in `labels` — sky, water, trees, person, …
  async semantic({ url, w, h, labels }) {
    const { out } = await segment('panoptic', url);
    const want = new Set(labels.map(baseLabel));
    const mask = new Uint8Array(w * h);
    let found = 0;
    for (const seg of out) {
      if (!want.has(baseLabel(seg.label))) continue;
      unionInto(mask, await maskTo(seg.mask, w, h)); found++;
    }
    return { mask, found };
  },
  async present({ url }) {
    const { out, w, h } = await segment('panoptic', url);
    const res = [];
    for (const seg of out) {
      const d = seg.mask.data; let n = 0;
      for (let i = 0; i < d.length; i += 7) if (d[i] > 127) n++;
      res.push({ label: baseLabel(seg.label), area: (n * 7) / d.length });
    }
    return { labels: res, w, h };
  },
  async objects({ url, w, h, withMasks = true }) {
    const { out } = await segment('panoptic', url);
    const res = [];
    for (const seg of out) {
      if ((seg.score ?? 1) < 0.7) continue;
      const label = baseLabel(seg.label);
      if (/^label_|^n\/a/.test(label)) continue;
      const m = seg.mask, d = m.data;
      let x0 = m.width, y0 = m.height, x1 = 0, y1 = 0, n = 0;
      for (let y = 0; y < m.height; y += 2) for (let x = 0; x < m.width; x += 2) if (d[y * m.width + x] > 127) { n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
      if (!n) continue;
      res.push({ label, score: seg.score ?? 1, box: [x0 / m.width, y0 / m.height, x1 / m.width, y1 / m.height], area: (n * 4) / d.length, mask: withMasks ? await maskTo(m, w, h) : null });
    }
    return { objects: res };
  },
  async samEmbed({ url }) {
    const { model, processor } = await getSAM();
    const key = 'sam|' + url;
    if (!segCache.has(key)) {
      const pr = (async () => {
        const img = await readImage(url, 1024);
        const inputs = await processor(img);
        const emb = await model.get_image_embeddings(inputs);
        return { inputs, emb };
      })();
      segCache.set(key, pr); pr.catch(() => segCache.delete(key));
    }
    await segCache.get(key);
    return { ok: true };
  },
  async samPoint({ url, points, w, h }) {
    const { model, processor } = await getSAM();
    await tasks.samEmbed({ url });
    const { inputs, emb } = await segCache.get('sam|' + url);
    const rs = inputs.reshaped_input_sizes[0]; // [h, w]
    const pts = points.map((p) => [p[0] * rs[1], p[1] * rs[0]]);
    const input_points = new Tensor('float32', pts.flat(), [1, 1, pts.length, 2]);
    const input_labels = new Tensor('int64', points.map((p) => BigInt(p[2] ?? 1)), [1, 1, pts.length]);
    const { pred_masks, iou_scores } = await model({ ...emb, input_points, input_labels });
    const masks = await processor.post_process_masks(pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
    const scores = iou_scores.data;
    let best = 0; for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
    const t = masks[0]; // [1, 3, H, W]
    const [, , H, W] = t.dims;
    // prefer the most complete object among near-equally confident candidates
    const area = (k) => { let n = 0; const pl = t.data.subarray(k * H * W, (k + 1) * H * W); for (let i = 0; i < pl.length; i += 9) if (pl[i]) n++; return n; };
    let bestArea = area(best);
    for (let i = 0; i < scores.length; i++) { if (i === best || scores[i] < scores[best] - 0.05) continue; const a = area(i); if (a > bestArea && a < (H * W) / 9 * 0.9) { best = i; bestArea = a; } }
    const plane = t.data.subarray(best * H * W, (best + 1) * H * W);
    const u8 = new Uint8Array(H * W); for (let i = 0; i < u8.length; i++) u8[i] = plane[i] ? 255 : 0;
    const raw = new RawImage(u8, W, H, 1);
    return { mask: await maskTo(raw, w, h), score: scores[best] };
  },
  async clipImage({ url }) {
    const { processor, vision } = await getCLIP();
    const img = await readImage(url, 512);
    const { image_embeds } = await vision(await processor(img));
    return { embedding: norm(image_embeds.data) };
  },
  async clipText({ texts }) {
    const { tokenizer, text } = await getCLIP();
    const inputs = tokenizer(texts, { padding: true, truncation: true });
    const { text_embeds } = await text(inputs);
    const dim = text_embeds.dims[1], out = [];
    for (let i = 0; i < texts.length; i++) out.push(norm(text_embeds.data.subarray(i * dim, (i + 1) * dim)));
    return { embeddings: out };
  },
  async warm({ which }) {
    const f = { subject: getSubject, panoptic: getPanoptic, sam: getSAM, clip: getCLIP }[which];
    if (f) await f();
    return { ok: true, gpu: await hasGPU() };
  },
  async status() { return { gpu: await hasGPU(), loaded: Object.keys(models) }; },
};

self.onmessage = async (e) => {
  const { id, task, args } = e.data;
  try {
    const result = await tasks[task](args || {});
    const transfer = [];
    if (result?.mask?.buffer) transfer.push(result.mask.buffer);
    self.postMessage({ id, result }, transfer);
  } catch (err) {
    console.error(err);
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
