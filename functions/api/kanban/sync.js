// Server-side proxy for the daily-log -> Google Sheet sync.
// KANBAN_SYNC_URL / KANBAN_SYNC_SECRET live only here (as Cloudflare Pages
// env vars/secrets), so the Apps Script secret never ships in the client
// JS bundle where anyone could view-source it and POST straight to the
// Apps Script endpoint, bypassing the app entirely.
export async function onRequestPost(context) {
  const { KANBAN_SYNC_URL, KANBAN_SYNC_SECRET } = context.env;
  if (!KANBAN_SYNC_URL || !KANBAN_SYNC_SECRET) return new Response('not configured', { status: 501 });
  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return new Response('bad request', { status: 400 });
  }
  const payload = { ...body, secret: KANBAN_SYNC_SECRET };
  context.waitUntil(
    fetch(KANBAN_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    }).catch(e => console.error('kanban sheet sync failed', e))
  );
  return new Response('ok');
}
