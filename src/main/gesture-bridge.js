'use strict';
/**
 * IVE — gesture bridge.
 * Spawns the platform gesture helper and normalises its NDJSON stream:
 *
 *   macOS   native/fn-listener/.build/fn-listener   (fn + right-drag)
 *   Windows native/win/gesture-hook.ps1             (Ctrl + Alt + right-drag)
 *
 * If no helper is available IVE falls back to a global shortcut so composing
 * still works.
 */
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const MOD_LABEL = { darwin: 'fn', win32: 'Ctrl + Alt', linux: 'Ctrl + Alt' };

class GestureBridge extends EventEmitter {
  constructor({ root, resourcesPath }) {
    super();
    this.root = root;
    this.resourcesPath = resourcesPath;
    this.proc = null;
    this.ready = false;
    this.fnDown = false;
    this.buttonDown = false;
    this.kind = process.platform === 'darwin' ? 'swift' : process.platform === 'win32' ? 'powershell' : 'none';
  }

  get modifierLabel() { return MOD_LABEL[process.platform] || 'Ctrl + Alt'; }

  binaryPath() {
    const candidates = [
      path.join(this.resourcesPath || '', 'bin', 'fn-listener'),
      path.join(this.root, 'native/fn-listener/.build/fn-listener')
    ];
    return candidates.find((p) => p && fs.existsSync(p)) || null;
  }

  scriptPath() {
    const candidates = [
      path.join(this.resourcesPath || '', 'native', 'gesture-hook.ps1'),
      path.join(this.root, 'native/win/gesture-hook.ps1')
    ];
    return candidates.find((p) => p && fs.existsSync(p)) || null;
  }

  command() {
    if (process.platform === 'darwin') {
      const bin = this.binaryPath();
      if (!bin) return null;
      return { file: bin, args: [] };
    }
    if (process.platform === 'win32') {
      const script = this.scriptPath();
      if (!script) return null;
      return {
        file: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script]
      };
    }
    return null;
  }

  start() {
    if (process.platform === 'linux') {
      this.emit('status', { ok: false, reason: 'Gestures are macOS / Windows only. Use the global shortcut.' });
      return false;
    }
    const cmd = this.command();
    if (!cmd) {
      this.emit('status', {
        ok: false,
        reason: process.platform === 'darwin'
          ? 'fn helper not built. Run: npm run build:fn'
          : 'gesture hook script missing from the installation.'
      });
      return false;
    }
    try {
      this.proc = spawn(cmd.file, cmd.args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      this.emit('status', { ok: false, reason: e.message });
      return false;
    }
    this.proc.on('error', (e) => this.emit('status', { ok: false, reason: e.message }));
    this.proc.on('exit', (code) => {
      this.ready = false;
      this.emit('status', { ok: false, reason: `gesture helper exited (${code}).` });
    });
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => this.handleLine(line));
    this.proc.stderr.on('data', (d) => this.emit('stderr', String(d)));
    return true;
  }

  handleLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.t === 'ready') {
      this.ready = true;
      this.emit('status', { ok: true, trusted: Boolean(msg.trusted), modifier: this.modifierLabel });
      return;
    }
    if (msg.t === 'permission') {
      this.emit('status', { ok: false, reason: msg.error || 'Gesture helper needs permission.' });
      return;
    }
    if (msg.t === 'fn') {
      this.fnDown = Boolean(msg.down);
      this.emit('fn', { down: this.fnDown, x: msg.x, y: msg.y });
      return;
    }
    if (msg.t === 'right') {
      if (msg.drag) {
        this.emit('drag', { x: msg.x, y: msg.y });
      } else {
        this.buttonDown = Boolean(msg.down);
        this.emit('right', { down: this.buttonDown, x: msg.x, y: msg.y });
      }
    }
  }

  stop() {
    if (this.proc) {
      try { this.proc.kill(); } catch { /* already gone */ }
    }
    this.proc = null;
  }
}

module.exports = { GestureBridge };
