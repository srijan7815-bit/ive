'use strict';
/**
 * IVE — platform layer.
 * One API, three implementations. Everything that touches the OS from a tool
 * goes through here so macOS (AppleScript/osascript), Windows (PowerShell) and
 * Linux (best-effort xdotool) stay behind the same contract.
 *
 * Contract (all async unless noted):
 *   capabilities -> { appControl, keystrokes, clicks, screenshots, music, search, shortcuts, trash, automation }
 *   typeText(text)                      -> string result message
 *   pressKey(key, modifiers[])          -> string
 *   click(x, y, {button, double})       -> string
 *   activeApp()                         -> string
 *   listWindows(app?)                   -> string
 *   openApp(name, action)               -> string
 *   clipboardRead() / clipboardWrite()  -> string
 *   screenshot(destPath)                -> { ok, path?, error? }
 *   searchFiles(query, {path,max})      -> string
 *   trashPath(p)                        -> string
 *   runShortcut(name)                   -> string
 *   media: { state(), control(action,value) }
 *   systemInfo()                        -> object
 *   openSettings(which)                 -> void
 */

const impls = {
  darwin: () => require('./darwin'),
  win32: () => require('./win32'),
  linux: () => require('./linux')
};

const impl = (impls[process.platform] || impls.linux)();

module.exports = impl;
