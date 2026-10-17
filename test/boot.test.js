'use strict';
/**
 * Boot smoke test: the real main process must survive startup outside Electron
 * (with the electron stub) in demo mode, and must register its whole IPC
 * surface. This catches broken requires, bad platform wiring and top-level
 * throws that unit tests miss.
 */
const { check, done } = require('./harness');

process.env.IVE_DEMO = '1';

let error = null;
try {
  require('../src/main/main.js');
} catch (e) {
  error = e;
}

check('main process boots without throwing', !error);
if (error) console.error(error);

const { ipcMain } = require('electron');
const channels = ipcMain.__handlers;
check('IPC surface is registered', channels.size >= 25);

const required = [
  'ive:agent:ask', 'ive:agent:cancel', 'ive:permission:respond',
  'ive:config:key', 'ive:provider:test', 'ive:updates:check',
  'ive:music:control', 'ive:selection:submit', 'ive:permissions:get'
];
const missing = required.filter((c) => !channels.has(c));
check(`core channels present${missing.length ? ` (missing ${missing.join(', ')})` : ''}`, missing.length === 0);

setTimeout(() => {
  check('still alive after the event loop turns', true);
  done();
}, 120);
