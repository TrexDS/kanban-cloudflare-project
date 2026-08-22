export async function onRequestGet(context) {
  const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSBHr45Mrr-BgaC7IuVuwW_zeAeCoqYhQGOf7OnspDgpJ-C1Vely9FwBm0yOxqgA483hkoCSOjQHpc-/pub?gid=0&single=true&output=csv';
  const cache = caches.default;
  const cacheKey = new Request(context.request.url, context.request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  try {
    const res = await fetch(CSV_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return new Response('upstream error', { status: 502 });
    const text = await res.text();
    const response = new Response(text, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (e) {
    return new Response('fetch failed: ' + e.message, { status: 502 });
  }
}
