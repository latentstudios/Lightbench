// AI Denoise dialog (single or batch).
import { C, P, srcId, emit, save } from './store.js';
import { el, modal, slider, toast, prefs } from './ui.js';
import { runDenoise } from './denoise.js';
import { loadSource, queueThumb } from './imaging.js';

export function openDenoise(ids) {
  ids = [...new Set(ids.map((id) => srcId(P(id))))].filter((id) => P(id));
  if (!ids.length) return;
  let model = prefs.get('dnModel', 'natural'), amount = prefs.get('dnAmount', 75), cancelled = false, running = false;
  const bar = el('div', { style: { height: '100%', width: '0%', background: 'var(--accent)', transition: 'width .2s' } });
  const status = el('div', { class: 'muted small', style: { minHeight: '18px', marginTop: '6px' } });
  const progress = el('div', { style: { height: '6px', background: '#333', borderRadius: '3px', overflow: 'hidden', marginTop: '12px' } }, bar);
  const modelSel = el('select', { onchange: () => { model = modelSel.value; prefs.set('dnModel', model); } },
    el('option', { value: 'natural', selected: model === 'natural' }, 'Natural — faithful detail (recommended)'),
    el('option', { value: 'detailed', selected: model === 'detailed' }, 'Detailed — crisper, may invent fine texture'));
  const body = el('div', {},
    el('div', { style: { lineHeight: 1.5, marginBottom: '10px' } }, `Removes noise from ${ids.length > 1 ? ids.length + ' photos' : '“' + P(ids[0]).name + '”'} with an AI model (SCUNet), at full resolution on your graphics card. RAW photos keep their full editing latitude. Your original files are never changed — you can turn it off or adjust the amount any time in Develop › Detail.`),
    el('div', { class: 'field' }, el('label', {}, 'Model'), modelSel),
    slider({ label: 'Amount', min: 0, max: 100, value: amount, def: 75, onInput: (v) => { amount = v; prefs.set('dnAmount', v); } }).el,
    progress, status);
  const m = modal('AI Denoise', body, {
    cls: 'small',
    onClose: () => { cancelled = true; },
    buttons: [
      { label: 'Cancel', onClick: () => { cancelled = true; } },
      { label: 'Denoise', cls: 'primary', close: false, onClick: async () => {
        if (running) return; running = true;
        const btn = m.el.querySelector('.modal-foot .btn.primary'); btn.disabled = true;
        let ok = 0;
        for (let i = 0; i < ids.length && !cancelled; i++) {
          const p = P(ids[i]);
          status.textContent = `${i + 1}/${ids.length} · ${p.name} · loading…`;
          try {
            await runDenoise(p, {
              model, loadSource, isCancelled: () => cancelled,
              onProgress: (f, eta, ep) => { bar.style.width = (((i + f) / ids.length) * 100).toFixed(1) + '%'; status.textContent = `${i + 1}/${ids.length} · ${p.name} · ${Math.round(f * 100)}% · about ${eta}s left${ep === 'wasm' ? ' (CPU — no GPU available, slower)' : ''}`; },
            });
            p.denoise.amount = amount; save();
            ok++;
            queueThumb(p.id); for (const v of Object.values(C.photos)) if (v.master === p.id) queueThumb(v.id);
            emit('denoised', p.id);
          } catch (e) {
            if (e.message === 'cancelled') break;
            console.error(e); toast(`AI Denoise failed for ${p.name}: ${e.message}`, true, 6000);
          }
        }
        if (!cancelled) { m.close(); toast(`AI Denoise finished (${ok} photo${ok === 1 ? '' : 's'})`); }
        else toast('AI Denoise cancelled');
      } },
    ],
  });
}
