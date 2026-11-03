// Auth is enforced by functions/api/_middleware.js. Here: only the app's own
// keys, and only valid JSON within a size cap, may reach D1.
// Concurrency: GET returns ETag "<rev>" (0 = no row); PUT must send If-Match with
// that rev and is applied only if it still matches (one conditional statement = CAS).
const ALLOWED_KEYS = new Set(['thread-kanban-data', 'job-pipeline-data', 'daily-log-data']);
const MAX_BYTES = 512 * 1024;
const etag = (rev) => `"${rev}"`;

export async function onRequestGet(context) {
  const key = context.params.key;
  if (!ALLOWED_KEYS.has(key)) return new Response('unknown key', { status: 404 });
  const row = await context.env.DB.prepare('SELECT body, rev FROM docs WHERE key = ?').bind(key).first();
  return new Response(row ? row.body : 'null', {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ETag: etag(row ? row.rev : 0) }
  });
}

export async function onRequestPut(context) {
  const key = context.params.key;
  if (!ALLOWED_KEYS.has(key)) return new Response('unknown key', { status: 404 });
  // Clients that don't send the rev they loaded (e.g. a stale cached page) must reload.
  const base = /^"?(\d+)"?$/.exec(context.request.headers.get('If-Match') || '')?.[1];
  if (base === undefined) return new Response('If-Match required; reload the page', { status: 428 });
  const body = await context.request.text();
  if (new TextEncoder().encode(body).length > MAX_BYTES) return new Response('too large', { status: 413 });
  let parsed;
  try { parsed = JSON.parse(body); } catch { return new Response('invalid json', { status: 400 }); }
  // The client only ever stores objects; null/arrays/primitives would wipe real data.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Response('invalid shape', { status: 400 });
  // Base 0 inserts only if absent; otherwise updates only if rev is unchanged. changes = 0 → someone else wrote first.
  const row = await context.env.DB.prepare(
    `INSERT INTO docs (key, body, rev) VALUES (?1, ?2, 1)
     ON CONFLICT (key) DO UPDATE SET body = excluded.body, rev = docs.rev + 1 WHERE docs.rev = ?3
     RETURNING rev`
  ).bind(key, body, Number(base)).first();
  if (!row) return new Response('conflict: changed elsewhere, reload', { status: 409 });
  return new Response('ok', { headers: { ETag: etag(row.rev) } });
}
