'use strict';
/**
 * IVE — agent loop.
 * A quiet worker: takes a prompt, thinks, calls tools (asking permission through
 * the notch when needed), and files the result in the notch log.
 */
const os = require('os');
const { EventEmitter } = require('events');
const { makeProvider } = require('./providers');
const { executeTool, toolSchemas } = require('./tools');

const MAX_TOOL_RESULT = 40_000;

function systemPrompt(cfg) {
  const now = new Date();
  const date = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const osName = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux';
  const shell = process.platform === 'win32' ? 'PowerShell' : 'zsh';
  return `You are IVE — a quiet, exceptionally capable assistant living in the notch at the top of this ${osName} machine.
The user summons you with a gesture, types a thought, and returns to their work. You keep working in the background.

Today is ${date}, ${time}. The user is ${os.userInfo().username} on ${os.hostname()}, ${osName} (${os.release()}), home folder ${os.homedir()}. Shell commands run in ${shell}.

How to behave:
- You are already authorized to use your tools; do the work instead of explaining how to do it. Prefer dedicated file tools over raw shell. Keep shell commands small and reversible.
- Stay silent unless it matters. When you finish, give ONE plain-text sentence (max ~25 words) describing what you did — it is shown quietly in the notch log, not a chat window. No markdown headings, no bullet lists in the final answer.
- If something is genuinely ambiguous, destructive outside the obvious, or a matter of taste, use ask_user and keep working after the answer arrives. Never ask permission twice for the same thing.
- Files: read before editing. Keep edits surgical. Use ~ paths. Never touch system directories.
- Looking at the screen is allowed when it helps (screenshot tool). Do not type/click unless the task requires controlling another app.
- The user may be typing in another window; your tools run in the background. Never bring your own windows forward.
- You can control the system music player if the user asks about it.
- If a tool is blocked, missing on this platform, or denied, adapt — do not retry the same blocked action.
- Today's date matters for anything time-related; trust the date above.`;
}

class Agent extends EventEmitter {
  constructor({ config, music, historyStore, authorize, requestChoice, notify, getSystemSummary, musicState }) {
    super();
    this.config = config;
    this.music = music;
    this.historyStore = historyStore;
    this.authorize = authorize;
    this.requestChoice = requestChoice;
    this.notify = notify;
    this.getSystemSummary = getSystemSummary;
    this.musicState = musicState;
    this.messages = [];
    this.busy = false;
    this.queue = [];
    this.abort = null;
    this.pendingImages = [];
    this.lastActivity = null;
    this.load();
  }

  load() {
    try {
      const saved = this.historyStore.get('messages');
      if (Array.isArray(saved)) this.messages = saved.slice(-60);
    } catch { /* fresh start */ }
  }

  persist() {
    try {
      this.historyStore.set('messages', this.messages.slice(-60).map(compact));
    } catch { /* non-fatal */ }
  }

  reset() {
    this.messages = [];
    this.persist();
    this.emit('log', { type: 'reset' });
  }

  provider() {
    const c = this.config.all();
    return makeProvider({
      provider: c.provider,
      baseUrl: c.baseUrl,
      apiKey: c.apiKey,
      model: c.model,
      temperature: c.temperature
    });
  }

  ask(text, meta = {}) {
    const clean = String(text || '').trim();
    if (!clean) return { queued: false, error: 'Empty prompt.' };
    this.queue.push({ text: clean, meta, ts: Date.now() });
    this.emit('log', { type: 'user', text: clean, ts: Date.now(), source: meta.source || 'composer' });
    if (!this.busy) this._drain();
    return { queued: this.busy, position: this.queue.length };
  }

  cancel() {
    if (this.abort) this.abort.abort();
    this.queue = [];
    this.emit('status', { state: 'idle' });
    this.emit('log', { type: 'system', text: 'Stopped.', ts: Date.now() });
  }

  async _drain() {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    const started = Date.now();
    const c = this.config.all();
    try {
      this.emit('status', { state: 'working', label: 'thinking' });
      const answer = await this._runTurn(job.text, c);
      const ms = Date.now() - started;
      this.emit('log', { type: 'assistant', text: answer || 'Done.', ts: Date.now(), ms });
      this.emit('done', { text: answer, ms });
      this.lastActivity = { text: answer, ms, ts: Date.now() };
    } catch (e) {
      const message = e?.message || String(e);
      const cancelled = /cancel/i.test(message);
      this.emit('log', { type: 'error', text: cancelled ? 'Stopped.' : message, ts: Date.now() });
      this.emit('error', { message });
      if (!cancelled && this.config.get('notifyErrors') !== false) {
        try { this.notify('IVE could not finish', message.slice(0, 160)); } catch {}
      }
    } finally {
      this.busy = false;
      this.emit('status', { state: 'idle' });
      this.persist();
      if (this.queue.length) setTimeout(() => this._drain(), 400);
    }
  }

  async _runTurn(text, cfg) {
    const provider = this.provider();
    if (!cfg.apiKey && cfg.provider !== 'ollama') {
      throw new Error('No API key yet. Open the notch → Settings to add one.');
    }
    const maxSteps = Math.min(Math.max(4, cfg.maxSteps || 24), 60);
    this.messages.push({ role: 'user', content: text });

    const ctx = {
      config: { autoApprove: cfg.autoApprove },
      authorize: this.authorize,
      requestChoice: this.requestChoice,
      attachImage: (dataUrl) => this.pendingImages.push(dataUrl),
      music: this.music,
      musicState: this.musicState,
      notify: this.notify,
      getSystemSummary: this.getSystemSummary,
      rememberAlways: (risk) => {
        const map = { write: 'writes', shell: 'shell', automation: 'automation', network: 'network', read: 'reads' };
        const key = map[risk];
        if (key) this.config.set({ autoApprove: { ...cfg.autoApprove, [key]: true } });
      }
    };

    let finalText = '';
    for (let step = 0; step < maxSteps; step++) {
      this.emit('status', { state: 'working', label: step === 0 ? 'thinking' : 'working', step });
      this.abort = new AbortController();
      const res = await provider.chat({
        system: systemPrompt(cfg),
        messages: this.messages,
        tools: toolSchemas,
        signal: this.abort.signal
      });

      if (!res.toolCalls?.length) {
        finalText = (res.text || '').trim();
        this.messages.push({ role: 'assistant', content: finalText });
        this.emit('log', { type: 'assistant-step', text: finalText, ts: Date.now() });
        break;
      }

      const toolCalls = res.toolCalls.map((tc, i) => ({
        id: tc.id || `call_${Date.now()}_${i}`,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) }
      }));
      if (res.text) this.emit('log', { type: 'assistant-step', text: res.text, ts: Date.now() });
      this.messages.push({
        role: 'assistant',
        content: res.text || null,
        tool_calls: toolCalls
      });

      for (const tc of res.toolCalls) {
        const id = tc.id || toolCalls[res.toolCalls.indexOf(tc)]?.id;
        this.emit('status', { state: 'working', label: toolLabel(tc.name), tool: tc.name, step });
        const result = await executeTool(ctx, { ...tc, id });
        this.messages.push({
          role: 'tool',
          tool_call_id: id,
          content: String(result.content).slice(0, MAX_TOOL_RESULT)
        });
        this.emit('log', { type: 'tool', text: `${tc.name} · ${result.ok ? 'ok' : 'blocked'}`, ts: Date.now(), tool: tc.name });
      }

      if (this.pendingImages.length && provider.supportsVision && cfg.vision !== false) {
        const content = [{ type: 'text', text: 'Attached: screen capture(s) from the screenshot tool.' }];
        for (const dataUrl of this.pendingImages.splice(0, 2)) content.push({ type: 'image', dataUrl });
        this.messages.push({ role: 'user', content });
      } else {
        this.pendingImages = [];
      }
    }

    if (!finalText) finalText = 'I ran out of steps before finishing. Ask me to continue.';
    if (this.messages.length > 80) this.messages = this.messages.slice(-60);
    return finalText;
  }
}

function compact(m) {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: String(m.content).slice(0, 2000) };
  if (m.role === 'assistant' && m.tool_calls) {
    return { role: 'assistant', content: m.content || '', tool_calls: m.tool_calls };
  }
  if (Array.isArray(m.content)) {
    return { role: m.role, content: m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') || '[image]' };
  }
  return m;
}

function toolLabel(name) {
  return {
    shell_run: 'running a command', read_file: 'reading', write_file: 'writing',
    edit_file: 'editing', list_dir: 'looking around', screenshot: 'looking at your screen',
    app_control: 'switching apps', music: 'music', ask_user: 'waiting on you',
    search_files: 'searching', web_fetch: 'browsing', type_text: 'typing',
    press_key: 'pressing keys', mouse_click: 'clicking'
  }[name] || name.replace(/_/g, ' ');
}

module.exports = { Agent, systemPrompt };
