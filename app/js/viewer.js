// The main image viewer (Loupe in Library, canvas in Develop): zoom, pan, before/after, tool overlays, histogram.
import { Engine, geomOutToRaw, geomRawToOut } from './engine.js';
import { loadSource, thumbUrl } from './imaging.js';
import { verifySession } from './api.js';
import { syncMaskLayers, invalidateLayers } from './maskraster.js';
import { emit, getSettings } from './store.js';
import { $, throttleRAF, toast } from './ui.js';

class Viewer {
  constructor() {
    this.canvas = $('#loupe-canvas');
    this.overlay = $('#overlay-canvas');
    this.octx = this.overlay.getContext('2d');
    this.engine = new Engine(this.canvas, { bg: [0.184, 0.184, 0.184] });
    this.photo = null; this.s = null;
    this.zoom = 'fit'; this.pan = [0, 0];
    this.before = 'off'; // off | full | split
    this.clipping = false; this.showMask = null; this.tool = null;
    this.ignoreCrop = false;
    this.fullRes = false; this.loadToken = 0;
    this.requestRender = throttleRAF(() => this._render());
    this.histo = throttleRAF(() => this._histogram());
    this._histTimer = 0;
    new ResizeObserver(() => this.requestRender()).observe(this.canvas);
    this._bindPointer();
  }

  async show(p, settings) {
    const token = ++this.loadToken;
    const changed = !this.photo || this.photo.id !== p.id || !this.engine.ready;
    this.photo = p; this.s = settings || getSettings(p);
    if (changed) {
      this.zoom = 'fit'; this.pan = [0, 0]; this.fullRes = false;
      let bmp;
      const slow = setTimeout(() => this._placeholder(p), 120);
      try { bmp = await loadSource(p); }
      catch (e) {
        clearTimeout(slow); this._placeholder(null);
        if (await verifySession()) toast(`Cannot load ${p.name}: ${e.message}`, true);
        return;
      }
      clearTimeout(slow);
      if (token !== this.loadToken) return;
      this._placeholder(null);
      this.engine.setSource(bmp);
      invalidateLayers(this.engine);
    }
    await syncMaskLayers(this.engine, this.s);
    if (token !== this.loadToken) return;
    this.requestRender();
    setTimeout(() => { if (token === this.loadToken) this._histogram(); }, 300);
  }
  // Re-read the current photo's source (e.g. after AI Denoise changed it), keeping zoom & pan.
  async reloadSource() {
    const p = this.photo; if (!p) return;
    const token = ++this.loadToken, zoom = this.zoom, pan = this.pan;
    const full = this.fullRes;
    const img = await loadSource(p, { full });
    if (token !== this.loadToken) return;
    this.engine.setSource(img);
    invalidateLayers(this.engine);
    await syncMaskLayers(this.engine, this.s);
    this.zoom = zoom; this.pan = pan;
    this.requestRender();
  }
  // Shows the (edited) thumbnail while a RAW file is being decoded.
  _placeholder(p) {
    let ph = document.getElementById('loupe-ph');
    if (!p) { if (ph) ph.remove(); return; }
    if (!ph) {
      ph = document.createElement('div'); ph.id = 'loupe-ph';
      ph.style.cssText = 'position:absolute;inset:24px;display:flex;align-items:center;justify-content:center;z-index:1;pointer-events:none;background:#2f2f2f';
      ph.innerHTML = '<img style="max-width:100%;max-height:100%;filter:blur(1px)"><div style="position:absolute;bottom:8px;right:10px;background:#000a;color:#ddd;padding:3px 10px;border-radius:10px;font-size:12px">Decoding RAW…</div>';
      this.canvas.parentElement.append(ph);
    }
    ph.querySelector('img').src = thumbUrl(p);
    ph.lastChild.style.display = p.raw ? '' : 'none';
  }
  setSettings(s, { masks = false } = {}) {
    this.s = s;
    if (masks) syncMaskLayers(this.engine, s).then(() => this.requestRender());
    else this.requestRender();
  }
  clear() { this.photo = null; this.s = null; this.loadToken++; const gl = this.engine.gl; gl.clearColor(0.184, 0.184, 0.184, 1); gl.clear(gl.COLOR_BUFFER_BIT); this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height); }

  // ----- geometry -----
  _size() {
    const dpr = devicePixelRatio || 1, r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    if (this.overlay.width !== w || this.overlay.height !== h) { this.overlay.width = w; this.overlay.height = h; }
    return [w, h, dpr];
  }
  origScale() { // original pixels per texture pixel
    const p = this.photo; if (!p || !p.w) return 1;
    return Math.max(p.w, p.h) / Math.max(this.engine.W, this.engine.H);
  }
  fitScale() {
    const [cw, ch] = this._size();
    const [ow, oh] = this.engine.outputSize(this.s, this.ignoreCrop);
    const pad = this.tool?.pad ?? 24 * (devicePixelRatio || 1);
    return Math.min((cw - 2 * pad) / ow, (ch - 2 * pad) / oh);
  }
  // device px per texture px
  scale() {
    const [cw, ch, dpr] = this._size();
    if (this.zoom === 'fit') return this.fitScale();
    if (this.zoom === 'fill') { const [ow, oh] = this.engine.outputSize(this.s, this.ignoreCrop); return Math.max(cw / ow, ch / oh); }
    return this.zoom * dpr * this.origScale();
  }
  // Side-by-side before/after: each half of the canvas shows the whole photo, fitted.
  // Returns [beforeView, afterView, splitX]; view() reports the "after" one so tools and masks line up with it.
  sideViews() {
    const [cw, ch, dpr] = this._size();
    const [ow, oh] = this.engine.outputSize(this.s, this.ignoreCrop);
    const gap = Math.round(14 * dpr), pad = 18 * dpr, half = (cw - gap) / 2;
    const sc = Math.min((half - 2 * pad) / ow, (ch - 2 * pad - 22 * dpr) / oh), w = ow * sc, h = oh * sc;
    const y = (ch - h) / 2 + 10 * dpr; // a little room above for the labels
    return [[(half - w) / 2, y, w, h], [half + gap + (half - w) / 2, y, w, h], Math.round(half + gap / 2)];
  }
  view() {
    if (this.before === 'side' && this.s) return this.sideViews()[1];
    const [cw, ch] = this._size();
    const [ow, oh] = this.engine.outputSize(this.s, this.ignoreCrop);
    const sc = this.scale(), w = ow * sc, h = oh * sc;
    let x = (cw - w) / 2 + this.pan[0], y = (ch - h) / 2 + this.pan[1];
    if (this.zoom !== 'fit') { // clamp panning
      if (w > cw) x = Math.min(0, Math.max(cw - w, x)); else x = (cw - w) / 2;
      if (h > ch) y = Math.min(0, Math.max(ch - h, y)); else y = (ch - h) / 2;
      this.pan = [x - (cw - w) / 2, y - (ch - h) / 2];
    }
    return [x, y, w, h];
  }
  // client (CSS) coords -> output normalized p
  clientToOut(cx, cy) {
    const r = this.canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const [x, y, w, h] = this.view();
    return [((cx - r.left) * dpr - x) / w, ((cy - r.top) * dpr - y) / h];
  }
  outToCanvas(px, py) { const [x, y, w, h] = this.view(); return [x + px * w, y + py * h]; }
  clientToRaw(cx, cy) { const [px, py] = this.clientToOut(cx, cy); return geomOutToRaw(this.s, this.engine.W, this.engine.H, px, py, this.ignoreCrop); }
  rawToCanvas(rx, ry) { const [px, py] = geomRawToOut(this.s, this.engine.W, this.engine.H, rx, ry, this.ignoreCrop); return this.outToCanvas(px, py); }
  rawPxScale() { // canvas px per raw texture px (approx, ignores transforms)
    return this.scale() * (this.ignoreCrop ? 1 : 1);
  }

  // ----- zoom -----
  setZoom(z, anchorClient) {
    const [cw, ch] = this._size();
    const before = this.view();
    const ax = anchorClient ? (anchorClient[0] - this.canvas.getBoundingClientRect().left) * devicePixelRatio : cw / 2;
    const ay = anchorClient ? (anchorClient[1] - this.canvas.getBoundingClientRect().top) * devicePixelRatio : ch / 2;
    const fx = (ax - before[0]) / before[2], fy = (ay - before[1]) / before[3];
    this.zoom = z;
    if (z === 'fit') this.pan = [0, 0];
    else {
      const [ow, oh] = this.engine.outputSize(this.s, this.ignoreCrop);
      const sc = this.scale(), w = ow * sc, h = oh * sc;
      this.pan = [ax - fx * w - (cw - w) / 2, ay - fy * h - (ch - h) / 2];
      if (typeof z === 'number' && z * this.origScale() > 0.9 && !this.fullRes && this.photo) this._loadFull();
    }
    emit('zoom', z);
    this.requestRender();
  }
  toggleZoom(anchor) { this.setZoom(this.zoom === 'fit' ? 1 : 'fit', anchor); }
  async _loadFull() {
    const p = this.photo, token = this.loadToken;
    this.fullRes = true;
    try {
      if (p.raw) toast('Loading full-resolution RAW…', false, 1800);
      const img = await loadSource(p, { full: true });
      if (token !== this.loadToken || this.photo !== p) return;
      const z = this.zoom, pan = this.pan, os = this.origScale();
      this.engine.setSource(img);
      invalidateLayers(this.engine);
      await syncMaskLayers(this.engine, this.s);
      // keep the same on-screen magnification
      if (typeof z === 'number') { this.zoom = z; this.pan = pan; }
      this.requestRender();
    } catch (e) { console.warn('full res', e); }
  }

  // ----- rendering -----
  _render() {
    if (!this.photo || !this.engine.ready || !this.s) return;
    const [cw, ch] = this._size();
    const view = this.view();
    const opts = { view, clipping: this.clipping, showMask: this.showMask, ignoreCrop: this.ignoreCrop, maskColor: this.maskColor, hideSpots: this.hideSpots };
    if (this.before === 'full') this.engine.render(this.s, { ...opts, before: true, showMask: null });
    else if (this.before === 'split') {
      const mid = Math.round(cw / 2);
      this.engine.render(this.s, { ...opts, before: true, showMask: null, scissor: [0, 0, mid, ch] });
      this.engine.render(this.s, { ...opts, scissor: [mid, 0, cw - mid, ch] });
    } else if (this.before === 'side') {
      const [bv, av, mid] = this.sideViews();
      this.engine.render(this.s, { ...opts, view: bv, before: true, showMask: null, scissor: [0, 0, mid, ch] });
      this.engine.render(this.s, { ...opts, view: av, scissor: [mid, 0, cw - mid, ch] });
    } else this.engine.render(this.s, opts);
    this._overlay();
    clearTimeout(this._histTimer);
    this._histTimer = setTimeout(() => this._histogram(), 90);
  }
  _overlay() {
    const c = this.octx;
    c.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (this.before === 'split') {
      const x = this.overlay.width / 2;
      c.fillStyle = '#ddd'; c.fillRect(x - 1, 0, 2, this.overlay.height);
      c.font = `${12 * devicePixelRatio}px Segoe UI`; c.fillStyle = '#fff'; c.shadowColor = '#000'; c.shadowBlur = 4;
      c.fillText('Before', x - 60 * devicePixelRatio, 20 * devicePixelRatio); c.fillText('After', x + 14 * devicePixelRatio, 20 * devicePixelRatio);
      c.shadowBlur = 0;
    }
    if (this.before === 'side' && this.s) {
      const [bv, av] = this.sideViews(), dpr = devicePixelRatio || 1;
      c.font = `600 ${13 * dpr}px Segoe UI`; c.fillStyle = '#e6e6e6'; c.textAlign = 'center';
      c.fillText('Before', bv[0] + bv[2] / 2, bv[1] - 9 * dpr); c.fillText('After', av[0] + av[2] / 2, av[1] - 9 * dpr);
      c.textAlign = 'start';
    }
    if (this.tool?.draw) this.tool.draw(c, this);
  }
  _histogram() {
    if (!this.photo || !this.engine.ready) return;
    const { data } = this.engine.readOutput(this.s, 256, { before: this.before === 'full' });
    const r = new Float32Array(256), g = new Float32Array(256), b = new Float32Array(256), l = new Float32Array(256);
    let clipHi = 0, clipLo = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      r[data[i]]++; g[data[i + 1]]++; b[data[i + 2]]++;
      l[Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])]++;
      if (data[i] > 253 || data[i + 1] > 253 || data[i + 2] > 253) clipHi++;
      if (data[i] < 2 && data[i + 1] < 2 && data[i + 2] < 2) clipLo++;
      n++;
    }
    emit('histogram', { r, g, b, l, clipHi: clipHi / n, clipLo: clipLo / n });
  }

  // pixel color under cursor (output space) for the histogram readout
  sampleAt(cx, cy) {
    const r = this.canvas.getBoundingClientRect(), dpr = devicePixelRatio;
    const x = Math.round((cx - r.left) * dpr), y = Math.round((cy - r.top) * dpr);
    const gl = this.engine.gl, px = new Uint8Array(4);
    gl.readPixels(x, this.canvas.height - y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }

  // ----- pointer handling (tools get first dibs) -----
  _bindPointer() {
    const ov = this.overlay;
    let panning = null;
    ov.addEventListener('pointerdown', (e) => {
      if (!this.photo) return;
      ov.setPointerCapture(e.pointerId);
      let pass = !this.tool;
      if (this.tool && !this.spaceDown && e.button === 0 && this.tool.down) {
        if (this.tool.down(e, this) !== false) { this._toolActive = true; return; }
        pass = true; // the tool declined this click → behave like normal zoom/pan
      }
      if (e.button === 0 || e.button === 1) panning = { x: e.clientX, y: e.clientY, pan: [...this.pan], moved: false, pass };
    });
    ov.addEventListener('pointermove', (e) => {
      if (this._toolActive) { this.tool.move && this.tool.move(e, this); return; }
      if (panning) {
        const dx = (e.clientX - panning.x) * devicePixelRatio, dy = (e.clientY - panning.y) * devicePixelRatio;
        if (Math.abs(dx) + Math.abs(dy) > 3) panning.moved = true;
        if (this.zoom !== 'fit') { this.pan = [panning.pan[0] + dx, panning.pan[1] + dy]; this.requestRender(); }
        return;
      }
      if (this.tool?.hover) this.tool.hover(e, this);
      if (this.tool?.cursorAt && !this.spaceDown) ov.style.cursor = this.tool.cursorAt(e, this) || this.tool.cursor || ''; // handle-specific cursors
      this.lastMouse = [e.clientX, e.clientY];
      emit('pixel', e);
    });
    const up = (e) => {
      if (this._toolActive) { this._toolActive = false; this.tool?.up && this.tool.up(e, this); return; }
      if (panning && !panning.moved && e.button === 0 && (!this.tool || panning.pass)) this.toggleZoom([e.clientX, e.clientY]);
      else if (panning && !panning.moved && e.button === 0 && this.tool?.click) this.tool.click(e, this);
      panning = null;
    };
    ov.addEventListener('pointerup', up);
    ov.addEventListener('pointercancel', up);
    ov.addEventListener('pointerleave', () => { emit('pixel', null); this.tool?.leave && this.tool.leave(this); });
    ov.addEventListener('wheel', (e) => {
      if (!this.photo) return;
      if (this.tool?.wheel && this.tool.wheel(e, this) !== false) { e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) || this.zoom !== 'fit') {
        e.preventDefault();
        const cur = this.zoom === 'fit' ? this.fitScale() / (devicePixelRatio * this.origScale()) : this.zoom;
        let z = cur * Math.pow(1.0015, -e.deltaY);
        const fitZ = this.fitScale() / (devicePixelRatio * this.origScale());
        if (z <= fitZ * 1.01) { this.setZoom('fit'); return; }
        this.setZoom(Math.min(16, z), [e.clientX, e.clientY]);
      }
    }, { passive: false });
    ov.addEventListener('dblclick', (e) => { if (this.tool?.dblclick) this.tool.dblclick(e, this); });
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { this.spaceDown = true; ov.style.cursor = 'grab'; } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') { this.spaceDown = false; ov.style.cursor = this.tool?.cursor || ''; } });
  }
  setTool(tool) {
    this.tool = tool;
    this.overlay.style.cursor = tool?.cursor || '';
    this.ignoreCrop = !!tool?.ignoreCrop;
    this.requestRender();
  }
}

let V = null;
export function viewer() { if (!V) V = new Viewer(); return V; }
