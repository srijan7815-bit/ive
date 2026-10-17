'use strict';
/**
 * IVE — updates.
 * electron-updater against GitHub Releases. Silent by default: the notch shows
 * a small "update ready" row, and installing is always a click.
 */
const { EventEmitter } = require('events');
const os = require('os');
const { app } = require('electron');
const { logger } = require('./logger');

let cached = null;
/** Loaded lazily: electron-updater is only useful inside a packaged app, and
 *  requiring it from a dev shell prints package-type warnings. */
function loadUpdater() {
  if (cached !== null) return cached;
  try {
    cached = require('electron-updater').autoUpdater;
  } catch {
    cached = false;
  }
  return cached;
}

class Updates extends EventEmitter {
  constructor({ enabled = true } = {}) {
    super();
    this.enabled = enabled;
    this.state = 'idle'; // idle | checking | available | downloading | ready | error | current
    this.info = null;
    this.error = null;
    this.lastChecked = 0;
  }

  init() {
    if (!this.enabled) {
      this.state = 'disabled';
      return;
    }
    // autoUpdater only makes sense for an installed app.
    if (!app.isPackaged) {
      this.enabled = false;
      this.state = 'dev';
      return;
    }
    const autoUpdater = loadUpdater();
    if (!autoUpdater) {
      this.enabled = false;
      this.state = 'disabled';
      return;
    }
    this.au = autoUpdater;
    this.au.autoDownload = true;
    this.au.autoInstallOnAppQuit = true;
    this.au.allowPrerelease = false;
    this.au.logger = {
      info: (...a) => logger.info('[update]', ...a),
      warn: (...a) => logger.warn('[update]', ...a),
      error: (...a) => logger.error('[update]', ...a),
      debug: (...a) => logger.debug('[update]', ...a)
    };

    this.au.on('checking-for-update', () => this.set('checking'));
    this.au.on('update-available', (info) => {
      this.info = info;
      this.set('available');
    });
    this.au.on('update-not-available', () => this.set('current'));
    this.au.on('download-progress', (p) => {
      this.progress = Math.round(p.percent || 0);
      this.emit('status', this.snapshot());
    });
    this.au.on('update-downloaded', (info) => {
      this.info = info;
      this.set('ready');
    });
    this.au.on('error', (e) => {
      this.error = e ? e.message : 'update error';
      logger.warn('update error', this.error);
      this.set('error');
    });

    // First check a few seconds after boot, then every 6 hours.
    setTimeout(() => this.check(), 8000).unref?.();
    setInterval(() => this.check(), 6 * 60 * 60 * 1000).unref?.();
  }

  set(state) {
    this.state = state;
    this.emit('status', this.snapshot());
  }

  snapshot() {
    return {
      enabled: this.enabled,
      state: this.state,
      version: this.info && this.info.version,
      progress: this.progress || 0,
      error: this.error,
      lastChecked: this.lastChecked,
      platform: process.platform,
      arch: os.arch()
    };
  }

  async check() {
    if (!this.enabled) return this.snapshot();
    try {
      this.lastChecked = Date.now();
      await this.au.checkForUpdates();
    } catch (e) {
      this.error = e.message;
      logger.warn('checkForUpdates failed', e.message);
    }
    return this.snapshot();
  }

  /** Quit and install. Safe to call when not ready (no-op). */
  install() {
    if (!this.enabled || this.state !== 'ready') return false;
    setImmediate(() => this.au.quitAndInstall(false, true));
    return true;
  }
}

module.exports = { Updates };
