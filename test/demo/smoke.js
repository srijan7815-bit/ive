const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + require('path').join(__dirname, '../../demo/index.html'));
  await p.waitForTimeout(1200);
  const notch = p.frameLocator('#notchFrame');

  await p.mouse.move(720, 16); await p.mouse.move(722, 18); await p.mouse.click(720, 16);
  await p.waitForTimeout(900);
  const panelVisible = await notch.locator('#pane-assistant.active').count();
  await notch.locator('[data-tab="music"]').click(); await p.waitForTimeout(700);
  const musicVisible = await notch.locator('#pane-music.active').count();
  const trackTitle = await notch.locator('#trackTitle').textContent();
  await notch.locator('[data-tab="settings"]').click(); await p.waitForTimeout(700);
  const settingsVisible = await notch.locator('#pane-settings.active').count();
  await notch.locator('#btnClose').click(); await p.waitForTimeout(500);

  await p.click('#btnCompose'); await p.waitForTimeout(900);
  const composing = await p.evaluate(() => {
    const f = document.getElementById('overlayFrame');
    return f.contentDocument.getElementById('stage').classList.contains('composing');
  });
  const overlay = p.frameLocator('#overlayFrame');
  await overlay.locator('#input').click();
  await overlay.locator('#input').type('Tidy my Downloads', { delay: 8 });
  await overlay.locator('#input').press('Enter');
  await p.waitForTimeout(4200);
  const alertVisible = await p.evaluate(() => {
    const f = document.getElementById('notchFrame');
    return f.contentDocument.getElementById('island').dataset.view;
  });
  const alertTitle = await notch.locator('#alertTitle').textContent();
  await notch.locator('#alertBtns button').first().click();
  await p.waitForTimeout(2200);
  const afterAnswer = await p.evaluate(() => document.getElementById('notchFrame').contentDocument.getElementById('island').dataset.view);

  console.log(JSON.stringify({ panelVisible, musicVisible, trackTitle, settingsVisible, composing, alertVisible, alertTitle, afterAnswer, errs }, null, 2));
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
