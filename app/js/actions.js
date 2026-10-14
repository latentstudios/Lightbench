// Shared photo actions: ratings, flags, labels, settings copy/paste/sync, collections, keywords.
import { C, S, P, save, emit, uid, targets, getSettings, setEdits, makeVirtualCopy, removePhotos, refreshList, step, SMART_FIELDS, srcId } from './store.js';
import { SETTING_GROUPS, DEFAULT_COPY_GROUPS, pick, applyPreset, autoTone, defaultSettings, defaultsFor, clone } from './settings.js';
import { queueThumb, loadSource } from './imaging.js';
import { Engine } from './engine.js';
import { el, modal, prompt, confirmBox, toast, prefs } from './ui.js';
import { api } from './api.js';

export const autoAdvance = { get on() { return prefs.get('autoAdvance', false); }, set on(v) { prefs.set('autoAdvance', v); } };
function after(ids) {
  save(); emit('meta', ids);
  if (autoAdvance.on && ids.length === 1) step(1);
}
export function setRating(n) { const ids = targets(); ids.forEach((id) => (P(id).rating = n)); after(ids); toast(n ? `Rated ${n} star${n > 1 ? 's' : ''}` : 'Rating removed', false, 900); }
export function bumpRating(d) { const ids = targets(); ids.forEach((id) => (P(id).rating = Math.max(0, Math.min(5, (P(id).rating || 0) + d)))); after(ids); }
export function setFlag(f) { const ids = targets(); ids.forEach((id) => (P(id).flag = f)); after(ids); toast(f === 1 ? 'Flagged as Pick' : f === -1 ? 'Flagged as Rejected' : 'Unflagged', false, 900); }
export function setLabel(l) {
  const ids = targets();
  const same = ids.every((id) => P(id).label === l);
  ids.forEach((id) => (P(id).label = same ? '' : l)); after(ids);
}

// ---- settings changes applied to (possibly many) photos ----
export function modifySettings(ids, fn, historyName) {
  for (const id of ids) {
    const p = P(id); if (!p) continue;
    const s = getSettings(p);
    const out = fn(s, p) || s;
    setEdits(p, out, historyName);
    queueThumb(id);
  }
  emit('meta', ids);
}
export function rotate(dir) {
  modifySettings(targets(), (s) => { s.orient.rot = (s.orient.rot + (dir > 0 ? 1 : 3)) % 4; }, dir > 0 ? 'Rotate Right' : 'Rotate Left');
}
export function flipH() { modifySettings(targets(), (s) => { s.orient.flipH = !s.orient.flipH; }, 'Flip Horizontal'); }
export function flipV() { modifySettings(targets(), (s) => { s.orient.flipV = !s.orient.flipV; }, 'Flip Vertical'); }
export function resetSettings(ids = targets()) { modifySettings(ids, (s, p) => defaultsFor(p), 'Reset'); toast('Settings reset'); }
export function applyPresetTo(ids, preset, amount = 1) {
  modifySettings(ids, (s) => applyPreset(s, preset.settings, amount), 'Preset: ' + preset.name);
}

function groupPicker(title, okLabel, defaults = DEFAULT_COPY_GROUPS) {
  return new Promise((resolve) => {
    const saved = prefs.get('copyGroups', defaults);
    const boxes = Object.keys(SETTING_GROUPS).map((g) => { const cb = el('input', { type: 'checkbox', checked: saved.includes(g) }); return [g, cb]; });
    const body = el('div', {},
      el('div', { class: 'btnrow' }, el('button', { class: 'btn small', onclick: () => boxes.forEach(([, c]) => (c.checked = true)) }, 'Check All'), el('button', { class: 'btn small', onclick: () => boxes.forEach(([, c]) => (c.checked = false)) }, 'Check None')),
      el('div', { style: { columns: 2, marginTop: '8px' } }, boxes.map(([g, cb]) => el('label', { class: 'check' }, cb, g))));
    let ok = false;
    modal(title, body, { cls: 'small', onClose: () => { const gs = boxes.filter(([, c]) => c.checked).map(([g]) => g); if (ok) prefs.set('copyGroups', gs); resolve(ok ? gs : null); }, buttons: [{ label: 'Cancel' }, { label: okLabel, cls: 'primary', onClick: () => { ok = true; } }] });
  });
}
export async function copySettings(dialog = true) {
  const p = P(S.cur); if (!p) return;
  const groups = dialog ? await groupPicker('Copy Settings', 'Copy') : prefs.get('copyGroups', DEFAULT_COPY_GROUPS);
  if (!groups) return;
  S.clipboard = pick(getSettings(p), groups);
  toast('Settings copied');
}
export function pasteSettings() {
  if (!S.clipboard) { toast('Nothing copied yet (Ctrl+Shift+C)', true); return; }
  const clip = S.clipboard;
  modifySettings(targets(), (s) => { Object.assign(s, clone(clip)); }, 'Paste Settings');
  toast(`Settings pasted to ${targets().length} photo(s)`);
}
export async function syncSettings() {
  const src = P(S.cur), ids = targets().filter((id) => id !== S.cur);
  if (!src || !ids.length) { toast('Select the source photo plus the photos to sync to', true); return; }
  const groups = await groupPicker(`Synchronize Settings to ${ids.length} photo(s)`, 'Synchronize');
  if (!groups) return;
  const part = pick(getSettings(src), groups);
  modifySettings(ids, (s) => { Object.assign(s, clone(part)); }, 'Sync Settings');
  toast(`Synchronized ${ids.length} photo(s)`);
}
export function pastePrevious() {
  const i = S.list.indexOf(S.cur);
  const prev = P(S.list[i - 1]);
  if (!prev) return;
  const s = pick(getSettings(prev), DEFAULT_COPY_GROUPS);
  modifySettings([S.cur], (x) => { Object.assign(x, clone(s)); }, 'Previous Settings');
}

let statsEngine = null;
export async function autoSettings(ids = targets(), { wbOnly = false } = {}) {
  if (!statsEngine) statsEngine = new Engine(document.createElement('canvas'));
  for (const id of ids) {
    const p = P(id);
    statsEngine.setSource(await loadSource(p));
    const { data } = statsEngine.readOutput(defaultSettings(), 400);
    const a = autoTone(data);
    modifySettings([id], (s) => {
      if (wbOnly) { s.temp = a._wb.temp; s.tint = a._wb.tint; return; }
      for (const k of ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance']) s[k] = a[k];
    }, wbOnly ? 'Auto White Balance' : 'Auto Settings');
  }
}
export async function measureAuto(p) {
  if (!statsEngine) statsEngine = new Engine(document.createElement('canvas'));
  statsEngine.setSource(await loadSource(p));
  return autoTone(statsEngine.readOutput(defaultSettings(), 400).data);
}

export function virtualCopy() {
  const ids = targets(); let last = null;
  for (const id of ids) { last = makeVirtualCopy(P(id)); queueThumb(last.id); }
  refreshList(); if (last) { S.cur = last.id; S.sel = new Set([last.id]); emit('current', last.id); emit('selection'); }
  toast(`Created ${ids.length} virtual cop${ids.length > 1 ? 'ies' : 'y'}`);
}
export async function removeSelected() {
  const ids = targets(); if (!ids.length) return;
  if (S.source.type === 'collection' && !C.collections[S.source.value]?.smart) {
    const c = C.collections[S.source.value];
    c.ids = c.ids.filter((x) => !ids.includes(x)); save(); refreshList(); toast(`Removed ${ids.length} from collection`); return;
  }
  if (S.source.type === 'quick') { C.quick = C.quick.filter((x) => !ids.includes(x)); save(); refreshList(); return; }
  if (!(await confirmBox('Remove from Catalog', `Remove ${ids.length} photo(s) from the catalog? Files on disk are NOT deleted.`, 'Remove'))) return;
  const i = S.list.indexOf(S.cur);
  removePhotos(ids); refreshList(false);
  const n = S.list[Math.min(i, S.list.length - 1)]; if (n) { S.cur = n; S.sel = new Set([n]); emit('current', n); }
  emit('list-changed');
}
export async function removeRejected() {
  const ids = Object.values(C.photos).filter((p) => p.flag === -1).map((p) => p.id);
  if (!ids.length) { toast('No rejected photos'); return; }
  if (!(await confirmBox('Remove Rejected Photos', `Remove ${ids.length} rejected photo(s) from the catalog? Files on disk are not deleted.`, 'Remove'))) return;
  removePhotos(ids); refreshList(false); emit('list-changed');
}

// ---- quick collection & collections ----
export function toggleQuick() {
  const ids = targets(); const all = ids.every((id) => C.quick.includes(id));
  if (all) C.quick = C.quick.filter((x) => !ids.includes(x)); else for (const id of ids) if (!C.quick.includes(id)) C.quick.push(id);
  save(); emit('collections'); emit('meta', ids);
  toast(all ? 'Removed from Quick Collection' : `Added to Quick Collection (${C.quick.length})`, false, 1200);
}
export async function newCollection(withSelected = true) {
  const name = await prompt('Create Collection', 'New Collection', withSelected ? `Include ${targets().length} selected photo(s)` : '');
  if (!name) return;
  const id = uid();
  C.collections[id] = { id, name, ids: withSelected ? targets() : [], created: Date.now() };
  save(); emit('collections'); toast(`Collection “${name}” created`);
  return id;
}
export function addToCollection(cid, ids = targets()) {
  const c = C.collections[cid]; if (!c || c.smart) return;
  for (const id of ids) if (!c.ids.includes(id)) c.ids.push(id);
  save(); emit('collections'); toast(`Added ${ids.length} to “${c.name}”`, false, 1200);
}
export function smartCollectionDialog(existing) {
  const sm = clone(existing?.smart) || { match: 'all', rules: [{ field: 'rating', op: '>=', value: '3' }] };
  const nameIn = el('input', { type: 'text', value: existing?.name || 'Smart Collection' });
  const matchSel = el('select', {}, el('option', { value: 'all' }, 'all'), el('option', { value: 'any' }, 'any'));
  matchSel.value = sm.match;
  const rulesBox = el('div');
  const draw = () => {
    rulesBox.innerHTML = '';
    sm.rules.forEach((r, i) => {
      const f = SMART_FIELDS[r.field];
      const fieldSel = el('select', { onchange: () => { r.field = fieldSel.value; const t = SMART_FIELDS[r.field].type; r.op = t === 'num' ? '>=' : t === 'enum' ? '=' : 'contains'; r.value = t === 'enum' ? SMART_FIELDS[r.field].opts[0][0] : ''; draw(); } },
        Object.entries(SMART_FIELDS).map(([k, v]) => el('option', { value: k }, v.label)));
      fieldSel.value = r.field;
      const ops = f.type === 'num' ? ['>=', '<=', '=', '!=', '>', '<'] : f.type === 'enum' ? ['=', '!='] : ['contains', 'not', 'starts'];
      const opSel = el('select', { onchange: () => (r.op = opSel.value) }, ops.map((o) => el('option', { value: o }, { contains: 'contains', not: "doesn't contain", starts: 'word starts with' }[o] || o)));
      opSel.value = r.op;
      const val = f.type === 'enum'
        ? el('select', { onchange: (e) => (r.value = e.target.value) }, f.opts.map(([v, l]) => el('option', { value: v, selected: v === r.value }, l)))
        : el('input', { type: 'text', value: r.value, oninput: (e) => (r.value = e.target.value), style: { width: '160px' } });
      rulesBox.append(el('div', { style: { display: 'flex', gap: '6px', margin: '5px 0', alignItems: 'center' } }, fieldSel, opSel, val,
        el('button', { class: 'btn small', onclick: () => { sm.rules.splice(i, 1); draw(); } }, '−')));
    });
    rulesBox.append(el('button', { class: 'btn small', onclick: () => { sm.rules.push({ field: 'keyword', op: 'contains', value: '' }); draw(); } }, '+ Add Rule'));
  };
  draw();
  const body = el('div', {}, el('div', { class: 'field' }, el('label', {}, 'Name'), nameIn), el('div', { style: { margin: '10px 0' } }, 'Match ', matchSel, ' of the following rules:'), rulesBox);
  modal(existing ? 'Edit Smart Collection' : 'Create Smart Collection', body, {
    buttons: [{ label: 'Cancel' }, {
      label: existing ? 'Save' : 'Create', cls: 'primary', onClick: () => {
        sm.match = matchSel.value;
        if (existing) { existing.name = nameIn.value; existing.smart = sm; }
        else { const id = uid(); C.collections[id] = { id, name: nameIn.value, smart: sm, ids: [], created: Date.now() }; }
        save(); emit('collections'); refreshList();
      },
    }],
  });
}

// ---- keywords ----
export function addKeywords(words, ids = targets()) {
  const ws = words.map((w) => w.trim()).filter(Boolean);
  for (const id of ids) { const p = P(id); p.keywords = [...new Set([...(p.keywords || []), ...ws])]; }
  for (const w of ws) if (!C.keywords.includes(w)) C.keywords.push(w);
  C.keywords.sort((a, b) => a.localeCompare(b));
  save(); emit('meta', ids); emit('keywords');
}
export function removeKeyword(w, ids = targets()) {
  for (const id of ids) { const p = P(id); p.keywords = (p.keywords || []).filter((k) => k !== w); }
  save(); emit('meta', ids); emit('keywords');
}
export function aiTagsToKeywords(ids = targets()) {
  let n = 0;
  for (const id of ids) {
    const p = P(id); if (!p.ai) continue;
    const ws = [...(p.ai.tags || []).map((t) => t.label), ...(p.ai.objects || []).filter((o) => o.score > 0.85 && o.area > 0.01).map((o) => o.label)];
    if (ws.length) { addKeywords(ws, [id]); n++; }
  }
  toast(n ? `Converted AI tags to keywords on ${n} photo(s)` : 'No AI tags yet — run AI Analyze first', !n);
}

export function showInExplorer() { const p = P(S.cur); if (p) api.reveal(p.path); }
export function metaSet(field, value, ids = targets()) { for (const id of ids) P(id)[field] = value; save(); emit('meta', ids); }
export { srcId };
