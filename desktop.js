// Lightbench desktop app (Electron): runs the local server in-process and shows the UI in a native window.
'use strict';
const { app, BrowserWindow, Menu, shell, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// Fixed port so the page origin stays the same between launches (keeps AI models and UI prefs cached).
// LIGHTBENCH_DESKTOP_PORT / LIGHTBENCH_USER_DATA let a test instance run fully isolated from the everyday one.
const PORT = Number(process.env.LIGHTBENCH_DESKTOP_PORT || 5196); // 5198 is used by the personal edition
if (process.env.LIGHTBENCH_USER_DATA) app.setPath('userData', process.env.LIGHTBENCH_USER_DATA);
let win = null;

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(launch);
}
app.on('window-all-closed', () => app.quit());

const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return null; } }
function saveState() {
  if (!win) return;
  try { fs.writeFileSync(stateFile(), JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() })); } catch {}
}

// macOS needs an application menu (Quit, Hide…) and an Edit menu for ⌘C/⌘V/⌘X in text fields.
// Undo/Select All are deliberately left out so ⌘Z (edit history) and ⌘A (select photos) reach the app.
function macMenu() {
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }] },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, { type: 'separator' }, { label: 'Reload', accelerator: 'Cmd+Shift+R', click: () => win?.webContents.reloadIgnoringCache() }, { role: 'toggleDevTools', accelerator: 'Cmd+Alt+I' }] },
    { role: 'windowMenu' },
  ]);
}

async function launch() {
  Menu.setApplicationMenu(process.platform === 'darwin' ? macMenu() : null);
  let url;
  try {
    process.env.LIGHTBENCH_PORT = String(PORT);
    ({ url } = await require('./server.js').start({ port: PORT }));
  } catch (e) {
    dialog.showErrorBox('Lightbench', e.code === 'EADDRINUSE'
      ? `Port ${PORT} is already in use. Close any other copy of Lightbench (or the program using that port) and try again.`
      : 'Lightbench could not start:\n\n' + (e.stack || e.message));
    app.quit();
    return;
  }

  const st = loadState();
  const area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: Math.min(1600, area.width), height: Math.min(1000, area.height), minWidth: 1000, minHeight: 640,
    ...(st?.bounds || {}),
    show: false, backgroundColor: '#171717', title: 'Lightbench', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    // backgroundThrottling off: imports, AI analysis and AI Denoise keep full speed while minimized
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false, backgroundThrottling: false },
  });
  if (st?.maximized !== false) win.maximize();
  win.once('ready-to-show', () => win.show());

  // Links (e.g. map attribution, feedback email) open in the normal browser / mail app, never inside the app.
  const external = (u) => /^(https?|mailto):/.test(u);
  win.webContents.setWindowOpenHandler(({ url: u }) => { if (external(u)) shell.openExternal(u); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(url)) { e.preventDefault(); if (external(u)) shell.openExternal(u); } });

  // If the window's page crashes, offer to reload (the catalog is saved continuously) or report it.
  win.webContents.on('render-process-gone', async (_e, details) => {
    if (details.reason === 'clean-exit' || !win) return;
    const { response } = await dialog.showMessageBox(win, {
      type: 'error', title: 'Lightbench', buttons: ['Reload', 'Report Problem', 'Quit'], defaultId: 0, cancelId: 2,
      message: 'Lightbench stopped unexpectedly.',
      detail: `Your catalog and edits are saved. Reload to carry on.\n\n(${details.reason}, code ${details.exitCode})`,
    });
    if (response === 1) {
      const pkg = require('./package.json');
      const body = `What were you doing when it happened?\n\n\n---\nLightbench ${pkg.version}\n${process.platform} ${require('os').release()} (${process.arch})\nCrash: ${details.reason}, code ${details.exitCode}`;
      shell.openExternal(`https://github.com/${pkg.build.publish.owner}/${pkg.build.publish.repo}/issues/new?title=${encodeURIComponent('[Crash] Lightbench stopped unexpectedly')}&body=${encodeURIComponent(body)}`);
    }
    if (response === 2) { flushed = true; app.quit(); } else if (win) win.reload();
  });

  // Developer tools (Ctrl+Alt+Shift+I) and reload (Ctrl+F5) remain available for troubleshooting.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    if (mod && input.shift && input.key.toLowerCase() === 'i' && input.alt) { win.webContents.toggleDevTools(); e.preventDefault(); }
    if (mod && input.key === 'F5') { win.webContents.reloadIgnoringCache(); e.preventDefault(); }
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });

  // Make sure the catalog is saved before the window goes away.
  let flushed = false;
  win.on('close', (e) => {
    saveState();
    if (flushed) return;
    e.preventDefault();
    const done = () => { flushed = true; win.close(); };
    const t = setTimeout(done, 4000);
    win.webContents.executeJavaScript('window.__flush ? window.__flush() : null').catch(() => {}).finally(() => { clearTimeout(t); done(); });
  });
  win.on('closed', () => { win = null; });

  win.loadURL(url);
}
