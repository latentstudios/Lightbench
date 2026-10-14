// Map module: photos with GPS on an OpenStreetMap map; drag photos from the filmstrip to geotag.
import { C, S, P, on, emit, save, setCurrent, targets } from './store.js';
import { el, $, panel, toast, icon } from './ui.js';
import { thumbUrl } from './imaging.js';

const mod = {};
export default mod;
let L = null, map = null, layer = null;

async function ensureMap() {
  if (!L) L = await import('../vendor/leaflet/leaflet-src.esm.js'); // Leaflet 1.9.4, bundled
  if (map) { map.invalidateSize(); return; }
  map = L.map($('#map-el'), { zoomControl: true, worldCopyJump: true }).setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  layer = L.layerGroup().addTo(map);
  const box = $('#map-el');
  box.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/lightbench-ids')) e.preventDefault(); });
  box.addEventListener('drop', (e) => {
    const d = e.dataTransfer.getData('text/lightbench-ids'); if (!d) return;
    e.preventDefault();
    const ll = map.mouseEventToLatLng(e);
    const ids = JSON.parse(d);
    for (const id of ids) P(id).gps = { lat: ll.lat, lng: ll.lng, alt: null };
    save(); draw(false); emit('meta', ids);
    toast(`Geotagged ${ids.length} photo(s)`);
  });
  map.on('zoomend', () => draw(false));
}

function draw(fit = true) {
  if (!map) return;
  layer.clearLayers();
  const pts = S.list.map(P).filter((p) => p?.gps);
  // simple screen-space clustering
  const groups = [];
  for (const p of pts) {
    const pt = map.latLngToLayerPoint([p.gps.lat, p.gps.lng]);
    const g = groups.find((g) => g.pt.distanceTo(pt) < 50);
    if (g) g.items.push(p); else groups.push({ pt, items: [p], ll: [p.gps.lat, p.gps.lng] });
  }
  for (const g of groups) {
    const p = g.items[0];
    const sel = g.items.some((x) => S.sel.has(x.id));
    const icon = L.divIcon({ className: '', iconSize: [54, 54], iconAnchor: [27, 27],
      html: `<div class="map-thumb" style="width:54px;height:54px;position:relative;${sel ? 'border-color:#e8a33d' : ''}"><img src="${thumbUrl(p)}">${g.items.length > 1 ? `<span style="position:absolute;right:-8px;top:-8px;background:#e8a33d;color:#000;border-radius:10px;padding:0 6px;font-size:11px;font-weight:700">${g.items.length}</span>` : ''}</div>` });
    const mk = L.marker(g.ll, { icon }).addTo(layer);
    mk.on('click', () => {
      S.sel = new Set(g.items.map((x) => x.id)); setCurrent(p.id, { additive: true });
      S.sel = new Set(g.items.map((x) => x.id)); emit('selection'); draw(false);
    });
    mk.bindTooltip(g.items.length > 1 ? `${g.items.length} photos` : p.name);
  }
  if (fit && pts.length) map.fitBounds(L.latLngBounds(pts.map((p) => [p.gps.lat, p.gps.lng])).pad(0.2), { maxZoom: 14 });
  info();
}
let infoBox = null;
function info() {
  if (!infoBox) return;
  const n = S.list.filter((id) => P(id)?.gps).length;
  const p = P(S.cur);
  infoBox.innerHTML = '';
  infoBox.append(el('div', {}, el('div', {}, `${n} of ${S.list.length} photos in view have GPS.`),
    el('div', { class: 'muted small', style: { margin: '6px 0' } }, 'Drag photos from the filmstrip onto the map to geotag them.'),
    p ? el('div', { class: 'kv' }, el('div', {}, 'Photo'), el('div', {}, p.name), el('div', {}, 'Location'), el('div', {}, p.gps ? `${p.gps.lat.toFixed(5)}, ${p.gps.lng.toFixed(5)}` : 'none')) : null,
    el('div', { class: 'btnrow' },
      el('button', { class: 'btn small', onclick: () => { if (p?.gps) map.setView([p.gps.lat, p.gps.lng], 14); } }, 'Go to Photo'),
      el('button', { class: 'btn small', onclick: () => { const ids = targets(); ids.forEach((id) => delete P(id).gps); save(); draw(false); emit('meta', ids); } }, 'Remove GPS'),
      el('button', { class: 'btn small', onclick: () => draw(true) }, 'Fit All'))));
}

mod.enter = async () => {
  for (const p of ['grid', 'loupe', 'compare', 'survey', 'empty', 'slideshow', 'print']) $('#' + p).classList.add('hidden');
  $('#map').classList.remove('hidden'); $('#filterbar').classList.add('hidden');
  $('#left-panels').innerHTML = ''; $('#right-panels').innerHTML = '';
  const lp = panel('Location', { id: 'map-info' }); infoBox = lp.body; $('#right-panels').append(lp.el);
  const hp = panel('Map Module', { id: 'map-help' });
  hp.body.append(el('div', { class: 'muted small' }, 'Shows photos of the current source/filters that contain GPS coordinates. Click a pin to select its photos.'));
  $('#left-panels').append(hp.el);
  $('#toolbar').innerHTML = '';
  $('#toolbar').append(el('button', { class: 'btn small', onclick: () => emit('module', 'library') }, icon('grid'), 'Library'), el('span', { class: 'muted' }, 'Map tiles © OpenStreetMap contributors'));
  try { await ensureMap(); setTimeout(() => { map.invalidateSize(); draw(true); }, 50); }
  catch (e) { $('#map-el').textContent = 'Map could not be loaded (offline?)'; }
};
mod.leave = () => { infoBox = null; $('#map').classList.add('hidden'); };
on('list', () => { if (S.module === 'map') draw(false); });
on('selection', () => { if (S.module === 'map') { draw(false); } });
on('current', () => { if (S.module === 'map') info(); });
