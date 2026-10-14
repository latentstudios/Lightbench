// Lightbench icon set: 24×24 line icons (1.8px stroke, round caps). Elements with class "f" are filled.
// Icons inherit `color`, so hover / active states work like text.
const I = {
  // ---- navigation & chrome ----
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  'chevron-left': '<path d="M15 6l-6 6 6 6"/>',
  'chevron-up': '<path d="M6 15l6-6 6 6"/>',
  'caret-right': '<path class="f" d="M9 6.5v11l7-5.5z"/>',
  'caret-down': '<path class="f" d="M6.5 9h11L12 16z"/>',
  'caret-left': '<path class="f" d="M15 6.5v11L8 12z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  more: '<circle class="f" cx="5" cy="12" r="1.6"/><circle class="f" cx="12" cy="12" r="1.6"/><circle class="f" cx="19" cy="12" r="1.6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  warning: '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5"/><circle class="f" cx="12" cy="17.3" r="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle class="f" cx="12" cy="7.8" r="1"/>',
  play: '<path class="f" d="M8 5.5v13l10.5-6.5z"/>',
  printer: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  export: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path d="M4 13.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-5.5"/>',
  import: '<path d="M12 3.5V15M7.5 10.5L12 15l4.5-4.5"/><path d="M4 13.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-5.5"/>',
  // ---- library ----
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
  loupe: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3.5 17l5-5 4 4 2.5-2.5 5.5 5"/><circle cx="15.5" cy="9" r="1.6"/>',
  compare: '<rect x="3" y="5" width="8" height="14" rx="1.5"/><rect x="13" y="5" width="8" height="14" rx="1.5"/>',
  survey: '<rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1"/><rect x="3" y="13" width="8" height="7" rx="1"/><rect x="13" y="13" width="8" height="7" rx="1"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3.5 17l5-5 4 4 2.5-2.5 5.5 5"/><circle cx="15.5" cy="9" r="1.6"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  'folder-up': '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><path d="M12 17v-6M9.3 13.5L12 10.8l2.7 2.7"/>',
  drive: '<rect x="3" y="7" width="18" height="10" rx="2"/><circle class="f" cx="17" cy="12" r="1.1"/><path d="M6.5 12h6"/>',
  home: '<path d="M4 11l8-6.5 8 6.5V20H4z"/><path d="M10 20v-5h4v5"/>',
  'star-fill': '<path class="f" d="M12 3.3l2.6 5.5 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.5l6-.7z"/>',
  star: '<path d="M12 3.3l2.6 5.5 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.5l6-.7z"/>',
  flag: '<path d="M5 21V4"/><path class="f" d="M5 4h11.5l-2.2 4 2.2 4H5z"/>',
  'flag-outline': '<path d="M5 21V4"/><path d="M5 4h11.5l-2.2 4 2.2 4H5z"/>',
  reject: '<circle cx="12" cy="12" r="8.5"/><path d="M8.7 8.7l6.6 6.6M15.3 8.7l-6.6 6.6"/>',
  collection: '<rect x="3.5" y="7" width="17" height="13" rx="1.5"/><path d="M6 4h12"/>',
  'smart-collection': '<rect x="3.5" y="7" width="17" height="13" rx="1.5"/><path d="M6 4h12"/><path d="M12 10.5v6M9 13.5h6"/>',
  quick: '<circle class="f" cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8.5"/>',
  dot: '<circle class="f" cx="12" cy="12" r="3.2"/>',
  tag: '<path d="M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.2 8.2-8.8 8.8z"/><circle class="f" cx="8" cy="8" r="1.4"/>',
  'rotate-ccw': '<path d="M4.5 9.5A8 8 0 1 1 4 14"/><path d="M4 4.5v5h5"/>',
  'rotate-cw': '<path d="M19.5 9.5A8 8 0 1 0 20 14"/><path d="M20 4.5v5h-5"/>',
  'flip-h': '<path d="M12 3v18"/><path d="M9 6.5L3.5 17H9z"/><path d="M15 6.5l5.5 10.5H15z"/>',
  'flip-v': '<path d="M3 12h18"/><path d="M6.5 9L17 3.5V9z"/><path d="M6.5 15L17 20.5V15z"/>',
  swap: '<path d="M7 4L3.5 7.5 7 11"/><path d="M3.5 7.5h13"/><path d="M17 13l3.5 3.5L17 20"/><path d="M20.5 16.5h-13"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.6 6.9C4 8.6 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.4-1.1"/><path d="M3.5 3.5l17 17"/>',
  invert: '<circle cx="12" cy="12" r="8.5"/><path class="f" d="M12 3.5a8.5 8.5 0 0 1 0 17z"/>',
  explorer: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><path d="M10 15.5l4-4M10.5 11.5H14V15"/>',
  map: '<path d="M3.5 6.5l5.5-2.5 6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="10" r="2.3"/>',
  // ---- develop tools ----
  crop: '<path d="M6.5 2.5v13.5a1.5 1.5 0 0 0 1.5 1.5h13.5"/><path d="M2.5 6.5H16a1.5 1.5 0 0 1 1.5 1.5v13.5"/>',
  heal: '<rect x="2.6" y="8.3" width="18.8" height="7.4" rx="3.7" transform="rotate(-45 12 12)"/><rect x="8.8" y="8.8" width="6.4" height="6.4" rx=".8" transform="rotate(-45 12 12)"/><circle class="f" cx="11" cy="11" r=".7"/><circle class="f" cx="13" cy="13" r=".7"/><circle class="f" cx="13" cy="11" r=".7"/><circle class="f" cx="11" cy="13" r=".7"/>',
  mask: '<circle cx="12" cy="12" r="8.5"/><path class="f" d="M12 3.5a8.5 8.5 0 0 0 0 17z" opacity=".55"/><path d="M12 3.5v17"/>',
  eyedropper: '<path d="M14.5 4.5l5 5"/><path d="M17.8 2.8a2.3 2.3 0 0 1 3.3 3.3l-2.6 2.6-3.3-3.3z"/><path d="M15.2 8.5L6.5 17.2 4 20l2.8-2.5 8.7-8.7"/><path d="M13.5 6.8l3.7 3.7"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle class="f" cx="12" cy="12" r="1.3"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 7.7-1.5"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/><path d="M10.5 7.8v5.4M7.8 10.5h5.4"/>',
  clipping: '<path d="M3 20.5h18"/><path d="M4 20.5V4M20 20.5V4"/><path d="M4 9c2 0 3 8 8 8s6-12 8-12"/>',
  beforeafter: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M12 3v18"/><path class="f" d="M12 4.5h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-7z" opacity=".35"/>',
  sparkles: '<path d="M10 3.5l1.6 4.4L16 9.5l-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6z"/><path d="M18 13.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  subject: '<path d="M3.5 8V5a1.5 1.5 0 0 1 1.5-1.5h3M16 3.5h3A1.5 1.5 0 0 1 20.5 5v3M20.5 16v3a1.5 1.5 0 0 1-1.5 1.5h-3M8 20.5H5A1.5 1.5 0 0 1 3.5 19v-3"/><circle cx="12" cy="9.5" r="2.6"/><path d="M7.5 17.5a4.5 4.5 0 0 1 9 0"/>',
  sky: '<path d="M7 18.5h10.5a3.8 3.8 0 0 0 .4-7.6A5.5 5.5 0 0 0 7.4 9.6 4.5 4.5 0 0 0 7 18.5z"/>',
  background: '<path d="M12 3.5l9 4.8-9 4.8-9-4.8z"/><path d="M3 12.2l9 4.8 9-4.8"/><path d="M3 16.2l9 4.8 9-4.8"/>',
  object: '<path d="M5 3.5l5.2 15.5 2.2-6.6 6.6-2.2z"/><path d="M13.5 13.5l6 6"/>',
  person: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20.5a7 7 0 0 1 14 0"/>',
  landscape: '<path d="M2.5 19.5l6.5-10 4.5 6.5 2.5-3.5 5.5 7z"/><circle cx="17" cy="6.5" r="2"/>',
  brush: '<path d="M20.5 3.5c-3.5 1.5-9 7-10.5 9.5l1.5 1.5c2.5-1.5 8-7 9-11z"/><path d="M9.5 13.5c-2 0-3.5 1.5-3.5 3.5 0 1.5-1 2.5-2.5 3 2.5 1 7 .5 7.5-3.5z"/>',
  'linear-gradient': '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 8.5h17"/><path d="M3.5 12h17" stroke-dasharray="2 2"/><path d="M3.5 15.5h17"/>',
  'radial-gradient': '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5" stroke-dasharray="2 2"/><circle class="f" cx="12" cy="12" r="1.2"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 1.8-1 1.2-2-.7-1.2.1-2.5 1.5-2.5H17a3.5 3.5 0 0 0 3.5-3.5c0-5-4-9-8.5-9z"/><circle class="f" cx="7.8" cy="11" r="1.2"/><circle class="f" cx="10" cy="7.3" r="1.2"/><circle class="f" cx="14.5" cy="7.5" r="1.2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
  scan: '<path d="M3.5 8V5a1.5 1.5 0 0 1 1.5-1.5h3M16 3.5h3A1.5 1.5 0 0 1 20.5 5v3M20.5 16v3a1.5 1.5 0 0 1-1.5 1.5h-3M8 20.5H5A1.5 1.5 0 0 1 3.5 19v-3"/><rect x="7.5" y="7.5" width="9" height="9" rx="1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  denoise: '<circle class="f" cx="5" cy="6" r="1"/><circle class="f" cx="9" cy="4.5" r="1"/><circle class="f" cx="5.5" cy="10.5" r="1"/><circle class="f" cx="9.5" cy="9" r="1"/><path d="M13 4.5c3.6.5 6.5 3.6 6.5 7.5a7.5 7.5 0 0 1-15 0"/>',
  'help': '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 3.8"/><circle class="f" cx="12" cy="17.2" r="1"/>',
};

const NS = 'http://www.w3.org/2000/svg';
// Returns an <svg> element. opts: { size, title, cls }
export function icon(name, opts = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ic' + (opts.cls ? ' ' + opts.cls : ''));
  svg.setAttribute('aria-hidden', 'true');
  if (opts.size) { svg.style.width = svg.style.height = typeof opts.size === 'number' ? opts.size + 'px' : opts.size; }
  svg.innerHTML = I[name] || I.dot;
  if (opts.title) { const t = document.createElementNS(NS, 'title'); t.textContent = opts.title; svg.prepend(t); svg.removeAttribute('aria-hidden'); }
  return svg;
}
export const iconHTML = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[name] || I.dot}</svg>`;
// Icon followed by a text label, for buttons.
export function iconLabel(name, label, opts) {
  const f = document.createDocumentFragment();
  f.append(icon(name, opts), document.createTextNode(label));
  return f;
}
// Five-star rating row as an HTML string (filled up to n).
export const starsHTML = (n, size = '') => Array.from({ length: 5 }, (_, i) => iconHTML(i < n ? 'star-fill' : 'star', 'star ' + (i < n ? 'on' : 'off') + ' ' + size)).join('');
export const ICON_NAMES = Object.keys(I);
