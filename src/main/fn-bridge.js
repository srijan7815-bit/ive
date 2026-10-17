'use strict';
/**
 * IVE — fn gesture bridge.
 * Spawns the tiny Swift helper that taps fn + right-mouse events globally:
 *   {"t":"fn","down":true,"x":812,"y":430}
 *   {"t":"right","down":true,"x":812,"y":430}
 *   {"t":"right","drag","x":900,"y":520}
 *   {"t":"right","down":false,"x":900,"y":520}
 * If the helper isn't built (non-macOS / fresh clone), IVE falls back to a
 * global shortcut that opens the composer.
 */
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

class FnBridge extends EventEmitter {
  constructor({ root, resourcesPath }) {
    super();
    this.root = root;
    this.resourcesPath = resourcesPath;
    this.proc = null;
    this.ready = false;
    this.fnDown = false;
    this.buttonDown = false;
  }

  binaryPath() {
    const packaged = path.join(this.resourcesPath || '', 'bin', 'fn-listener');
    const dev = path.join(this.root, 'native/fn-listener/.build/fn-listener');
    if (fs.existsSync(packaged)) return packaged;
    if (fs.existsSync(dev)) return dev;
    return null;
  }

  start() {
    if (process.platform !== 'darwin') {
      this.emit('status', { ok: false, reason: 'fn gesture needs macOS. Use ⌘⇧Space to open the composer.' });
      return;
    }
    const bin = this.binaryPath();
    if (!bin) {
      this.emit('status', { ok: false, reason: 'fn helper not built. Run: npm run build:fn' });
      return;
    }
    try {
      this.proc = spawn(bin, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      this.emit('status', { ok: false, reason: e.message });
      return;
    }
    this.proc.on('error', (e) => this.emit('status', { ok: false, reason: e.message }));
    this.proc.on('exit', (code) => {
      this.ready = false;
      this.emit('status', { ok: false, reason: `fn helper exited (${code}).` });
    });
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.t === 'ready') {
        this.ready = true;
        this.emit('status', { ok: true, trusted: Boolean(msg.trusted) });
        return;
      }
      if (msg.t === 'permission') {
        this.emit('status', { ok: false, reason: 'Accessibility permission needed for the fn gesture.' });
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
    });
    this.proc.stderr.on('data', (d) => this.emit('stderr', String(d)));
  }

  stop() {
    if (this.proc) this.proc.kill();
    this.proc = null;
  }
}

module.exports = { FnBridge };
