// Run: node --test backup-worker/snapshot.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './index.js';
import { d1 } from '../tests/d1-mock.mjs';

const kv = (init = {}) => { const m = new Map(Object.entries(init)); const opts = new Map();
  return { m, opts, get: async (k) => m.get(k) ?? null, put: async (k, v, o) => { m.set(k, v); opts.set(k, o); } }; };

test('copies every key under a dated prefix with ttl and checksum', async () => {
  const DB = d1({ 'thread-kanban-data': '{"tasks":[1]}', 'job-pipeline-data': '{}', 'daily-log-data': '{"entries":{}}' });
  const BACKUPS = kv();
  const m = await snapshot({ DB, BACKUPS }, new Date('2026-11-03T17:00:00Z'));
  assert.equal(BACKUPS.m.get('2026-11-03/thread-kanban-data'), '{"tasks":[1]}');
  assert.equal(BACKUPS.opts.get('2026-11-03/thread-kanban-data').expirationTtl, 35 * 24 * 3600);
  assert.equal(BACKUPS.opts.get('2026-11-03/job-pipeline-data').metadata.bytes, 2);
  assert.match(m.keys[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.parse(BACKUPS.m.get('2026-11-03/_manifest')).keys.length, 3);
});

test('missing source key is recorded, not backed up as empty', async () => {
  const BACKUPS = kv();
  const m = await snapshot({ DB: d1({ 'thread-kanban-data': '{}' }), BACKUPS }, new Date('2026-11-03T17:00:00Z'));
  assert.equal(BACKUPS.m.has('2026-11-03/daily-log-data'), false);
  assert.deepEqual(m.keys.find((k) => k.key === 'daily-log-data'), { key: 'daily-log-data', missing: true });
});
