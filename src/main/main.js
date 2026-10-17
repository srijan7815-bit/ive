'use strict';
/**
 * IVE — main process (macOS + Windows).
 *
 *   gesture  →  glass composer  →  agent works in the background
 *   agent needs you  →  the notch grows  →  you answer  →  it shrinks away
 */
const { app, BrowserWindow, ipcMain, screen, shell, Notification, globalShortcut, Tray, Menu, nativeImage, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const { logger } = require('./logger');
const config = require('./config');
const platform = require('./platform');
const { Windows } = require('./windows');
const { GestureBridge } = require('./gesture-bridge');
const { Music } = require('./music');
const { Updates } = require('./updates');
const { Agent } = require('./ai/agent');
const { testConnection, PRESETS } = require('./ai/providers');
const { runShell } = require('./shell');

let Store;
try { Store = require('electron-store'); } catch { Store = null; }

const ROOT = path.join(__dirname, '..', '..');
const DEV = process.env.IVE_DEV === '1';
const MOCK_AI = process.env.IVE_DEMO === '1';
const IS_MAC = process.platform === 'darwin';

app.setName('IVE');
if (process.platform === 'win32') app.setAppUserModelId('ai.ive.app');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/* ---------------------------- crash safety ------------------------------ */

process.on('uncaughtException', (e) => {
  logger.error('uncaughtException', e);
});
process.on('unhandledRejection', (e) => {
  logger.error('unhandledRejection', e);
});

/* ------------------------------- stores --------------------------------- */

function memoryStore(seed) {
  const data = { entries: [], messages: [], chat: [], ...(seed || {}) };
  return {
    get: (k, d) => (data[k] === undefined ? d : data[k]),
    set: (k, v) => { data[k] = v; },
    store: data
  };
}

let logStore;
let historyStore;
try {
  logStore = Store ? new Store({ name: 'ive-log', defaults: { entries: [] } }) : memoryStore();
  historyStore = Store ? new Store({ name: 'ive-history', defaults: { messages: [] } }) : memoryStore();
} catch (e) {
  logger.warn('electron-store unavailable, using memory store', e.message);
  logStore = memoryStore();
  historyStore = memoryStore();
}

/* ------------------------------- state ---------------------------------- */

const S = {
  gesture: null,
  overlay: null,
  pending: new Map(),
  lastExternalApp: null,
  fnDown: false,
  helper: { ok: false, reason: 'starting…' },
  accessibility: false,
  agentBusy: false,
  notchPinned: false,
  bootedAt: Date.now()
};

logger.setDir(path.join(app.getPath('userData'), 'logs'));
logger.info(`IVE ${app.getVersion()} boot · ${process.platform}/${process.arch} · electron ${process.versions.electron}`);

/* ------------------------------ windows --------------------------------- */

const windows = new Windows({
  preload: path.join(__dirname, '../preload/index.js'),
  root: path.join(ROOT, 'src'),
  dev: DEV
});

const music = new Music();
const updates = new Updates({ enabled: config.get('autoUpdate') !== false });

/* ------------------------------ helpers --------------------------------- */

const isOurApp = (name) => /^(ive|electron|ive\.exe|electron\.exe)$/i.test(String(name || '').trim());

async function frontmostApp() {
  try { return await platform.activeApp(); } catch { return null; }
}

async function rememberExternalApp() {
  const name = await frontmostApp();
  if (name && !isOurApp(name)) S.lastExternalApp = name;
}

async function restoreFocus() {
  const target = S.lastExternalApp;
  if (!target || isOurApp(target)) return;
  try {
    await platform.openApp(target, 'activate');
  } catch { /* best effort */ }
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
  } catch { /* ignore */ }
  notchSend('agent:log', e);
  return e;
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
    if (config.get('sound')) runShell('afplay /System/Library/Sounds/Tink.aiff', { timeout: 4000 }).catch(() => {});
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
  musicState: () => music.lastState
});

agent.on('status', (s) => {
  S.agentBusy = s.state === 'working';
  notchSend('agent:status', s);
});
agent.on('log', (entry) => logEntry(entry));
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
  } catch { /* ignore */ }
}

async function getSystemSummary() {
  const displays = screen.getAllDisplays().map((d) => ({
    id: d.id, size: `${d.size.width}x${d.size.height}`, scale: d.scaleFactor,
    primary: d.id === screen.getPrimaryDisplay().id
  }));
  const info = await platform.systemInfo();
  return {
    ...info,
    date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    time: new Date().toLocaleTimeString('en-US'),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    activeApp: await frontmostApp(),
    displays,
    capabilities: platform.capabilities
  };
}

/* ---------------------------- composers -------------------------------- */

async function captureGlass(display) {
  if (config.get('glassScreenshot') === false) return null;
  try {
    const tmp = path.join(os.tmpdir(), `ive-glass-${Date.now()}.jpg`);
    const res = await platform.screenshot(tmp);
    if (!res.ok) return null;
    const r = await runShell(
      IS_MAC ? `sips -Z 1400 -s format jpeg -s formatQuality 55 "${tmp}" --out "${tmp}"` : 'echo skip',
      { timeout: 5000 }
    );
    const buf = await fs.promises.readFile(tmp);
    await fs.promises.unlink(tmp).catch(() => {});
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

/* --------------------------- gesture flow ------------------------------- */

const gestures = new GestureBridge({ root: ROOT, resourcesPath: process.resourcesPath });

gestures.on('status', (s) => {
  S.helper = { ...s, modifier: gestures.modifierLabel };
  notchSend('permissions', permissionsSnapshot());
});
gestures.on('fn', ({ down, x, y }) => {
  S.fnDown = down;
  notchSend('fn', { down });
  if (!down && S.gesture) finishGesture({ x: S.gesture.lastX, y: S.gesture.lastY });
});
gestures.on('right', async ({ down, x, y }) => {
  if (down) {
    if (S.overlay) return;
    await rememberExternalApp();
    const display = screen.getDisplayNearestPoint({ x, y });
    S.gesture = { displayId: display.id, startX: x, startY: y, lastX: x, lastY: y, moved: false, t0: Date.now() };
    const { win, display: d } = windows.showOverlayAt({ x, y }) || {};
    if (!win) return;
    S.overlay = d.id;
    win.webContents.send('selection:start', {
      x: x - d.bounds.x, y: y - d.bounds.y,
      displayWidth: d.bounds.width, displayHeight: d.bounds.height, gesture: true
    });
    notchSend('gesture', { phase: 'start' });
    captureGlass(d).then((glass) => {
      if (glass && S.gesture && S.overlay === d.id) win.webContents.send('selection:glass', { glass, bounds: d.bounds });
    });
  } else {
    finishGesture({ x, y });
  }
});
gestures.on('drag', ({ x, y }) => {
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

ipcMain.handle('ive:config:get', () => ({
  config: config.publicConfig(),
  presets: PRESETS,
  platform: process.platform,
  arch: process.arch,
  version: app.getVersion(),
  modifier: gestures.modifierLabel,
  capabilities: platform.capabilities,
  packaged: app.isPackaged
}));

ipcMain.handle('ive:config:set', (_e, patch) => {
  if (patch && typeof patch.apiKey === 'string') {
    config.setApiKey(patch.apiKey.trim());
    delete patch.apiKey;
  }
  config.set(patch);
  if (patch && 'launchAtLogin' in patch) {
    try { app.setLoginItemSettings({ openAtLogin: Boolean(patch.launchAtLogin), openAsHidden: true }); } catch { /* unsupported */ }
  }
  if (patch && 'showInDock' in patch && IS_MAC) windows.setDockVisible(Boolean(patch.showInDock));
  if (patch && 'autoUpdate' in patch) updates.enabled = Boolean(patch.autoUpdate) && updates.enabled;
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
ipcMain.handle('ive:log:tail', () => logger.tail(300));

ipcMain.handle('ive:music:control', async (_e, { action, value }) => music.control(action, value));
ipcMain.handle('ive:music:state', () => music.lastState || null);

ipcMain.handle('ive:updates:status', () => updates.snapshot());
ipcMain.handle('ive:updates:check', () => updates.check());
ipcMain.handle('ive:updates:install', () => ({ ok: updates.install() }));

ipcMain.on('ive:window:setInteractive', (_e, interactive) => {
  windows.setNotchInteractive(Boolean(interactive));
  if (interactive) rememberExternalApp();
});
ipcMain.on('ive:window:pinned', (_e, pinned) => { S.notchPinned = Boolean(pinned); });
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

ipcMain.on('ive:selection:begin', async () => openComposerAt(screen.getCursorScreenPoint()));
ipcMain.on('ive:selection:beginCentered', async () => {
  const d = screen.getPrimaryDisplay();
  await openComposerAt({ x: d.bounds.x + d.bounds.width / 2, y: d.bounds.y + d.bounds.height * 0.42 });
});

ipcMain.on('ive:openExternal', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.on('ive:app:quit', () => app.quit());
ipcMain.on('ive:app:openApp', (_e, name) => {
  if (typeof name !== 'string' || !name.trim()) return;
  platform.openApp(name, 'open').catch(() => {});
});

ipcMain.on('ive:openSystemPrefs', (_e, which) => {
  platform.openSettings(which);
});

ipcMain.handle('ive:permissions:get', () => permissionsSnapshot());
ipcMain.on('ive:permissions:prompt', () => {
  if (IS_MAC) {
    try { systemPreferences.isTrustedAccessibilityClient(true); } catch { /* ignore */ }
  }
});

ipcMain.on('ive:panel:toggle', () => notchSend('panel:toggle', {}));

function permissionsSnapshot() {
  let ax = true;
  if (IS_MAC) {
    try { ax = systemPreferences.isTrustedAccessibilityClient(false); } catch { ax = false; }
  }
  return {
    platform: process.platform,
    accessibility: ax,
    needsAccessibility: IS_MAC,
    helper: S.helper,
    modifier: gestures.modifierLabel,
    capabilities: platform.capabilities
  };
}

/* -------------------------------- tray --------------------------------- */

let tray = null;
function buildTray() {
  try {
    const trayFile = process.platform === 'win32' ? 'tray-win.png' : 'trayTemplate.png';
    let img = nativeImage.createFromPath(path.join(ROOT, 'assets', trayFile));
    if (img.isEmpty()) img = nativeImage.createEmpty();
    if (IS_MAC) img.setTemplateImage(true);
    if (!tray) tray = new Tray(img);
    else tray.setImage(img);
    const playing = music.lastState && music.lastState.playing;
    tray.setToolTip('IVE');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open IVE', click: () => { windows.focusNotch(); notchSend('panel:open', { tab: 'assistant' }); } },
      { label: 'New prompt', accelerator: 'CommandOrControl+Shift+Space', click: () => openComposerAt(screen.getCursorScreenPoint()) },
      { type: 'separator' },
      { label: playing ? 'Pause music' : 'Play music', click: () => music.control('playpause') },
      { label: 'Settings…', click: () => { windows.focusNotch(); notchSend('panel:open', { tab: 'settings' }); } },
      { type: 'separator' },
      { label: S.helper.ok ? `${gestures.modifierLabel} + right-drag: live` : `gesture: ${S.helper.reason || 'off'}`, enabled: false },
      { label: 'Quit IVE', role: 'quit' }
    ]));
    tray.on('click', () => { windows.focusNotch(); notchSend('panel:toggle', {}); });
  } catch (e) {
    logger.warn('tray unavailable', e.message);
  }
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
  } catch (e) {
    logger.warn('shortcut registration failed', e.message);
  }
}

app.whenReady().then(async () => {
  windows.init();
  windows.setDockVisible(Boolean(config.get('showInDock')));
  gestures.start();
  music.start(3000);
  music.on('state', (s) => {
    notchSend('music', s);
    if (tray) buildTray();
  });
  updates.init();
  updates.on('status', (s) => notchSend('updates', s));
  registerShortcuts();
  setTimeout(buildTray, 600);

  // Watchdog: never leave the notch swallowing clicks once the cursor leaves.
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
  }, 180);

  // Track which app to hand focus back to.
  setInterval(async () => {
    const name = await frontmostApp();
    if (name && !isOurApp(name)) S.lastExternalApp = name;
  }, 2500);

  notchSend('permissions', permissionsSnapshot());
  notchSend('music', music.lastState);

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
  gestures.stop();
  music.stop();
  globalShortcut.unregisterAll();
  logger.info('quit');
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) windows.init();
});
