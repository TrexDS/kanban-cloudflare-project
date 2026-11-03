// Run: node --test tests/asset-version.test.mjs
// Fails when a css/js file changed but index.html still points at the old ?v= (fix: node scripts/stamp-assets.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stamped } from '../scripts/stamp-assets.mjs';

test('every css/js reference in index.html carries the current content hash', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const refs = html.match(/(?:href|src)="(?:css|js)\/[^"]+"/g) || [];
  assert.ok(refs.length >= 9, 'expected the stylesheet and 8 scripts');
  assert.ok(refs.every(r => /\?v=[0-9a-f]{10}"$/.test(r)), 'every asset reference has ?v=');
  assert.equal(stamped(html), html, 'stale ?v= — run: node scripts/stamp-assets.mjs');
});
