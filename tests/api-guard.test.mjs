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

// storage handler
const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => m.set(k, v) }; };
const put = (key, body, KANBAN_KV) => onRequestPut({ params: { key }, env: { KANBAN_KV }, request: new Request('https://x/', { method: 'PUT', body }) });

test('storage rejects unknown keys', async () => {
  const k = kv();
  assert.equal((await onRequestGet({ params: { key: 'other' }, env: { KANBAN_KV: k } })).status, 404);
  assert.equal((await put('other', '{}', k)).status, 404);
});
test('storage validates body', async () => {
  const k = kv();
  assert.equal((await put('daily-log-data', 'not json', k)).status, 400);
  assert.equal((await put('daily-log-data', 'null', k)).status, 400);
  assert.equal((await put('daily-log-data', '[1]', k)).status, 400);
  assert.equal((await put('daily-log-data', JSON.stringify({ a: 'x'.repeat(600 * 1024) }), k)).status, 413);
  assert.equal(k.m.size, 0);
  assert.equal((await put('daily-log-data', '{"entries":{}}', k)).status, 200);
  assert.equal(await (await onRequestGet({ params: { key: 'daily-log-data' }, env: { KANBAN_KV: k } })).text(), '{"entries":{}}');
});
