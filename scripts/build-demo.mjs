#!/usr/bin/env node
/**
 * Build the single-file, offline showcase in demo/index.html from the *real*
 * renderer sources + the mock bridges. No external requests, safe to open
 * straight from disk or inside a sandboxed preview.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function inlineRenderer(dir, mockFile) {
  let html = read(`${dir}/index.html`);
  const css = read(`${dir}/styles.css`);
  const app = read(`${dir}/app.js`);
  const mock = read(`demo/${mockFile}`);

  html = html
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/i, '')
    .replace(/<link rel="stylesheet" href="styles\.css" \/>/, `<style>\n${css}\n</style>`)
    .replace('<script src="app.js"></script>', `<script>\n${mock}\n</script>\n<script>\n${app}\n</script>`);

  if (html.includes('href="styles.css"') || html.includes('src="app.js"')) {
    throw new Error(`Inlining failed for ${dir}`);
  }
  return html;
}

function toScriptLiteral(html) {
  return JSON.stringify(html).replace(/<\/script/gi, '<\\/script');
}

const notch = inlineRenderer('src/renderer/notch', 'mock-notch.js');
const overlay = inlineRenderer('src/renderer/overlay', 'mock-overlay.js');

let page = read('demo/template.html');
page = page.replace('__NOTCH_JSON__', toScriptLiteral(notch));
page = page.replace('__OVERLAY_JSON__', toScriptLiteral(overlay));

if (page.includes('__NOTCH_JSON__') || page.includes('__OVERLAY_JSON__')) {
  throw new Error('Template placeholders not replaced.');
}

fs.mkdirSync(path.join(root, 'demo'), { recursive: true });
fs.writeFileSync(path.join(root, 'demo/index.html'), page);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`✅ demo/index.html written — ${kb(Buffer.byteLength(page))}`);
console.log(`   notch iframe:   ${kb(Buffer.byteLength(notch))}`);
console.log(`   overlay iframe: ${kb(Buffer.byteLength(overlay))}`);
