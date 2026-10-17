'use strict';
/**
 * IVE — preload. A deliberately narrow bridge. No node in the renderer.
 */
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set([
  'agent:status', 'agent:log', 'agent:done', 'agent:error',
  'ask', 'ask:resolved',
  'music', 'config', 'permissions', 'fn', 'gesture',
  'panel:open', 'panel:toggle',
  'selection:start', 'selection:move', 'selection:end', 'selection:open', 'selection:glass',
  'composer:closed', 'pointer:leave', 'updates'
]);

function on(channel, cb) {
  if (!EVENTS.has(channel)) throw new Error(`Unknown event ${channel}`);
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('ive', {
  platform: process.platform,
  version: process.env.IVE_VERSION || '0.1.0',

  config: {
    get: () => ipcRenderer.invoke('ive:config:get'),
    set: (patch) => ipcRenderer.invoke('ive:config:set', patch),
    setKey: (key) => ipcRenderer.invoke('ive:config:key', key),
    test: () => ipcRenderer.invoke('ive:provider:test')
  },

  agent: {
    ask: (text, source) => ipcRenderer.invoke('ive:agent:ask', { text, source }),
    cancel: () => ipcRenderer.invoke('ive:agent:cancel'),
    reset: () => ipcRenderer.invoke('ive:agent:reset')
  },

  log: {
    get: () => ipcRenderer.invoke('ive:log:get'),
    clear: () => ipcRenderer.invoke('ive:log:clear')
  },

  music: {
    control: (action, value) => ipcRenderer.invoke('ive:music:control', { action, value }),
    state: () => ipcRenderer.invoke('ive:music:state')
  },

  window: {
    setInteractive: (flag) => ipcRenderer.send('ive:window:setInteractive', flag),
    setPinned: (flag) => ipcRenderer.send('ive:window:pinned', flag),
    focus: () => ipcRenderer.send('ive:window:focus'),
    blur: () => ipcRenderer.send('ive:window:blur')
  },

  selection: {
    begin: () => ipcRenderer.send('ive:selection:begin'),
    beginCentered: () => ipcRenderer.send('ive:selection:beginCentered'),
    submit: (text) => ipcRenderer.send('ive:selection:submit', { text }),
    cancel: () => ipcRenderer.send('ive:selection:cancel')
  },

  permission: {
    respond: (id, optionId) => ipcRenderer.invoke('ive:permission:respond', { id, optionId })
  },

  permissions: {
    get: () => ipcRenderer.invoke('ive:permissions:get'),
    prompt: () => ipcRenderer.send('ive:permissions:prompt'),
    open: (which) => ipcRenderer.send('ive:openSystemPrefs', which)
  },

  updates: {
    status: () => ipcRenderer.invoke('ive:updates:status'),
    check: () => ipcRenderer.invoke('ive:updates:check'),
    install: () => ipcRenderer.invoke('ive:updates:install')
  },

  logs: {
    tail: () => ipcRenderer.invoke('ive:log:tail')
  },

  openExternal: (url) => ipcRenderer.send('ive:openExternal', url),
  openApp: (name) => ipcRenderer.send('ive:app:openApp', name),
  quit: () => ipcRenderer.send('ive:app:quit'),
  panelToggle: () => ipcRenderer.send('ive:panel:toggle'),

  on
});
