'use strict';
/**
 * IVE — window layer (macOS + Windows).
 * One notch window (primary display) + one shadowless overlay per display for
 * the drag-to-compose gesture. Both are transparent, click-through when idle,
 * and never steal focus unless you are actively typing.
 */
const { BrowserWindow, screen, app } = require('electron');
const path = require('path');

const NOTCH_W = 660;
const NOTCH_H = 760;
const IS_MAC = process.platform === 'darwin';

function panelType() {
  return IS_MAC ? 'panel' : undefined;
}

class Windows {
  constructor({ preload, root, dev }) {
    this.preload = preload;
    this.root = root;
    this.dev = dev;
    this.notch = null;
    this.overlays = new Map();
    this.interactive = false;
  }

  init() {
    this.createNotch();
    this.createOverlays();
    screen.on('display-added', () => this.createOverlays());
    screen.on('display-removed', () => this.createOverlays());
    screen.on('display-metrics-changed', () => {
      this.positionNotch();
      this.createOverlays();
    });
  }

  notchBounds() {
    const d = screen.getPrimaryDisplay();
    return {
      x: Math.round(d.bounds.x + (d.bounds.width - NOTCH_W) / 2),
      y: Math.round(d.bounds.y),
      width: NOTCH_W,
      height: Math.min(NOTCH_H, d.bounds.height)
    };
  }

  webPreferences() {
    return {
      preload: this.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
      webSecurity: true
    };
  }

  createNotch() {
    if (this.notch && !this.notch.isDestroyed()) return this.notch;
    const b = this.notchBounds();
    const win = new BrowserWindow({
      ...b,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      acceptFirstMouse: true,
      roundedCorners: false,
      thickFrame: false,
      type: panelType(),
      webPreferences: this.webPreferences()
    });

    win.setAlwaysOnTop(true, 'screen-saver', 1);
    if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.loadFile(path.join(this.root, 'renderer/notch/index.html'));
    win.once('ready-to-show', () => win.showInactive());
    win.on('closed', () => { this.notch = null; });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('file://')) e.preventDefault();
    });
    win.webContents.on('render-process-gone', () => {
      setTimeout(() => { try { win.reload(); } catch { /* closed */ } }, 800);
    });
    if (this.dev) win.webContents.openDevTools({ mode: 'detach' });
    this.notch = win;
    return win;
  }

  positionNotch() {
    if (this.notch && !this.notch.isDestroyed()) this.notch.setBounds(this.notchBounds(), false);
  }

  createOverlays() {
    for (const [id, win] of this.overlays) {
      if (!win.isDestroyed()) win.destroy();
      this.overlays.delete(id);
    }
    for (const display of screen.getAllDisplays()) {
      const win = new BrowserWindow({
        ...display.bounds,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        acceptFirstMouse: true,
        roundedCorners: false,
        thickFrame: false,
        type: panelType(),
        webPreferences: this.webPreferences()
      });
      win.setAlwaysOnTop(true, 'pop-up-menu');
      if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.loadFile(path.join(this.root, 'renderer/overlay/index.html'), { query: { display: String(display.id) } });
      win.on('closed', () => this.overlays.delete(display.id));
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (e, url) => {
        if (!url.startsWith('file://')) e.preventDefault();
      });
      this.overlays.set(display.id, win);
    }
  }

  overlayForPoint(pt) {
    const display = screen.getDisplayNearestPoint(pt);
    return { win: this.overlays.get(display.id), display };
  }

  showOverlayAt(pt) {
    const { win, display } = this.overlayForPoint(pt);
    if (!win) return null;
    win.showInactive();
    win.setAlwaysOnTop(true, 'pop-up-menu');
    if (this.notch && !this.notch.isDestroyed()) this.notch.setAlwaysOnTop(true, 'screen-saver', 1);
    return { win, display };
  }

  hideOverlays() {
    for (const win of this.overlays.values()) {
      if (!win.isDestroyed()) win.hide();
    }
  }

  sendNotch(channel, payload) {
    if (this.notch && !this.notch.isDestroyed()) this.notch.webContents.send(channel, payload);
  }

  sendOverlay(channel, payload, pt) {
    const target = pt ? this.overlayForPoint(pt).win : [...this.overlays.values()].find((w) => !w.isDestroyed() && w.isVisible());
    if (target && !target.isDestroyed()) target.webContents.send(channel, payload);
  }

  setNotchInteractive(interactive) {
    if (!this.notch || this.notch.isDestroyed()) return;
    if (interactive === this.interactive) return;
    this.interactive = interactive;
    this.notch.setIgnoreMouseEvents(!interactive, { forward: true });
  }

  focusOverlay(displayId) {
    const win = displayId ? this.overlays.get(displayId) : [...this.overlays.values()].find((w) => w.isVisible());
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
    return win;
  }

  focusNotch() {
    if (!this.notch || this.notch.isDestroyed()) return;
    this.setNotchInteractive(true);
    this.notch.show();
    this.notch.focus();
  }

  blurOverlay() {
    for (const win of this.overlays.values()) {
      if (!win.isDestroyed()) win.hide();
    }
  }

  setDockVisible(visible) {
    if (!IS_MAC) return;
    try {
      if (visible) app.dock.show();
      else app.dock.hide();
    } catch { /* no dock in some sessions */ }
  }
}

module.exports = { Windows, NOTCH_W, NOTCH_H };
