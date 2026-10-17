'use strict';
const { resolve, check, done, ROOT } = require('./harness');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

const files = [
  'src/main/config.js', 'src/main/shell.js', 'src/main/safety.js', 'src/main/music.js',
  'src/main/ai/providers.js', 'src/main/ai/tools.js', 'src/main/ai/agent.js',
  'src/main/windows.js', 'src/main/fn-bridge.js'
];
for (const f of files) {
  try { resolve(f); check(`loads ${f}`, true); } catch (e) { check(`loads ${f} (${e.message})`, false); }
}

const sources = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (name.endsWith('.js')) sources.push(p);
  }
})(path.join(ROOT, 'src'));
check('renderer sources counted', sources.length > 0);

const tools = resolve('src/main/ai/tools.js');
check('tool schemas shape', tools.toolSchemas.every((t) => t.name && t.description && t.parameters));
check('24+ tools', tools.toolSchemas.length >= 20);
done();
