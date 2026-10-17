'use strict';
/**
 * IVE — config store
 * API keys are encrypted at rest with Electron's safeStorage when available.
 */
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

let Store;
try {
  Store = require('electron-store');
} catch {
  // Minimal fallback so the app still boots if the dep is missing.
  Store = class {
    constructor(opts) {
      this.file = path.join(app.getPath('userData'), 'ive-config.json');
      this.data = { ...(opts.defaults || {}), ...this._read() };
    }
    _read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; } }
    _flush() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)); }
    get(k, d) { const v = this.data[k]; return v === undefined ? d : v; }
    set(k, v) { this.data[k] = v; this._flush(); }
    onDidChange() {}
  };
}

const DEFAULTS = {
  provider: 'openai', // openai | anthropic | ollama
  model: 'gpt-4o',
  baseUrl: '',
  apiKey: '',
  maxSteps: 24,
  temperature: 0.4,
  vision: true,
  silent: true, // results land quietly in the notch log, no popups
  sound: false,
  launchAtLogin: false,
  autoApprove: {
    reads: true,
    writes: true,
    automation: true,
    shell: false,
    network: true
  },
  notch: {
    clock: true,
    music: true
  },
  onboardingDone: false
};

const store = new Store({ name: 'ive-config', defaults: DEFAULTS });

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

/** API key: stored encrypted when the OS supports it. */
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
    try {
      return safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'));
    } catch {
      return '';
    }
  }
  return raw;
}

module.exports = { get, set, getApiKey: readApiKey, setApiKey: writeApiKey, publicConfig, DEFAULTS, store };
