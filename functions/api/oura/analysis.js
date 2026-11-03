// Reads the Oura_Analysis tab through the Apps Script web app (secret-authenticated),
// replacing the old publicly published Sheet CSV. Auth for callers: functions/api/_middleware.js.
export async function onRequestGet(context) {
  const { KANBAN_SYNC_URL, KANBAN_SYNC_SECRET } = context.env;
  if (!KANBAN_SYNC_URL || !KANBAN_SYNC_SECRET) return new Response('not configured', { status: 501 });
  const cache = caches.default;
  const cacheKey = new Request(context.request.url, context.request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  try {
    const res = await fetch(KANBAN_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ secret: KANBAN_SYNC_SECRET, action: 'oura_csv', sheet: 'Oura_Analysis' }),
      signal: AbortSignal.timeout(15000)
    });
    const text = await res.text();
    if (!res.ok || text === 'forbidden' || text === 'bad sheet' || text.startsWith('error')) return new Response('upstream error', { status: 502 });
    const response = new Response(text, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (e) {
    return new Response('fetch failed', { status: 502 });
  }
}
