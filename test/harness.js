'use strict';
/**
 * Test harness: lets the main-process modules be required outside Electron by
 * aliasing `electron` to a tiny stub.
 */
const Module = require('module');
const path = require('path');

const stub = path.join(__dirname, 'stubs/electron.js');
const orig = Module._resolveFilename;
const OPTIONAL = new Set(['electron-updater']);
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return stub;
  if (OPTIONAL.has(request)) {
    try { return orig.call(this, request, ...args); } catch { return require.resolve(path.join(__dirname, 'stubs/optional.js')); }
  }
  return orig.call(this, request, ...args);
};

const ROOT = path.join(__dirname, '..');
const resolve = (p) => require(path.join(ROOT, p));

let failures = 0;
function check(name, value) {
  const ok = Boolean(value);
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
  if (!ok) failures++;
  return ok;
}
function done() {
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}

module.exports = { resolve, check, done, ROOT };
