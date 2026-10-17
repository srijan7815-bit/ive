'use strict';
/**
 * IVE — Windows platform (PowerShell + Win32 via Add-Type).
 * Mirrors the macOS surface so the tool belt and UI are identical.
 */
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { runShell } = require('../shell');

const PS = 'powershell.exe';
const tmp = () => path.join(os.tmpdir(), `ive-ps-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ps1`);
const q = (s) => `'${String(s == null ? '' : s).replace(/'/g, "''")}'`;

/** Run a PowerShell script body; returns { ok, stdout, stderr }. */
async function ps(body, { timeout = 45_000 } = {}) {
  const file = tmp();
  await fs.writeFile(file, `$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\n${body}\n`, 'utf8');
  try {
    const r = await runShell(`"${PS}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${file}"`, { timeout });
    return r;
  } finally {
    fs.unlink(file).catch(() => {});
  }
}

const capabilities = {
  appControl: true, keystrokes: true, clicks: true, screenshots: true,
  music: true, search: true, shortcuts: false, trash: true, automation: true
};

/* --------------------------- input helpers ----------------------------- */

const SENDKEYS_ESCAPE = /([+^%~(){}[\]])/g;
function escapeSendKeys(text) {
  return String(text).replace(SENDKEYS_ESCAPE, '{$1}').replace(/\n/g, '{ENTER}');
}

const KEY_TOKENS = {
  return: '{ENTER}', enter: '{ENTER}', tab: '{TAB}', escape: '{ESC}', esc: '{ESC}',
  backspace: '{BACKSPACE}', delete: '{DELETE}', space: ' ',
  up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
  home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}',
  insert: '{INS}', f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}', f6: '{F6}',
  f7: '{F7}', f8: '{F8}', f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}'
};
const MOD_PREFIX = { ctrl: '^', control: '^', alt: '%', shift: '+', win: '#', cmd: '^', meta: '#' };

async function typeText(text) {
  const keys = escapeSendKeys(text);
  const r = await ps(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait(${q(keys)})
'sent'`);
  return r.ok ? `Typed ${text.length} characters.` : `Could not type: ${r.stderr}`;
}

async function pressKey(key, modifiers = []) {
  const lower = String(key).toLowerCase();
  let token = KEY_TOKENS[lower];
  if (!token && String(key).length === 1) token = escapeSendKeys(key);
  if (!token) return `Unknown key "${key}".`;
  const prefix = modifiers.map((m) => MOD_PREFIX[String(m).toLowerCase()] || '').join('');
  const r = await ps(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait(${q(prefix + token)})
'sent'`);
  return r.ok ? `Pressed ${key}${modifiers.length ? ' + ' + modifiers.join('+') : ''}.` : `Failed: ${r.stderr}`;
}

async function click(x, y, { button = 'left', double = false } = {}) {
  const down = button === 'right' ? '0x0008' : '0x0002';
  const up = button === 'right' ? '0x0010' : '0x0004';
  const r = await ps(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class IveMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
"@
[IveMouse]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
Start-Sleep -Milliseconds 40
for ($i = 0; $i -lt ${double ? 2 : 1}; $i++) {
  [IveMouse]::mouse_event(${down}, 0, 0, 0, [IntPtr]::Zero)
  [IveMouse]::mouse_event(${up}, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 90
}
'clicked'`);
  return r.ok ? `Clicked (${x}, ${y}).` : `Click failed: ${r.stderr}`;
}

const WIN32_FOREGROUND = `
Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class IveWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static string ForegroundApp() {
    var h = GetForegroundWindow(); uint pid; GetWindowThreadProcessId(h, out pid);
    try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
  }
}
"@`;

async function activeApp() {
  const r = await ps(`${WIN32_FOREGROUND}\n[IveWin]::ForegroundApp()`);
  return r.stdout.trim();
}

async function listWindows(app) {
  const filter = app ? `Where-Object { $_.ProcessName -like ${q('*' + app + '*')} -or $_.MainWindowTitle -like ${q('*' + app + '*')} }` : '';
  const r = await ps(`
Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim() -ne '' } | ${filter || 'ForEach-Object { $_ }'} |
  ForEach-Object { "$($_.ProcessName) — $($_.MainWindowTitle)" }`);
  return (r.stdout.trim() || `No windows found${app ? ` for ${app}.` : '.'}`).slice(0, 8000);
}

async function openApp(name, action = 'open') {
  if (action === 'quit') {
    const r = await ps(`
$p = Get-Process | Where-Object { $_.ProcessName -like ${q('*' + name + '*')} -or $_.MainWindowTitle -like ${q('*' + name + '*')} } | Select-Object -First 1
if ($p) { $p.CloseMainWindow() | Out-Null; 'closed' } else { 'not-running' }`);
    return r.ok ? `Closed ${name}.` : `Could not close ${name}: ${r.stderr}`;
  }
  const r = await ps(`
$target = ${q(name)}
try {
  $p = Start-Process -FilePath $target -PassThru -ErrorAction Stop
  'launched'
} catch {
  $app = Get-StartApps | Where-Object { $_.Name -like ${q('*' + name + '*')} } | Select-Object -First 1
  if ($app) { Start-Process ("shell:AppsFolder\\" + $app.AppID); 'launched-store' }
  else { throw "not found" }
}`);
  return r.ok ? `${action === 'activate' ? 'Focused' : 'Opened'} ${name}.` : `Could not open ${name}. ${r.stderr}`;
}

async function clipboardRead() {
  const r = await ps('Get-Clipboard -Raw');
  return (r.stdout || '').slice(0, 20_000) || '(clipboard is empty)';
}

async function clipboardWrite(text) {
  const r = await ps(`Set-Clipboard -Value ${q(text || '')}`);
  return r.ok ? `Copied ${(text || '').length} characters.` : `Failed: ${r.stderr}`;
}

async function screenshot(dest) {
  const r = await ps(`
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save(${q(dest)}, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
'saved'`, { timeout: 30_000 });
  if (!r.ok) return { ok: false, error: r.stderr || 'screen capture failed' };
  try {
    const st = await fs.stat(dest);
    return { ok: true, path: dest, bytes: st.size };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function searchFiles(query, { path: scope, max = 25 } = {}) {
  const root = scope || os.homedir();
  const r = await ps(`
$hits = Get-ChildItem -Path ${q(root)} -Recurse -Depth 5 -Filter ${q('*' + query + '*')} -ErrorAction SilentlyContinue |
  Select-Object -First ${Math.min(max, 100)} -ExpandProperty FullName
if ($hits) { $hits } else { '(no matches)' }`, { timeout: 60_000 });
  return r.stdout.trim() || '(no matches)';
}

async function trashPath(p) {
  const r = await ps(`
Add-Type -AssemblyName Microsoft.VisualBasic
$p = ${q(p)}
if (Test-Path -LiteralPath $p -PathType Container) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
} else {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
}
'trashed'`);
  return r.ok ? `Moved to Recycle Bin: ${p}` : `Could not trash: ${r.stderr}`;
}

async function runShortcut() {
  return 'Shortcuts are a macOS feature. On Windows, ask IVE to run the action directly.';
}

async function systemInfo() {
  const r = await ps(`
$os = Get-CimInstance Win32_OperatingSystem
"$($os.Caption)|$($os.Version)"`);
  const [caption, version] = (r.stdout || '|').trim().split('|');
  return { os: `${caption || 'Windows'} ${version || os.release()}`.trim(), hostname: os.hostname(), user: os.userInfo().username };
}

function openSettings(which) {
  const map = {
    accessibility: 'ms-settings:easeofaccess',
    input: 'ms-settings:easeofaccess-keyboard',
    automation: 'ms-settings:privacy',
    screen: 'ms-settings:privacy-screenshots',
    notifications: 'ms-settings:notifications'
  };
  return runShell(`start "" "${map[which] || 'ms-settings:'}"`).catch(() => {});
}

/* ------------------------------ media ---------------------------------- */
/* Windows exposes no reliable scripted metadata surface across players, so
 * IVE drives the system media keys and reports transport state only. */

const KEY = { playpause: 0xB3, play: 0xB3, toggle: 0xB3, next: 0xB0, previous: 0xB1, stop: 0xB2 };

async function mediaKey(code) {
  const r = await ps(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class IveMedia {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
}
"@
[IveMedia]::keybd_event([byte]${code}, 0, 0, [IntPtr]::Zero)
[IveMedia]::keybd_event([byte]${code}, 0, 2, [IntPtr]::Zero)
'ok'`);
  return r.ok;
}

const media = {
  async state() {
    return {
      playing: false, title: '', artist: '', album: '',
      duration: 0, position: 0, player: 'system', label: 'System media',
      available: true, metadata: false
    };
  },
  async control(action) {
    if (action === 'seek') return { ok: false, error: 'Seeking is not supported on Windows yet.' };
    const code = KEY[action];
    if (!code) return { ok: false, error: `Unknown action ${action}` };
    const ok = await mediaKey(code);
    return ok ? { ok: true } : { ok: false, error: 'Could not send media key.' };
  }
};

module.exports = {
  id: 'win32',
  capabilities,
  typeText, pressKey, click, activeApp, listWindows, openApp,
  clipboardRead, clipboardWrite, screenshot, searchFiles, trashPath, runShortcut,
  systemInfo, openSettings, media
};
