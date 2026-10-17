/* IVE demo bridge — fakes the main process inside the showcase iframe. */
(function () {
  const subs = new Map();
  const post = (msg) => { try { parent.postMessage({ __ive: true, src: 'notch', ...msg }, '*'); } catch (_) {} };
  const emit = (channel, data) => {
    (subs.get(channel) || []).slice().forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
  };

  const now = Date.now();
  const state = {
    config: {
      provider: 'openai',
      model: 'gpt-4o',
      baseUrl: '',
      hasApiKey: true,
      maxSteps: 24,
      silent: true,
      sound: false,
      launchAtLogin: false,
      autoApprove: { reads: true, writes: true, automation: true, shell: false, network: true },
      onboardingDone: true
    },
    presets: {
      openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', keyHint: 'sk-…' },
      anthropic: { label: 'Anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5', keyHint: 'sk-ant-…' },
      ollama: { label: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.1', keyHint: 'not needed' }
    },
    log: [
      { id: 'a1', type: 'user', text: 'Tidy my Downloads and group the Q3 decks.', ts: now - 8 * 60000 },
      { id: 'a2', type: 'tool', text: 'search_files · ok', ts: now - 7.8 * 60000 },
      { id: 'a3', type: 'tool', text: 'list_dir · ok', ts: now - 7.5 * 60000 },
      { id: 'a4', type: 'assistant', text: 'Done — 15 files sorted into 4 folders. Nothing deleted.', ts: now - 7 * 60000 }
    ],
    music: {
      player: 'music', playing: true,
      title: 'Everything In Its Right Place', artist: 'Radiohead', album: 'Kid A',
      duration: 251, position: 86, artHue: 196,
      queue: [
        { title: 'Weightless', artist: 'Marconi Union', duration: 486, artHue: 174 },
        { title: 'A Walk', artist: 'Tycho', duration: 306, artHue: 232 }
      ]
    },
    tracks: [
      { title: 'Everything In Its Right Place', artist: 'Radiohead', album: 'Kid A', duration: 251, artHue: 196 },
      { title: 'Weightless', artist: 'Marconi Union', album: 'Weightless', duration: 486, artHue: 174 },
      { title: 'A Walk', artist: 'Tycho', album: 'Dive', duration: 306, artHue: 232 }
    ],
    trackIdx: 0,
    asks: new Map(),
    seq: 0,
    timers: []
  };

  const later = (ms, fn) => { const t = setTimeout(fn, ms); state.timers.push(t); return t; };
  const pushLog = (entry) => {
    const e = { id: `l${++state.seq}`, ts: Date.now(), ...entry };
    state.log.push(e);
    emit('agent:log', e);
  };
  const setStatus = (s, label) => emit('agent:status', { state: s, ...(label ? { label } : {}) });

  function finish(text, ms) {
    emit('agent:status', { state: 'idle' });
    emit('agent:done', { text, ms });
  }

  function askPermission(card) {
    const id = `permission-${++state.seq}`;
    const ask = { id, kind: 'permission', meta: { tool: 'move_path' }, ...card };
    state.asks.set(id, ask);
    emit('ask', ask);
    post({ type: 'ask-created', id, kind: ask.kind });
    return ask;
  }

  function resolveAsk(ask, optionId) {
    state.asks.delete(ask.id);
    emit('ask:resolved', { id: ask.id, optionId });
    post({ type: 'ask-resolved', id: ask.id });
  }

  function runTask(text) {
    pushLog({ type: 'user', text });
    setStatus('working', 'thinking');
    later(900, () => {
      pushLog({ type: 'tool', text: 'search_files · ok' });
      setStatus('working', 'reading ~/Downloads');
    });
    later(1900, () => {
      pushLog({ type: 'tool', text: 'list_dir · ok' });
      setStatus('working', 'planning 4 folders');
    });
    later(2800, () => {
      askPermission({
        title: 'May I move these?',
        body: 'I found 18 loose files in ~/Downloads. I can sort them into four project folders — nothing gets deleted.',
        detail: 'Q3 Decks/        ← 6 files\nInvoices/        ← 4 files\nDesign/          ← 5 files\nUnsorted/        ← 3 files\n\nDestination: ~/Downloads',
        options: [
          { id: 'allow', label: 'Allow once', style: 'primary' },
          { id: 'always', label: 'Always allow', style: 'ghost' },
          { id: 'deny', label: 'Keep as is', style: 'danger' }
        ]
      });
    });
  }

  function answer(task, optionId) {
    state.asks.delete(task.id);
    emit('ask:resolved', { id: task.id, optionId });
    post({ type: 'ask-resolved', id: task.id });
    if (optionId === 'deny') {
      pushLog({ type: 'assistant', text: 'Left everything untouched. Say the word if you change your mind.' });
      later(500, () => finish('Left Downloads as it was.', 2600));
      return;
    }
    if (optionId === 'show') {
      pushLog({ type: 'assistant', text: 'Opened ~/Downloads so you can look first.' });
      post({ type: 'toast', text: 'Opening Downloads — demo only' });
      later(500, () => finish('Opened Downloads for you to review.', 2600));
      return;
    }
    setStatus('working', 'organizing');
    pushLog({ type: 'tool', text: 'move_path · ok' });
    later(1400, () => {
      pushLog({ type: 'assistant', text: 'Done — 15 files sorted into 4 folders. Nothing deleted.' });
      finish('15 files sorted into 4 folders. Nothing deleted.', 5400);
    });
  }

  window.IVE_DEMO_HOOK = (event) => post({ type: 'hook', event });

  /* ── browser demo only: fn is played by Alt ─────────────────── */
  const isTyping = (el) => el && /^(INPUT|TEXTAREA)$/.test(el.tagName);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') post({ type: 'alt', down: true });
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') post({ type: 'alt', down: false });
  }, true);
  window.addEventListener('blur', () => post({ type: 'alt', down: false }));

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || !m.__ive || m.src !== 'parent') return;
    if (m.type === 'external-submit') runTask(String(m.text || '').slice(0, 400));
    if (m.type === 'trigger-permission') {
      setStatus('working', 'waiting on you');
      later(350, () => askPermission({
        title: 'A choice, quickly',
        body: 'Two of these files look like duplicates. Merge them into one deck?',
        detail: 'Q3-Review-final.pptx\nQ3-Review-final-v2.pptx',
        options: [
          { id: 'allow', label: 'Merge', style: 'primary' },
          { id: 'deny', label: 'Keep both', style: 'danger' }
        ]
      }));
    }
    if (m.type === 'music-toggle') api.music.control('playpause');
    if (m.type === 'close-panel') emit('panel:toggle');
    if (m.type === 'respond') api.permission.respond(m.id, m.optionId);
    if (m.type === 'reset-demo') {
      state.timers.forEach(clearTimeout);
      state.timers = [];
      state.asks.clear();
      state.log = [];
      emit('agent:log', { type: 'clear', ts: Date.now() });
      setStatus('idle');
      emit('ask:resolved', { id: 'reset', optionId: 'reset' });
    }
  });

  const api = {
    platform: 'darwin',
    version: '0.1.0 · demo',
    config: {
      get: async () => ({ config: { ...state.config }, presets: state.presets, platform: 'darwin' }),
      set: async (patch) => {
        for (const [k, v] of Object.entries(patch || {})) {
          state.config[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? { ...state.config[k], ...v } : v;
        }
        emit('config', { ...state.config });
        return { ...state.config };
      },
      setKey: async (key) => { state.config.hasApiKey = Boolean(key); return { ok: true }; },
      test: () => new Promise((res) => setTimeout(() => res({ ok: true, ms: 940, reply: 'IVE-OK', model: state.config.model }), 1100))
    },
    agent: {
      ask: async (text) => { runTask(text); return { ok: true }; },
      cancel: async () => { setStatus('idle'); pushLog({ type: 'system', text: 'Stopped.' }); return { ok: true }; },
      reset: async () => {
        state.log = [];
        emit('agent:log', { type: 'clear', ts: Date.now() });
        pushLog({ type: 'system', text: 'Conversation reset.' });
        return { ok: true };
      }
    },
    log: {
      get: async () => ({ entries: state.log }),
      clear: async () => { state.log = []; return { ok: true }; }
    },
    music: {
      control: async (action, value) => {
        const m = state.music;
        if (action === 'playpause' || action === 'toggle') m.playing = !m.playing;
        if (action === 'play') m.playing = true;
        if (action === 'pause') m.playing = false;
        if (action === 'next' || action === 'previous') {
          state.trackIdx = (state.trackIdx + (action === 'next' ? 1 : state.tracks.length - 1)) % state.tracks.length;
          Object.assign(m, state.tracks[state.trackIdx], { position: 0, player: 'music' });
        }
        if (action === 'seek' && typeof value === 'number') m.position = value;
        emit('music', { ...m });
        post({ type: 'toast', text: `Music · ${action}` });
        return { ok: true };
      },
      state: async () => ({ ...state.music })
    },
    window: {
      setInteractive: () => {},
      focus: () => {},
      blur: () => {}
    },
    selection: {
      begin: () => post({ type: 'open-composer' }),
      beginCentered: () => post({ type: 'open-composer' }),
      submit: () => {},
      cancel: () => {}
    },
    permission: {
      respond: async (id, optionId) => {
        const task = state.asks.get(id) || { id };
        answer(task, optionId);
        return { ok: true };
      }
    },
    permissions: {
      get: async () => ({ platform: 'darwin', accessibility: true, helper: { ok: true, reason: 'fn + right-drag is live' } }),
      prompt: () => {},
      open: () => post({ type: 'toast', text: 'System Settings would open here' })
    },
    openExternal: () => post({ type: 'toast', text: 'This is the in-browser demo' }),
    openApp: (name) => post({ type: 'toast', text: `Opening ${name} — demo only` }),
    quit: () => post({ type: 'toast', text: 'The real app quits here' }),
    panelToggle: () => {},
    on: (channel, cb) => {
      if (!subs.has(channel)) subs.set(channel, []);
      subs.get(channel).push(cb);
      return () => {};
    }
  };

  window.ive = api;

  setInterval(() => {
    if (!state.music.playing) return;
    state.music.position = Math.min(state.music.duration, state.music.position + 1);
    if (state.music.position >= state.music.duration) {
      state.trackIdx = (state.trackIdx + 1) % state.tracks.length;
      Object.assign(state.music, state.tracks[state.trackIdx], { position: 0 });
    }
    emit('music', { ...state.music });
  }, 1000);

  setTimeout(() => post({ type: 'ready' }), 60);
})();
