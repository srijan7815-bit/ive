'use strict';
/**
 * IVE — main process.
 *
 * The whole app is a quiet loop:
 *   fn + right-drag  →  glass composer  →  agent works in the background
 *   agent needs you  →  the notch grows  →  you answer  →  it shrinks away
 */
const { app, BrowserWindow, ipcMain, screen, shell, Notification, globalShortcut, Tray, Menu, nativeImage, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const config = require('./config');
const { Windows } = require('./windows');
const { FnBridge } = require('./fn-bridge');
const { Music } = require('./music');
const { Agent } = require('./ai/agent');
const { testConnection, PRESETS } = require('./ai/providers');
const { runAppleScript, runShell } = require('./shell');

let Store;
try { Store = require('electron-store'); } catch { Store = null; }

const ROOT = path.join(__dirname, '..', '..');
const DEV = process.env.IVE_DEV === '1';
const MOCK_AI = process.env.IVE_DEMO === '1';

app.setName('IVE');
if (process.platform === 'win32') app.setAppUserModelId('ai.ive.app');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

/* ------------------------------- stores --------------------------------- */

let logStore;
if (Store) {
  logStore = new Store({ name: 'ive-log', defaults: { entries: [], chat: [] } });
  var historyStore = new Store({ name: 'ive-history', defaults: { messages: [] } });
} else {
  logStore = memoryStore();
  var historyStore = memoryStore();
}
function memoryStore() {
  const data = { entries: [], messages: [], chat: [] };
  return { get: (k, d) => (data[k] === undefined ? d : data[k]), set: (k, v) => { data[k] = v; }, store: data };
}

/* ------------------------------- state ---------------------------------- */

const S = {
  gesture: null,          // active fn+right drag
  overlay: null,          // display id currently showing composer
  pending: new Map(),     // permission requests awaiting an answer
  lastExternalApp: null,
  fnDown: false,
  helper: { ok: false, reason: 'starting…' },
  accessibility: false,
  agentBusy: false,
  notchPinned: false,
  bootedAt: Date.now()
};

/* ------------------------------ windows --------------------------------- */

const windows = new Windows({
  preload: path.join(__dirname, '../preload/index.js'),
  root: path.join(ROOT, 'src'),
  dev: DEV
});

/* ------------------------------- music ---------------------------------- */

const music = new Music();

/* ------------------------------ helpers --------------------------------- */

const isOurApp = (name) => /^(ive|electron)$/i.test(String(name || '').trim());

async function frontmostApp() {
  if (process.platform !== 'darwin') return null;
  const r = await runAppleScript('tell application "System Events" to get name of first application process whose frontmost is true');
  return r.ok ? r.stdout.trim() : null;
}

async function rememberExternalApp() {
  try {
    const name = await frontmostApp();
    if (name && !isOurApp(name)) S.lastExternalApp = name;
  } catch { /* ignore */ }
}

async function restoreFocus() {
  if (process.platform !== 'darwin') return;
  const target = S.lastExternalApp;
  if (!target || isOurApp(target)) return;
  const r = await runAppleScript(`tell application "System Events" to set frontmost of process "${target.replace(/"/g, '\\"')}" to true`);
  if (!r.ok) await runShell(`open -a '${target.replace(/'/g, `'\\''`)}'`);
}

function notchSend(channel, payload) {
  windows.sendNotch(channel, payload);
}

function logEntry(entry) {
  const e = { id: crypto.randomUUID(), ts: Date.now(), ...entry };
  try {
    const entries = logStore.get('entries', []);
    entries.push(e);
    logStore.set('entries', entries.slice(-120));
  } catch {}
  notchSend('agent:log', e);
  return e;
}

function status() {
  notchSend('agent:status', { state: S.agentBusy ? 'working' : 'idle' });
}

/* --------------------------- permission desk ---------------------------- */

function requestChoice(payload) {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const timeoutMs = payload.timeoutMs || 10 * 60 * 1000;
    const timer = setTimeout(() => {
      S.pending.delete(id);
      notchSend('ask:resolved', { id, optionId: 'timeout' });
      resolve({ id: 'timeout', label: 'no answer yet', timeout: true });
    }, timeoutMs);
    S.pending.set(id, { resolve, timer, payload });
    notchSend('ask', {
      id,
      kind: payload.kind || 'permission',
      title: payload.title || 'IVE',
      body: payload.body || '',
      detail: payload.detail || '',
      options: payload.options || [
        { id: 'allow', label: 'Allow', style: 'primary' },
        { id: 'deny', label: 'Deny', style: 'danger' }
      ],
      meta: payload.meta || null
    });
    if (config.get('sound')) {
      runShell('afplay /System/Library/Sounds/Tink.aiff', { timeout: 4000 }).catch(() => {});
    }
  });
}

ipcMain.handle('ive:permission:respond', (_e, { id, optionId }) => {
  const entry = S.pending.get(id);
  if (!entry) return { ok: false };
  const option = (entry.payload.options || []).find((o) => o.id === optionId) || { id: optionId, label: optionId };
  clearTimeout(entry.timer);
  S.pending.delete(id);
  entry.resolve({ id: option.id, label: option.label });
  notchSend('ask:resolved', { id, optionId: option.id });
  return { ok: true };
});

/* ------------------------------ agent ----------------------------------- */

const agent = new Agent({
  config: {
    all: () => ({ ...config.publicConfig(), apiKey: config.getApiKey() }),
    get: (k) => config.get(k),
    set: (p) => config.set(p)
  },
  music,
  historyStore,
  authorize: (payload) => requestChoice(payload),
  requestChoice,
  notify,
  getSystemSummary,
  musicState: () => music.lastState ? music.lastState : null
});

agent.on('status', (s) => {
  S.agentBusy = s.state === 'working';
  notchSend('agent:status', s);
});
agent.on('log', (entry) => {
  logEntry(entry);
});
agent.on('done', (d) => {
  S.agentBusy = false;
  notchSend('agent:done', d);
  logEntry({ type: 'done', text: d.text, ms: d.ms });
});
agent.on('error', (e) => notchSend('agent:error', e));

function notify(title, body) {
  try {
    if (!Notification.isSupported()) return;
    new Notification({ title, body, silent: !config.get('sound') }).show();
  } catch {}
}

async function getSystemSummary() {
  const displays = screen.getAllDisplays().map((d) => ({ id: d.id, size: `${d.size.width}x${d.size.height}`, scale: d.scaleFactor, primary: d.id === screen.getPrimaryDisplay().id }));
  return {
    os: `macOS ${os.release()} (${process.platform})`,
    hostname: os.hostname(),
    user: os.userInfo().username,
    home: os.homedir(),
    date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    time: new Date().toLocaleTimeString('en-US'),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    activeApp: await frontmostApp(),
    displays
  };
}

/* ---------------------------- composers -------------------------------- */

async function captureGlass(display) {
  if (config.get('glassScreenshot') === false) return null;
  if (process.platform !== 'darwin') return null;
  try {
    const tmp = path.join(os.tmpdir(), `ive-glass-${Date.now()}.png`);
    const out = tmp.replace(/\.png$/, '.jpg');
    const b = display.bounds;
    const r = await runShell(`screencapture -x -R${b.x},${b.y},${b.width},${b.height} ${JSON.stringify(tmp)}`, { timeout: 5000 });
    if (!r.ok) return null;
    await runShell(`sips -Z 1400 -s format jpeg -s formatOptions 55 ${JSON.stringify(tmp)} --out ${JSON.stringify(out)}`, { timeout: 5000 });
    const buf = await fs.promises.readFile(out);
    await fs.promises.unlink(tmp).catch(() => {});
    await fs.promises.unlink(out).catch(() => {});
    if (buf.length < 1000) return null;
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function openComposerAt(pt) {
  if (S.overlay) return;
  await rememberExternalApp();
  const { win, display } = windows.showOverlayAt(pt) || {};
  if (!win) return;
  S.overlay = display.id;
  const local = { x: pt.x - display.bounds.x, y: pt.y - display.bounds.y };
  win.webContents.send('selection:open', { x: local.x, y: local.y, displayWidth: display.bounds.width, displayHeight: display.bounds.height });
  setTimeout(() => windows.focusOverlay(display.id), 30);
  captureGlass(display).then((glass) => {
    if (glass && S.overlay === display.id) win.webContents.send('selection:glass', { glass, bounds: display.bounds });
  });
}

function endComposer({ restore = true } = {}) {
  S.overlay = null;
  windows.hideOverlays();
  if (restore) setTimeout(() => restoreFocus(), 60);
}

/* --------------------------- fn gesture flow ---------------------------- */

const fnBridge = new FnBridge({ root: ROOT, resourcesPath: process.resourcesPath });

fnBridge.on('status', (s) => {
  S.helper = s;
  notchSend('permissions', permissionsSnapshot());
});
fnBridge.on('fn', ({ down, x, y }) => {
  S.fnDown = down;
  notchSend('fn', { down });
  if (!down && S.gesture) {
    // fn released mid-drag: finish softly.
    finishGesture({ x: S.gesture.lastX, y: S.gesture.lastY });
  }
});
fnBridge.on('right', async ({ down, x, y }) => {
  if (down) {
    if (S.overlay) return;
    await rememberExternalApp();
    const pt = { x, y };
    const display = screen.getDisplayNearestPoint(pt);
    S.gesture = {
      displayId: display.id,
      startX: x, startY: y,
      lastX: x, lastY: y,
      moved: false,
      t0: Date.now()
    };
    const { win, display: d } = windows.showOverlayAt(pt) || {};
    if (!win) return;
    S.overlay = d.id;
    win.webContents.send('selection:start', {
      x: x - d.bounds.x,
      y: y - d.bounds.y,
      displayWidth: d.bounds.width,
      displayHeight: d.bounds.height,
      gesture: true
    });
    notchSend('gesture', { phase: 'start' });
    captureGlass(d).then((glass) => {
      if (glass && S.gesture && S.overlay === d.id) win.webContents.send('selection:glass', { glass, bounds: d.bounds });
    });
  } else {
    finishGesture({ x, y });
  }
});
fnBridge.on('drag', ({ x, y }) => {
  if (!S.gesture) return;
  S.gesture.lastX = x;
  S.gesture.lastY = y;
  if (Math.abs(x - S.gesture.startX) + Math.abs(y - S.gesture.startY) > 6) S.gesture.moved = true;
  const display = screen.getAllDisplays().find((d) => d.id === S.gesture.displayId) || screen.getPrimaryDisplay();
  windows.sendOverlay('selection:move', {
    x: Math.max(0, Math.min(x - display.bounds.x, display.bounds.width)),
    y: Math.max(0, Math.min(y - display.bounds.y, display.bounds.height))
  }, { x: S.gesture.startX, y: S.gesture.startY });
});

function finishGesture(pt) {
  const g = S.gesture;
  if (!g) return;
  const display = screen.getAllDisplays().find((d) => d.id === g.displayId) || screen.getPrimaryDisplay();
  const local = {
    x: Math.max(0, Math.min(pt.x - display.bounds.x, display.bounds.width)),
    y: Math.max(0, Math.min(pt.y - display.bounds.y, display.bounds.height))
  };
  S.gesture = null;
  windows.sendOverlay('selection:end', { ...local, tap: !g.moved }, { x: g.startX, y: g.startY });
  windows.focusOverlay(g.displayId);
  notchSend('gesture', { phase: 'end' });
}

/* -------------------------------- IPC ---------------------------------- */

ipcMain.handle('ive:config:get', () => ({ config: config.publicConfig(), presets: PRESETS, platform: process.platform }));

ipcMain.handle('ive:config:set', (_e, patch) => {
  if (patch && typeof patch.apiKey === 'string') {
    config.setApiKey(patch.apiKey.trim());
    delete patch.apiKey;
  }
  config.set(patch);
  if ('launchAtLogin' in (patch || {})) {
    try { app.setLoginItemSettings({ openAtLogin: Boolean(patch.launchAtLogin), openAsHidden: true }); } catch {}
  }
  const pub = config.publicConfig();
  notchSend('config', pub);
  return pub;
});

ipcMain.handle('ive:config:key', (_e, key) => {
  config.setApiKey(String(key || '').trim());
  return { ok: true, hasApiKey: Boolean(key) };
});

ipcMain.handle('ive:provider:test', async () => {
  try {
    return await testConnection({
      provider: config.get('provider'),
      baseUrl: config.get('baseUrl'),
      apiKey: config.getApiKey(),
      model: config.get('model')
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('ive:agent:ask', async (_e, { text, source }) => {
  if (!config.getApiKey() && config.get('provider') !== 'ollama') {
    return { ok: false, error: 'Add an API key in the notch → Settings first.' };
  }
  agent.ask(text, { source: source || 'panel' });
  return { ok: true };
});

ipcMain.handle('ive:agent:cancel', () => { agent.cancel(); return { ok: true }; });
ipcMain.handle('ive:agent:reset', () => { agent.reset(); return { ok: true }; });
ipcMain.handle('ive:log:get', () => ({ entries: logStore.get('entries', []), pending: [...S.pending.keys()] }));
ipcMain.handle('ive:log:clear', () => { logStore.set('entries', []); return { ok: true }; });

ipcMain.handle('ive:music:control', async (_e, { action, value }) => music.control(action, value));
ipcMain.handle('ive:music:state', () => music.lastState || null);

ipcMain.on('ive:window:setInteractive', (_e, interactive) => {
  windows.setNotchInteractive(Boolean(interactive));
  if (interactive) rememberExternalApp();
});

ipcMain.on('ive:window:pinned', (_e, pinned) => {
  S.notchPinned = Boolean(pinned);
});

ipcMain.on('ive:window:focus', () => windows.focusNotch());
ipcMain.on('ive:window:blur', () => { windows.setNotchInteractive(false); restoreFocus(); });

ipcMain.on('ive:selection:submit', (_e, { text }) => {
  const clean = String(text || '').trim();
  endComposer({ restore: true });
  notchSend('composer:closed', {});
  if (clean) {
    agent.ask(clean, { source: 'gesture' });
    if (!config.getApiKey() && config.get('provider') !== 'ollama') {
      notchSend('ask', {
        id: 'no-key',
        kind: 'info',
        title: 'IVE is ready',
        body: 'Add a model API key to start working. Settings lives in the notch.',
        detail: '',
        options: [{ id: 'settings', label: 'Open settings', style: 'primary' }, { id: 'dismiss', label: 'Later', style: 'ghost' }]
      });
    }
  }
});

ipcMain.on('ive:selection:cancel', () => {
  S.gesture = null;
  endComposer({ restore: true });
  notchSend('composer:closed', {});
});

ipcMain.on('ive:selection:begin', async () => {
  const pt = screen.getCursorScreenPoint();
  await openComposerAt(pt);
});

ipcMain.on('ive:selection:beginCentered', async () => {
  const d = screen.getPrimaryDisplay();
  const pt = { x: d.bounds.x + d.bounds.width / 2, y: d.bounds.y + d.bounds.height * 0.42 };
  await openComposerAt(pt);
});

ipcMain.on('ive:selection:moveTo', (e, { x, y }) => {
  // reserved for future "drag the glass box" support in manual mode
});

ipcMain.on('ive:openExternal', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.on('ive:app:quit', () => app.quit());

ipcMain.on('ive:app:openApp', (_e, name) => {
  if (typeof name !== 'string' || !name.trim()) return;
  runShell(`open -a '${name.replace(/'/g, `'\\''`)}'`, { timeout: 10_000 }).catch(() => {});
});

ipcMain.on('ive:openSystemPrefs', (_e, which) => {
  const map = {
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    input: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
    automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
    screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
  };
  shell.openExternal(map[which] || map.accessibility);
});

ipcMain.handle('ive:permissions:get', () => permissionsSnapshot());
ipcMain.on('ive:permissions:prompt', () => {
  if (process.platform === 'darwin') {
    try { systemPreferences.isTrustedAccessibilityClient(true); } catch {}
    if (fnBridge.ready) fnBridge.proc?.stdin?.write(''); // no-op; helper already prompts
  }
});

ipcMain.on('ive:panel:toggle', () => notchSend('panel:toggle', {}));

function permissionsSnapshot() {
  let ax = false;
  try { if (process.platform === 'darwin') ax = systemPreferences.isTrustedAccessibilityClient(false); } catch {}
  return {
    platform: process.platform,
    accessibility: ax,
    helper: S.helper,
    screenRecording: process.platform === 'darwin' ? undefined : false
  };
}

/* -------------------------------- tray --------------------------------- */

let tray = null;
function buildTray() {
  try {
    const imgPath = path.join(ROOT, 'assets', 'trayTemplate.png');
    let img = nativeImage.createFromPath(imgPath);
    if (img.isEmpty()) img = nativeImage.createEmpty();
    if (process.platform === 'darwin') img.setTemplateImage(true);
    tray = new Tray(img);
    const playLabel = music.lastState?.playing ? 'Pause music' : 'Play music';
    tray.setToolTip('IVE');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open IVE', click: () => { windows.focusNotch(); notchSend('panel:open', { tab: 'assistant' }); } },
      { label: 'New prompt', accelerator: 'CommandOrControl+Shift+Space', click: () => openComposerAt(screen.getCursorScreenPoint()) },
      { type: 'separator' },
      { label: playLabel, click: () => music.control('playpause') },
      { label: 'Settings…', click: () => { windows.focusNotch(); notchSend('panel:open', { tab: 'settings' }); } },
      { type: 'separator' },
      { label: S.helper.ok ? 'fn gesture: listening' : `fn gesture: ${S.helper.reason || 'off'}`, enabled: false },
      { label: 'Quit IVE', role: 'quit' }
    ]));
    tray.on('click', () => { windows.focusNotch(); notchSend('panel:toggle', {}); });
  } catch { /* headless tray */ }
}

/* ------------------------------ boot ----------------------------------- */

function registerShortcuts() {
  try {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
      if (S.overlay) endComposer();
      else openComposerAt(screen.getCursorScreenPoint());
    });
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      windows.focusNotch();
      notchSend('panel:toggle', {});
    });
  } catch {}
}

app.whenReady().then(async () => {
  windows.init();
  fnBridge.start();
  music.start(3000);
  music.on('state', (s) => {
    music.lastState = s;
    notchSend('music', s);
    if (tray) buildTray();
  });
  registerShortcuts();
  setTimeout(buildTray, 600);

  // Watchdog: never leave the notch window swallowing clicks when the cursor
  // has left it (fast exits don't always deliver a mousemove to the renderer).
  setInterval(() => {
    if (!windows.interactive || S.notchPinned) return;
    if (!windows.notch || windows.notch.isDestroyed()) return;
    const b = windows.notch.getBounds();
    const c = screen.getCursorScreenPoint();
    const pad = 4;
    const inside = c.x >= b.x - pad && c.x <= b.x + b.width + pad && c.y >= b.y - pad && c.y <= b.y + b.height + pad;
    if (!inside) {
      windows.setNotchInteractive(false);
      windows.sendNotch('pointer:leave', {});
    }
  }, 180).unref?.();

  // Track which app to hand focus back to.
  setInterval(async () => {
    if (process.platform !== 'darwin') return;
    const name = await frontmostApp();
    if (name && !isOurApp(name)) S.lastExternalApp = name;
  }, 2500).unref?.();

  notchSend('permissions', permissionsSnapshot());
  notchSend('music', music.lastState || null);

  if (MOCK_AI) {
    agent.ask = (text) => {
      logEntry({ type: 'user', text, ts: Date.now() });
      notchSend('agent:status', { state: 'working', label: 'thinking' });
      setTimeout(() => {
        notchSend('agent:status', { state: 'idle' });
        const answer = `Demo: I would now work on “${text}” with my tools.`;
        logEntry({ type: 'assistant', text: answer, ts: Date.now() });
        notchSend('agent:done', { text: answer, ms: 2400 });
      }, 2200);
    };
  }
});

app.on('second-instance', () => {
  windows.focusNotch();
  notchSend('panel:open', {});
});

app.on('window-all-closed', (e) => e.preventDefault?.());

app.on('before-quit', () => {
  fnBridge.stop();
  music.stop();
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    windows.init();
  }
});
