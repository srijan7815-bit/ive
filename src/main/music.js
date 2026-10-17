'use strict';
/**
 * IVE — now playing.
 * Thin polling wrapper around the platform media layer (AppleScript on macOS,
 * system media keys on Windows). Emits only on change.
 */
const { EventEmitter } = require('events');
const platform = require('./platform');

function hueFrom(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

const EMPTY = {
  playing: false, title: '', artist: '', album: '', duration: 0, position: 0,
  player: null, available: true
};

function decorate(state) {
  const s = { ...EMPTY, ...state };
  return { ...s, artHue: hueFrom((s.title || 'ive') + (s.artist || '')) };
}

class Music extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.busy = false;
    this.lastJson = '';
    this.lastState = decorate({});
  }

  available() {
    return Boolean(platform.capabilities && platform.capabilities.music !== false && platform.media);
  }

  start(intervalMs = 3000) {
    if (!this.available()) {
      this.lastState = decorate({ available: false });
      return;
    }
    this.stop();
    this.timer = setInterval(() => this.refresh(), intervalMs);
    this.refresh();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh() {
    if (this.busy || !this.available()) return;
    this.busy = true;
    try {
      const raw = await platform.media.state();
      const state = decorate(raw);
      const json = JSON.stringify(state);
      if (json !== this.lastJson) {
        this.lastJson = json;
        this.lastState = state;
        this.emit('state', state);
      }
    } catch {
      /* player app may be mid-launch; next tick recovers */
    } finally {
      this.busy = false;
    }
  }

  async control(action, value) {
    if (!this.available()) return { ok: false, error: 'Music control is not available on this platform.' };
    try {
      const res = await platform.media.control(action, value);
      if (res && res.ok) setTimeout(() => this.refresh(), 220);
      return res || { ok: false, error: 'No response from the media layer.' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

module.exports = { Music, hueFrom };
