'use strict';
/**
 * IVE — process runner. All shell/OS script execution goes through here:
 * timeouts, output caps, and a hard kill switch. Cross-platform.
 */
const { execFile } = require('child_process');
const os = require('os');

const DEFAULT_TIMEOUT = 90_000;
const MAX_BUFFER = 8 * 1024 * 1024;

function defaultShell() {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command'] };
  return { file: process.env.SHELL || '/bin/zsh', args: ['-lc'] };
}

function runShell(command, { cwd, timeout = DEFAULT_TIMEOUT, env } = {}) {
  const sh = defaultShell();
  return new Promise((resolve) => {
    const started = Date.now();
    const child = execFile(
      sh.file,
      [...sh.args, command],
      {
        cwd: cwd || os.homedir(),
        timeout,
        maxBuffer: MAX_BUFFER,
        env: { ...process.env, ...(env || {}) },
        windowsHide: true,
        killSignal: 'SIGKILL'
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err || err.code === 0,
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          killed: Boolean(err && err.killed),
          stdout: String(stdout || '').slice(-200_000),
          stderr: String(stderr || '').slice(-20_000),
          ms: Date.now() - started
        });
      }
    );
    child.on('error', (e) => {
      resolve({ ok: false, code: 1, stdout: '', stderr: String(e.message), ms: Date.now() - started });
    });
  });
}

function runAppleScript(script, { timeout = 30_000 } = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      return resolve({ ok: false, stdout: '', stderr: 'AppleScript is only available on macOS.' });
    }
    execFile('osascript', ['-e', script], { timeout, maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || (err ? err.message : '')).trim()
      });
    });
  });
}

module.exports = { runShell, runAppleScript, defaultShell };
