'use strict';
/**
 * IVE — composer overlay.
 * fn + right-drag draws a glass rectangle that springs open into a prompt.
 * Motion is a small spring integrator, not CSS transitions, so every frame
 * carries a little weight.
 */
const ive = window.ive || null;
const stage = document.getElementById('stage');
const card = document.getElementById('card');
const dimsEl = document.getElementById('dims');
const inputEl = document.getElementById('input');
const glassImg = document.getElementById('glassImg');
const wirePath = document.getElementById('wirePath');

const BASE_W = 460;
const BASE_H = 210;

const S = {
  phase: 'idle', // idle | dragging | composing | sending | closing
  cur: { x: 0, y: 0, w: 30, h: 30 },
  tgt: { x: 0, y: 0, w: 30, h: 30 },
  vel: { x: 0, y: 0, w: 0, h: 0 },
  start: { x: 0, y: 0 },
  pointer: { x: 0, y: 0 },
  display: { w: window.innerWidth, h: window.innerHeight },
  moved: false,
  glass: null,
  bounds: null,
  submitLock: false
};

/* droplets trail the pointer */
const drops = [
  { el: document.querySelector('.d1'), k: 420, d: 30, p: { x: 0, y: 0 }, v: { x: 0, y: 0 }, kk: 0 },
  { el: document.querySelector('.d2'), k: 190, d: 24, p: { x: 0, y: 0 }, v: { x: 0, y: 0 } },
  { el: document.querySelector('.d3'), k: 95, d: 18, p: { x: 0, y: 0 }, v: { x: 0, y: 0 } }
];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function composerRectAt(x, y) {
  const w = BASE_W;
  const h = BASE_H;
  const margin = 16;
  return {
    x: clamp(x - w / 2, margin, S.display.w - w - margin),
    y: clamp(y, 8, S.display.h - h - margin),
    w, h
  };
}

function resetSurface() {
  stage.className = '';
  card.classList.remove('sent');
  card.style.opacity = '0';
  inputEl.value = '';
  inputEl.disabled = false;
  S.submitLock = false;
  S.phase = 'idle';
  S.glass = null;
  glassImg.classList.remove('on');
  glassImg.style.backgroundImage = '';
  S.cur = { x: S.start.x, y: S.start.y, w: 30, h: 30 };
  window.IVE_DEMO_HOOK?.('idle');
}

/* ── gestures from the fn helper (via main) ──────────────────── */

function startSelection({ x, y, displayWidth, displayHeight }) {
  resetSurface();
  S.display = { w: displayWidth || window.innerWidth, h: displayHeight || window.innerHeight };
  S.phase = 'dragging';
  S.start = { x, y };
  S.pointer = { x, y };
  S.moved = false;
  S.cur = { x, y, w: 24, h: 24 };
  S.tgt = { x, y, w: 24, h: 24 };
  S.vel = { x: 0, y: 0, w: 0, h: 0 };
  drops.forEach((d) => { d.p.x = x; d.p.y = y; d.v.x = 0; d.v.y = 0; });
  stage.classList.add('armed');
  card.style.opacity = '1';
  dimsEl.textContent = 'drag to open';
  window.IVE_DEMO_HOOK?.('armed');
}

function moveSelection({ x, y }) {
  if (S.phase !== 'dragging') return;
  S.pointer = { x, y };
  if (Math.hypot(x - S.start.x, y - S.start.y) > 6) {
    S.moved = true;
    stage.classList.add('dragging');
  }
  const rect = {
    x: Math.min(S.start.x, x),
    y: Math.min(S.start.y, y),
    w: Math.max(28, Math.abs(x - S.start.x)),
    h: Math.max(28, Math.abs(y - S.start.y))
  };
  S.tgt = rect;
  dimsEl.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
  stage.classList.add('selecting');
}

function endSelection({ x, y, tap }) {
  if (S.phase !== 'dragging') return;
  const rect = { x: S.tgt.x, y: S.tgt.y, w: S.tgt.w, h: S.tgt.h };
  const useTap = tap || !S.moved || (rect.w < 40 && rect.h < 40);
  beginComposing(useTap ? composerRectAt(S.start.x, S.start.y) : composerRectAt(rect.x + rect.w / 2, rect.y));
}

function beginComposing(rect) {
  S.phase = 'composing';
  stage.classList.remove('dragging');
  stage.classList.add('composing');
  S.tgt = rect;
  dimsEl.textContent = '';
  updateGlass();
  card.style.opacity = '1';
  focusInput(0);
  focusInput(120);
  focusInput(320);
  window.focus();
  window.IVE_DEMO_HOOK?.('compose');
}

function focusInput(delay) {
  setTimeout(() => {
    if (S.phase === 'composing') inputEl.focus({ preventScroll: true });
  }, delay);
}

/* ── manual open (hotkey / notch "Compose") ─────────────────── */

function openManual({ x, y, displayWidth, displayHeight }) {
  resetSurface();
  S.display = { w: displayWidth || window.innerWidth, h: displayHeight || window.innerHeight };
  S.start = { x, y };
  const rect = composerRectAt(x, y);
  S.cur = { ...rect };
  S.tgt = { ...rect };
  S.vel = { x: 0, y: 0, w: 0, h: 0 };
  beginComposing(rect);
}

/* ── glass capture ──────────────────────────────────────────── */

function updateGlass() {
  if (!S.glass) return;
  glassImg.style.backgroundSize = `${S.bounds.width}px ${S.bounds.height}px`;
  glassImg.style.backgroundPosition = `${-S.cur.x + 48}px ${-S.cur.y + 48}px`;
}

function applyGlass({ glass, bounds }) {
  if (!glass) return;
  S.glass = glass;
  S.bounds = bounds;
  glassImg.style.backgroundImage = `url(${glass})`;
  glassImg.style.backgroundSize = `${bounds.width}px ${bounds.height}px`;
  glassImg.classList.add('on');
  updateGlass();
}

/* ── motion ─────────────────────────────────────────────────── */

function integrate(dt) {
  const drag = S.phase === 'dragging';
  const absorb = S.phase === 'sending';
  const k = absorb ? 120 : drag ? 340 : 200;
  const d = absorb ? 20 : drag ? 34 : 24;
  for (const key of ['x', 'y', 'w', 'h']) {
    const a = (S.tgt[key] - S.cur[key]) * k - S.vel[key] * d;
    S.vel[key] += a * dt;
    S.cur[key] += S.vel[key] * dt;
  }
  for (const drop of drops) {
    const ax = (S.pointer.x - drop.p.x) * drop.k - drop.v.x * drop.d;
    const ay = (S.pointer.y - drop.p.y) * drop.k - drop.v.y * drop.d;
    drop.v.x += ax * dt;
    drop.v.y += ay * dt;
    drop.p.x += drop.v.x * dt;
    drop.p.y += drop.v.y * dt;
  }
}

function paint() {
  const { x, y, w, h } = S.cur;
  const sw = Math.max(1, w) / BASE_W;
  const sh = Math.max(1, h) / BASE_H;
  card.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${sw}, ${sh})`;
  const speed = Math.min(1, Math.hypot(S.vel.x, S.vel.y) / 2600);
  const r = clamp(24 - (1 - Math.min(w, h) / 200) * 6, 14, 24);
  const wob = r + speed * 9;
  card.style.borderRadius = `${wob}px ${r}px ${wob}px ${r}px / ${r}px ${wob}px ${r}px ${wob}px`;
  for (const drop of drops) {
    drop.el.style.transform = `translate3d(${drop.p.x}px, ${drop.p.y}px, 0)`;
  }
  if (S.phase === 'composing' || S.phase === 'sending') {
    updateWire(x, y, w);
    updateGlass();
    if (S.glass) {
      glassImg.style.backgroundPosition = `${-x + 48}px ${-y + 48}px`;
    }
  }
}

function updateWire(x, y, w) {
  const cx = S.display.w / 2;
  const ex = x + w / 2;
  const c1y = Math.max(20, y * 0.45);
  wirePath.setAttribute('d', `M ${cx} 0 Q ${cx} ${c1y} ${ex} ${y}`);
}

let last = performance.now();
function tick(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  if (S.phase !== 'idle') {
    integrate(dt);
    paint();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* ── sending / closing ──────────────────────────────────────── */

function send() {
  const text = inputEl.value.trim();
  if (!text || S.phase !== 'composing' || S.submitLock) return;
  S.submitLock = true;
  S.phase = 'sending';
  inputEl.disabled = true;
  card.classList.add('sent');
  stage.classList.remove('composing');
  stage.classList.add('sending');
  S.tgt = { x: S.display.w / 2 - 120, y: -34, w: 240, h: 30 };
  setTimeout(() => {
    ive?.selection?.submit?.(text);
    resetSurface();
  }, 420);
}

/* Native pointer selection — used by the browser demo and for development
   on machines where the fn helper isn't running. */
if (window.IVE_POINTER_MODE) {
  let selecting = false;
  stage.addEventListener('pointerdown', (e) => {
    if (S.phase !== 'idle' || e.button !== 0) return;
    selecting = true;
    S.start = { x: e.clientX, y: e.clientY };
    startSelection({ x: e.clientX, y: e.clientY, displayWidth: window.innerWidth, displayHeight: window.innerHeight });
  });
  window.addEventListener('pointermove', (e) => {
    if (!selecting) return;
    moveSelection({ x: e.clientX, y: e.clientY });
  });
  window.addEventListener('pointerup', (e) => {
    if (!selecting) return;
    selecting = false;
    const dist = Math.hypot(e.clientX - S.start.x, e.clientY - S.start.y);
    endSelection({ x: e.clientX, y: e.clientY, tap: dist < 8 });
  });
}
/* Demo hooks: programmatic drag for the showcase page. */
window.IVE_DEMO_START = (x, y) => startSelection({ x, y, displayWidth: window.innerWidth, displayHeight: window.innerHeight });
window.IVE_DEMO_MOVE = (x, y) => moveSelection({ x, y });
window.IVE_DEMO_END = (x, y) => endSelection({ x, y, tap: false });
window.IVE_DEMO_SEND = (text) => { inputEl.value = text; send(); };

function close() {
  if (S.phase === 'sending' || S.phase === 'closing') return;
  if (S.phase === 'composing' || S.phase === 'dragging') {
    S.phase = 'closing';
    S.tgt = { x: S.cur.x + S.cur.w / 2 - 20, y: S.cur.y + S.cur.h / 2 - 12, w: 40, h: 24 };
    setTimeout(() => {
      ive?.selection?.cancel?.();
      resetSurface();
      stage.classList.remove('armed');
    }, 200);
  } else {
    ive?.selection?.cancel?.();
  }
}

/* ── input ──────────────────────────────────────────────────── */

document.getElementById('send').addEventListener('click', send);
document.getElementById('btnX').addEventListener('click', close);

inputEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); close(); }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
});

/* The overlay is a real key window while composing; make sure the caret lands. */
function ensureFocus() {
  if (S.phase === 'composing' && document.activeElement !== inputEl) {
    inputEl.focus({ preventScroll: true });
  }
}
window.addEventListener('focus', ensureFocus);

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    inputEl.value = chip.dataset.chip;
    inputEl.focus();
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
  });
});

/* click on the dim to dismiss an empty composer */
window.addEventListener('mousedown', (e) => {
  if (S.phase !== 'composing') return;
  const inside = e.target.closest('.card');
  if (!inside && !inputEl.value.trim()) close();
});

/* drag the header to move the card */
let dragCard = null;
document.querySelector('.head').addEventListener('mousedown', (e) => {
  if (S.phase !== 'composing') return;
  if (e.target.closest('button')) return;
  dragCard = { dx: e.clientX - S.tgt.x, dy: e.clientY - S.tgt.y };
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!dragCard) return;
  S.tgt.x = clamp(e.clientX - dragCard.dx, 8, S.display.w - S.tgt.w - 8);
  S.tgt.y = clamp(e.clientY - dragCard.dy, 4, S.display.h - S.tgt.h - 8);
});
window.addEventListener('mouseup', () => { dragCard = null; });

/* ── bridge events ──────────────────────────────────────────── */

function on(channel, cb) {
  try { ive?.on?.(channel, cb); } catch { /* mock */ }
}

on('selection:start', startSelection);
on('selection:move', moveSelection);
on('selection:end', endSelection);
on('selection:open', openManual);
on('selection:glass', applyGlass);
