'use strict';
/**
 * IVE — notch renderer.
 * One island, four states: collapsed → hover → panel / alert.
 * No framework; a tiny spring-ish state machine and a lot of restraint.
 */

const $ = (s) => document.querySelector(s);
const ive = window.ive || null;

const island = $('#island');
const pill = $('#pill');
const clockEl = $('#clock');
const labelEl = $('#pillLabel');
const brandStatus = $('#brandStatus');
const alertWrap = $('#alertWrap');
const toastEl = $('#toast');

const PANEL_H = { assistant: 470, music: 462, settings: 610 };
const SIZE = {
  collapsed: { w: 216, h: 34 },
  hover: { w: 300, h: 40 }
};

const state = {
  view: 'collapsed',
  tab: 'assistant',
  pinned: false,
  config: null,
  presets: {},
  log: [],
  asks: [],
  askInlineId: null,
  alertH: 150,
  music: null,
  musicAt: 0,
  working: false,
  lastLabel: '',
  onboardingAutoShown: false,
  interactive: false,
  alertTimer: null,
  toastTimer: null
};

/* ── boot ─────────────────────────────────────────────────────── */

function fmtClock(d = new Date()) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
clockEl.textContent = fmtClock();
setInterval(() => { clockEl.textContent = fmtClock(); }, 1000);

function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function applySize() {
  const size = state.view === 'panel'
    ? { w: 440, h: PANEL_H[state.tab] || 496 }
    : state.view === 'alert'
      ? { w: 396, h: state.alertH }
      : SIZE[state.view];
  island.style.width = `${size.w}px`;
  island.style.height = `${size.h}px`;
}

function setView(next, { instant = false } = {}) {
  if (state.view === next && !instant) return;
  state.view = next;
  island.dataset.view = next;
  if (!instant) {
    island.classList.add('morphing');
    clearTimeout(setView._t);
    setView._t = setTimeout(() => island.classList.remove('morphing'), 660);
  }
  if (next === 'panel') {
    island.classList.add('opening');
    clearTimeout(setView._o);
    setView._o = setTimeout(() => island.classList.remove('opening'), 1100);
  }
  applySize();
  if (next === 'panel') {
    renderTabs();
    renderAskInline();
    renderLog();
    scrollLogToEnd();
    setTimeout(() => $('#panelInput')?.blur(), 0);
  }
  if (next === 'collapsed') {
    island.classList.remove('pinned');
  }
}

function openPanel(tab) {
  if (tab) setTab(tab, { silent: true });
  state.pinned = true;
  setView('panel');
  island.classList.add('pinned');
  ive?.window?.focus?.();
  renderPanels();
  window.IVE_DEMO_HOOK?.('panel-open');
}

function closePanel() {
  state.pinned = false;
  setView('collapsed');
  ive?.window?.blur?.();
  window.IVE_DEMO_HOOK?.('panel-close');
}

/* ── hover + click-through ────────────────────────────────────── */

function insideIsland(x, y) {
  const r = island.getBoundingClientRect();
  return x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2;
}

window.addEventListener('mousemove', (e) => {
  const inside = insideIsland(e.clientX, e.clientY);
  if (inside !== state.interactive) {
    state.interactive = inside;
    ive?.window?.setInteractive?.(inside);
  }
  if (!inside) {
    if (state.view === 'hover') setView('collapsed');
    return;
  }
  if (state.view === 'collapsed' && !state.pinned) setView('hover');
  if (state.view === 'alert') armAlertRelax(false);
});

window.addEventListener('mouseleave', () => {
  if (state.view === 'hover') setView('collapsed');
});

document.addEventListener('click', (e) => {
  const music = e.target.closest('[data-music]');
  if (music) {
    e.stopPropagation();
    const action = music.dataset.music;
    ive?.music?.control?.(action);
    if (action === 'playpause') toggleOptimisticPlay();
    return;
  }
});

pill.addEventListener('click', (e) => {
  if (e.target.closest('[data-music]') || e.target.closest('.pending-dot')) return;
  if (state.view === 'panel') closePanel();
  else openPanel();
});

$('#btnClose').addEventListener('click', closePanel);
$('#btnCompose').addEventListener('click', () => {
  closePanel();
  setTimeout(() => ive?.selection?.begin?.(), 120);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.view === 'panel') closePanel();
    else if (state.view === 'alert') dismissAlert();
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && document.activeElement === $('#panelInput')) {
    $('#panelComposer').requestSubmit();
  }
});

/* ── tabs ─────────────────────────────────────────────────────── */

const tabButtons = [...document.querySelectorAll('.tab-btn')];
tabButtons.forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

function setTab(tab, { silent = false } = {}) {
  state.tab = tab;
  renderTabs();
  renderPanels();
  if (state.view === 'panel') applySize();
  if (!silent) {
    island.classList.add('morphing');
    clearTimeout(setTab._t);
    setTab._t = setTimeout(() => island.classList.remove('morphing'), 600);
  }
  if (tab === 'assistant') setTimeout(scrollLogToEnd, 60);
}

function renderTabs() {
  tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  const idx = ['assistant', 'music', 'settings'].indexOf(state.tab);
  $('#tabInk').style.transform = `translateX(${idx * 100}%)`;
}

function renderPanels() {
  document.querySelectorAll('.tab-pane').forEach((p) => {
    p.classList.toggle('active', p.id === `pane-${state.tab}`);
  });
}

/* ── log ──────────────────────────────────────────────────────── */

const SPARK = `<svg viewBox="0 0 24 24"><path d="M12 3v18M5.5 8v8M18.5 8v8" stroke-linecap="round"/></svg>`;

function renderLog() {
  const log = $('#log');
  const visible = state.log.filter((e) => !['done'].includes(e.type));
  if (!visible.length && !state.working) {
    log.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `
      <div class="empty-orb"><span></span><span></span><span></span></div>
      <p>I work from the notch.</p>
      <p class="muted">Hold <kbd>fn</kbd> and right-drag anywhere to open the glass composer. Say what you need, press <kbd>↵</kbd>, and get back to work.</p>`;
    log.appendChild(empty);
    return;
  }
  log.innerHTML = visible.map((e) => {
    if (e.type === 'user') {
      return `<div class="entry user"><div class="bubble"><div class="text">${esc(e.text)}</div><div class="when">${fmtTime(e.ts)}</div></div></div>`;
    }
    if (e.type === 'tool') {
      return `<div class="entry tool"><div class="bubble"><div class="text">${esc(e.text)}</div></div></div>`;
    }
    if (e.type === 'error') {
      return `<div class="entry error"><div class="avatar">!</div><div class="bubble"><div class="text">${esc(e.text)}</div></div></div>`;
    }
    if (e.type === 'system') {
      return `<div class="entry system"><div class="bubble"><div class="text">${esc(e.text)}</div></div></div>`;
    }
    const text = e.text || '';
    return `<div class="entry"><div class="avatar">${SPARK}</div><div class="bubble"><div class="text">${esc(text)}</div><div class="when">${fmtTime(e.ts)}</div></div></div>`;
  }).join('');
  if (state.working) {
    log.insertAdjacentHTML('beforeend', `<div class="entry"><div class="avatar">${SPARK}</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>`);
  }
}

function scrollLogToEnd() {
  const log = $('#log');
  if (log) log.scrollTop = log.scrollHeight;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── pills / status ───────────────────────────────────────────── */

function setWorking(working, label) {
  state.working = working;
  island.classList.toggle('working', working);
  if (working) {
    state.lastLabel = label || 'working';
    labelEl.textContent = state.lastLabel;
    brandStatus.textContent = `working · ${state.lastLabel}`;
  } else {
    labelEl.textContent = 'quiet';
    brandStatus.textContent = 'quiet · listening';
  }
  if (state.view === 'panel') renderLog();
  updatePendingDot();
}

function updatePendingDot() {
  const dot = $('#pendingDot');
  dot.hidden = !(state.asks.length && state.view !== 'alert');
}

function flash() {
  island.classList.remove('flash');
  void island.offsetWidth;
  island.classList.add('flash');
  setTimeout(() => island.classList.remove('flash'), 1250);
}

/* ── music ────────────────────────────────────────────────────── */

function toggleOptimisticPlay() {
  if (!state.music) state.music = { playing: false, title: '', artist: '', duration: 0, position: 0, artHue: 162 };
  state.music.playing = !state.music.playing;
  state.musicAt = Date.now();
  renderMusic();
}

function renderMusic() {
  const m = state.music || {};
  const playing = Boolean(m.playing);
  island.classList.toggle('music-playing', playing);
  const hue = Number.isFinite(m.artHue) ? m.artHue : 162;
  const art = $('#art');
  if (art) {
    art.style.background = `
      radial-gradient(120% 120% at 20% 10%, rgba(255,255,255,.22), transparent 45%),
      linear-gradient(150deg, hsl(${hue} 52% 44%), hsl(${(hue + 46) % 360} 62% 30%) 55%, hsl(${(hue + 110) % 360} 55% 26%))`;
  }
  $('#trackTitle').textContent = m.title || 'Nothing playing';
  $('#trackArtist').textContent = m.artist || (m.title ? '' : 'Ask IVE to put something on.');
  $('#trackSource').textContent = m.player ? `${m.player === 'music' ? 'Apple Music' : 'Spotify'}${playing ? ' · playing' : ' · paused'}` : '';
  const dur = m.duration || 0;
  const pos = currentPosition();
  $('#scrubFill').style.width = dur ? `${Math.min(100, (pos / dur) * 100)}%` : '0%';
  $('#scrubKnob').style.left = dur ? `${Math.min(100, (pos / dur) * 100)}%` : '0%';
  $('#tNow').textContent = fmtDur(pos);
  $('#tDur').textContent = fmtDur(dur);
  const queue = $('#queue');
  if (queue) {
    const rows = (m.queue || []).slice(0, 3);
    queue.innerHTML = rows.length
      ? `<div class="q-label">up next</div>` + rows.map((t) => `
          <div class="qrow">
            <span class="qdot" style="--h:${Number.isFinite(t.artHue) ? t.artHue : hue}"></span>
            <span class="qtitle">${esc(t.title)}</span>
            <span class="qartist">${esc(t.artist || '')}</span>
            <span class="qtime">${fmtDur(t.duration)}</span>
          </div>`).join('')
      : '';
  }
}

function currentPosition() {
  const m = state.music;
  if (!m) return 0;
  if (!m.playing) return m.position || 0;
  const drift = (Date.now() - state.musicAt) / 1000;
  return Math.min(m.duration || Infinity, (m.position || 0) + drift);
}

function fmtDur(s) {
  s = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

setInterval(() => { if (state.music) renderMusic(); }, 500);

$('#scrub').addEventListener('click', (e) => {
  const m = state.music;
  if (!m || !m.duration) return;
  const r = $('#scrub').getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const seconds = Math.round(frac * m.duration);
  m.position = seconds;
  state.musicAt = Date.now();
  renderMusic();
  ive?.music?.control?.('seek', seconds);
});

$('#openMusic').addEventListener('click', () => ive?.openApp?.('Music'));

/* ── asks / permissions ───────────────────────────────────────── */

function activeAsk() {
  return state.asks[0] || null;
}

function receiveAsk(ask) {
  if (state.asks.some((a) => a.id === ask.id)) return;
  state.asks.push(ask);
  flash();
  if (state.view === 'panel') {
    state.askInlineId = ask.id;
    renderAskInline();
    renderLog();
    scrollLogToEnd();
  } else {
    renderAlert();
    setView('alert');
  }
  updatePendingDot();
  if (ask.kind === 'permission' || ask.kind === 'question') {
    armAlertRelax(true);
  }
}

function renderAlert() {
  const ask = activeAsk();
  if (!ask) {
    dismissAlert(true);
    return;
  }
  $('#alertTitle').textContent = ask.title || 'IVE needs you';
  $('#alertMeta').textContent = ask.kind === 'permission'
    ? `permission · ${(ask.meta?.tool || 'action').replace(/_/g, ' ')}`
    : ask.kind === 'question' ? 'a question for you' : 'from IVE';
  $('#alertBody').textContent = ask.body || '';
  const detail = $('#alertDetail');
  if (ask.detail) { detail.textContent = ask.detail; detail.classList.add('show'); }
  else { detail.textContent = ''; detail.classList.remove('show'); }

  const btns = $('#alertBtns');
  btns.innerHTML = '';
  (ask.options || []).slice(0, 3).forEach((opt) => {
    const b = document.createElement('button');
    b.className = opt.style === 'primary' ? 'primary' : opt.style === 'danger' ? 'danger' : 'ghost';
    b.textContent = opt.label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      respond(ask, opt.id, b);
    });
    btns.appendChild(b);
  });

  const more = $('#alertMore');
  if (state.asks.length > 1) {
    more.hidden = false;
    more.textContent = `+${state.asks.length - 1} more waiting`;
  } else {
    more.hidden = true;
  }

  const measure = () => {
    if (state.view !== 'alert') return;
    const h = alertWrap.offsetTop + alertWrap.scrollHeight + 4;
    if (h && Math.abs(h - state.alertH) > 1) {
      state.alertH = h;
      island.style.height = `${h}px`;
    }
  };
  requestAnimationFrame(measure);
  setTimeout(measure, 220);
  setTimeout(measure, 640);
}

function dismissAlert(force = false) {
  if (!force) {
    // hide visually but keep the ask pending; a dot stays on the notch
    state.view = 'collapsed';
    island.dataset.view = 'collapsed';
    applySize();
    updatePendingDot();
    const ask = activeAsk();
    if (ask?.id === 'no-key') {
      state.asks = state.asks.filter((a) => a.id !== 'no-key');
      updatePendingDot();
    }
    return;
  }
  setView('collapsed');
  updatePendingDot();
}

function armAlertRelax(arm) {
  clearTimeout(state.alertTimer);
  if (!arm) return;
  state.alertTimer = setTimeout(() => {
    if (state.view === 'alert' && !state.interactive) dismissAlert();
  }, 11000);
}

$('#alertDismiss').addEventListener('click', (e) => { e.stopPropagation(); dismissAlert(); });
alertWrap.addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  openPanel('assistant');
});

async function respond(ask, optionId, btn) {
  if (btn) { btn.style.opacity = '.6'; btn.style.pointerEvents = 'none'; }
  if (ask.id === 'no-key') {
    state.asks = state.asks.filter((a) => a.id !== ask.id);
    if (optionId === 'settings') openPanel('settings');
    else closePanel();
    renderAskInline();
    updatePendingDot();
    return;
  }
  try { await ive?.permission?.respond?.(ask.id, optionId); } catch { /* resolved elsewhere */ }
}

function resolveAsk(id) {
  const ask = state.asks.find((a) => a.id === id);
  state.asks = state.asks.filter((a) => a.id !== id);
  updatePendingDot();
  if (state.view === 'panel') {
    renderAskInline();
    renderLog();
    scrollLogToEnd();
  } else if (activeAsk()) {
    renderAlert();
  } else {
    const wasAlert = state.view === 'alert';
    if (wasAlert) {
      // let the answer land, then retract
      setTimeout(() => {
        if (!state.asks.length) setView('collapsed');
      }, 420);
    }
  }
  return ask;
}

function renderAskInline() {
  const wrap = $('#askInline');
  const ask = activeAsk();
  if (!ask) { wrap.hidden = true; wrap.innerHTML = ''; return; }
  wrap.hidden = false;
  wrap.innerHTML = `
    <div class="ai-q">${esc(ask.body || ask.title || '')}${ask.detail ? `<div class="text" style="margin-top:6px;color:var(--muted);font-size:10.5px;">${esc(ask.detail)}</div>` : ''}</div>
    <div class="ai-btns">${(ask.options || []).map((o) => `<button class="ghost-btn ${o.style === 'primary' ? 'primaryish' : ''}" data-ask-opt="${esc(o.id)}">${esc(o.label)}</button>`).join('')}</div>`;
  wrap.querySelectorAll('[data-ask-opt]').forEach((b) => {
    b.addEventListener('click', () => respond(ask, b.dataset.askOpt, b));
  });
}

/* ── panel composer ──────────────────────────────────────────── */

$('#panelComposer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#panelInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const res = await ive?.agent?.ask?.(text, 'panel');
  if (res && res.ok === false) showToast(res.error || 'Could not send.');
});

/* ── settings ─────────────────────────────────────────────────── */

function fillSettings() {
  const c = state.config;
  if (!c) return;
  $('#setModel').value = c.model || '';
  $('#setBaseUrl').value = c.baseUrl || '';
  const preset = state.presets[c.provider] || {};
  $('#setKey').placeholder = c.hasApiKey ? '•••••••••• saved — type to replace' : (preset.keyHint || 'api key');
  document.querySelectorAll('#providerSeg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.provider === c.provider);
  });
  document.querySelectorAll('[data-toggle]').forEach((el) => {
    const path = el.dataset.toggle.split('.');
    const value = path.length === 2 ? (c[path[0]] || {})[path[1]] : c[path[0]];
    el.classList.toggle('on', Boolean(value));
  });
  $('#onboard').hidden = Boolean(c.onboardingDone);
}

function readToggle(el) {
  return el.classList.contains('on');
}

document.querySelectorAll('[data-toggle]').forEach((el) => {
  el.addEventListener('click', async () => {
    el.classList.toggle('on');
    const path = el.dataset.toggle.split('.');
    const patch = path.length === 2
      ? { [path[0]]: { ...(state.config?.[path[0]] || {}), [path[1]]: readToggle(el) } }
      : { [path[0]]: readToggle(el) };
    const pub = await ive?.config?.set?.(patch);
    if (pub) { state.config = pub; }
  });
});

document.querySelectorAll('#providerSeg button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#providerSeg button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    const preset = state.presets[b.dataset.provider];
    if (preset) {
      const model = $('#setModel');
      const base = $('#setBaseUrl');
      if (!model.value || Object.values(state.presets).some((p) => p.model === model.value)) model.value = preset.model;
      if (!base.value || Object.values(state.presets).some((p) => p.baseUrl === base.value)) base.value = preset.baseUrl;
      $('#setKey').placeholder = state.config?.hasApiKey ? '•••••••••• saved — type to replace' : preset.keyHint;
    }
  });
});

$('#btnTest').addEventListener('click', async () => {
  const status = $('#testStatus');
  status.className = '';
  status.textContent = 'Saving…';
  const provider = document.querySelector('#providerSeg button.active')?.dataset.provider || 'openai';
  const model = $('#setModel').value.trim();
  const baseUrl = $('#setBaseUrl').value.trim();
  const key = $('#setKey').value.trim();
  const patch = { provider, model, baseUrl };
  let pub = await ive?.config?.set?.(patch);
  if (key) {
    await ive?.config?.setKey?.(key);
    $('#setKey').value = '';
    const again = await ive?.config?.get?.();
    pub = again?.config;
  }
  if (pub) { state.config = pub; }
  if (!model) { status.className = 'bad'; status.textContent = 'Add a model name.'; return; }
  status.textContent = 'Testing…';
  const res = await ive?.config?.test?.();
  if (res?.ok) {
    status.className = 'ok';
    status.textContent = `Connected · ${res.model} · ${res.ms}ms`;
    showToast('Model connected');
  } else {
    status.className = 'bad';
    status.textContent = res?.error ? String(res.error).slice(0, 140) : 'Connection failed.';
  }
  fillSettings();
});

document.querySelectorAll('[data-perm]').forEach((b) => {
  b.addEventListener('click', () => ive?.permissions?.open?.(b.dataset.perm));
});

$('#btnOnboardDone').addEventListener('click', async () => {
  const pub = await ive?.config?.set?.({ onboardingDone: true });
  if (pub) state.config = pub;
  $('#onboard').hidden = true;
  showToast('Welcome to IVE');
});

$('#btnReset').addEventListener('click', async () => {
  await ive?.agent?.reset?.();
  showToast('Conversation reset');
});

$('#btnClearLog').addEventListener('click', async () => {
  await ive?.log?.clear?.();
  state.log = [];
  renderLog();
  showToast('Log cleared');
});

$('#btnQuit').addEventListener('click', () => ive?.quit?.());

document.querySelectorAll('[data-link]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    ive?.openExternal?.(a.dataset.link);
  });
});

function renderPermissions(p) {
  if (!p) return;
  const ax = $('#stateAx');
  ax.textContent = p.accessibility ? 'granted' : 'not granted';
  ax.className = `perm-state ${p.accessibility ? 'ok' : 'bad'}`;
  const helper = $('#stateHelper');
  helper.textContent = p.helper?.ok ? 'listening' : 'off';
  helper.className = `perm-state ${p.helper?.ok ? 'ok' : 'bad'}`;
  $('#helperReason').textContent = p.helper?.reason || (p.helper?.ok ? 'fn + right-drag is live' : 'using ⌘⇧Space fallback');
  const inp = $('#stateInput');
  inp.textContent = '—';
  inp.className = 'perm-state';
  const scr = $('#stateScreen');
  scr.textContent = '—';
  scr.className = 'perm-state';
}

function showToast(text) {
  toastEl.textContent = String(text).slice(0, 120);
  toastEl.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

/* ── bridge events ────────────────────────────────────────────── */

function on(channel, cb) {
  try { ive?.on?.(channel, cb); } catch { /* mock bridge */ }
}

on('agent:status', ({ state: s, label }) => {
  setWorking(s === 'working', label);
  if (s === 'working' && state.view === 'panel') renderLog();
});

on('agent:log', (entry) => {
  if (entry.type === 'clear') {
    state.log = [];
    renderLog();
    return;
  }
  state.log.push(entry);
  if (state.log.length > 160) state.log = state.log.slice(-160);
  if (state.view === 'panel' && state.tab === 'assistant') {
    const nearBottom = (() => {
      const el = $('#log');
      return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    })();
    renderLog();
    if (nearBottom || entry.type === 'user') scrollLogToEnd();
  }
});

on('agent:done', ({ text, ms }) => {
  setWorking(false);
  flash();
  if (state.config && state.config.silent === false && text) showToast(text.slice(0, 110));
  if (state.view === 'panel') { renderLog(); scrollLogToEnd(); }
});

on('agent:error', ({ message }) => {
  setWorking(false);
  island.classList.add('error');
  setTimeout(() => island.classList.remove('error'), 3200);
  showToast(message || 'Something went wrong.');
});

on('ask', (ask) => receiveAsk(ask));
on('ask:resolved', ({ id, optionId }) => {
  const ask = resolveAsk(id);
  if (ask && ask.kind === 'question') showToast('Sent your answer');
});

on('music', (m) => {
  state.music = m;
  state.musicAt = Date.now();
  renderMusic();
});

on('permissions', renderPermissions);

on('config', (c) => {
  state.config = c;
  fillSettings();
});

on('fn', ({ down }) => {
  island.classList.toggle('fn', down);
});

on('panel:open', ({ tab } = {}) => openPanel(tab || 'assistant'));
on('panel:toggle', () => {
  if (state.view === 'panel') closePanel();
  else openPanel('assistant');
});

on('selection:start', () => {
  // The composer is about to be drawn on the overlay; get out of the way.
  if (state.view === 'panel') closePanel();
});

on('composer:closed', () => updatePendingDot());

/* ── init ─────────────────────────────────────────────────────── */

(async function init() {
  setView('collapsed', { instant: true });
  renderTabs();
  renderPanels();
  renderMusic();
  renderPermissions(null);

  try {
    const boot = await ive?.config?.get?.();
    if (boot) {
      state.config = boot.config;
      state.presets = boot.presets || {};
      fillSettings();
      if (!boot.config.onboardingDone && !state.onboardingAutoShown) {
        state.onboardingAutoShown = true;
        setTimeout(() => openPanel('settings'), 1100);
      }
    }
  } catch { /* ignore */ }

  try {
    const log = await ive?.log?.get?.();
    if (log?.entries) {
      state.log = log.entries;
      if (state.view === 'panel') renderLog();
    }
  } catch { /* ignore */ }

  try {
    const m = await ive?.music?.state?.();
    if (m) { state.music = m; state.musicAt = Date.now(); renderMusic(); }
  } catch { /* ignore */ }

  // If an ask is already pending on boot (e.g. Electron reloaded), surface it.
  try {
    const log = await ive?.log?.get?.();
    if (log?.pending?.length) {
      receiveAsk({
        id: log.pending[0],
        kind: 'permission',
        title: 'Still waiting',
        body: 'IVE asked for your permission while the screen restarted.',
        options: [
          { id: 'allow', label: 'Allow', style: 'primary' },
          { id: 'deny', label: 'Deny', style: 'danger' }
        ]
      });
    }
  } catch { /* ignore */ }
})();
