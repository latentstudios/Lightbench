// Small DOM helpers and reusable widgets.
import { api } from './api.js';
import { icon, ICON_NAMES, starsHTML } from './icons.js';
import { keyLabel, REVEAL_LABEL } from './platform.js';
export { icon };

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const lsGet = (k, d) => { try { const v = localStorage.getItem('lightbench:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem('lightbench:' + k, JSON.stringify(v)); } catch {} };
export const prefs = { get: lsGet, set: lsSet };

export function panel(title, { id, collapsed = false, tools = [] } = {}) {
  const key = 'panel:' + (id || title);
  const isCollapsed = lsGet(key, collapsed);
  const body = el('div', { class: 'panel-body' });
  const triIcon = (c) => icon(c ? 'chevron-right' : 'chevron-down', { cls: 'sm' });
  const tri = el('span', { class: 'tri' }, triIcon(isCollapsed));
  const head = el('div', { class: 'panel-head' }, tri, el('span', { class: 'title' }, title),
    el('span', { class: 'tools' }, tools.map((t) => el('button', { title: t.title, onclick: (e) => { e.stopPropagation(); t.onClick(e); } }, ICON_NAMES.includes(t.icon) ? icon(t.icon) : t.icon))));
  const root = el('div', { class: 'panel' + (isCollapsed ? ' collapsed' : '') }, head, body);
  head.addEventListener('click', (e) => {
    if (e.altKey) { // solo mode: collapse siblings
      for (const p of root.parentElement.querySelectorAll(':scope > .panel')) if (p !== root) { p.classList.add('collapsed'); p.querySelector('.tri').replaceChildren(triIcon(true)); }
    }
    root.classList.toggle('collapsed');
    const c = root.classList.contains('collapsed');
    tri.replaceChildren(triIcon(c));
    lsSet(key, c);
  });
  return { el: root, body, head };
}

export function sectionLabel(t) { return el('div', { class: 'section-label' }, t); }

// Slider row. onInput(v) during drag, onCommit(v) when released (history).
export function slider({ label, min = -100, max = 100, step = 1, value = 0, def = 0, cls = '', fmt, onInput, onCommit, style }) {
  const range = el('input', { type: 'range', min, max, step, value });
  const show = (v) => (fmt ? fmt(v) : (step < 1 ? Number(v).toFixed(step < 0.1 ? 2 : 1) : String(Math.round(v))).replace(/^(\d)/, (m) => (v > 0 && min < 0 ? '+' + m : m)));
  const box = el('input', { type: 'text', class: 'val', value: show(value) });
  const lab = el('label', { title: 'Double-click to reset' }, label);
  const row = el('div', { class: 'srow ' + cls, style }, lab, range, box);
  const mark = (v) => row.classList.toggle('changed', Math.abs(v - def) > 1e-9);
  mark(value);
  const setv = (v, commit) => {
    v = Math.min(max, Math.max(min, Number(v)));
    if (isNaN(v)) return;
    range.value = v; box.value = show(v); mark(v);
    onInput && onInput(v);
    if (commit) onCommit && onCommit(v);
  };
  range.addEventListener('input', () => setv(range.value, false));
  range.addEventListener('change', () => setv(range.value, true));
  range.addEventListener('dblclick', () => setv(def, true));
  lab.addEventListener('dblclick', () => setv(def, true));
  box.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { setv(parseFloat(box.value), true); box.blur(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setv(Number(range.value) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), true); }
  });
  box.addEventListener('blur', () => { box.value = show(range.value); });
  // fine control with the mouse wheel on hover
  row.addEventListener('wheel', (e) => { if (!(e.ctrlKey || e.metaKey) && !e.shiftKey && document.activeElement !== box) return; e.preventDefault(); setv(Number(range.value) - Math.sign(e.deltaY) * step, true); }, { passive: false });
  return { el: row, set: (v) => { range.value = v; box.value = show(v); mark(v); }, get: () => Number(range.value) };
}

export function seg(options, value, onChange) {
  const root = el('div', { class: 'seg' });
  const btns = options.map(([v, label, title]) => el('button', { title: title || '', class: v === value ? 'on' : '', onclick: () => { btns.forEach((b) => b.classList.remove('on')); btn(v).classList.add('on'); onChange(v); } }, label));
  const btn = (v) => btns[options.findIndex((o) => o[0] === v)];
  root.append(...btns);
  root.setValue = (v) => { btns.forEach((b) => b.classList.remove('on')); if (btn(v)) btn(v).classList.add('on'); };
  return root;
}

// ---------- toasts + activity ----------
export function toast(msg, isErr = false, ms = 2600) {
  const t = el('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}
const acts = new Set();
function renderActivity() {
  const a = [...acts].at(-1);
  $('#activity').classList.toggle('on', !!a);
  if (a) { $('#activity-text').textContent = a.text + (acts.size > 1 ? `  (+${acts.size - 1} more)` : ''); $('#activity-bar').style.width = (a.frac * 100).toFixed(1) + '%'; }
}
export function activity(text) {
  const a = { text, frac: 0 };
  acts.add(a); renderActivity();
  return {
    update(t, f) { a.text = t; if (f != null) a.frac = f; renderActivity(); },
    done(msg) { acts.delete(a); renderActivity(); if (msg) toast(msg); },
  };
}

// ---------- modals ----------
export function modal(title, body, { buttons = [], cls = '', onClose, foot } = {}) {
  const root = $('#modal-root');
  const close = () => { back.remove(); document.removeEventListener('keydown', esc, true); onClose && onClose(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const footEl = el('div', { class: 'modal-foot' }, foot || el('span', { class: 'grow' }),
    buttons.map((b) => el('button', { class: 'btn ' + (b.cls || ''), onclick: async () => { if ((await b.onClick?.(close)) !== false && b.close !== false) close(); } }, b.label)));
  const m = el('div', { class: 'modal ' + cls }, el('div', { class: 'modal-head' }, title, el('span', { class: 'close', onclick: close, title: 'Close (Esc)' }, icon('x', { cls: 'lg' }))), el('div', { class: 'modal-body' }, body), footEl);
  const back = el('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(); } }, m);
  root.append(back);
  document.addEventListener('keydown', esc, true);
  setTimeout(() => { const f = m.querySelector('input[type=text],textarea'); if (f) f.focus(); }, 30);
  return { close, el: m };
}
export function prompt(title, value = '', label = '') {
  return new Promise((resolve) => {
    const inp = el('input', { type: 'text', value, style: { width: '100%' } });
    let ok = false;
    const m = modal(title, el('div', {}, label ? el('div', { class: 'muted', style: { marginBottom: '6px' } }, label) : null, inp), {
      cls: 'small', onClose: () => resolve(ok ? inp.value.trim() : null),
      buttons: [{ label: 'Cancel' }, { label: 'OK', cls: 'primary', onClick: () => { ok = true; } }],
    });
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { ok = true; m.close(); } });
    setTimeout(() => inp.select(), 40);
  });
}
export function confirmBox(title, text, okLabel = 'OK') {
  return new Promise((resolve) => {
    let ok = false;
    modal(title, el('div', { style: { lineHeight: '1.5' } }, text), { cls: 'small', onClose: () => resolve(ok), buttons: [{ label: 'Cancel' }, { label: okLabel, cls: 'primary', onClick: () => { ok = true; } }] });
  });
}

// ---------- context menu ----------
export function contextMenu(x, y, items) {
  document.querySelectorAll('.ctx').forEach((c) => c.remove());
  const m = el('div', { class: 'ctx' }, items.filter(Boolean).map((it) => (it === '-' ? el('hr') : el('div', { onclick: () => { m.remove(); it.action(); } }, el('span', {}, it.label.replace('Show in Explorer', REVEAL_LABEL)), it.key ? el('span', { class: 'k' }, keyLabel(it.key)) : null))));
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 4) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', h); } }), 0);
}

// ---------- server-side folder browser ----------
export function browseFolder({ title = 'Choose Folder', start, showImages = true, extra } = {}) {
  return new Promise(async (resolve) => {
    const info = await api.info();
    let cur = start || prefs.get('lastBrowse', info.pictures);
    let chosen = null;
    const pathIn = el('input', { type: 'text', value: cur });
    const drives = el('div', { class: 'drives' });
    const dirs = el('div', { class: 'dirs' });
    const status = el('span', { class: 'muted' });
    const go = async (d) => {
      try {
        const r = await api.ls(d);
        cur = r.dir; pathIn.value = cur; dirs.innerHTML = '';
        if (r.parent) dirs.append(el('div', { class: 'entry', onclick: () => go(r.parent) }, icon('folder-up'), ' ..'));
        for (const n of r.dirs) dirs.append(el('div', { class: 'entry', onclick: () => go(cur + (cur.endsWith(info.sep) ? '' : info.sep) + n) }, icon('folder'), ' ' + n));
        if (showImages) for (const n of r.images.slice(0, 400)) dirs.append(el('div', { class: 'entry img' }, icon('image'), ' ' + n));
        status.textContent = `${r.images.length} photos in this folder`;
      } catch (e) { status.textContent = 'Cannot open: ' + e.message; }
    };
    const quick = [['Pictures', info.pictures, 'image'], ['Home', info.home, 'home'], ['Desktop', info.home + info.sep + 'Desktop', 'folder'], ['Downloads', info.home + info.sep + 'Downloads', 'import']];
    for (const [n, p, ic] of quick) drives.append(el('div', { class: 'entry', onclick: () => go(p) }, icon(ic), ' ' + n));
    for (const d of await api.drives()) drives.append(el('div', { class: 'entry', onclick: () => go(d) }, icon('drive'), ' ' + d));
    pathIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(pathIn.value); });
    const body = el('div', {}, el('div', { class: 'pathbar' }, pathIn, el('button', { class: 'btn', onclick: () => go(pathIn.value) }, 'Go')), el('div', { class: 'browser' }, drives, dirs), extra || null);
    modal(title, body, {
      foot: status,
      onClose: () => { if (chosen) prefs.set('lastBrowse', chosen); resolve(chosen); },
      buttons: [{ label: 'Cancel' }, { label: 'Choose This Folder', cls: 'primary', onClick: () => { chosen = cur; } }],
    });
    go(cur);
  });
}

export const stars = (n) => { const s = el('span', { class: 'stars-row' }); s.innerHTML = starsHTML(n); return s; };
export const LABEL_COLORS = { red: '#d9443f', yellow: '#e2c43a', green: '#55a84a', blue: '#4a78c9', purple: '#9452b8' };
export function fmtDate(t) { if (!t) return ''; const d = new Date(t); return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
export function fmtBytes(n) { if (!n) return ''; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; }
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function throttleRAF(fn) { let q = false, args; return (...a) => { args = a; if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(...args); }); }; }
