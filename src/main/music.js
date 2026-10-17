'use strict';
/**
 * IVE — now playing, via AppleScript (Music.app + Spotify).
 * Polls gently and pushes state to the notch.
 */
const { EventEmitter } = require('events');
const { runAppleScript } = require('./shell');

const PLAYERS = [
  { id: 'music', app: 'Music', label: 'Music' },
  { id: 'spotify', app: 'Spotify', label: 'Spotify' }
];

const state = {
  player: null,      // 'music' | 'spotify' | null
  playing: false,
  title: '',
  artist: '',
  album: '',
  duration: 0,
  position: 0,
  artHue: 210,
  available: process.platform === 'darwin'
};

function hueFrom(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

async function isRunning(app) {
  const r = await runAppleScript(`tell application "System Events" to (name of processes) contains "${app}"`);
  return r.ok && r.stdout === 'true';
}

async function queryPlayer(app) {
  const r = await runAppleScript(`
tell application "${app}"
  if it is running then
    try
      set st to player state as string
      if st is "stopped" then return "stopped"
      set tr to current track
      set out to st & "\\n" & (name of tr as string) & "\\n" & (artist of tr as string) & "\\n" & (album of tr as string) & "\\n" & (duration of tr as string) & "\\n" & (player position as string)
      return out
    on error
      return "stopped"
    end try
  else
    return "stopped"
  end if
end tell`, { timeout: 8000 });
  if (!r.ok || !r.stdout || r.stdout === 'stopped') return null;
  const [st, title, artist, album, duration, position] = r.stdout.split('\n');
  return {
    playing: st === 'playing',
    title: title || '',
    artist: artist || '',
    album: album || '',
    duration: Number(duration) || 0,
    position: Number(position) || 0
  };
}

function toPublic() {
  return { ...state, artHue: hueFrom((state.title || 'ive') + (state.artist || '')) };
}

class Music extends EventEmitter {
  constructor() {
    super();
    this.lastState = toPublic();
    this.timer = null;
    this.busy = false;
    this.lastJson = '';
  }

  start(intervalMs = 3000) {
    if (!state.available) return;
    this.stop();
    this.timer = setInterval(() => this.refresh(), intervalMs);
    this.refresh();
    // One extra quick refresh after a control press, for snappy UI.
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh() {
    if (this.busy) return;
    this.busy = true;
    try {
      let found = null;
      for (const p of PLAYERS) {
        if (await isRunning(p.app)) {
          const info = await queryPlayer(p.app);
          if (info && (info.playing || !found)) found = { ...info, player: p.id, app: p.app, label: p.label };
          if (info?.playing) break;
        }
      }
      if (found) {
        Object.assign(state, {
          player: found.player,
          playing: found.playing,
          title: found.title,
          artist: found.artist,
          album: found.album,
          duration: found.duration,
          position: found.position
        });
      } else {
        state.player = null;
        state.playing = false;
        state.title = '';
        state.artist = '';
        state.album = '';
        state.duration = 0;
        state.position = 0;
      }
      const json = JSON.stringify(toPublic());
      if (json !== this.lastJson) {
        this.lastJson = json;
        this.emit('state', toPublic());
      }
    } finally {
      this.busy = false;
    }
  }

  async control(action, value) {
    if (!state.available) return { ok: false, error: 'Music control is macOS only.' };
    let app = state.player === 'spotify' ? 'Spotify' : 'Music';
    const running = await isRunning(app === 'Music' ? 'Music' : 'Spotify');
    if (!running && app === 'Music') {
      // Start Music.app if the user asks to play and nothing is running.
      if (action === 'play' || action === 'playpause' || action === 'toggle') {
        await runAppleScript('tell application "Music" to play');
        app = 'Music';
      } else {
        return { ok: false, error: 'No music player is open.' };
      }
    }
    const scripts = {
      playpause: `tell application "${app}" to playpause`,
      toggle: `tell application "${app}" to playpause`,
      play: `tell application "${app}" to play`,
      pause: `tell application "${app}" to pause`,
      next: `tell application "${app}" to next track`,
      previous: `tell application "${app}" to previous track`
    };
    if (action === 'seek' && typeof value === 'number') {
      const r = await runAppleScript(`tell application "${app}" to set player position to ${Math.max(0, value)}`);
      await this.refresh();
      return r.ok ? { ok: true } : { ok: false, error: r.stderr };
    }
    if (!scripts[action]) return { ok: false, error: `Unknown action ${action}` };
    const r = await runAppleScript(scripts[action]);
    setTimeout(() => this.refresh(), 250);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr || 'AppleScript failed (check Automation permission).' };
  }
}

module.exports = { Music, musicState: toPublic, hueFrom };
