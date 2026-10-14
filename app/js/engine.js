// WebGL2 non-destructive rendering engine. One instance per canvas.
import { buildCurveLUT, curveIsIdentity, gradingUniforms, calibMatrix, defaultSettings } from './settings.js';

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.,1.); }`;

const COPY = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; out vec4 o;
void main(){ o = texture(uTex, vUv); }`;

const BLUR = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir; uniform float uSigma; out vec4 o;
void main(){
  float s = max(uSigma, 0.3); int R = int(min(ceil(s*3.0), 40.0));
  vec4 acc = vec4(0.); float ws = 0.;
  for (int i=-40;i<=40;i++){ if(i<-R||i>R) continue; float w = exp(-float(i*i)/(2.*s*s)); acc += texture(uTex, vUv + uDir*float(i))*w; ws += w; }
  o = acc/ws;
}`;

const MAIN = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2D uSrc, uBS, uBM, uBL, uCurve;
uniform sampler2DArray uMaskTex;
uniform vec2 uCanvas; uniform vec4 uView; uniform vec3 uBg; uniform vec2 uOut;
uniform vec2 uSrcSize, uOSize; uniform int uRot; uniform vec2 uFlip;
uniform vec4 uCrop; uniform float uAngle; uniform vec4 uKey; uniform float uScale; uniform vec2 uOffset;
uniform float uCA, uLensVig, uRawProf;
uniform vec4 uB0, uB1, uB2; uniform float uSat;
uniform vec4 uSharp; uniform vec3 uNR;
uniform mat3 uCalib; uniform float uShadowTint; uniform int uCalibOn;
uniform vec4 uHue0, uHue1, uHSat0, uHSat1, uHLum0, uHLum1, uBW0, uBW1; uniform int uHSLOn, uBWOn;
uniform vec4 uGS, uGM, uGH, uGG; uniform vec2 uGBlend; uniform int uGradeOn;
uniform int uCurveOn;
uniform vec4 uVig; uniform float uVigHL; uniform vec3 uGrain;
uniform int uClip; uniform int uShowMask; uniform vec3 uMaskColor;
uniform int uSpotN; uniform vec4 uSpot[32]; uniform vec4 uSpot2[32];
uniform int uMaskN; uniform vec4 uMMeta[8]; uniform vec4 uMP0[8], uMP1[8], uMRng[8];
uniform vec4 uMA0[8], uMA1[8], uMA2[8], uMA3[8], uMCol[8];
out vec4 outColor;

vec3 toLin(vec3 c){ c=max(c,0.); return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045,c)); }
vec3 toSrgb(vec3 c){ c=max(c,0.); return mix(c*12.92, 1.055*pow(c,vec3(1./2.4))-0.055, step(0.0031308,c)); }
float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)), d/(q.x+e), q.x); }
vec3 hsv2rgb(vec3 c){ vec4 K=vec4(1.,2./3.,1./3.,3.); vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www); return c.z*mix(K.xxx, clamp(p-K.xxx,0.,1.), c.y); }
float h8(vec4 a, vec4 b, int i){ return i<4 ? a[i] : b[i-4]; }
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }

vec2 oToRaw(vec2 o){
  if(uFlip.x>0.5) o.x = 1.-o.x;
  if(uFlip.y>0.5) o.y = 1.-o.y;
  if(uRot==1) return vec2(o.y, 1.-o.x);
  if(uRot==2) return vec2(1.-o.x, 1.-o.y);
  if(uRot==3) return vec2(1.-o.y, o.x);
  return o;
}
vec2 outToRaw(vec2 p, out bool inside){
  vec2 s = uCrop.xy + p*uCrop.zw;
  vec2 q = (s-0.5)*uOSize;
  float ca=cos(uAngle), sa=sin(uAngle);
  q = vec2(ca*q.x + sa*q.y, -sa*q.x + ca*q.y);
  q.x *= 1. + uKey.x*0.6*(q.y/uOSize.y);
  q.y *= 1. + uKey.y*0.6*(q.x/uOSize.x);
  q.x *= exp2(-uKey.z*0.5);
  q = q/uScale - uOffset*uOSize*0.5;
  float r2 = dot(q,q)/(0.25*dot(uOSize,uOSize));
  q *= 1. + uKey.w*0.18*r2;
  vec2 o = q/uOSize + 0.5;
  inside = o.x>=0. && o.y>=0. && o.x<=1. && o.y<=1.;
  return oToRaw(o);
}
void samp(vec2 r, out vec3 c, out vec3 s, out vec3 m, out vec3 l){
  c = texture(uSrc, r).rgb;
  if(uCA != 0.){ vec2 d = r-0.5; c.r = texture(uSrc, 0.5+d*(1.+uCA*0.003)).r; c.b = texture(uSrc, 0.5+d*(1.-uCA*0.003)).b; }
  s = texture(uBS, r).rgb; m = texture(uBM, r).rgb; l = texture(uBL, r).rgb;
}

// RAW base profile: gentle toe + highlight shoulder that maps ~2.5x sensor white into display range.
vec3 shoulder(vec3 x){ x = max(x, 0.)*1.6; return x*(1. + x/16.)/(1. + x); }
vec3 expo(vec3 enc, float k, float prof){ vec3 lin = toLin(enc)*k; return toSrgb(prof > 0.5 ? shoulder(lin) : lin); }

vec3 basicAdj(vec3 c, vec3 s, vec3 m, vec3 l, vec4 A0, vec4 A1, vec4 A2, float sat, float prof){
  float k = exp2(A0.x);
  vec3 wbm = vec3(1.+0.3*A1.z, 1.-0.25*A1.w, 1.-0.3*A1.z); wbm /= luma(wbm);
  vec3 lin0 = toLin(c)*k*wbm;
  c = toSrgb(prof > 0.5 ? shoulder(lin0) : lin0);
  float Ls = luma(expo(s, k, prof)), Lm = luma(expo(m, k, prof)), Ll = luma(expo(l, k, prof));
  float L = luma(c), L2 = L;
  float mid = 1. - pow(min(abs(2.*L-1.),1.), 2.);
  L2 += A2.x*0.9*(L - Lm) + A2.y*0.8*(Lm - Ll)*mid + A2.y*0.25*(L-Lm)*mid;
  float B = mix(L, Lm, 0.6);
  float hm = smoothstep(0.4, 0.95, B), sm = 1. - smoothstep(0.05, 0.6, B);
  L2 += A0.z * hm * (A0.z < 0. ? 0.6*max(L2-0.3, 0.) : 0.3*max(1.-L2, 0.));
  L2 += A0.w * sm * (A0.w > 0. ? 0.55*max(0.7-L2, 0.) : 0.45*L2);
  float wp = 1. - 0.3*A1.x, bp = -0.12*A1.y;
  L2 = (L2 - bp)/(wp - bp);
  float Lc = clamp(L2, 0., 1.);
  L2 -= A0.y*1.6*Lc*(1.-Lc)*(1.-2.*Lc);
  float ratio = min(L2/max(L, 1e-4), 8.);
  c = mix(c*ratio, c + (L2-L), 0.4);
  if (A2.z > 0.) {
    vec3 mk = expo(m, k, prof);
    float dark = min(mk.r, min(mk.g, mk.b));
    float t = 1. - A2.z*0.65*smoothstep(0., 0.9, dark);
    c = (c - vec3(0.96))/max(t, 0.25) + vec3(0.96);
    c = mix(vec3(luma(c)), c, 1. + A2.z*0.2);
  } else if (A2.z < 0.) {
    c = mix(c, vec3(0.78) + 0.22*c, -A2.z*0.55);
  }
  float Lx = luma(c);
  float mx = max(c.r,max(c.g,c.b)), mn = min(c.r,min(c.g,c.b));
  float cs = clamp((mx-mn)/max(mx,1e-4), 0., 1.);
  float hue = rgb2hsv(clamp(c,0.,1.)).x;
  float skin = 1. - smoothstep(0.03, 0.09, abs(hue - 0.07));
  float vib = A2.w * (1. - cs) * (A2.w > 0. ? (1. - 0.6*skin) : 1.);
  c = mix(vec3(Lx), c, max(0., 1. + sat + vib));
  return c;
}

float maskWeight(int i, vec2 r, vec3 corig){
  vec4 meta = uMMeta[i]; int t = int(meta.x);
  vec4 a = uMP0[i], b = uMP1[i];
  vec2 rp = r*uSrcSize;
  float w = 0.;
  if (t == 1) { vec2 d = a.zw - a.xy; float tt = dot(rp - a.xy, d)/max(dot(d,d), 1e-6); w = 1. - smoothstep(0., 1., clamp(tt, 0., 1.)); }
  else if (t == 2) { vec2 q = rp - a.xy; float ca=cos(b.x), sa=sin(b.x); q = vec2(ca*q.x+sa*q.y, -sa*q.x+ca*q.y)/max(a.zw, vec2(1.)); float rr = length(q); w = 1. - smoothstep(max(1.-b.y, 0.), 1., rr); }
  else if (t == 3) { w = texture(uMaskTex, vec3(r, meta.w)).a; }
  else if (t == 4) { float L = luma(corig); w = smoothstep(a.x - a.z - 1e-4, a.x, L) * (1. - smoothstep(a.y, a.y + a.w + 1e-4, L)); }
  else if (t == 5) { float d = length(corig - a.rgb)*1.2; w = 1. - smoothstep(a.w*0.5, a.w + 1e-4, d); }
  else if (t == 6) { w = 1.; }
  vec4 rg = uMRng[i];
  if (rg.w > 0.5) { float L = luma(corig); w *= smoothstep(rg.x - rg.z - 1e-4, rg.x, L) * (1. - smoothstep(rg.y, rg.y + rg.z + 1e-4, L)); }
  if (meta.y > 0.5) w = 1. - w;
  return clamp(w * meta.z, 0., 1.);
}

void main(){
  vec2 fc = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 p = (fc - uView.xy)/uView.zw;
  if (p.x < 0. || p.y < 0. || p.x > 1. || p.y > 1.) { outColor = vec4(uBg, 1.); return; }
  bool inside;
  vec2 r = outToRaw(p, inside);
  if (!inside) { outColor = vec4(0.,0.,0.,1.); return; }
  vec3 c, s, m, l; samp(r, c, s, m, l);

  for (int i=0;i<32;i++) {
    if (i >= uSpotN) break;
    vec4 a = uSpot[i], b = uSpot2[i];
    float d = length((r - a.xy)*uSrcSize)/max(b.x, 1.);
    if (d < 1.) {
      float w = (1. - smoothstep(max(1.-b.y, 0.), 1., d))*b.z;
      vec3 c2, s2, m2, l2; samp(r + (a.zw - a.xy), c2, s2, m2, l2);
      if (b.w < 0.5) { c2 = c2 - l2 + l; s2 = s2 - l2 + l; m2 = m2 - l2 + l; }
      c = mix(c, c2, w); s = mix(s, s2, w); m = mix(m, m2, w);
    }
  }
  if (uLensVig != 0.) {
    float rr = length((r-0.5)*uSrcSize)/(0.5*length(uSrcSize));
    float g = pow(max(1. + uLensVig*rr*rr*1.2, 0.05), 1./2.2);
    c *= g; s *= g; m *= g; l *= g;
  }
  vec3 corig = c;

  if (uNR.x > 0.) { float th = 0.03 + uNR.y*0.12; float edge = length(c - m); float w = uNR.x*(1. - smoothstep(th*0.3, th, edge)); c = mix(c, mix(s, m, 0.5), w); }
  if (uNR.z > 0.) { float Lc = luma(c); c = Lc + mix(c - Lc, m - luma(m), uNR.z); }
  if (uSharp.x > 0.) {
    float msk = uSharp.z > 0. ? smoothstep(uSharp.z*0.06, uSharp.z*0.06 + 0.03, length(s - l)) : 1.;
    c += ((c - s)*2.5 + (s - m)*(1. - uSharp.y)*0.8) * uSharp.x * msk;
  }
  if (uCalibOn == 1) {
    c = toSrgb(uCalib * toLin(c));
    float sh = pow(1. - clamp(luma(c),0.,1.), 2.);
    c += vec3(0.5, -1., 0.5)*uShadowTint*0.06*sh;
  }

  if (uRawProf > 0.5) corig = toSrgb(shoulder(toLin(corig)));
  c = basicAdj(c, s, m, l, uB0, uB1, uB2, uSat, uRawProf);
  if (uRawProf > 0.5) { s = expo(s, 1., 1.); m = expo(m, 1., 1.); l = expo(l, 1., 1.); }

  float showW = 0.;
  for (int i=0;i<8;i++) {
    if (i >= uMaskN) break;
    float w = maskWeight(i, r, corig);
    if (i == uShowMask) showW = w;
    if (w < 0.002) continue;
    vec4 A3 = uMA3[i];
    vec3 cl = basicAdj(c, s, m, l, uMA0[i], uMA1[i], vec4(uMA2[i].xyz, 0.), uMA2[i].w, 0.);
    if (A3.x > 0.) cl += (c - s)*A3.x*2.5; else if (A3.x < 0.) cl = mix(cl, mix(s, m, 0.5), -A3.x);
    if (A3.y > 0.) cl = mix(cl, mix(s, m, 0.6), A3.y*0.9);
    if (A3.z != 0.) { vec3 hsv = rgb2hsv(clamp(cl,0.,1.)); hsv.x = fract(hsv.x + A3.z*0.1); cl = hsv2rgb(hsv); }
    vec4 tc = uMCol[i];
    if (tc.w > 0.) cl = mix(cl, cl * (tc.rgb / max(luma(tc.rgb), 1e-3)), tc.w*0.6);
    c = mix(c, cl, w);
  }
  if (uShowMask >= 100) showW = 0.;

  c = clamp(c, 0., 1.);
  if (uHSLOn == 1 || uBWOn == 1) {
    vec3 hsv = rgb2hsv(c); float h = hsv.x*360.;
    float CEN[9] = float[9](0., 30., 60., 120., 180., 240., 270., 300., 360.);
    int A = 7; float t = 0.;
    for (int i=0;i<8;i++) { if (h >= CEN[i] && h < CEN[i+1]) { A = i; t = (h - CEN[i])/(CEN[i+1]-CEN[i]); } }
    int Bi = A == 7 ? 0 : A + 1;
    t = smoothstep(0., 1., t);
    float sW = smoothstep(0.0, 0.2, hsv.y);
    if (uBWOn == 1) {
      float mixv = mix(h8(uBW0,uBW1,A), h8(uBW0,uBW1,Bi), t);
      float g = luma(c)*(1. + mixv*0.9*hsv.y);
      c = vec3(clamp(g, 0., 1.));
    } else {
      float hs = mix(h8(uHue0,uHue1,A), h8(uHue0,uHue1,Bi), t);
      float ss = mix(h8(uHSat0,uHSat1,A), h8(uHSat0,uHSat1,Bi), t);
      float ls = mix(h8(uHLum0,uHLum1,A), h8(uHLum0,uHLum1,Bi), t);
      hsv.x = fract(hsv.x + hs*30./360.*sW);
      hsv.y = clamp(hsv.y*(1. + ss*sW), 0., 1.);
      vec3 rgb = hsv2rgb(hsv);
      float L0 = luma(rgb);
      rgb = toSrgb(toLin(rgb)*exp2(ls*1.2*sW*hsv.y));
      c = rgb;
    }
  }
  if (uGradeOn == 1) {
    float L = luma(c);
    float piv = 0.5 - uGBlend.y*0.25; float soft = 0.15 + 0.35*uGBlend.x;
    float ws = 1. - smoothstep(0., piv + soft*0.5, L);
    float wh = smoothstep(piv - soft*0.5, 1., L);
    float wm = clamp(1. - ws - wh, 0., 1.);
    c += uGS.rgb*ws*0.45 + uGM.rgb*wm*0.35 + uGH.rgb*wh*0.45 + uGG.rgb*0.3;
    c += uGS.a*ws*0.2 + uGM.a*wm*0.2 + uGH.a*wh*0.2 + uGG.a*0.15;
    c = clamp(c, 0., 1.);
  }
  if (uCurveOn == 1) {
    vec3 u = c*(255./256.) + 0.5/256.;
    c = vec3(texture(uCurve, vec2(u.r, 0.5)).r, texture(uCurve, vec2(u.g, 0.5)).g, texture(uCurve, vec2(u.b, 0.5)).b);
  }
  if (uVig.x != 0.) {
    vec2 d = (p - 0.5)*2.;
    float aspect = uOut.x/uOut.y;
    float n = 2.;
    if (uVig.z < 0.) n = mix(2., 7., -uVig.z);
    else { if (aspect > 1.) d.x *= mix(1., aspect, uVig.z); else d.y *= mix(1., 1./aspect, uVig.z); }
    float rr = pow(pow(abs(d.x), n) + pow(abs(d.y), n), 1./n);
    float inner = mix(0.15, 1.25, uVig.y), outer = inner + mix(0.05, 1.3, uVig.w);
    float v = smoothstep(inner, outer, rr);
    if (uVig.x < 0.) {
      vec3 dk = toSrgb(toLin(c)*(1. + uVig.x*v));
      c = mix(dk, c, uVigHL*smoothstep(0.6, 1., luma(c)));
    } else c = mix(c, vec3(1.), uVig.x*v);
  }
  if (uGrain.x > 0.) {
    float freq = 2.2 / mix(0.25, 3.0, uGrain.y);
    vec2 gp = p*vec2(uOut.x/uOut.y, 1.)*900.*freq/2.2;
    float n = mix(vnoise(gp), vnoise(gp*2.7 + 13.1), uGrain.z) - 0.5;
    float L = luma(c);
    c += n*uGrain.x*0.28*(1. - abs(L - 0.5));
  }
  c = clamp(c, 0., 1.);
  if (uClip == 1) {
    if (max(c.r, max(c.g, c.b)) >= 0.999) c = vec3(1., 0.1, 0.1);
    else if (max(c.r, max(c.g, c.b)) <= 0.004) c = vec3(0.15, 0.35, 1.);
  }
  if (uShowMask >= 0) c = mix(c, uMaskColor, showW*0.6);
  outColor = vec4(c, 1.);
}`;

function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const cache = new Map();
  p.u = (n) => { if (!cache.has(n)) cache.set(n, gl.getUniformLocation(p, n)); return cache.get(n); };
  return p;
}

export const MASK_LAYERS = 8;
export const MASK_TYPE = { linear: 1, radial: 2, raster: 3, luminance: 4, color: 5, all: 6 };
export const rasterKinds = new Set(['brush', 'subject', 'sky', 'object', 'semantic', 'background']);

export class Engine {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.floatOK = !!gl.getExtension('EXT_color_buffer_float'); // float render targets keep RAW highlight headroom
    gl.getExtension('OES_texture_float_linear');
    this.pMain = compile(gl, VERT, MAIN);
    this.pBlur = compile(gl, VERT, BLUR);
    this.pCopy = compile(gl, VERT, COPY);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.curveTex = this._tex(256, 1, null, gl.LINEAR);
    this.lastCurve = '';
    this.maskTex = gl.createTexture();
    this.srcTex = null; this.W = 0; this.H = 0;
    this.bs = this.bm = this.bl = null;
    this.sharpRadius = -1;
    this.bg = opts.bg || [0.18, 0.18, 0.18];
    this.maskW = 1; this.maskH = 1;
    this.layerOf = new Map();
  }

  _tex(w, h, data, filter, float = false) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (float && this.floatOK) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  _target(w, h, float = true) {
    const gl = this.gl, tex = this._tex(w, h, null, gl.LINEAR, float), fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }
  _free(t) { if (!t) return; this.gl.deleteTexture(t.tex); this.gl.deleteFramebuffer(t.fb); }

  // source: ImageBitmap | HTMLImageElement | HTMLCanvasElement
  setSource(img) {
    const gl = this.gl;
    let w = img.width, h = img.height;
    this.isRaw = !!img.raw;
    if (img.data) { // half/full float pixel source (RAW decode or AI-denoised image)
      if (this.srcTex) gl.deleteTexture(this.srcTex);
      this.srcTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, img.half ? gl.HALF_FLOAT : gl.FLOAT, img.data);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      if (this.floatOK) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
      else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this._afterSource(w, h);
      return;
    }
    if (Math.max(w, h) > this.maxTex) {
      const k = this.maxTex / Math.max(w, h);
      const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); img = c; w = c.width; h = c.height;
    }
    if (this.srcTex) gl.deleteTexture(this.srcTex);
    this.srcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._afterSource(w, h);
  }
  _afterSource(w, h) {
    const gl = this.gl;
    this.W = w; this.H = h;
    this.refScale = Math.max(w, h) / 2560;
    this._buildBlurs(1);
    // mask layers (raw space)
    const k = Math.min(1, 1024 / Math.max(w, h));
    this.maskW = Math.max(1, Math.round(w * k)); this.maskH = Math.max(1, Math.round(h * k));
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.maskTex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, this.maskW, this.maskH, MASK_LAYERS, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.layerOf = new Map(); // mask id -> texture layer
    this.ready = true;
  }

  _blurInto(srcTex, w, h, sigma) {
    const gl = this.gl;
    const a = this._target(w, h), b = this._target(w, h);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.pCopy);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(this.pCopy.u('uTex'), 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.useProgram(this.pBlur);
    gl.uniform1i(this.pBlur.u('uTex'), 0); gl.uniform1f(this.pBlur.u('uSigma'), sigma);
    gl.bindTexture(gl.TEXTURE_2D, a.tex); gl.uniform2f(this.pBlur.u('uDir'), 1 / w, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindTexture(gl.TEXTURE_2D, b.tex); gl.uniform2f(this.pBlur.u('uDir'), 0, 1 / h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._free(b);
    return a;
  }
  _buildBlurs(radius) {
    const { W, H } = this, long = Math.max(W, H);
    this._free(this.bs); this._free(this.bm); this._free(this.bl);
    this.bs = this._blurInto(this.srcTex, W, H, Math.max(0.5, radius * this.refScale));
    const fm = Math.max(1, long / 1280);
    this.bm = this._blurInto(this.srcTex, Math.max(1, Math.round(W / fm)), Math.max(1, Math.round(H / fm)), 3);
    const fl = Math.max(1, long / 320);
    this.bl = this._blurInto(this.srcTex, Math.max(1, Math.round(W / fl)), Math.max(1, Math.round(H / fl)), 8);
    this.sharpRadius = radius;
  }

  setMaskLayer(layer, canvas) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.maskTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, this.maskW, this.maskH, 1, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  orientedSize(s) { return s.orient.rot % 2 ? [this.H, this.W] : [this.W, this.H]; }
  // output (cropped) size in source pixels
  outputSize(s, ignoreCrop = false) {
    const [oW, oH] = this.orientedSize(s);
    return ignoreCrop ? [oW, oH] : [Math.max(1, oW * s.crop.w), Math.max(1, oH * s.crop.h)];
  }

  // opts: { view:[x,y,w,h] canvas px, before, showMask, clipping, ignoreCrop, maskColor, target:{fb,w,h} }
  render(s, opts = {}) {
    if (!this.ready) return;
    const gl = this.gl, p = this.pMain, U = (n) => p.u(n);
    if (Math.abs((s.sharpen?.radius ?? 1) - this.sharpRadius) > 1e-3 && !opts.before) this._buildBlurs(s.sharpen.radius);
    const cw = opts.target ? opts.target.w : this.canvas.width, ch = opts.target ? opts.target.h : this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, opts.target ? opts.target.fb : null);
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(p);
    const texs = [this.srcTex, this.bs.tex, this.bm.tex, this.bl.tex, this.curveTex];
    ['uSrc', 'uBS', 'uBM', 'uBL', 'uCurve'].forEach((n, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, texs[i]); gl.uniform1i(U(n), i); });
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.maskTex); gl.uniform1i(U('uMaskTex'), 5);

    const geo = s;
    if (opts.before) s = { ...defaultSettings(), crop: geo.crop, orient: geo.orient };
    const crop = opts.ignoreCrop ? { x: 0, y: 0, w: 1, h: 1 } : s.crop;
    const [oW, oH] = this.orientedSize(s);
    const view = opts.view || [0, 0, cw, ch];
    gl.uniform2f(U('uCanvas'), cw, ch);
    gl.uniform4f(U('uView'), view[0], view[1], view[2], view[3]);
    gl.uniform3fv(U('uBg'), opts.bg || this.bg);
    gl.uniform2f(U('uOut'), oW * crop.w, oH * crop.h);
    gl.uniform2f(U('uSrcSize'), this.W, this.H);
    gl.uniform2f(U('uOSize'), oW, oH);
    gl.uniform1i(U('uRot'), s.orient.rot | 0);
    gl.uniform2f(U('uFlip'), s.orient.flipH ? 1 : 0, s.orient.flipV ? 1 : 0);
    gl.uniform4f(U('uCrop'), crop.x, crop.y, crop.w, crop.h);
    const T = s.transform;
    gl.uniform1f(U('uAngle'), ((s.crop.angle || 0) + (T.rotate || 0)) * Math.PI / 180);
    gl.uniform4f(U('uKey'), T.vertical / 100, T.horizontal / 100, T.aspect / 100, s.lens.distortion / 100);
    gl.uniform1f(U('uScale'), T.scale / 100);
    gl.uniform2f(U('uOffset'), T.x / 100, T.y / 100);
    gl.uniform1f(U('uCA'), s.lens.ca / 100);
    gl.uniform1f(U('uLensVig'), s.lens.vignette / 100);
    gl.uniform1f(U('uRawProf'), this.isRaw ? 1 : 0);

    gl.uniform4f(U('uB0'), s.exposure, s.contrast / 100, s.highlights / 100, s.shadows / 100);
    gl.uniform4f(U('uB1'), s.whites / 100, s.blacks / 100, s.temp / 100, s.tint / 100);
    gl.uniform4f(U('uB2'), s.texture / 100, s.clarity / 100, s.dehaze / 100, s.vibrance / 100);
    gl.uniform1f(U('uSat'), s.saturation / 100);
    gl.uniform4f(U('uSharp'), s.sharpen.amount / 150, s.sharpen.detail / 100, s.sharpen.masking / 100, 0);
    gl.uniform3f(U('uNR'), s.nr.lum / 100, s.nr.detail / 100, s.nr.color / 100);

    const cal = s.calib, calOn = cal.shadowTint || cal.redHue || cal.redSat || cal.greenHue || cal.greenSat || cal.blueHue || cal.blueSat;
    gl.uniform1i(U('uCalibOn'), calOn ? 1 : 0);
    if (calOn) { gl.uniformMatrix3fv(U('uCalib'), false, calibMatrix(cal)); gl.uniform1f(U('uShadowTint'), cal.shadowTint / 100); }

    const hs = s.hsl, n8 = (a) => a.map((v) => v / 100);
    const hslOn = s.profile !== 'bw' && [...hs.hue, ...hs.sat, ...hs.lum].some((v) => v);
    gl.uniform1i(U('uHSLOn'), hslOn ? 1 : 0);
    gl.uniform1i(U('uBWOn'), s.profile === 'bw' ? 1 : 0);
    const set8 = (n, arr) => { const a = n8(arr); gl.uniform4f(U(n + '0'), a[0], a[1], a[2], a[3]); gl.uniform4f(U(n + '1'), a[4], a[5], a[6], a[7]); };
    set8('uHue', hs.hue); set8('uHSat', hs.sat); set8('uHLum', hs.lum); set8('uBW', s.bwMix);

    const g = s.grading, gOn = [g.shadows, g.midtones, g.highlights, g.global].some((r) => r.s || r.l);
    gl.uniform1i(U('uGradeOn'), gOn ? 1 : 0);
    if (gOn) {
      const gu = gradingUniforms(g);
      gl.uniform4fv(U('uGS'), gu.sh); gl.uniform4fv(U('uGM'), gu.mid); gl.uniform4fv(U('uGH'), gu.hi); gl.uniform4fv(U('uGG'), gu.glob);
      gl.uniform2f(U('uGBlend'), g.blending / 100, g.balance / 100);
    }
    const curveOn = !curveIsIdentity(s.curve);
    gl.uniform1i(U('uCurveOn'), curveOn ? 1 : 0);
    if (curveOn) {
      const key = JSON.stringify(s.curve);
      if (key !== this.lastCurve) {
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, buildCurveLUT(s.curve));
        this.lastCurve = key;
      }
    }
    const v = s.vignette;
    gl.uniform4f(U('uVig'), v.amount / 100, v.midpoint / 100, v.roundness / 100, v.feather / 100);
    gl.uniform1f(U('uVigHL'), v.highlights / 100);
    gl.uniform3f(U('uGrain'), s.grain.amount / 100, s.grain.size / 100, s.grain.roughness / 100);
    gl.uniform1i(U('uClip'), opts.clipping ? 1 : 0);

    // spots
    const spots = (opts.hideSpots ? [] : s.spots).slice(0, 32);
    const sp1 = new Float32Array(128), sp2 = new Float32Array(128);
    const long = Math.max(this.W, this.H);
    spots.forEach((q, i) => { sp1.set([q.x, q.y, q.sx, q.sy], i * 4); sp2.set([q.r * long, q.feather ?? 0.5, q.opacity ?? 1, q.mode === 'clone' ? 1 : 0], i * 4); });
    gl.uniform1i(U('uSpotN'), spots.length);
    gl.uniform4fv(U('uSpot[0]'), sp1); gl.uniform4fv(U('uSpot2[0]'), sp2);

    // masks
    const masks = s.masks.filter((m) => m.enabled !== false).slice(0, 8);
    const meta = new Float32Array(32), p0 = new Float32Array(32), p1 = new Float32Array(32), rng = new Float32Array(32);
    const a0 = new Float32Array(32), a1 = new Float32Array(32), a2 = new Float32Array(32), a3 = new Float32Array(32), col = new Float32Array(32);
    let showIdx = -1;
    masks.forEach((m, i) => {
      const W = this.W, H = this.H;
      let type = 0, layer = 0;
      if (m.kind === 'linear' && !m.linear) type = 0;
      else if (m.kind === 'radial' && !m.radial) type = 0;
      else if (m.kind === 'linear') { type = 1; p0.set([m.linear.x0 * W, m.linear.y0 * H, m.linear.x1 * W, m.linear.y1 * H], i * 4); }
      else if (m.kind === 'radial') { const r = m.radial; type = 2; p0.set([r.cx * W, r.cy * H, r.rx * long, r.ry * long], i * 4); p1.set([r.angle || 0, r.feather ?? 0.5, 0, 0], i * 4); }
      else if (m.kind === 'luminance') { type = 4; const r = m.range; p0.set([r.lo, r.hi, r.smooth, r.smooth], i * 4); }
      else if (m.kind === 'color') { type = 5; const c = m.color; p0.set([c.r, c.g, c.b, c.tol], i * 4); }
      else if (m.kind === 'all') type = 6;
      else if (rasterKinds.has(m.kind)) { type = 3; layer = this.layerOf.get(m.id) ?? 0; }
      meta.set([type, m.invert && type ? 1 : 0, (m.amount ?? 100) / 100, layer], i * 4);
      const rf = m.refine;
      if (rf && rf.on) rng.set([rf.lo, rf.hi, rf.smooth, 1], i * 4);
      const A = m.adj;
      a0.set([A.exposure, A.contrast / 100, A.highlights / 100, A.shadows / 100], i * 4);
      a1.set([A.whites / 100, A.blacks / 100, A.temp / 100, A.tint / 100], i * 4);
      a2.set([A.texture / 100, A.clarity / 100, A.dehaze / 100, A.saturation / 100], i * 4);
      a3.set([A.sharpness / 100, A.noise / 100, A.hue / 100, 0], i * 4);
      if (A.colorS > 0) {
        const h = A.colorH / 360, c = [0, 0, 0];
        for (let k = 0; k < 3; k++) { const x = Math.abs(((h * 6 + [0, 4, 2][k]) % 6) - 3) - 1; c[k] = Math.min(1, Math.max(0, x)); }
        col.set([c[0], c[1], c[2], A.colorS / 100], i * 4);
      }
      if (opts.showMask && m.id === opts.showMask) showIdx = i;
    });
    gl.uniform1i(U('uMaskN'), opts.before ? 0 : masks.length);
    gl.uniform4fv(U('uMMeta[0]'), meta); gl.uniform4fv(U('uMP0[0]'), p0); gl.uniform4fv(U('uMP1[0]'), p1); gl.uniform4fv(U('uMRng[0]'), rng);
    gl.uniform4fv(U('uMA0[0]'), a0); gl.uniform4fv(U('uMA1[0]'), a1); gl.uniform4fv(U('uMA2[0]'), a2); gl.uniform4fv(U('uMA3[0]'), a3); gl.uniform4fv(U('uMCol[0]'), col);
    gl.uniform1i(U('uShowMask'), showIdx);
    gl.uniform3fv(U('uMaskColor'), opts.maskColor || [1, 0.15, 0.15]);
    if (opts.scissor) { gl.enable(gl.SCISSOR_TEST); const [x, y, w, h] = opts.scissor; gl.scissor(x, ch - y - h, w, h); }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Render the full output into a small offscreen buffer and return RGBA pixels (for histograms / stats).
  readOutput(s, maxSide = 256, opts = {}) {
    const [ow, oh] = this.outputSize(s, opts.ignoreCrop);
    const k = maxSide / Math.max(ow, oh);
    const w = Math.max(1, Math.round(ow * k)), h = Math.max(1, Math.round(oh * k));
    if (!this._small || this._small.w !== w || this._small.h !== h) { this._free(this._small); this._small = this._target(w, h, false); }
    this.render(s, { ...opts, target: this._small, view: [0, 0, w, h] });
    const gl = this.gl, px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._small.fb);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { data: px, w, h };
  }

  // Resize the canvas to an exact output size and render the full image into it (export / thumbnails).
  renderFull(s, w, h) {
    const TILE = 4096;
    if (w <= TILE && h <= TILE) {
      this.canvas.width = w; this.canvas.height = h;
      if (this.gl.drawingBufferWidth === w && this.gl.drawingBufferHeight === h) {
        this.render(s, { view: [0, 0, w, h] });
        return this.canvas;
      }
    }
    // Tiled render for very large outputs (drawing buffer limits).
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    const tw = Math.min(TILE, w), th = Math.min(TILE, h);
    this.canvas.width = tw; this.canvas.height = th;
    for (let ty = 0; ty < h; ty += th) {
      for (let tx = 0; tx < w; tx += tw) {
        this.render(s, { view: [-tx, -ty, w, h] });
        ctx.drawImage(this.canvas, tx, ty);
      }
    }
    return out;
  }

  destroy() {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }
}

// ---------- geometry helpers mirrored from the shader (for overlays) ----------
export function geomOutToRaw(s, W, H, px, py, ignoreCrop = false) {
  const rot = s.orient.rot | 0;
  const oW = rot % 2 ? H : W, oH = rot % 2 ? W : H;
  const c = ignoreCrop ? { x: 0, y: 0, w: 1, h: 1 } : s.crop;
  let qx = (c.x + px * c.w - 0.5) * oW, qy = (c.y + py * c.h - 0.5) * oH;
  const T = s.transform, a = ((s.crop.angle || 0) + (T.rotate || 0)) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  [qx, qy] = [ca * qx + sa * qy, -sa * qx + ca * qy];
  qx *= 1 + (T.vertical / 100) * 0.6 * (qy / oH);
  qy *= 1 + (T.horizontal / 100) * 0.6 * (qx / oW);
  qx *= Math.pow(2, -(T.aspect / 100) * 0.5);
  const sc = T.scale / 100;
  qx = qx / sc - (T.x / 100) * oW * 0.5; qy = qy / sc - (T.y / 100) * oH * 0.5;
  const r2 = (qx * qx + qy * qy) / (0.25 * (oW * oW + oH * oH)), f = 1 + (s.lens.distortion / 100) * 0.18 * r2;
  qx *= f; qy *= f;
  let ox = qx / oW + 0.5, oy = qy / oH + 0.5;
  if (s.orient.flipH) ox = 1 - ox;
  if (s.orient.flipV) oy = 1 - oy;
  if (rot === 1) return [oy, 1 - ox];
  if (rot === 2) return [1 - ox, 1 - oy];
  if (rot === 3) return [1 - oy, ox];
  return [ox, oy];
}
// Numeric inverse (Newton) — raw uv → output p.
export function geomRawToOut(s, W, H, rx, ry, ignoreCrop = false) {
  let px = 0.5, py = 0.5;
  for (let it = 0; it < 12; it++) {
    const [fx, fy] = geomOutToRaw(s, W, H, px, py, ignoreCrop);
    const e = 1e-4;
    const [ax, ay] = geomOutToRaw(s, W, H, px + e, py, ignoreCrop);
    const [bx, by] = geomOutToRaw(s, W, H, px, py + e, ignoreCrop);
    const j00 = (ax - fx) / e, j10 = (ay - fy) / e, j01 = (bx - fx) / e, j11 = (by - fy) / e;
    const det = j00 * j11 - j01 * j10;
    if (Math.abs(det) < 1e-12) break;
    const dx = rx - fx, dy = ry - fy;
    px += (j11 * dx - j01 * dy) / det; py += (-j10 * dx + j00 * dy) / det;
    if (Math.abs(dx) + Math.abs(dy) < 1e-7) break;
  }
  return [px, py];
}
