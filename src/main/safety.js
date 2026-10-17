'use strict';
/**
 * IVE — safety rails.
 * The assistant can do real work on the machine, so a few bones are made of steel:
 *  1. A denylist of commands that are never executed, even if approved.
 *  2. File writes are fenced to the home directory (and a few system-temp paths).
 *  3. Risky calls surface as a permission card in the notch.
 */

const os = require('os');
const path = require('path');

const NEVER = [
  { re: /\bsudo\b/, why: 'sudo escalates privileges and is never run automatically.' },
  { re: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(\/|~|\$HOME)(\s|\*|$)/, why: 'Refusing to recursively delete your home or root directory.' },
  { re: /\brm\s+-rf\s+\/(\s|$)/, why: 'Refusing to delete the root filesystem.' },
  { re: /\bmkfs(\.|\s)/, why: 'Formatting disks is out of scope for IVE.' },
  { re: /\bdiskutil\s+(erasedisk|erasevolume|partitiondisk)/, why: 'Disk erasure is destructive and blocked.' },
  { re: /\bdd\s+.*\bof=\/dev\//, why: 'Raw device writes are blocked.' },
  { re: /:\(\)\s*\{.*\};:/, why: 'Fork bomb blocked.' },
  { re: /\b(shutdown|reboot|halt)\b/, why: 'Power commands are blocked. Use System Settings.' },
  { re: /\b(chmod|chown)\s+(-R\s+)?(777|000)\s+\/(\s|$)/, why: 'Refusing to change permissions on the root filesystem.' },
  { re: />\s*\/dev\/disk/, why: 'Raw device writes are blocked.' },
  { re: /\b(defaults\s+delete|killall|launchctl\s+(unload|bootout))\b/, why: 'Touching core system services is blocked.' },
  { re: /\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh)\b/, why: 'Piping remote scripts into a shell is blocked. Download and inspect first.' }
];

const HOME = os.homedir();
const EXTRA_WRITE_ROOTS = [os.tmpdir(), '/tmp', '/private/tmp'];

function checkCommand(command) {
  if (typeof command !== 'string' || !command.trim()) {
    return { ok: false, reason: 'Empty command.' };
  }
  for (const rule of NEVER) {
    if (rule.re.test(command)) return { ok: false, reason: rule.why };
  }
  return { ok: true };
}

/** Write fence: absolute paths must resolve inside $HOME or temp. */
function checkWritePath(p) {
  if (typeof p !== 'string' || !p) return { ok: false, reason: 'No path given.' };
  let abs;
  try {
    abs = path.resolve(p.replace(/^~(?=$|\/)/, HOME));
  } catch {
    return { ok: false, reason: 'Invalid path.' };
  }
  const roots = [HOME, ...EXTRA_WRITE_ROOTS].map((r) => path.resolve(r));
  if (roots.some((root) => abs === root || abs.startsWith(root + path.sep))) return { ok: true, abs };
  return { ok: false, reason: `Writes are fenced to your home folder. ${abs} is outside it.` };
}

const SAFE_SHELL = [
  /^(pwd|whoami|date|uname(\s+-a)?|sw_vers|hostname|id)\s*$/,
  /^ls(\s+[^|;&>]*)?$/,
  /^git\s+(status|diff|log|branch|show)(\s+[^|;&>]*)?$/,
  /^(cat|head|tail|wc|file|stat)\s+[^|;&>]+$/,
  /^(which|type|echo)\s+[^|;&>]*$/,
  /^(ps\s+aux|top\s+-l\s*1|df\s+-h|du\s+-sh\s+[^|;&>]*)$/,
  /^(date|cal|uptime|say\s+[^|;&>]*)$/,
  /^(defaults\s+read\s+\S+)$/,
  /^(plutil\s+-p\s+\S+)$/
];

function isSafeShell(command) {
  const c = String(command || '').trim();
  if (/[|;&>`$()]/.test(c)) return false;
  return SAFE_SHELL.some((re) => re.test(c));
}

module.exports = { checkCommand, checkWritePath, isSafeShell, NEVER, HOME };
