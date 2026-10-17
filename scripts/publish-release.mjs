#!/usr/bin/env node
/**
 * Publish build artifacts to a GitHub release without electron-builder.
 *
 *   GH_TOKEN=ghp_… node scripts/publish-release.mjs android-v1.0.0 \
 *     release/IVE-1.0.0-android.apk release/IVE-1.0.0-android.aab
 *
 * Creates the release if the tag has none, uploads (or replaces) each asset,
 * and prints the HTML URL. Safe to run twice.
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const [tag, ...files] = process.argv.slice(2);
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const repo = process.env.IVE_REPO || 'srijan7815-bit/ive';

if (!tag || files.length === 0) {
  console.error('usage: GH_TOKEN=… node scripts/publish-release.mjs <tag> <file…>');
  process.exit(1);
}
if (!token) {
  console.error('Set GH_TOKEN (a token with repo scope) first.');
  process.exit(1);
}

const api = `https://api.github.com/repos/${repo}`;
const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'ive-release-script',
  'x-github-api-version': '2022-11-28'
};

const call = async (url, init = {}) => {
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
};

const ensureRelease = async () => {
  try {
    return await call(`${api}/releases/tags/${encodeURIComponent(tag)}`);
  } catch (e) {
    if (!String(e.message).startsWith('404')) throw e;
  }
  return call(`${api}/releases`, {
    method: 'POST',
    body: JSON.stringify({
      tag_name: tag,
      name: `IVE ${tag.replace(/^v/, '')}`,
      draft: false,
      prerelease: tag.includes('beta') || tag.includes('rc'),
      generate_release_notes: true
    })
  });
};

const upload = async (release, file) => {
  const name = basename(file);
  const existing = (release.assets || []).find((a) => a.name === name);
  if (existing) {
    console.log(`· replacing ${name}`);
    await call(`${api}/releases/assets/${existing.id}`, { method: 'DELETE' });
  } else {
    console.log(`· uploading ${name}`);
  }
  const data = readFileSync(file);
  await call(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'content-type': file.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'application/octet-stream',
      'content-length': String(statSync(file).size)
    },
    body: data
  });
};

const release = await ensureRelease();
for (const f of files) await upload(release, resolve(f));
console.log(`\n✅ ${release.html_url}`);
