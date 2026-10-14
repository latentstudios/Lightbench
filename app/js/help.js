// Update check, feedback / problem reports, and the first-launch welcome guide.
import { S } from './store.js';
import { el, toast, modal, prefs } from './ui.js';
import { icon } from './icons.js';
import { api } from './api.js';
import { mdToHtml } from './markdown.js';
import { keyLabel } from './platform.js';

const REPO = 'latentstudios/lightbench';
const EMAIL = 'latentstudios.hq@gmail.com';
const openExternal = (url) => window.open(url, '_blank', 'noopener');

// ---------- recent errors (attached to problem reports) ----------
const errors = [];
let errorToastShown = false;
function recordError(msg, stack) {
  msg = String(msg || 'Unknown error');
  if (/ResizeObserver loop/.test(msg)) return; // harmless browser noise
  errors.push({ t: new Date().toISOString(), msg: msg.slice(0, 300), stack: String(stack || '').split('\n').slice(0, 6).join('\n') });
  if (errors.length > 8) errors.shift();
  // Offer a report once per session, without interrupting the user's work.
  if (!errorToastShown) {
    errorToastShown = true;
    toast(el('span', {}, 'Something went wrong. ', el('a', { href: '#', class: 'toast-link', onclick: (e) => { e.preventDefault(); showFeedback('problem'); } }, 'Report the problem')), true, 9000);
  }
}
export function installErrorCapture() {
  window.addEventListener('error', (e) => recordError(e.message, e.error?.stack));
  window.addEventListener('unhandledrejection', (e) => recordError(e.reason?.message || e.reason, e.reason?.stack));
}

function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch { return 'unknown'; }
}
function systemDetails() {
  const i = S.info || {};
  const os = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[i.platform] || i.platform || navigator.platform;
  const lines = [
    `Lightbench ${i.version || '?'}`,
    `${os} ${i.osRelease || ''} (${i.arch || '?'})`,
    `GPU: ${gpuName()}`,
    `WebGPU: ${navigator.gpu ? 'yes' : 'no'} · Memory: ${navigator.deviceMemory ? navigator.deviceMemory + ' GB+' : '?'} · Screen: ${screen.width}×${screen.height}`,
  ];
  if (errors.length) lines.push('', 'Recent errors:', ...errors.map((e) => `- ${e.t.slice(11, 19)} ${e.msg}${e.stack ? '\n  ' + e.stack.replace(/\n/g, '\n  ') : ''}`));
  return lines.join('\n');
}

// ---------- feedback ----------
export function showFeedback(kind = 'problem') {
  const kinds = { problem: 'Report a problem', idea: 'Suggest an idea', question: 'Ask a question' };
  const sel = el('select', {}, Object.entries(kinds).map(([k, v]) => el('option', { value: k, selected: k === kind }, v)));
  const title = el('input', { type: 'text', placeholder: 'One-line summary, e.g. "Export fails for NEF files"', style: { width: '100%' } });
  const text = el('textarea', { rows: 7, style: { width: '100%' }, placeholder: 'What happened, and what did you expect? Steps to reproduce help a lot.' });
  const inc = el('input', { type: 'checkbox', checked: true });
  const details = el('pre', { class: 'feedback-details' }, systemDetails());
  inc.onchange = () => { details.style.opacity = inc.checked ? 1 : 0.35; };
  const compose = (max) => {
    let body = text.value.trim() || '(no description)';
    if (inc.checked) body += '\n\n---\n' + systemDetails();
    return body.length > max ? body.slice(0, max) + '\n…(truncated)' : body;
  };
  const subject = () => `[${kinds[sel.value].split(' ').pop()}] ${title.value.trim() || kinds[sel.value]}`;
  modal('Send Feedback', el('div', { class: 'feedback' },
    el('p', { class: 'muted', style: { marginTop: 0 } }, 'Thanks for helping make Lightbench better. Nothing is sent automatically — you\'ll see the message in your browser or email app before sending, and no photos are included.'),
    el('div', { class: 'fb-row' }, sel, title),
    text,
    el('label', { class: 'fb-check' }, inc, ' Include version, system and recent-error details (shown below)'),
    details,
  ), {
    cls: 'feedback-modal',
    buttons: [
      { label: 'Copy', onClick: async () => { await navigator.clipboard.writeText(subject() + '\n\n' + compose(20000)); toast('Copied to clipboard'); return false; } },
      { label: 'Send by Email', onClick: () => openExternal(`mailto:${EMAIL}?subject=${encodeURIComponent(subject())}&body=${encodeURIComponent(compose(1500))}`) },
      { label: 'Open on GitHub', cls: 'primary', onClick: () => openExternal(`https://github.com/${REPO}/issues/new?title=${encodeURIComponent(subject())}&body=${encodeURIComponent(compose(6000))}`) },
    ],
  });
}

// ---------- updates ----------
const DAY = 24 * 3600 * 1000;
export async function checkForUpdates({ manual = false } = {}) {
  if (!manual) {
    if (!prefs.get('updates:auto', true) || Date.now() - prefs.get('updates:last', 0) < DAY) return;
  }
  let r;
  try { r = await api.json('update-check'); } catch (e) { r = { error: e.message }; }
  if (!r.error) prefs.set('updates:last', Date.now());
  if (r.available) {
    if (!manual && prefs.get('updates:skip', '') === r.latest) return;
    return showUpdate(r);
  }
  if (!manual) return;
  if (r.error) toast('Couldn\'t check for updates: ' + r.error, true, 5000);
  else showUpToDate(r);
}
function autoCheckBox() {
  const cb = el('input', { type: 'checkbox', checked: prefs.get('updates:auto', true), onchange: () => prefs.set('updates:auto', cb.checked) });
  return el('label', { class: 'fb-check' }, cb, ' Check for updates automatically (once a day)');
}
function showUpToDate(r) {
  modal('Check for Updates', el('div', {},
    el('div', { class: 'update-head' }, icon('check', { cls: 'lg' }), el('div', {}, el('b', {}, 'You\'re up to date'), el('div', { class: 'muted' }, `Lightbench ${r.current} is the latest version.`))),
    autoCheckBox()), { buttons: [{ label: 'OK', cls: 'primary' }] });
}
function showUpdate(r) {
  const mb = r.size ? ` (${Math.round(r.size / 1048576)} MB)` : '';
  const notes = el('div', { class: 'legal update-notes' });
  notes.innerHTML = r.notes ? mdToHtml(r.notes) : '<p class="muted">No release notes.</p>';
  const mac = S.info?.platform === 'darwin';
  const how = r.download
    ? (mac ? 'Download the new version, open it, and drag Lightbench into Applications to replace the old one.'
      : 'Download and run the installer — it updates Lightbench in place. Your catalog, edits and settings are kept.')
    : 'Get the new version from the download page.';
  modal('Update Available', el('div', {},
    el('div', { class: 'update-head' }, icon('sparkles', { cls: 'lg' }), el('div', {}, el('b', {}, `${r.name || 'Lightbench ' + r.latest} is available`), el('div', { class: 'muted' }, `You have ${r.current}. ${how}`))),
    notes,
    autoCheckBox()), {
    buttons: [
      { label: 'Skip This Version', onClick: () => prefs.set('updates:skip', r.latest) },
      { label: 'Later' },
      { label: r.download ? 'Download Update' + mb : 'Open Download Page', cls: 'primary', onClick: () => openExternal(r.download || r.page) },
    ],
  });
}

// ---------- welcome guide ----------
export function showWelcome({ openImport, firstRun = false } = {}) {
  prefs.set('welcome:v1', true);
  if (firstRun) prefs.set('models:offered', true);
  // First launch: offer to fetch every AI model now, so all AI features work offline straight away.
  const dl = el('input', { type: 'checkbox', checked: true });
  const aiBox = firstRun ? el('label', { class: 'welcome-ai' }, dl, el('span', {},
    el('b', {}, 'Download the AI features now (about 600 MB)'), el('br'),
    'Recommended. Runs in the background — keep working while it downloads. Afterwards every AI tool works offline.')) : null;
  const card = (ic, title, text) => el('div', { class: 'welcome-card' }, el('div', { class: 'wc-icon' }, icon(ic, { cls: 'lg' })), el('b', {}, title), el('p', {}, text));
  modal('Welcome to Lightbench', el('div', { class: 'welcome' },
    el('div', { class: 'welcome-hero' },
      el('img', { src: 'img/logo.svg', alt: '' }),
      el('div', {}, el('h2', {}, 'Your photos, your computer, no subscription.'),
        el('p', { class: 'muted' }, 'Here\'s the quick tour. You can reopen this guide any time from the Lightbench menu (top-left).'))),
    el('div', { class: 'welcome-grid' },
      card('import', '1 · Import', 'Click Import (or drag a folder onto the window). Lightbench reads photos where they are — nothing is moved or copied, and originals are never changed.'),
      card('grid', '2 · Library', 'Sort your shots: 1–5 for stars, P to pick, X to reject, 6–9 for colour labels. Use the filter bar and AI search to find anything.'),
      card('sun', '3 · Develop', 'Press D to edit. Light, colour, curves, crop, healing and AI Denoise — all non-destructive, with full undo history.'),
      card('mask', '4 · AI Masking', 'Press M, then Subject, Sky, Background or People to select it in one click. Or click any object to select just that.'),
      card('export', '5 · Export', `${keyLabel('Ctrl+Shift+E')} saves finished JPEG, PNG or WebP files wherever you like, at any size — with presets for web and Instagram.`),
      card('help', 'Need help?', 'Press ? for all keyboard shortcuts. Found a bug or have an idea? Use Send Feedback in the Lightbench menu.'),
    ),
    aiBox,
  ), {
    cls: 'welcome-modal',
    onClose: () => { if (aiBox && dl.checked) import('./models.js').then((m) => m.downloadAll()).catch((e) => toast('AI download failed: ' + e.message, true)); },
    buttons: [
      { label: 'Explore First' },
      { label: 'Import Photos…', cls: 'primary', onClick: () => setTimeout(() => openImport?.(), 50) },
    ],
  });
}
