/* IVE demo bridge — fakes the main process for the composer iframe. */
(function () {
  window.IVE_POINTER_MODE = true;

  const subs = new Map();
  const post = (msg) => { try { parent.postMessage({ __ive: true, src: 'overlay', ...msg }, '*'); } catch (_) {} };
  const emit = (channel, data) => (subs.get(channel) || []).slice().forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });

  window.IVE_DEMO_HOOK = (phase) => post({ type: 'overlay-state', phase });

  /* ── browser demo only: fn is played by Alt ─────────────────── */
  const isTyping = (el) => el && /^(INPUT|TEXTAREA)$/.test(el.tagName);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') post({ type: 'alt', down: true });
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') post({ type: 'alt', down: false });
  }, true);
  window.addEventListener('blur', () => post({ type: 'alt', down: false }));

  /* In the browser there is no real screen capture, so the glass borrows a
     blurred echo of the demo wallpaper. In the app this is a real screenshot. */
  const demoGlass = document.createElement('style');
  demoGlass.textContent = `
    .demo-glass .glass-img.on {
      background-image:
        radial-gradient(46% 46% at 24% 28%, rgba(70,160,132,.9), transparent 62%),
        radial-gradient(42% 42% at 76% 24%, rgba(74,104,190,.9), transparent 64%),
        radial-gradient(54% 60% at 60% 84%, rgba(148,76,160,.7), transparent 64%),
        linear-gradient(160deg, #0a0d14, #0c0a12 48%, #0a0b10) !important;
      background-size: cover !important;
      background-position: center !important;
      opacity: 1 !important;
      filter: blur(30px) saturate(1.9) brightness(.78) !important;
    }`;
  document.head.appendChild(demoGlass);

  function showDemoGlass() {
    document.body.classList.add('demo-glass');
    const img = document.getElementById('glassImg');
    if (img) img.classList.add('on');
  }

  function typeAndSend(text) {
    const input = document.getElementById('input');
    if (!input) return;
    input.focus();
    let i = 0;
    const step = Math.max(1, Math.round(text.length / 60));
    const iv = setInterval(() => {
      i = Math.min(text.length, i + step);
      input.value = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(iv);
        setTimeout(() => { if (typeof window.IVE_DEMO_FORCE_SEND === 'function') window.IVE_DEMO_FORCE_SEND(text); }, 420);
      }
    }, 26);
  }

  window.IVE_DEMO_FORCE_SEND = (text) => {
    // send() reads the textarea, so ensure it is populated first
    document.getElementById('input').value = text;
    if (typeof send === 'function') send();
  };

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || !m.__ive || m.src !== 'parent') return;
    if (m.type === 'open-composer' || m.type === 'demo-select') showDemoGlass();
    if (m.type === 'open-composer') {
      const x = typeof m.x === 'number' ? m.x : window.innerWidth / 2;
      const y = typeof m.y === 'number' ? m.y : window.innerHeight * 0.42;
      window.openManual({ x, y, displayWidth: window.innerWidth, displayHeight: window.innerHeight });
    }
    if (m.type === 'demo-select') window.IVE_DEMO_START(m.x, m.y);
    if (m.type === 'demo-move') window.IVE_DEMO_MOVE(m.x, m.y);
    if (m.type === 'demo-end') window.IVE_DEMO_END(m.x, m.y);
    if (m.type === 'demo-autosend') typeAndSend(String(m.text || '').slice(0, 400));
  });

  window.ive = {
    platform: 'darwin',
    config: {
      get: async () => ({ config: { onboardingDone: true, silent: true, model: 'gpt-4o', provider: 'openai' }, presets: {} }),
      set: async () => ({}),
      setKey: async () => ({ ok: true }),
      test: async () => ({ ok: true, ms: 900, model: 'gpt-4o' })
    },
    agent: {
      ask: async () => ({ ok: true }),
      cancel: async () => ({ ok: true }),
      reset: async () => ({ ok: true })
    },
    log: { get: async () => ({ entries: [] }), clear: async () => ({}) },
    music: { control: async () => ({}), state: async () => null },
    window: { setInteractive: () => {}, focus: () => {}, blur: () => {} },
    selection: {
      begin: () => {},
      beginCentered: () => {},
      submit: (text) => { post({ type: 'submit', text }); },
      cancel: () => { post({ type: 'cancel' }); }
    },
    permission: { respond: async () => ({ ok: true }) },
    permissions: { get: async () => ({}), prompt: () => {}, open: () => {} },
    openExternal: () => {},
    openApp: () => {},
    quit: () => {},
    panelToggle: () => {},
    on: (channel, cb) => {
      if (!subs.has(channel)) subs.set(channel, []);
      subs.get(channel).push(cb);
      return () => {};
    }
  };
})();
