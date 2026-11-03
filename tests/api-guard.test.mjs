// Run: node --test tests/api-guard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as guard } from '../functions/api/_middleware.js';
import { onRequestGet, onRequestPut } from '../functions/api/storage/[key].js';

const TEAM = 'team.cloudflareaccess.com';
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: 'aud123', ALLOWED_EMAILS: 'ok@example.com' };
const ORIGIN = 'https://app.example';

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1', alg: 'RS256' };
globalThis.fetch = async (url) => {
  assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`);
  return new Response(JSON.stringify({ keys: [jwk] }));
};

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
async function jwt(claims = {}, key = privateKey, kid = 'k1') {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'RS256', kid })}.${b64({ aud: ['aud123'], iss: `https://${TEAM}`, email: 'ok@example.com', exp: now + 600, ...claims })}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body));
  return `${body}.${Buffer.from(sig).toString('base64url')}`;
}
const call = async (token, { method = 'GET', origin, e = env } = {}) => {
  const headers = {};
  if (token) headers['Cf-Access-Jwt-Assertion'] = token;
  if (origin) headers.Origin = origin;
  const res = await guard({ request: new Request(`${ORIGIN}/api/storage/x`, { method, headers }), env: e, next: async () => new Response('inner', { headers: { 'Cache-Control': 'public, max-age=300' } }) });
  return res;
};

test('valid token passes and response is made private', async () => {
  const r = await call(await jwt());
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'inner');
  assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
});
test('missing config fails closed', async () => assert.equal((await call(await jwt(), { e: { ...env, ACCESS_AUD: '' } })).status, 503));
test('no token', async () => assert.equal((await call(null)).status, 401));
test('garbage token', async () => assert.equal((await call('a.b.c')).status, 401));
test('other email', async () => assert.equal((await call(await jwt({ email: 'evil@example.com' }))).status, 401));
test('email match is case-insensitive', async () => assert.equal((await call(await jwt({ email: 'OK@Example.com' }))).status, 200));
test('wrong aud', async () => assert.equal((await call(await jwt({ aud: ['other'] }))).status, 401));
test('wrong issuer', async () => assert.equal((await call(await jwt({ iss: 'https://evil.cloudflareaccess.com' }))).status, 401));
test('expired', async () => assert.equal((await call(await jwt({ exp: 1 }))).status, 401));
test('unknown kid', async () => assert.equal((await call(await jwt({}, privateKey, 'nope'))).status, 401));
test('signed by another key', async () => {
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  assert.equal((await call(await jwt({}, other.privateKey))).status, 401);
});
test('tampered payload', async () => {
  const [h, , s] = (await jwt()).split('.');
  assert.equal((await call(`${h}.${b64({ aud: ['aud123'], iss: `https://${TEAM}`, email: 'ok@example.com', exp: 9e9 })}.${s}`)).status, 401);
});
test('PUT needs same Origin', async () => {
  const t = await jwt();
  assert.equal((await call(t, { method: 'PUT' })).status, 403);
  assert.equal((await call(t, { method: 'PUT', origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(t, { method: 'PUT', origin: ORIGIN })).status, 200);
});

// storage handler (D1 + If-Match CAS)
import { d1 } from './d1-mock.mjs';
const get = (key, DB) => onRequestGet({ params: { key }, env: { DB } });
const put = (key, body, DB, ifMatch = '"0"') => onRequestPut({ params: { key }, env: { DB },
  request: new Request('https://x/', { method: 'PUT', body, headers: ifMatch === null ? {} : { 'If-Match': ifMatch } }) });
const count = (DB) => DB.db.prepare('SELECT COUNT(*) n FROM docs').get().n;

test('storage rejects unknown keys', async () => {
  const DB = d1();
  assert.equal((await get('other', DB)).status, 404);
  assert.equal((await put('other', '{}', DB)).status, 404);
});
test('storage validates body', async () => {
  const DB = d1();
  assert.equal((await put('daily-log-data', 'not json', DB)).status, 400);
  assert.equal((await put('daily-log-data', 'null', DB)).status, 400);
  assert.equal((await put('daily-log-data', '[1]', DB)).status, 400);
  assert.equal((await put('daily-log-data', JSON.stringify({ a: 'x'.repeat(600 * 1024) }), DB)).status, 413);
  assert.equal(count(DB), 0);
});
test('missing row reads as null with rev 0, then create and read back', async () => {
  const DB = d1();
  const r0 = await get('daily-log-data', DB);
  assert.equal(await r0.text(), 'null');
  assert.equal(r0.headers.get('ETag'), '"0"');
  const w = await put('daily-log-data', '{"entries":{}}', DB, r0.headers.get('ETag'));
  assert.equal(w.status, 200);
  assert.equal(w.headers.get('ETag'), '"1"');
  const r1 = await get('daily-log-data', DB);
  assert.equal(await r1.text(), '{"entries":{}}');
  assert.equal(r1.headers.get('ETag'), '"1"');
});
test('PUT without If-Match is refused (stale client)', async () => {
  const DB = d1({ 'daily-log-data': '{"keep":1}' });
  assert.equal((await put('daily-log-data', '{}', DB, null)).status, 428);
  assert.equal((await put('daily-log-data', '{}', DB, '*')).status, 428);
  assert.equal(await (await get('daily-log-data', DB)).text(), '{"keep":1}');
});
test('stale rev gets 409 and does not overwrite', async () => {
  const DB = d1({ 'thread-kanban-data': '{"v":"a"}' }); // rev 1
  assert.equal((await put('thread-kanban-data', '{"v":"b"}', DB, '"1"')).status, 200); // device B → rev 2
  assert.equal((await put('thread-kanban-data', '{"v":"c"}', DB, '"1"')).status, 409); // device A, stale
  assert.equal((await put('thread-kanban-data', '{"v":"c"}', DB, '"0"')).status, 409); // "create" over existing
  const r = await get('thread-kanban-data', DB);
  assert.equal(await r.text(), '{"v":"b"}');
  assert.equal(r.headers.get('ETag'), '"2"');
});
test('weak ETag from the edge (W/"n") is accepted as If-Match', async () => {
  const DB = d1({ 'thread-kanban-data': '{}' });
  assert.equal((await put('thread-kanban-data', '{"v":1}', DB, 'W/"1"')).status, 200);
  assert.equal((await put('thread-kanban-data', '{"v":2}', DB, 'W/"1"')).status, 409);
});
test('concurrent writers on the same rev: exactly one wins', async () => {
  const DB = d1({ 'thread-kanban-data': '{}' });
  const res = await Promise.all([...Array(10)].map((_, i) => put('thread-kanban-data', `{"i":${i}}`, DB, '"1"')));
  assert.deepEqual(res.map((r) => r.status).sort(), [200, ...Array(9).fill(409)]);
});
