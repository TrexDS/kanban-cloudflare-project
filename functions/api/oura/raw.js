export async function onRequestGet(context) {
  const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSBHr45Mrr-BgaC7IuVuwW_zeAeCoqYhQGOf7OnspDgpJ-C1Vely9FwBm0yOxqgA483hkoCSOjQHpc-/pub?gid=0&single=true&output=csv';
  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) return new Response('upstream error', { status: 502 });
    const text = await res.text();
    return new Response(text, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  } catch (e) {
    return new Response('fetch failed: ' + e.message, { status: 502 });
  }
}
