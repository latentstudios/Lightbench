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
        for (const asset of rel.assets || []) {
          const a = document.querySelector(`a[data-file="${asset.name}"] [data-size]`);
          if (a) a.textContent = `(${Math.round(asset.size / 1048576)} MB)`;
        }
      })
      .catch(() => {});
  }
})();
