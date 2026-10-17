const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + require('path').join(__dirname, '../../demo/index.html'));
  await p.waitForTimeout(1200);

  /* 1 — the guided "Play" run: gesture + typing + permission + auto-answer */
  await p.click('#btnPlay');
  await p.waitForTimeout(16000);
  const logCount = await p.evaluate(() => {
    const w = document.getElementById('notchFrame').contentWindow;
    return w.eval('state.log.length');
  });
  const logTypes = await p.evaluate(() => {
    const w = document.getElementById('notchFrame').contentWindow;
    return w.eval('state.log.map(e => e.type).join(",")');
  });
  const asksLeft = await p.evaluate(() => {
    const w = document.getElementById('notchFrame').contentWindow;
    return w.eval('state.asks.length');
  });
  const view = await p.evaluate(() => document.getElementById('notchFrame').contentDocument.getElementById('island').dataset.view);

  /* 2 — Option held + real pointer drag */
  await p.keyboard.down('Alt');
  await p.waitForTimeout(200);
  await p.mouse.move(400, 500);
  await p.mouse.down();
  for (let i = 1; i <= 18; i++) { await p.mouse.move(400 + i * 18, 500 + i * 6); await p.waitForTimeout(14); }
  await p.mouse.up();
  await p.keyboard.up('Alt');
  await p.waitForTimeout(900);
  const composing = await p.evaluate(() => document.getElementById('overlayFrame').contentDocument.getElementById('stage').className);
  const focused = await p.evaluate(() => document.activeElement && document.activeElement.id);

  console.log(JSON.stringify({ logCount, logTypes, asksLeft, view, composing, errs }, null, 2));
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
