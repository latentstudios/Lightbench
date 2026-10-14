// Catalog + UI state + event bus.
import { api } from './api.js';
import { normalize, clone, isEdited, defaultsFor } from './settings.js';

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const C = {
  version: 1, photos: {}, collections: {}, presets: [], keywords: [], exportPresets: [], quick: [], prefs: {}, filterPresets: [],
};

export const S = {
  module: 'library', libView: 'grid',
  source: { type: 'all' },
  filter: { text: '', rating: 0, ratingOp: '>=', flag: 'any', labels: [], edited: 'any', camera: '', kind: 'any', ai: '' },
  sort: { by: 'captureTime', dir: 1 },
  list: [], cur: null, sel: new Set(), anchor: null,
  compare: { select: null, candidate: null, active: 'b' },
  aiRank: null, // Map id -> similarity when an AI search is active
  clipboard: null, info: null,
  targetCollection: null,
};

// ---------- persistence ----------
let saveTimer = null, saving = false, dirtyAgain = false;
export function save(immediate = false) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, immediate ? 0 : 700);
}
async function doSave() {
  if (saving) { dirtyAgain = true; return; }
  saving = true;
  try {
    await api.saveCatalog(C);
    document.getElementById('catalog-status').textContent = `Catalog · ${Object.keys(C.photos).length} photos · saved`;
  } catch (e) {
    console.error(e);
    document.getElementById('catalog-status').textContent = /token/.test(e.message) ? 'Server restarted — reload the window (Ctrl+F5) to keep saving' : 'Catalog save failed!';
    dirtyAgain = false; saving = false; return;
  }
  saving = false;
  if (dirtyAgain) { dirtyAgain = false; doSave(); }
}
export const hasPendingSave = () => saving || dirtyAgain;
// Called by the desktop app right before the window closes.
window.__flush = async () => {
  if (!saveTimer && !saving) return;
  clearTimeout(saveTimer); saveTimer = null;
  while (saving) await new Promise((r) => setTimeout(r, 50));
  await doSave();
};
window.addEventListener('beforeunload', () => { clearTimeout(saveTimer); doSave(); });

export async function loadCatalog() {
  const data = await api.loadCatalog();
  if (data) Object.assign(C, data);
  for (const k of ['photos', 'collections']) if (!C[k] || Array.isArray(C[k])) C[k] = {};
  for (const k of ['presets', 'keywords', 'exportPresets', 'quick', 'filterPresets']) if (!Array.isArray(C[k])) C[k] = [];
  C.prefs = C.prefs || {};
  S.info = await api.info();
  document.getElementById('catalog-status').textContent = `Catalog · ${Object.keys(C.photos).length} photos`;
}

// ---------- photo helpers ----------
export const P = (id) => C.photos[id];
export const srcId = (p) => p.master || p.id;
export const getSettings = (p) => (p.edits ? normalize(p.edits) : defaultsFor(p));
export function allPhotos() { return Object.values(C.photos); }

export function setEdits(p, settings, historyName) {
  const s = normalize(settings);
  p.edits = isEdited(s, p) ? clone(s) : null;
  p.editedAt = Date.now();
  if (historyName) {
    p.history = p.history || [];
    p.history.unshift({ name: historyName, t: Date.now(), s: clone(s) });
    if (p.history.length > 80) p.history.length = 80;
    p.histPos = 0;
  }
  save();
  emit('edits', p.id);
}

export function photoDate(p) { return p.captureTime || p.mtime || p.importedAt || 0; }

export function makeVirtualCopy(p) {
  const id = uid();
  const n = Object.values(C.photos).filter((x) => x.master === srcId(p)).length + 1;
  const copy = { ...clone(p), id, master: srcId(p), copyName: `Copy ${n}`, history: [], snapshots: [], importedAt: Date.now() };
  C.photos[id] = copy;
  save();
  return copy;
}

export function removePhotos(ids) {
  for (const id of ids) {
    const p = C.photos[id]; if (!p) continue;
    delete C.photos[id];
    for (const c of Object.values(C.collections)) if (c.ids) c.ids = c.ids.filter((x) => x !== id);
    C.quick = C.quick.filter((x) => x !== id);
    if (!p.master) for (const v of Object.values(C.photos)) if (v.master === id) delete C.photos[v.id];
    if (!p.master && p.denoise) { api.cacheDel(`dn-${id}.f16gz`).catch(() => {}); api.cacheDel(`dnh-${id}.f16gz`).catch(() => {}); }
  }
  save();
}

// ---------- folder tree ----------
export function folderTree() {
  const roots = new Map();
  const sep = S.info?.sep || '\\';
  for (const p of allPhotos()) {
    if (p.master) continue;
    const f = p.folder;
    roots.set(f, (roots.get(f) || 0) + 1);
  }
  return [...roots.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([path, count]) => ({ path, count, name: path.split(sep).filter(Boolean).pop() || path }));
}

// ---------- smart collections ----------
export const SMART_FIELDS = {
  rating: { label: 'Rating', type: 'num', get: (p) => p.rating || 0 },
  flag: { label: 'Pick Flag', type: 'enum', opts: [['1', 'Flagged'], ['0', 'Unflagged'], ['-1', 'Rejected']], get: (p) => String(p.flag || 0) },
  label: { label: 'Color Label', type: 'enum', opts: [['red', 'Red'], ['yellow', 'Yellow'], ['green', 'Green'], ['blue', 'Blue'], ['purple', 'Purple'], ['', 'None']], get: (p) => p.label || '' },
  keyword: { label: 'Keywords', type: 'text', get: (p) => (p.keywords || []).join(' ') },
  ai: { label: 'AI Tags / Objects', type: 'text', get: (p) => aiText(p) },
  text: { label: 'Any Searchable Text', type: 'text', get: (p) => searchText(p) },
  camera: { label: 'Camera', type: 'text', get: (p) => [p.exif?.make, p.exif?.model].filter(Boolean).join(' ') },
  lens: { label: 'Lens', type: 'text', get: (p) => p.exif?.lens || '' },
  iso: { label: 'ISO', type: 'num', get: (p) => p.exif?.iso || 0 },
  focal: { label: 'Focal Length', type: 'num', get: (p) => p.exif?.focal || 0 },
  edited: { label: 'Has Adjustments', type: 'enum', opts: [['1', 'True'], ['0', 'False']], get: (p) => (p.edits ? '1' : '0') },
  filetype: { label: 'File Type', type: 'enum', opts: [['raw', 'Raw'], ['jpg', 'JPEG'], ['other', 'Other']], get: (p) => (p.raw ? 'raw' : /jpe?g|jfif/.test(p.ext) ? 'jpg' : 'other') },
  captureDays: { label: 'Captured within (days)', type: 'num', get: (p) => (Date.now() - photoDate(p)) / 86400000 },
  gps: { label: 'Has GPS', type: 'enum', opts: [['1', 'True'], ['0', 'False']], get: (p) => (p.gps ? '1' : '0') },
};
export function evalRule(p, r) {
  const f = SMART_FIELDS[r.field]; if (!f) return true;
  const v = f.get(p);
  if (f.type === 'num') {
    const x = Number(r.value);
    return r.op === '>=' ? v >= x : r.op === '<=' ? v <= x : r.op === '>' ? v > x : r.op === '<' ? v < x : r.op === '!=' ? v !== x : v === x;
  }
  if (f.type === 'enum') return r.op === '!=' ? v !== r.value : v === r.value;
  const t = String(v).toLowerCase(), q = String(r.value || '').toLowerCase();
  return r.op === 'not' ? !t.includes(q) : r.op === 'starts' ? t.split(/\s+/).some((w) => w.startsWith(q)) : t.includes(q);
}
export function smartMatch(p, smart) {
  if (!smart.rules.length) return true;
  return smart.match === 'any' ? smart.rules.some((r) => evalRule(p, r)) : smart.rules.every((r) => evalRule(p, r));
}

export const aiText = (p) => [...(p.ai?.tags || []).map((t) => t.label), ...(p.ai?.objects || []).map((o) => o.label)].join(' ');
export const searchText = (p) => [p.name, p.title, p.caption, (p.keywords || []).join(' '), aiText(p), p.exif?.model, p.exif?.lens, p.folder].filter(Boolean).join(' ').toLowerCase();

// ---------- the filtered/sorted list ----------
export function sourcePhotos() {
  const src = S.source;
  let arr = allPhotos();
  if (src.type === 'folder') arr = arr.filter((p) => p.folder === src.value || (src.deep && p.folder.startsWith(src.value)));
  else if (src.type === 'collection') {
    const c = C.collections[src.value];
    if (!c) arr = [];
    else if (c.smart) arr = arr.filter((p) => smartMatch(p, c.smart));
    else { const set = new Set(c.ids); arr = arr.filter((p) => set.has(p.id)); }
  } else if (src.type === 'quick') { const set = new Set(C.quick); arr = arr.filter((p) => set.has(p.id)); }
  else if (src.type === 'recent') { const t = Math.max(0, ...arr.map((p) => p.importedAt || 0)); arr = arr.filter((p) => t - (p.importedAt || 0) < 120000); }
  else if (src.type === 'edited') arr = arr.filter((p) => p.edits);
  else if (src.type === 'keyword') arr = arr.filter((p) => (p.keywords || []).includes(src.value));
  else if (src.type === 'aitag') arr = arr.filter((p) => aiText(p).toLowerCase().split(' ').includes(src.value.toLowerCase()) || (p.ai?.tags || []).some((t) => t.label === src.value) || (p.ai?.objects || []).some((o) => o.label === src.value));
  else if (src.type === 'missing') arr = arr.filter((p) => p.missing);
  return arr;
}

export function applyFilter(arr) {
  const f = S.filter;
  const q = f.text.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  return arr.filter((p) => {
    if (terms.length) { const t = searchText(p); if (!terms.every((w) => t.includes(w))) return false; }
    const r = p.rating || 0;
    if (f.rating) { if (f.ratingOp === '>=' && r < f.rating) return false; if (f.ratingOp === '<=' && r > f.rating) return false; if (f.ratingOp === '=' && r !== f.rating) return false; }
    if (f.flag === 'pick' && p.flag !== 1) return false;
    if (f.flag === 'unflagged' && (p.flag || 0) !== 0) return false;
    if (f.flag === 'rejected' && p.flag !== -1) return false;
    if (f.flag === 'notrejected' && p.flag === -1) return false;
    if (f.labels.length && !f.labels.includes(p.label || 'none')) return false;
    if (f.edited === 'yes' && !p.edits) return false;
    if (f.edited === 'no' && p.edits) return false;
    if (f.kind === 'raw' && !p.raw) return false;
    if (f.kind === 'virtual' && !p.master) return false;
    if (f.kind === 'master' && p.master) return false;
    if (f.camera && ![p.exif?.make, p.exif?.model].join(' ').includes(f.camera)) return false;
    if (S.aiRank && !S.aiRank.has(p.id)) return false;
    return true;
  });
}

export function sortList(arr) {
  const { by, dir } = S.sort;
  const key = {
    captureTime: photoDate, importedAt: (p) => p.importedAt || 0, name: (p) => (p.name + (p.copyName || '')).toLowerCase(),
    rating: (p) => p.rating || 0, label: (p) => p.label || 'zzz', editedAt: (p) => p.editedAt || 0, size: (p) => p.size || 0,
    flag: (p) => p.flag || 0, aspect: (p) => (p.w || 1) / (p.h || 1),
  }[by] || photoDate;
  if (S.aiRank) return arr.sort((a, b) => S.aiRank.get(b.id) - S.aiRank.get(a.id));
  return arr.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : 1) * dir; });
}

export function refreshList(keepCur = true) {
  const arr = sortList(applyFilter(sourcePhotos()));
  S.list = arr.map((p) => p.id);
  const set = new Set(S.list);
  for (const id of [...S.sel]) if (!set.has(id)) S.sel.delete(id);
  if (!keepCur || !set.has(S.cur)) S.cur = S.list[0] || null;
  if (S.cur && !S.sel.size) S.sel.add(S.cur);
  emit('list');
}

export function setCurrent(id, { additive = false, range = false, toggle = false } = {}) {
  if (!id) return;
  if (range && S.anchor) {
    const a = S.list.indexOf(S.anchor), b = S.list.indexOf(id);
    if (a >= 0 && b >= 0) { if (!additive) S.sel.clear(); for (let i = Math.min(a, b); i <= Math.max(a, b); i++) S.sel.add(S.list[i]); }
  } else if (toggle) {
    if (S.sel.has(id) && S.sel.size > 1) { S.sel.delete(id); if (S.cur === id) id = [...S.sel][0]; } else S.sel.add(id);
    S.anchor = id;
  } else { S.sel.clear(); S.sel.add(id); S.anchor = id; }
  S.cur = id;
  emit('current', id);
  emit('selection');
}
export function selected() { return [...S.sel].filter((id) => C.photos[id]); }
export function targets() { const s = selected(); return s.length ? s : S.cur ? [S.cur] : []; }

export function step(delta) {
  const i = S.list.indexOf(S.cur);
  const n = S.list[Math.max(0, Math.min(S.list.length - 1, i + delta))];
  if (n && n !== S.cur) setCurrent(n);
}
