// Develop settings model, presets, curves, auto tone.
export const HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
export const BAND_COLORS = ['#e03030', '#e08030', '#e0d030', '#30c040', '#30c0c0', '#3050e0', '#8040e0', '#d040c0'];
const zeros8 = () => [0, 0, 0, 0, 0, 0, 0, 0];

export function defaultSettings() {
  return {
    v: 1, profile: 'color',
    temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0,
    curve: { rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]], pHighlights: 0, pLights: 0, pDarks: 0, pShadows: 0, split: [0.25, 0.5, 0.75] },
    hsl: { hue: zeros8(), sat: zeros8(), lum: zeros8() },
    bwMix: [-8, 2, 15, -12, -18, -14, 4, 8],
    grading: { shadows: { h: 0, s: 0, l: 0 }, midtones: { h: 0, s: 0, l: 0 }, highlights: { h: 0, s: 0, l: 0 }, global: { h: 0, s: 0, l: 0 }, blending: 50, balance: 0 },
    sharpen: { amount: 0, radius: 1, detail: 25, masking: 0 },
    nr: { lum: 0, detail: 50, color: 0 },
    lens: { distortion: 0, vignette: 0, ca: 0 },
    transform: { vertical: 0, horizontal: 0, rotate: 0, aspect: 0, scale: 100, x: 0, y: 0 },
    vignette: { amount: 0, midpoint: 50, roundness: 0, feather: 50, highlights: 0 },
    grain: { amount: 0, size: 25, roughness: 50 },
    calib: { shadowTint: 0, redHue: 0, redSat: 0, greenHue: 0, greenSat: 0, blueHue: 0, blueSat: 0 },
    crop: { x: 0, y: 0, w: 1, h: 1, angle: 0, aspect: 'original' },
    orient: { rot: 0, flipH: false, flipV: false },
    spots: [], masks: [],
  };
}

export function defaultMaskAdj() {
  return { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temp: 0, tint: 0, saturation: 0, clarity: 0, dehaze: 0, texture: 0, sharpness: 0, noise: 0, hue: 0, colorH: 0, colorS: 0 };
}

export const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

// Fill missing keys from defaults (forward-compatible loading).
export function normalize(s) {
  const d = defaultSettings();
  if (!s) return d;
  const fill = (dst, src) => {
    for (const k of Object.keys(src)) {
      if (dst[k] === undefined) dst[k] = clone(src[k]);
      else if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && typeof dst[k] === 'object') fill(dst[k], src[k]);
    }
    return dst;
  };
  s = fill(clone(s), d);
  for (const m of s.masks) { m.adj = { ...defaultMaskAdj(), ...(m.adj || {}) }; m.strokes = m.strokes || []; if (m.amount == null) m.amount = 100; }
  return s;
}

// Per-photo defaults: RAW files start with light capture sharpening and color noise reduction.
export function defaultsFor(p) {
  const d = defaultSettings();
  if (p?.raw && p.rawMode !== 'embedded') { d.sharpen.amount = 40; d.nr.color = 25; }
  return d;
}
export function isEdited(s, p) {
  if (!s) return false;
  return JSON.stringify(normalize(s)) !== JSON.stringify(defaultsFor(p));
}

// Deep merge partial (preset) into settings. Arrays are replaced.
export function deepMerge(dst, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) deepMerge(dst[k], v);
    else dst[k] = clone(v);
  }
  return dst;
}

// Apply a preset with an amount (0..2): numeric fields interpolate between current and preset value.
export function applyPreset(cur, partial, amount = 1) {
  const out = clone(cur);
  const walk = (dst, src) => {
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (typeof v === 'number' && typeof dst[k] === 'number' && amount !== 1) dst[k] = dst[k] + (v - dst[k]) * amount;
      else if (Array.isArray(v) && Array.isArray(dst[k]) && typeof v[0] === 'number' && amount !== 1) dst[k] = dst[k].map((x, i) => x + ((v[i] ?? x) - x) * amount);
      else if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') walk(dst[k], v);
      else dst[k] = clone(v);
    }
  };
  walk(out, partial);
  return out;
}

// Select subset of settings by group names (for copy/paste/sync/preset creation).
export const SETTING_GROUPS = {
  'White Balance': ['temp', 'tint'],
  'Basic Tone': ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
  'Presence': ['texture', 'clarity', 'dehaze', 'vibrance', 'saturation'],
  'Tone Curve': ['curve'],
  'Treatment & Profile': ['profile'],
  'HSL / Color': ['hsl'],
  'B&W Mix': ['bwMix'],
  'Color Grading': ['grading'],
  'Sharpening': ['sharpen'],
  'Noise Reduction': ['nr'],
  'Lens Corrections': ['lens'],
  'Transform': ['transform'],
  'Effects': ['vignette', 'grain'],
  'Calibration': ['calib'],
  'Crop': ['crop'],
  'Orientation': ['orient'],
  'Spot Removal': ['spots'],
  'Masks': ['masks'],
};
export const DEFAULT_COPY_GROUPS = Object.keys(SETTING_GROUPS).filter((g) => !['Crop', 'Orientation', 'Spot Removal', 'Masks'].includes(g));
export function pick(s, groups) {
  const out = {};
  for (const g of groups) for (const k of SETTING_GROUPS[g] || []) out[k] = clone(s[k]);
  return out;
}

// ---------- tone curve LUT ----------
function monotoneSpline(pts) {
  pts = [...pts].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  if (n === 1) return () => ys[0];
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
export function curveFn(pts) { return monotoneSpline(pts); }

function parametric(c) {
  const [s1, s2, s3] = c.split;
  const bump = (x, a, b) => (x <= a || x >= b ? 0 : Math.sin(Math.PI * (x - a) / (b - a)));
  return (x) => {
    let y = x;
    y += (c.pShadows / 100) * 0.22 * bump(x, 0, s1 + (s2 - s1) * 0.5) * 1.0;
    y += (c.pDarks / 100) * 0.22 * bump(x, s1 * 0.4, s2 + (s3 - s2) * 0.5);
    y += (c.pLights / 100) * 0.22 * bump(x, s1 + (s2 - s1) * 0.5, s3 + (1 - s3) * 0.6);
    y += (c.pHighlights / 100) * 0.22 * bump(x, s2 + (s3 - s2) * 0.5, 1.0001);
    return y;
  };
}
export function buildCurveLUT(curve) {
  const master = monotoneSpline(curve.rgb), pr = parametric(curve);
  const ch = [monotoneSpline(curve.r), monotoneSpline(curve.g), monotoneSpline(curve.b)];
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const m = Math.min(1, Math.max(0, master(Math.min(1, Math.max(0, pr(x))))));
    for (let c = 0; c < 3; c++) lut[i * 4 + c] = Math.round(Math.min(1, Math.max(0, ch[c](m))) * 255);
    lut[i * 4 + 3] = 255;
  }
  return lut;
}
export function curveIsIdentity(curve) {
  const id = (p) => p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 1 && p[1][1] === 1;
  return id(curve.rgb) && id(curve.r) && id(curve.g) && id(curve.b) && !curve.pHighlights && !curve.pLights && !curve.pDarks && !curve.pShadows;
}

// ---------- color helpers ----------
export function hsv2rgb(h, s, v) {
  const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export function gradingUniforms(g) {
  const one = (r) => {
    const c = hsv2rgb(((r.h % 360) + 360) % 360 / 360, 1, 1), L = lum(c), s = r.s / 100;
    return [(c[0] - L) * s, (c[1] - L) * s, (c[2] - L) * s, r.l / 100];
  };
  return { sh: one(g.shadows), mid: one(g.midtones), hi: one(g.highlights), glob: one(g.global) };
}

// 3x3 calibration matrix (column-major for WebGL) built from primary hue/sat shifts, neutral-preserving.
export function calibMatrix(c) {
  const cols = [[0, c.redHue, c.redSat], [120, c.greenHue, c.greenSat], [240, c.blueHue, c.blueSat]].map(([h0, dh, ds]) => {
    const base = hsv2rgb((((h0 + dh * 0.3) % 360) + 360) % 360 / 360, 1, 1);
    const L = lum(base), s = 1 + ds / 100;
    return base.map((v) => L + (v - L) * s);
  });
  // normalize rows so white stays white
  const M = [[cols[0][0], cols[1][0], cols[2][0]], [cols[0][1], cols[1][1], cols[2][1]], [cols[0][2], cols[1][2], cols[2][2]]];
  for (const row of M) { const s = row[0] + row[1] + row[2]; for (let i = 0; i < 3; i++) row[i] /= s; }
  return [M[0][0], M[1][0], M[2][0], M[0][1], M[1][1], M[2][1], M[0][2], M[1][2], M[2][2]];
}

// ---------- Auto tone & auto white balance from an RGBA buffer of the unedited image ----------
const toLin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export function autoTone(data) {
  const hist = new Float64Array(256); let n = 0, r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += 16) {
    const R = data[i] / 255, G = data[i + 1] / 255, B = data[i + 2] / 255;
    const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    hist[Math.min(255, Math.round(L * 255))]++; n++;
    r += toLin(R); g += toLin(G); b += toLin(B);
  }
  const pct = (p) => { let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= p * n) return i / 255; } return 1; };
  const lo = pct(0.005), hi = pct(0.995), mid = pct(0.5);
  const exposure = Math.max(-2, Math.min(2, Math.log2(toLin(0.45) / Math.max(0.003, toLin(mid))) * 0.7));
  const whites = Math.max(-60, Math.min(60, (0.97 - hi) * 220));
  const blacks = Math.max(-60, Math.min(60, (0.02 - lo) * 400));
  const spread = hi - lo;
  const contrast = Math.max(-30, Math.min(40, (0.75 - spread) * 60));
  const highlights = hi > 0.95 ? -Math.min(70, (pct(0.98) - 0.85) * 300) : -10;
  const shadows = lo < 0.08 ? Math.min(60, (0.12 - pct(0.05)) * 350) : 10;
  return {
    exposure: +exposure.toFixed(2), contrast: Math.round(contrast), highlights: Math.round(Math.max(-80, Math.min(10, highlights))),
    shadows: Math.round(Math.max(-10, Math.min(70, shadows))), whites: Math.round(whites), blacks: Math.round(blacks), vibrance: 12,
    _wb: autoWBFromSums(r / n, g / n, b / n),
  };
}
function autoWBFromSums(r, g, b) {
  let t = (b - r) / (0.3 * (r + b) + 1e-6);
  t = Math.max(-1, Math.min(1, t));
  const r2 = r * (1 + 0.3 * t), b2 = b * (1 - 0.3 * t);
  let ti = (1 - (r2 + b2) / 2 / Math.max(1e-6, g)) / 0.25;
  ti = Math.max(-1, Math.min(1, ti));
  return { temp: Math.round(t * 100), tint: Math.round(ti * 100) };
}
export function autoWB(data) { return autoTone(data)._wb; }

// ---------- built-in presets ----------
const P = (group, name, s) => ({ id: 'builtin:' + group + ':' + name, group, name, builtin: true, settings: s });
const curvePts = (pts) => pts;
export const BUILTIN_PRESETS = [
  P('Color', 'Auto Pop', { contrast: 15, highlights: -30, shadows: 25, whites: 10, blacks: -8, clarity: 12, vibrance: 22, saturation: 4 }),
  P('Color', 'Vivid', { contrast: 22, vibrance: 40, saturation: 12, clarity: 10, dehaze: 6 }),
  P('Color', 'Soft & Bright', { exposure: 0.35, contrast: -15, highlights: -25, shadows: 30, clarity: -8, vibrance: 10, curve: { rgb: curvePts([[0, 0.06], [0.5, 0.53], [1, 0.98]]) } }),
  P('Color', 'Warm Afternoon', { temp: 18, tint: 4, vibrance: 15, grading: { highlights: { h: 45, s: 18, l: 0 }, shadows: { h: 30, s: 8, l: 0 } } }),
  P('Color', 'Cool Breeze', { temp: -16, vibrance: 10, grading: { shadows: { h: 215, s: 15, l: 0 } } }),
  P('Color', 'Deep Landscape', { contrast: 18, highlights: -60, shadows: 40, clarity: 20, dehaze: 15, vibrance: 25, hsl: { sat: [0, 5, 10, 15, 10, 15, 0, 0], lum: [0, 0, 0, -10, 0, -18, 0, 0] } }),
  P('Color', 'Portrait Glow', { exposure: 0.15, contrast: -5, texture: -15, clarity: -10, highlights: -15, shadows: 15, hsl: { sat: [0, -8, 0, 0, 0, 0, 0, 0], lum: [5, 12, 0, 0, 0, 0, 0, 0] } }),
  P('B&W', 'Classic B&W', { profile: 'bw', contrast: 20, clarity: 10 }),
  P('B&W', 'High Contrast B&W', { profile: 'bw', contrast: 50, whites: 25, blacks: -25, clarity: 25, curve: { rgb: curvePts([[0, 0], [0.25, 0.18], [0.75, 0.85], [1, 1]]) } }),
  P('B&W', 'Soft Matte B&W', { profile: 'bw', contrast: -10, curve: { rgb: curvePts([[0, 0.12], [0.5, 0.5], [1, 0.94]]) }, grain: { amount: 20, size: 25, roughness: 50 } }),
  P('B&W', 'Selenium Tone', { profile: 'bw', contrast: 15, grading: { shadows: { h: 280, s: 15, l: 0 }, highlights: { h: 40, s: 8, l: 0 } } }),
  P('Cinematic', 'Teal & Orange', { contrast: 15, highlights: -25, shadows: 10, grading: { shadows: { h: 190, s: 35, l: -5 }, highlights: { h: 35, s: 30, l: 0 }, balance: 10 }, hsl: { hue: [0, -10, 0, 30, 0, -10, 0, 0], sat: [0, 10, -20, -40, 0, 10, -30, -30] } }),
  P('Cinematic', 'Bleach Bypass', { contrast: 35, saturation: -45, clarity: 20, highlights: -20, whites: 10 }),
  P('Cinematic', 'Moody Blue', { exposure: -0.3, temp: -12, contrast: 10, highlights: -40, saturation: -15, grading: { shadows: { h: 215, s: 25, l: -8 }, highlights: { h: 200, s: 10, l: 0 } }, vignette: { amount: -25, midpoint: 40, roundness: 0, feather: 60, highlights: 0 } }),
  P('Cinematic', 'Blockbuster', { contrast: 30, dehaze: 10, clarity: 15, grading: { shadows: { h: 200, s: 40, l: -10 }, highlights: { h: 30, s: 25, l: 5 } }, vignette: { amount: -20, midpoint: 50, roundness: 0, feather: 60, highlights: 0 } }),
  P('Vintage', 'Faded Film', { contrast: -15, curve: { rgb: curvePts([[0, 0.1], [0.25, 0.27], [0.75, 0.75], [1, 0.93]]) }, saturation: -15, grading: { shadows: { h: 210, s: 12, l: 0 }, highlights: { h: 45, s: 15, l: 0 } }, grain: { amount: 25, size: 30, roughness: 60 } }),
  P('Vintage', 'Kodachrome-ish', { contrast: 20, vibrance: 15, temp: 8, hsl: { hue: [5, 0, -5, 10, 0, -5, 0, 0], sat: [20, 10, 15, -10, 0, 15, 0, 0] }, curve: { rgb: curvePts([[0, 0.03], [0.5, 0.5], [1, 0.97]]) } }),
  P('Vintage', 'Polaroid', { exposure: 0.2, contrast: -20, temp: 12, tint: 8, saturation: -10, curve: { rgb: curvePts([[0, 0.12], [1, 0.9]]), b: curvePts([[0, 0.08], [1, 0.92]]) }, vignette: { amount: -15, midpoint: 50, roundness: 20, feather: 70, highlights: 0 } }),
  P('Vintage', 'Cross Process', { contrast: 25, curve: { r: curvePts([[0, 0], [0.3, 0.25], [0.7, 0.8], [1, 1]]), g: curvePts([[0, 0], [0.3, 0.28], [0.7, 0.78], [1, 1]]), b: curvePts([[0, 0.12], [1, 0.85]]) } }),
  P('Creative', 'Golden Hour', { temp: 25, tint: 6, exposure: 0.15, highlights: -20, grading: { highlights: { h: 40, s: 30, l: 0 }, midtones: { h: 30, s: 10, l: 0 } }, vibrance: 15 }),
  P('Creative', 'Night City', { temp: -15, contrast: 20, highlights: -30, clarity: 15, dehaze: 10, grading: { shadows: { h: 230, s: 30, l: 0 }, highlights: { h: 300, s: 15, l: 0 } }, vibrance: 20 }),
  P('Creative', 'Pastel Dream', { exposure: 0.3, contrast: -25, saturation: -10, vibrance: 15, curve: { rgb: curvePts([[0, 0.12], [1, 0.97]]) }, grading: { shadows: { h: 280, s: 15, l: 0 }, highlights: { h: 340, s: 10, l: 0 } } }),
  P('Creative', 'Matte Fade', { curve: { rgb: curvePts([[0, 0.14], [0.3, 0.3], [1, 1]]) }, contrast: 8, saturation: -8 }),
  P('Detail', 'Sharpen - Landscape', { sharpen: { amount: 55, radius: 1, detail: 40, masking: 20 } }),
  P('Detail', 'Sharpen - Portrait', { sharpen: { amount: 35, radius: 1.4, detail: 15, masking: 60 } }),
  P('Detail', 'Noise Reduction - High ISO', { nr: { lum: 45, detail: 50, color: 40 } }),
];

export const ASPECTS = [
  ['original', 'As Shot'], ['free', 'Free'], ['1:1', '1 x 1'], ['4:5', '4 x 5 / 8 x 10'], ['5:7', '5 x 7'], ['2:3', '2 x 3 / 4 x 6'],
  ['3:4', '3 x 4'], ['16:9', '16 x 9'], ['16:10', '16 x 10'], ['1.91:1', '1.91 x 1 (Social)'], ['2.39:1', '2.39 x 1 (Cinema)'], ['8.5:11', '8.5 x 11'],
];
