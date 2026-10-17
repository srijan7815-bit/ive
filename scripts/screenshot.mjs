#!/usr/bin/env node
/**
 * Capture the showcase in headless Chromium — used while designing the UI
 * and to regenerate the images in docs/.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'demo/frames');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text()); });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.goto('file://' + path.join(root, 'demo/index.html'));
await page.waitForTimeout(1400);

const shot = async (name) => {
  await page.screenshot({ path: path.join(out, name) });
  console.log('  📸', name);
};

const notch = page.frameLocator('#notchFrame');
const overlay = page.frameLocator('#overlayFrame');
const wait = (ms) => page.waitForTimeout(ms);

await shot('01-desktop.png');

/* hover — the iframe only becomes hit-testable near the top, so jiggle in */
await page.mouse.move(720, 30);
await page.mouse.move(722, 17);
await page.mouse.move(719, 21);
await wait(800);
await shot('02-hover.png');

/* panel */
await page.mouse.move(720, 16);
await page.mouse.click(720, 16);
await wait(1100);
await shot('03-panel-assistant.png');

/* music */
await notch.locator('[data-tab="music"]').click();
await wait(900);
await shot('04-panel-music.png');

/* settings */
await notch.locator('[data-tab="settings"]').click();
await wait(900);
await shot('05-panel-settings.png');

await notch.locator('#btnClose').click();
await wait(600);

/* composer — drive the real overlay with the demo messages */
await page.evaluate(() => {
  const f = document.getElementById('overlayFrame');
  window.__iveMsg = (type, extra = {}) => f.contentWindow.postMessage({ __ive: true, src: 'parent', type, ...extra }, '*');
  window.__iveMsg('demo-select', { x: 380, y: 300 });
});
await wait(200);
for (let i = 1; i <= 24; i++) {
  const t = i / 24;
  const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  await page.evaluate(([x, y]) => window.__iveMsg('demo-move', { x, y }), [380 + (960 - 380) * e, 300 + (520 - 300) * e]);
  await wait(16);
}
await page.evaluate(() => window.__iveMsg('demo-end', { x: 960, y: 520 }));
await wait(900);
await shot('06-composer.png');

await overlay.locator('#input').click();
await overlay.locator('#input').type('Tidy my Downloads and group the Q3 decks together.', { delay: 18 });
await wait(400);
await shot('07-composer-typed.png');

const focused = await page.frame({ url: /srcdoc/ }) // noop guard
  ;
await overlay.locator('#input').press('Enter');
await wait(380);
await shot('08-composer-sending.png');
await wait(4200);
await shot('09-permission.png');

/* answer via the real alert button */
await notch.locator('#alertBtns button').first().click();
await wait(900);
await shot('10-after-answer.png');
await wait(2600);

/* open panel to see the log */
await page.mouse.move(720, 16);
await page.mouse.move(722, 18);
await page.mouse.click(720, 16);
await wait(900);
await page.frameLocator('#notchFrame').locator('[data-tab="assistant"]').click();
await wait(700);
await shot('11-log.png');

/* a live permission while the panel is open shows the inline card */
await page.evaluate(() => {
  const f = document.getElementById('notchFrame');
  f.contentWindow.postMessage({ __ive: true, src: 'parent', type: 'trigger-permission' }, '*');
});
await wait(1200);
await shot('12-inline-permission.png');

await browser.close();
console.log('done →', out);
