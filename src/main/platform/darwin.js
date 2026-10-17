'use strict';
/**
 * IVE — macOS platform (AppleScript + shell).
 * This is the reference implementation; Windows mirrors the same surface.
 */
const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const { runShell, runAppleScript } = require('../shell');

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const KEYCODES = {
  return: 36, enter: 36, tab: 48, space: 49, delete: 51, backspace: 51, escape: 53, esc: 53,
  left: 123, right: 124, down: 125, up: 126, home: 115, end: 119,
  pageup: 116, pagedown: 121, f1: 122, f2: 120, f3: 99, f4: 118, f5: 96,
  f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111
};
const MODS = {
  cmd: 'command down', command: 'command down', shift: 'shift down',
  alt: 'option down', option: 'option down', ctrl: 'control down', control: 'control down'
};

const capabilities = {
  appControl: true, keystrokes: true, clicks: true, screenshots: true,
  music: true, search: true, shortcuts: true, trash: true, automation: true
};

async function typeText(text) {
  const r = await runAppleScript(`tell application "System Events" to keystroke "${esc(text)}"`);
  return r.ok ? `Typed ${text.length} characters.` : `Could not type: ${r.stderr} (grant Accessibility to IVE.)`;
}

async function pressKey(key, modifiers = []) {
  const lower = String(key).toLowerCase();
  const code = KEYCODES[lower];
  const mods = modifiers.map((m) => MODS[String(m).toLowerCase()]).filter(Boolean);
  const using = mods.length ? ` using {${mods.join(', ')}}` : '';
  let script;
  if (code !== undefined) script = `tell application "System Events" to key code ${code}${using}`;
  else if (String(key).length === 1) script = `tell application "System Events" to keystroke "${esc(key)}"${using}`;
  else return `Unknown key "${key}".`;
  const r = await runAppleScript(script);
  return r.ok ? `Pressed ${key}${modifiers.length ? ' + ' + modifiers.join('+') : ''}.` : `Failed: ${r.stderr}`;
}

async function click(x, y, { button = 'left', double = false } = {}) {
  const b = button === 'right' ? 2 : 1;
  const script = `
use framework "CoreGraphics"
use scripting additions
set pt to current application's CGPointMake(${Number(x)}, ${Number(y)})
repeat with i from 1 to ${double ? 2 : 1}
  set down to current application's CGEventCreateMouseEvent(missing value, ${b === 2 ? '3' : '1'}, pt, ${b})
  set up to current application's CGEventCreateMouseEvent(missing value, ${b === 2 ? '4' : '2'}, pt, ${b})
  current application's CGEventPost(0, down)
  current application's CGEventPost(0, up)
end repeat`;
  const r = await runAppleScript(script);
  return r.ok ? `Clicked (${x}, ${y}).` : `Click failed: ${r.stderr}`;
}

async function activeApp() {
  const r = await runAppleScript('tell application "System Events" to get name of first application process whose frontmost is true');
  return r.ok ? r.stdout.trim() : '';
}

async function listWindows(app) {
  if (app) {
    const r = await runAppleScript(`tell application "System Events" to tell process "${esc(app)}" to get name of every window`);
    return r.ok ? r.stdout : `No windows found for ${app}.`;
  }
  const r = await runAppleScript(`
tell application "System Events"
  set out to ""
  repeat with p in (application processes whose visible is true)
    try
      set out to out & (name of p) & ": " & (count of windows of p) & " window(s)" & linefeed
    end try
  end repeat
  return out
end tell`);
  return (r.stdout || '(none)').slice(0, 8000);
}

async function openApp(name, action = 'open') {
  if (action === 'quit') {
    const r = await runAppleScript(`tell application "${esc(name)}" to quit`);
    return r.ok ? `Quit ${name}.` : `Could not quit ${name}: ${r.stderr}`;
  }
  const r = await runShell(`open -a ${shq(name)}`);
  return r.ok ? `${action === 'activate' ? 'Focused' : 'Opened'} ${name}.` : `Could not open ${name}: ${r.stderr}`;
}

async function clipboardRead() {
  const r = await runShell('pbpaste');
  return r.stdout.slice(0, 20_000) || '(clipboard is empty)';
}

async function clipboardWrite(text) {
  const tmp = path.join(os.tmpdir(), `ive-clip-${Date.now()}.txt`);
  await fs.writeFile(tmp, text || '', 'utf8');
  const r = await runShell(`pbcopy < ${shq(tmp)}`);
  await fs.unlink(tmp).catch(() => {});
  return r.ok ? `Copied ${(text || '').length} characters.` : `Failed: ${r.stderr}`;
}

async function screenshot(dest) {
  const r = await runShell(`screencapture -x -t png ${shq(dest)}`, { timeout: 15_000 });
  if (!r.ok) return { ok: false, error: r.stderr || 'screencapture failed (Screen Recording permission?)' };
  try {
    const st = await fs.stat(dest);
    return { ok: true, path: dest, bytes: st.size };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function searchFiles(query, { path: scope, max = 25 } = {}) {
  const scopeArg = scope ? ` -onlyin ${shq(scope)}` : '';
  const r = await runShell(`mdfind ${shq(query)}${scopeArg} | head -n ${Math.min(max, 100)}`);
  return r.stdout.trim() || '(no matches)';
}

async function trashPath(p) {
  const r = await runAppleScript(`tell application "Finder" to delete POSIX file "${esc(p)}"`);
  return r.ok ? `Moved to Trash: ${p}` : `Could not trash: ${r.stderr}`;
}

async function runShortcut(name) {
  const r = await runShell(`shortcuts run ${shq(name)}`, { timeout: 120_000 });
  return r.ok ? `Shortcut "${name}" finished. ${r.stdout.slice(0, 4000)}` : `Shortcut failed: ${r.stderr}`;
}

async function systemInfo() {
  const sw = await runShell('sw_vers -productVersion');
  return {
    os: `macOS ${sw.stdout.trim() || os.release()}`,
    hostname: os.hostname(),
    user: os.userInfo().username
  };
}

function openSettings(which) {
  const map = {
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    input: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
    automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
    screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    notifications: 'x-apple.systempreferences:com.apple.preference.notifications'
  };
  return runShell(`open "${map[which] || map.accessibility}"`);
}

/* ------------------------------ media ---------------------------------- */

const MEDIA_PLAYERS = ['Music', 'Spotify'];

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
      return st & "\\n" & (name of tr as string) & "\\n" & (artist of tr as string) & "\\n" & (album of tr as string) & "\\n" & (duration of tr as string) & "\\n" & (player position as string)
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
    playing: st === 'playing', title: title || '', artist: artist || '', album: album || '',
    duration: Number(duration) || 0, position: Number(position) || 0
  };
}

let cachedPlayer = null;

const media = {
  async state() {
    for (const app of MEDIA_PLAYERS) {
      if (!(await isRunning(app))) continue;
      const info = await queryPlayer(app);
      if (info && (info.playing || !cachedPlayer)) {
        if (info.playing) cachedPlayer = app;
        return { ...info, player: app === 'Spotify' ? 'spotify' : 'music', label: app, available: true };
      }
      if (info) return { ...info, player: app === 'Spotify' ? 'spotify' : 'music', label: app, available: true };
    }
    cachedPlayer = null;
    return { playing: false, title: '', artist: '', album: '', duration: 0, position: 0, player: null, available: true };
  },

  async control(action, value) {
    let app = cachedPlayer || 'Music';
    if (!(await isRunning(app))) {
      if (action === 'play' || action === 'playpause' || action === 'toggle') {
        await runAppleScript('tell application "Music" to play');
        app = 'Music';
        cachedPlayer = app;
      } else {
        if (await isRunning('Spotify')) { app = 'Spotify'; cachedPlayer = app; }
        else return { ok: false, error: 'No music player is open.' };
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
      return r.ok ? { ok: true } : { ok: false, error: r.stderr };
    }
    if (!scripts[action]) return { ok: false, error: `Unknown action ${action}` };
    const r = await runAppleScript(scripts[action]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr || 'AppleScript failed (check Automation permission).' };
  }
};

module.exports = {
  id: 'darwin', capabilities,
  typeText, pressKey, click, activeApp, listWindows, openApp,
  clipboardRead, clipboardWrite, screenshot, searchFiles, trashPath, runShortcut,
  systemInfo, openSettings, media, isRunning
};
