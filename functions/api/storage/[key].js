// Auth is enforced by functions/api/_middleware.js. Here: only the app's own
// keys, and only valid JSON within a size cap, may reach KV.
const ALLOWED_KEYS = new Set(['thread-kanban-data', 'job-pipeline-data', 'daily-log-data']);
const MAX_BYTES = 512 * 1024;

export async function onRequestGet(context) {
  const key = context.params.key;
  if (!ALLOWED_KEYS.has(key)) return new Response('unknown key', { status: 404 });
  const value = await context.env.KANBAN_KV.get(key);
  return new Response(value === null ? 'null' : value, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestPut(context) {
  const key = context.params.key;
  if (!ALLOWED_KEYS.has(key)) return new Response('unknown key', { status: 404 });
  const body = await context.request.text();
  if (new TextEncoder().encode(body).length > MAX_BYTES) return new Response('too large', { status: 413 });
  let parsed;
  try { parsed = JSON.parse(body); } catch { return new Response('invalid json', { status: 400 }); }
  // The client only ever stores objects; null/arrays/primitives would wipe real data.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Response('invalid shape', { status: 400 });
  await context.env.KANBAN_KV.put(key, body);
  return new Response('ok');
}
