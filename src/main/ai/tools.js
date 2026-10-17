'use strict';
/**
 * IVE — tool belt.
 * Every capability of the assistant is a named tool with a risk level.
 * Risk decides whether the notch asks you first.
 *
 * OS-touching tools call the platform layer so the same schema works on
 * macOS and Windows.
 */
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { runShell } = require('../shell');
const { checkCommand, checkWritePath, isSafeShell } = require('../safety');
const platform = require('../platform');

const HOME = os.homedir();
const OS = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux';

const expand = (p) => String(p || '').replace(/^~(?=$|[/\\])/, HOME);
const clip = (s, n = 40_000) => {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + `\n… [${s.length - n} more characters truncated]` : s;
};

/* -------------------------------- schemas ------------------------------- */

const TOOLS = [
  {
    name: 'system_info',
    risk: 'read',
    description: 'Get OS, hostname, user, date/time/timezone and display information. Use before acting if you need context.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run(ctx) { return JSON.stringify(await ctx.getSystemSummary(), null, 2); }
  },
  {
    name: 'list_dir',
    risk: 'read',
    description: 'List a directory. Returns names, types and sizes, folders first.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path. Supports ~. Defaults to the home folder.' }, showHidden: { type: 'boolean' } },
      additionalProperties: false
    },
    async run(ctx, a) {
      const dir = expand(a.path || HOME);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const rows = [];
      for (const e of entries) {
        if (!a.showHidden && e.name.startsWith('.')) continue;
        let size = 0;
        try { size = e.isFile() ? (await fs.stat(path.join(dir, e.name))).size : 0; } catch { /* unreadable */ }
        rows.push(`${e.isDirectory() ? 'dir ' : 'file'}  ${String(size).padStart(9)}  ${e.name}`);
      }
      rows.sort((x, y) => (x.startsWith('dir') === y.startsWith('dir') ? x.localeCompare(y) : x.startsWith('dir') ? -1 : 1));
      return `${dir}\n${rows.slice(0, 400).join('\n') || '(empty)'}${rows.length > 400 ? `\n… ${rows.length - 400} more` : ''}`;
    }
  },
  {
    name: 'read_file',
    risk: 'read',
    description: 'Read a text file with line numbers. Use offset/limit for large files.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, offset: { type: 'number', description: 'First line (1-based).' }, limit: { type: 'number', description: 'Max lines (default 400, max 2000).' } },
      required: ['path'], additionalProperties: false
    },
    async run(ctx, a) {
      const file = expand(a.path);
      const buf = await fs.readFile(file);
      if (buf.includes(0)) return `[binary file, ${buf.length} bytes] ${file}`;
      const lines = buf.toString('utf8').split('\n');
      const off = Math.max(1, a.offset || 1);
      const lim = Math.min(a.limit || 400, 2000);
      const slice = lines.slice(off - 1, off - 1 + lim);
      const numbered = slice.map((l, i) => `${String(i + off).padStart(5)}│ ${l}`).join('\n');
      const tail = off - 1 + lim < lines.length ? `\n… ${lines.length - (off - 1 + lim)} more lines` : '';
      return clip(numbered + tail, 60_000);
    }
  },
  {
    name: 'write_file',
    risk: 'write',
    description: 'Create or overwrite a text file (parent folders are created). Show what you are about to write in your reply.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' }, append: { type: 'boolean' } },
      required: ['path', 'content'], additionalProperties: false
    },
    async run(ctx, a) {
      const fence = checkWritePath(expand(a.path));
      if (!fence.ok) return `Refused: ${fence.reason}`;
      await fs.mkdir(path.dirname(fence.abs), { recursive: true });
      if (a.append) await fs.appendFile(fence.abs, a.content, 'utf8');
      else await fs.writeFile(fence.abs, a.content, 'utf8');
      const st = await fs.stat(fence.abs);
      return `Wrote ${st.size} bytes to ${fence.abs}${a.append ? ' (appended)' : ''}.`;
    }
  },
  {
    name: 'edit_file',
    risk: 'write',
    description: 'Replace an exact string in a file. Fails if the string is absent or ambiguous. Use for surgical edits.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' }, all: { type: 'boolean', description: 'Replace every occurrence (default false).' } },
      required: ['path', 'find', 'replace'], additionalProperties: false
    },
    async run(ctx, a) {
      const fence = checkWritePath(expand(a.path));
      if (!fence.ok) return `Refused: ${fence.reason}`;
      const src = await fs.readFile(fence.abs, 'utf8');
      const count = src.split(a.find).length - 1;
      if (count === 0) return 'Refused: the "find" string does not exist in the file. Read it again.';
      if (count > 1 && !a.all) return `Refused: "find" appears ${count} times. Pass all:true or use a longer unique string.`;
      const out = a.all ? src.split(a.find).join(a.replace) : src.replace(a.find, a.replace);
      await fs.writeFile(fence.abs, out, 'utf8');
      return `Edited ${fence.abs} (${a.all ? count : 1} replacement${(a.all ? count : 1) === 1 ? '' : 's'}).`;
    }
  },
  {
    name: 'make_dir',
    risk: 'write',
    description: 'Create a folder (recursively).',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    async run(ctx, a) {
      const fence = checkWritePath(expand(a.path));
      if (!fence.ok) return `Refused: ${fence.reason}`;
      await fs.mkdir(fence.abs, { recursive: true });
      return `Created ${fence.abs}.`;
    }
  },
  {
    name: 'move_path',
    risk: 'write',
    description: 'Move or rename a file or folder.',
    parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'], additionalProperties: false },
    async run(ctx, a) {
      const from = checkWritePath(expand(a.from));
      const to = checkWritePath(expand(a.to));
      if (!from.ok) return `Refused: ${from.reason}`;
      if (!to.ok) return `Refused: ${to.reason}`;
      await fs.mkdir(path.dirname(to.abs), { recursive: true });
      await fs.rename(from.abs, to.abs);
      return `Moved ${from.abs} → ${to.abs}.`;
    }
  },
  {
    name: 'trash_path',
    risk: 'write',
    description: 'Move a file or folder to the Trash / Recycle Bin (recoverable). Prefer this over deleting.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    async run(ctx, a) {
      const fence = checkWritePath(expand(a.path));
      if (!fence.ok) return `Refused: ${fence.reason}`;
      return platform.trashPath(fence.abs);
    }
  },
  {
    name: 'search_files',
    risk: 'read',
    description: `Search this ${OS} machine for files by name. On macOS this uses Spotlight; on Windows a bounded filesystem walk.`,
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, path: { type: 'string', description: 'Folder to search in (optional).' }, maxResults: { type: 'number' } },
      required: ['query'], additionalProperties: false
    },
    async run(ctx, a) {
      return platform.searchFiles(a.query, { path: a.path ? expand(a.path) : undefined, max: Math.min(a.maxResults || 25, 100) });
    }
  },
  {
    name: 'shell_run',
    risk: 'shell',
    description: `Run a shell command (${OS === 'Windows' ? 'PowerShell' : 'zsh'}) and return stdout/stderr. Working directory defaults to the home folder. Prefer the dedicated file tools for file work. Destructive/system-level commands are blocked.`,
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeoutSec: { type: 'number', description: 'Default 90, max 300.' } },
      required: ['command'], additionalProperties: false
    },
    async run(ctx, a) {
      const check = checkCommand(a.command);
      if (!check.ok) return `Blocked: ${check.reason}`;
      const timeout = Math.min(Math.max(1, a.timeoutSec || 90), 300) * 1000;
      const r = await runShell(a.command, { cwd: a.cwd ? expand(a.cwd) : HOME, timeout });
      const parts = [`exit ${r.code} · ${r.ms}ms`];
      if (r.stdout.trim()) parts.push(`stdout:\n${clip(r.stdout.trim(), 30_000)}`);
      if (r.stderr.trim()) parts.push(`stderr:\n${clip(r.stderr.trim(), 10_000)}`);
      if (!r.stdout.trim() && !r.stderr.trim()) parts.push('(no output)');
      return parts.join('\n');
    }
  },
  {
    name: 'app_control',
    risk: 'automation',
    description: 'Open, focus or quit an application by name (e.g. "Safari", "Figma", "Notes", "Spotify").',
    parameters: {
      type: 'object',
      properties: { app: { type: 'string' }, action: { type: 'string', enum: ['open', 'activate', 'quit'] } },
      required: ['app', 'action'], additionalProperties: false
    },
    async run(ctx, a) { return platform.openApp(a.app, a.action); }
  },
  {
    name: 'active_app',
    risk: 'read',
    description: 'Name of the app currently in the foreground.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run() { return (await platform.activeApp()) || '(unknown)'; }
  },
  {
    name: 'list_windows',
    risk: 'read',
    description: 'List visible apps and their open windows.',
    parameters: { type: 'object', properties: { app: { type: 'string', description: 'Limit to one app.' } }, additionalProperties: false },
    async run(ctx, a) { return platform.listWindows(a.app); }
  },
  {
    name: 'open_url',
    risk: 'network',
    description: 'Open a URL in the default browser.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false },
    async run(ctx, a) {
      if (!/^https?:\/\//i.test(a.url)) return 'Refused: only http(s) URLs.';
      const cmd = process.platform === 'win32' ? `Start-Process ${JSON.stringify(a.url)}` : `open '${a.url.replace(/'/g, `'\\''`)}'`;
      const r = await runShell(cmd);
      return r.ok ? `Opened ${a.url}` : `Failed: ${r.stderr}`;
    }
  },
  {
    name: 'clipboard',
    risk: 'automation',
    description: 'Read the clipboard, or write text to it.',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['read', 'write'] }, text: { type: 'string' } },
      required: ['action'], additionalProperties: false
    },
    async run(ctx, a) {
      if (a.action === 'read') return clip(await platform.clipboardRead(), 20_000);
      return platform.clipboardWrite(a.text || '');
    }
  },
  {
    name: 'screenshot',
    risk: 'read',
    description: 'Capture the screen so you can see the current state. The image is attached to your next turn.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run(ctx) {
      if (!platform.capabilities.screenshots) return 'Screenshots are not available on this platform.';
      const file = path.join(os.tmpdir(), `ive-shot-${Date.now()}.png`);
      const res = await platform.screenshot(file);
      if (!res.ok) return `Screenshot failed: ${res.error}`;
      try {
        const buf = await fs.readFile(file);
        ctx.attachImage(`data:image/png;base64,${buf.toString('base64')}`, `Screenshot ${new Date().toLocaleTimeString()}`);
        await fs.unlink(file).catch(() => {});
        return 'Screenshot captured and attached as an image in the next user turn.';
      } catch (e) {
        return `Screenshot failed: ${e.message}`;
      }
    }
  },
  {
    name: 'type_text',
    risk: 'automation',
    description: 'Type text into the app that is currently focused (keystroke injection).',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    async run(ctx, a) {
      if (!platform.capabilities.keystrokes) return 'Typing is not available on this platform.';
      return platform.typeText(a.text);
    }
  },
  {
    name: 'press_key',
    risk: 'automation',
    description: 'Press a key with optional modifiers in the focused app, e.g. key:"return", modifiers:["cmd"].',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string' }, modifiers: { type: 'array', items: { type: 'string' } } },
      required: ['key'], additionalProperties: false
    },
    async run(ctx, a) {
      if (!platform.capabilities.keystrokes) return 'Key presses are not available on this platform.';
      return platform.pressKey(a.key, a.modifiers || []);
    }
  },
  {
    name: 'mouse_click',
    risk: 'automation',
    description: 'Click at global screen coordinates (points/pixels, origin top-left).',
    parameters: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string', enum: ['left', 'right'] }, double: { type: 'boolean' } },
      required: ['x', 'y'], additionalProperties: false
    },
    async run(ctx, a) {
      if (!platform.capabilities.clicks) return 'Clicks are not available on this platform.';
      return platform.click(Math.round(a.x), Math.round(a.y), { button: a.button || 'left', double: Boolean(a.double) });
    }
  },
  {
    name: 'run_shortcut',
    risk: 'automation',
    description: 'Run an Apple Shortcut by name (macOS only).',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
    async run(ctx, a) {
      if (!platform.capabilities.shortcuts) return platform.runShortcut(a.name);
      return platform.runShortcut(a.name);
    }
  },
  {
    name: 'music',
    risk: 'read',
    description: 'Read or control the system music player: play, pause, playpause, next, previous, seek (seconds), status.',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['status', 'play', 'pause', 'playpause', 'next', 'previous', 'seek'] }, seconds: { type: 'number' } },
      required: ['action'], additionalProperties: false
    },
    async run(ctx, a) {
      if (a.action === 'status') return JSON.stringify(ctx.musicState?.() || {}, null, 2);
      const res = await ctx.music.control(a.action, a.seconds);
      return res.ok ? `Music: ${a.action} ✓` : `Music control failed: ${res.error}`;
    }
  },
  {
    name: 'notify',
    risk: 'read',
    description: 'Send the user a quiet native notification (for long tasks the user should know finished).',
    parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title'], additionalProperties: false },
    async run(ctx, a) {
      ctx.notify(a.title, a.body || '');
      return 'Notification sent.';
    }
  },
  {
    name: 'ask_user',
    risk: 'read',
    description: 'Ask the user a question or request a decision. A card expands from the notch; the user can answer anytime while you wait. Provide 2–4 options.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        detail: { type: 'string', description: 'Optional context shown under the question.' },
        options: {
          type: 'array', minItems: 2, maxItems: 4,
          items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } }, required: ['id', 'label'] }
        }
      },
      required: ['question', 'options'], additionalProperties: false
    },
    async run(ctx, a) {
      const options = a.options.slice(0, 4).map((o) => ({ id: String(o.id), label: String(o.label) }));
      const res = await ctx.requestChoice({ title: 'IVE needs you', body: a.question, detail: a.detail || '', options, kind: 'question' });
      return `The user answered: ${res.label} (${res.id}).`;
    }
  },
  {
    name: 'web_fetch',
    risk: 'network',
    description: 'Fetch a web page or text resource and return readable text (truncated). No browser cookies are sent.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false },
    async run(ctx, a) {
      if (!/^https?:\/\//i.test(a.url)) return 'Refused: only http(s) URLs.';
      try {
        const res = await fetch(a.url, {
          headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) IVE/1.0' },
          signal: AbortSignal.timeout(25_000)
        });
        const ct = res.headers.get('content-type') || '';
        const body = await res.text();
        if (ct.includes('json')) return clip(body, 20_000);
        const text = body
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return `HTTP ${res.status} · ${ct}\n${clip(text, 24_000)}`;
      } catch (e) {
        return `Fetch failed: ${e.message}`;
      }
    }
  }
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

function schema(t) {
  return { name: t.name, description: t.description, parameters: t.parameters };
}

function inferRisk(tool, args) {
  if (['music', 'ask_user', 'notify', 'active_app', 'system_info'].includes(tool.name)) return 'read';
  if (tool.name === 'shell_run') return isSafeShell(args.command) ? 'safe-shell' : 'shell';
  return tool.risk;
}

async function executeTool(ctx, call) {
  const tool = byName.get(call.name);
  if (!tool) return { ok: false, content: `Unknown tool: ${call.name}` };
  const args = call.args || {};
  const risk = inferRisk(tool, args);
  const approve = ctx.config.autoApprove || {};

  const auto = {
    read: approve.reads !== false,
    write: approve.writes !== false,
    automation: approve.automation !== false,
    network: approve.network !== false,
    'safe-shell': true,
    shell: approve.shell === true
  }[risk];

  if (!auto) {
    const verdict = await ctx.authorize({
      tool: tool.name,
      risk,
      title: tool.name === 'shell_run' ? 'Run a shell command?' : `${labelFor(risk)} permission`,
      body: describeCall(tool.name, args),
      options: [
        { id: 'allow', label: 'Allow once', style: 'primary' },
        { id: 'always', label: 'Always allow', style: 'ghost' },
        { id: 'deny', label: 'Deny', style: 'danger' }
      ],
      kind: 'permission'
    });
    if (!verdict || verdict.id === 'deny' || verdict.timeout) return { ok: false, content: 'The user denied this action.' };
    if (verdict.id === 'always') ctx.rememberAlways(risk);
  }

  try {
    const content = await tool.run(ctx, args);
    return { ok: true, content: typeof content === 'string' ? content : JSON.stringify(content) };
  } catch (e) {
    return { ok: false, content: `${tool.name} failed: ${e.message}` };
  }
}

function labelFor(risk) {
  return { write: 'File edit', shell: 'Shell command', automation: 'Automation', network: 'Network', read: 'Read' }[risk] || 'Action';
}

function describeCall(name, args) {
  if (name === 'shell_run') return args.command || '';
  if (name === 'write_file') return `${args.path}\n${(args.content || '').slice(0, 300)}${(args.content || '').length > 300 ? '…' : ''}`;
  if (name === 'edit_file') return `${args.path}\n− ${(args.find || '').slice(0, 120)}\n+ ${(args.replace || '').slice(0, 120)}`;
  const parts = [];
  for (const [k, v] of Object.entries(args)) parts.push(`${k}: ${typeof v === 'string' ? v.slice(0, 160) : JSON.stringify(v)}`);
  return parts.join('\n') || 'Continue?';
}

module.exports = { TOOLS, toolSchemas: TOOLS.map(schema), executeTool, inferRisk, byName, OS };
