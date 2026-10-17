'use strict';
/**
 * IVE — config store.
 * API keys are encrypted at rest with Electron's safeStorage when available.
 */
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

let Store;
try {
  Store = require('electron-store');
} catch {
  Store = class {
    constructor(opts) {
      this.file = path.join(app.getPath('userData'), 'ive-config.json');
      this.data = { ...(opts.defaults || {}), ...this._read() };
    }
    _read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; } }
    _flush() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)); }
    get(k, d) { const v = this.data[k]; return v === undefined ? d : v; }
    set(k, v) { this.data[k] = v; this._flush(); }
  };
}

const DEFAULTS = {
  schemaVersion: 2,
  provider: 'openai',
  model: 'gpt-4o',
  baseUrl: '',
  apiKey: '',
  maxSteps: 24,
  temperature: 0.4,
  vision: true,
  silent: true,
  sound: false,
  launchAtLogin: false,
  showInDock: false,      // notch apps live in the menu bar
  autoUpdate: true,
  betaChannel: false,
  autoApprove: { reads: true, writes: true, automation: true, shell: false, network: true },
  notch: { clock: true, music: true },
  onboardingDone: false
};

const store = new Store({ name: 'ive-config', defaults: DEFAULTS });

/** Forward-compatible settings migration. */
function migrate() {
  const v = store.get('schemaVersion', 1);
  if (v < 2) {
    if (store.get('showInDock') === undefined) store.set('showInDock', false);
    if (store.get('autoUpdate') === undefined) store.set('autoUpdate', true);
    store.set('schemaVersion', 2);
  }
}
migrate();

function get(key) {
  if (key === undefined) return store.store;
  return store.get(key);
}

function set(patch) {
  if (!patch || typeof patch !== 'object') return;
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof store.get(k) === 'object') {
      store.set(k, { ...store.get(k), ...v });
    } else {
      store.set(k, v);
    }
  }
}

function publicConfig() {
  const c = { ...store.store };
  c.hasApiKey = Boolean(readApiKey());
  delete c.apiKey;
  return c;
}

function writeApiKey(plain) {
  if (!plain) { store.set('apiKey', ''); return; }
  try {
    if (safeStorage.isEncryptionAvailable()) {
      store.set('apiKey', 'enc:' + safeStorage.encryptString(plain).toString('base64'));
      return;
    }
  } catch { /* fall through */ }
  store.set('apiKey', plain);
}

function readApiKey() {
  const raw = store.get('apiKey', '');
  if (!raw) return '';
  if (raw.startsWith('enc:')) {
    try { return safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64')); } catch { return ''; }
  }
  return raw;
}

module.exports = { get, set, getApiKey: readApiKey, setApiKey: writeApiKey, publicConfig, DEFAULTS, store };
