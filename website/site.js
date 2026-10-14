// Download buttons: point at the latest GitHub release, highlight the visitor's platform,
// and show the live version / file sizes when the GitHub API is reachable.
(function () {
  const cfg = window.LIGHTBENCH || {};
  const repo = cfg.repo || '';
  const configured = repo && !/YOUR-GITHUB-USERNAME/.test(repo);
  const base = configured ? `https://github.com/${repo}/releases/latest/download/` : null;

  // ----- which platform is the visitor on? -----
  function detect() {
    const ua = navigator.userAgent, plat = navigator.userAgentData?.platform || navigator.platform || '';
    if (/Win/i.test(plat) || /Windows/i.test(ua)) return 'win';
    if (/Mac/i.test(plat) || /Macintosh/i.test(ua)) {
      // Browsers report "Intel" even on Apple silicon; the GPU name gives it away.
      try {
        const gl = document.createElement('canvas').getContext('webgl');
        const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
        if (/Intel|AMD|Radeon|NVIDIA/i.test(r)) return 'mac-intel';
      } catch (e) { /* ignore */ }
      return 'mac-arm'; // most Macs sold since 2020
    }
    return null;
  }
  const os = detect();
  const labels = { win: 'Download for Windows', 'mac-arm': 'Download for Mac (Apple silicon)', 'mac-intel': 'Download for Mac (Intel)' };

  // ----- wire up buttons -----
  document.querySelectorAll('.dl').forEach((card) => {
    const a = card.querySelector('a[data-file]');
    if (base) a.href = base + a.dataset.file;
    else { a.href = '#download'; a.addEventListener('click', (e) => { e.preventDefault(); alert('Downloads will be available here once the first release is published.'); }); }
    if (card.dataset.os === os) {
      card.classList.add('recommended');
      const h = card.querySelector('h3'), b = document.createElement('span');
      b.className = 'badge'; b.textContent = 'Your system'; h.appendChild(b);
    }
  });
  if (os) {
    document.getElementById('hero-dl-label').textContent = labels[os];
    const file = document.querySelector(`.dl[data-os="${os}"] a`);
    document.getElementById('hero-dl').href = file.href;
  }
  // ----- support / donations -----
  if (cfg.donate) document.querySelectorAll('[data-donate]').forEach((a) => { a.href = cfg.donate; });
  document.querySelectorAll('[data-discord]').forEach((a) => { if (cfg.discord) a.href = cfg.discord; else a.remove(); });
  document.querySelectorAll('[data-email]').forEach((a) => { if (cfg.email) { a.href = 'mailto:' + cfg.email; a.title = cfg.email; } else a.remove(); });
  const g = cfg.goal;
  if (g && g.target) {
    const cur = g.currency || '$', raised = Math.max(0, Number(g.raised) || 0);
    document.getElementById('goal-label').textContent = 'Goal: ' + g.label;
    document.getElementById('goal-amount').textContent = raised >= g.target
      ? 'Reached — thank you! 💛'
      : raised > 0 ? `${cur}${raised} of ${cur}${g.target}` : `${cur}${g.target}`;
    document.getElementById('goal-fill').style.width = Math.min(100, (raised / g.target) * 100) + '%';
    document.getElementById('goal').hidden = false;
  }

  const releases = configured ? `https://github.com/${repo}/releases` : '#download';
  document.getElementById('all-releases').href = releases;
  document.getElementById('gh-link').href = configured ? `https://github.com/${repo}` : '#';

  // ----- live version + sizes -----
  const setVersion = (v) => {
    document.querySelectorAll('.ver').forEach((e) => (e.textContent = v));
    document.getElementById('hero-version').textContent = 'Version ' + v;
  };
  if (cfg.version) setVersion(cfg.version);
  if (configured) {
    fetch(`https://api.github.com/repos/${repo}/releases/latest`)
      .then((r) => (r.ok ? r.json() : null))
      .then((rel) => {
        if (!rel) return;
        setVersion(String(rel.tag_name || '').replace(/^v/, '') || cfg.version);
        const names = new Set((rel.assets || []).map((x) => x.name));
        for (const asset of rel.assets || []) {
          const a = document.querySelector(`a[data-file="${asset.name}"] [data-size]`);
          if (a) a.textContent = `(${Math.round(asset.size / 1048576)} MB)`;
        }
        // A build that isn't in this release yet (e.g. the Mac one) — don't offer a dead link.
        document.querySelectorAll('a[data-file]').forEach((a) => {
          if (names.has(a.dataset.file)) return;
          a.removeAttribute('href');
          a.classList.add('unavailable');
          a.title = 'Coming soon';
          const s = a.querySelector('[data-size]');
          if (s) s.textContent = '(coming soon)';
        });
      })
      .catch(() => {});
  }

  // ----- "your download has started" + how to get past the first-launch warning -----
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const GUIDES = {
    win: {
      title: 'Installing on Windows',
      mock: `<div class="mock win">
          <div class="mock-win-title">Windows protected your PC</div>
          <p>Microsoft Defender SmartScreen prevented an unrecognized app from starting. Running this app might put your PC at risk.</p>
          <p class="mock-link"><span class="hl">More info</span></p>
          <div class="mock-win-btns"><span class="mock-btn hl">Run anyway</span><span class="mock-btn">Don't run</span></div>
        </div>`,
      steps: [
        'Open <b>Lightbench-Setup-win-x64.exe</b> from your Downloads.',
        'If a blue <b>“Windows protected your PC”</b> box appears, click <b>More info</b>.',
        'Click <b>Run anyway</b>, then follow the installer.',
      ],
      why: 'This appears because Lightbench is new and not yet signed with a paid Microsoft certificate — not because anything is wrong. You only see it once.',
    },
    mac: {
      title: 'Installing on Mac',
      mock: `<div class="mock mac">
          <div class="mock-mac-icon">!</div>
          <p><b>“Lightbench” Not Opened</b></p>
          <p class="small">Apple could not verify “Lightbench” is free of malware…</p>
          <div class="mock-mac-btns"><span class="mock-btn hl">Done</span><span class="mock-btn">Move to Bin</span></div>
        </div>
        <div class="mock mac settings">
          <p class="small"><b>Privacy &amp; Security</b> · Security</p>
          <p class="small">“Lightbench” was blocked to protect your Mac.</p>
          <div class="mock-mac-btns"><span class="mock-btn hl">Open Anyway</span></div>
        </div>`,
      steps: [
        'Open the downloaded <b>.dmg</b> and drag <b>Lightbench</b> into <b>Applications</b>.',
        'Open Lightbench. When macOS says it can’t be opened, click <b>Done</b> (not Move to Bin).',
        'Open <b>System Settings → Privacy &amp; Security</b>, scroll down and click <b>Open Anyway</b>, then confirm.',
      ],
      extra: 'If it says Lightbench <b>is damaged</b>: open Terminal and run <kbd>xattr -cr /Applications/Lightbench.app &amp;&amp; codesign --force --deep -s - /Applications/Lightbench.app</kbd>',
      why: 'Apple charges $99 a year to sign apps, which Lightbench can’t afford yet — <a href="#support" data-close>help us remove this step ☕</a>. You only need to do it once.',
    },
  };
  let modal = null;
  function showGuide(kind, started) {
    const g = GUIDES[kind]; if (!g) return;
    if (modal) modal.remove();
    const help = (cfg.email ? `<a class="btn ghost" href="mailto:${esc(cfg.email)}?subject=${encodeURIComponent('Help with Lightbench')}" title="${esc(cfg.email)}"><svg viewBox="0 0 24 24"><path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 2v.4l8 5 8-5V7zm16 2.8-7.5 4.7a1 1 0 0 1-1 0L4 9.8V17h16z"/></svg>Email us</a>` : '') + (cfg.discord
      ? `<a class="btn discord" href="${esc(cfg.discord)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M19.6 5.3A16.6 16.6 0 0 0 15.5 4l-.5 1a15.4 15.4 0 0 0-6 0l-.5-1a16.6 16.6 0 0 0-4.1 1.3C1.8 9.2 1.1 13 1.4 16.8a16.8 16.8 0 0 0 5 2.5l1.1-1.7-1.7-.8.4-.3a11.9 11.9 0 0 0 11.6 0l.4.3-1.7.8 1.1 1.7a16.7 16.7 0 0 0 5-2.5c.4-4.4-.7-8.2-2.9-11.5zM8.5 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg>Join our Discord for help</a>`
      : '');
    modal = document.createElement('div');
    modal.className = 'guide-back';
    modal.innerHTML = `<div class="guide" role="dialog" aria-modal="true" aria-label="${esc(g.title)}">
        <button class="guide-x" aria-label="Close" data-close>×</button>
        ${started ? '<div class="guide-started"><span>✓</span> Your download has started</div>' : ''}
        <h3>${g.title}</h3>
        <p class="guide-lead">You'll probably see a warning the first time. It's expected — here's what to click:</p>
        <div class="guide-body">
          <ol>${g.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
          <div class="guide-mocks">${g.mock}</div>
        </div>
        ${g.extra ? `<p class="guide-extra">${g.extra}</p>` : ''}
        <p class="guide-why">${g.why}</p>
        <div class="guide-foot">${help}<button class="btn primary" data-close>Got it</button></div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => { modal?.remove(); modal = null; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) close(); });
    modal.querySelector('.btn.primary').focus();
  }
  const kindOf = (file) => (/\.exe$/i.test(file || '') ? 'win' : /\.dmg$/i.test(file || '') ? 'mac' : null);
  document.querySelectorAll('a[data-file]').forEach((a) => a.addEventListener('click', () => {
    if (a.getAttribute('href')) setTimeout(() => showGuide(kindOf(a.dataset.file), true), 150); // let the download start first
  }));
  const hero = document.getElementById('hero-dl');
  hero.addEventListener('click', () => { const k = kindOf(hero.getAttribute('href')); if (k) setTimeout(() => showGuide(k, true), 150); });
  document.querySelectorAll('[data-help]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showGuide(a.dataset.help, false); }));
})();
