'use strict';
/**
 * IVE — logger.
 * Small, rotating, local-only. Nothing leaves the machine.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP_FILES = 4;

class Logger {
  constructor({ dir, level = 'info' } = {}) {
    this.dir = dir || path.join(os.tmpdir(), 'ive-logs');
    this.level = level;
    this.file = path.join(this.dir, 'ive.log');
    this.ready = false;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this.ready = true;
    } catch { /* read-only fs: logs go to stderr only */ }
  }

  setDir(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'ive.log');
    try { fs.mkdirSync(dir, { recursive: true }); this.ready = true; } catch { this.ready = false; }
  }

  _rotate() {
    try {
      const st = fs.statSync(this.file);
      if (st.size < MAX_BYTES) return;
      for (let i = KEEP_FILES - 1; i >= 1; i--) {
        const from = `${this.file}.${i}`;
        const to = `${this.file}.${i + 1}`;
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      fs.renameSync(this.file, `${this.file}.1`);
    } catch { /* ignore */ }
  }

  write(level, args) {
    const line = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} ${args
      .map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : safeJSON(a)))
      .join(' ')}\n`;
    if (level === 'error') process.stderr.write(line);
    else if (process.env.IVE_DEBUG) process.stdout.write(line);
    if (!this.ready) return;
    try {
      this._rotate();
      fs.appendFileSync(this.file, line);
    } catch { /* ignore */ }
  }

  info(...a) { this.write('info', a); }
  warn(...a) { this.write('warn', a); }
  error(...a) { this.write('error', a); }
  debug(...a) { this.write('debug', a); }

  tail(lines = 200) {
    try {
      return fs.readFileSync(this.file, 'utf8').split('\n').slice(-lines).join('\n');
    } catch {
      return '';
    }
  }
}

function safeJSON(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

const logger = new Logger();
module.exports = { logger, Logger };
