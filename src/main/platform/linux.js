'use strict';
/**
 * IVE — Linux platform (best effort).
 * IVE is designed for macOS and Windows; on Linux it runs headless-ish with a
 * reduced toolset so development and CI still work.
 */
const os = require('os');
const { runShell } = require('../shell');

const capabilities = {
  appControl: true, keystrokes: false, clicks: false, screenshots: false,
  music: false, search: true, shortcuts: false, trash: true, automation: false
};

const no = (what) => `${what} is not available on Linux.`;

const media = {
  async state() { return { playing: false, title: '', artist: '', album: '', duration: 0, position: 0, player: null, available: false }; },
  async control() { return { ok: false, error: 'Music control is not available on Linux.' }; }
};

module.exports = {
  id: 'linux',
  capabilities,
  async typeText() { return no('Typing'); },
  async pressKey() { return no('Key presses'); },
  async click() { return no('Clicks'); },
  async activeApp() {
    const r = await runShell('xdotool getactivewindow getwindowname 2>/dev/null || echo ""');
    return r.stdout.trim();
  },
  async listWindows() {
    const r = await runShell('wmctrl -l 2>/dev/null || echo "(no window manager)"');
    return r.stdout.trim() || '(none)';
  },
  async openApp(name) {
    const r = await runShell(`xdg-open ${JSON.stringify(name)} 2>/dev/null || ${JSON.stringify(name)} &`);
    return r.ok ? `Launched ${name}.` : `Could not launch ${name}.`;
  },
  async clipboardRead() {
    const r = await runShell('xclip -o -selection clipboard 2>/dev/null || xsel --clipboard --output 2>/dev/null || echo ""');
    return r.stdout || '(clipboard is empty)';
  },
  async clipboardWrite(text) {
    const r = await runShell(`printf %s ${JSON.stringify(text || '')} | xclip -selection clipboard 2>/dev/null || true`);
    return r.ok ? `Copied ${(text || '').length} characters.` : 'Clipboard tools are missing (install xclip).';
  },
  async screenshot() { return { ok: false, error: no('Screenshots') }; },
  async searchFiles(query, { path: scope, max = 25 } = {}) {
    const r = await runShell(`find ${JSON.stringify(scope || os.homedir())} -maxdepth 4 -iname ${JSON.stringify('*' + query + '*')} 2>/dev/null | head -n ${Math.min(max, 100)}`);
    return r.stdout.trim() || '(no matches)';
  },
  async trashPath(p) {
    const r = await runShell(`gio trash ${JSON.stringify(p)} 2>/dev/null || echo "gio trash unavailable"`);
    return r.ok ? `Moved to Trash: ${p}` : 'Could not trash.';
  },
  async runShortcut() { return no('Shortcuts'); },
  async systemInfo() { return { os: `Linux ${os.release()}`, hostname: os.hostname(), user: os.userInfo().username }; },
  openSettings() { return runShell('xdg-open settings:// 2>/dev/null || true'); },
  media
};
