#!/usr/bin/env node
/**
 * Bump IVE's version everywhere it is written down.
 *
 *   node scripts/bump-version.mjs 1.0.1
 *
 * - package.json                        version
 * - android/app/build.gradle.kts        versionName + versionCode (+1)
 * - src/main/updates.js / renderer copy  (only if they carry a literal)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const next = process.argv[2];

if (!next || !/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/.test(next)) {
  console.error('usage: node scripts/bump-version.mjs <major.minor.patch>');
  process.exit(1);
}

const edit = (rel, fn) => {
  const p = join(root, rel);
  if (!existsSync(p)) return false;
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after !== before) {
    writeFileSync(p, after);
    console.log(`✓ ${rel}`);
  }
  return true;
};

edit('package.json', (s) => {
  const j = JSON.parse(s);
  j.version = next;
  return `${JSON.stringify(j, null, 2)}\n`;
});

edit('android/app/build.gradle.kts', (s) => {
  const code = Number((s.match(/versionCode\s*=\s*(\d+)/) || [])[1] || 0) + 1;
  return s
    .replace(/versionCode\s*=\s*\d+/, `versionCode = ${code}`)
    .replace(/versionName\s*=\s*"[^"]*"/, `versionName = "${next}"`);
});

// The demo badge and the update panel print the version.
edit('README.md', (s) => s.replace(/(badge\/version-)(\d+\.\d+\.\d+)/, `$1${next}`));
edit('demo/mock-notch.js', (s) => s.replace(/version:\s*'[^']*'/, `version: '${next}'`));

console.log(`\nIVE ${next}. Commit, then: git tag v${next} && git push origin v${next}`);
