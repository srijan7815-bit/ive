// Minimal Electron stub for headless module smoke-tests.
const EventEmitter = require('events');
const noop = () => {};
const app = new EventEmitter();
Object.assign(app, {
  setName: noop, setAppUserModelId: noop, requestSingleInstanceLock: () => true,
  whenReady: () => new Promise((res) => setImmediate(res)), quit: noop, on: app.on.bind(app),
  getPath: () => require('os').tmpdir(), setLoginItemSettings: noop, isPackaged: false, getVersion: () => '0.1.0', getLocale: () => 'en-US', getName: () => 'IVE'
});
class BW extends EventEmitter {
  constructor(opts = {}) { super(); this.opts = opts; this.webContents = { send: noop, openDevTools: noop, setWindowOpenHandler: noop, on: noop }; }
  setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setIgnoreMouseEvents() {}
  loadFile(p) { this._file = p; } showInactive() {} show() {} focus() {} blur() {} hide() {} destroy() {}
  isDestroyed() { return false; } setBounds() {} once(e, cb) { if (e === 'ready-to-show') setTimeout(cb, 0); return this; }
  getBounds() { return this.opts; }
}
const screen = {
  getPrimaryDisplay: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, size: { width: 1440, height: 900 }, scaleFactor: 2 }),
  getAllDisplays: () => [screen.getPrimaryDisplay()],
  getDisplayNearestPoint: () => screen.getPrimaryDisplay(),
  getCursorScreenPoint: () => ({ x: 100, y: 100 }),
  on: noop
};
module.exports = {
  app, BrowserWindow: BW, screen,
  ipcMain: { handle: noop, on: noop },
  shell: { openExternal: noop },
  Notification: class { constructor(o) { this.o = o; } static isSupported() { return false; } show() {} },
  globalShortcut: { register: () => true, unregisterAll: noop },
  Tray: class { constructor() {} setToolTip() {} setContextMenu() {} on() {} },
  Menu: { buildFromTemplate: (t) => ({ t }) },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true, setTemplateImage: noop }), createEmpty: () => ({}) },
  systemPreferences: { isTrustedAccessibilityClient: () => false },
  safeStorage: { isEncryptionAvailable: () => false }
};
