// Guards every /api/* route behind Cloudflare Access, verified here as well
// (defense in depth: if the Access app is ever misconfigured or a hostname is
// left off it, private data still isn't served).
// Required Pages env vars — missing any of them fails closed (503):
//   ACCESS_TEAM_DOMAIN  e.g. "your-team.cloudflareaccess.com"
//   ACCESS_AUD          the Access application's Audience (AUD) tag
//   ALLOWED_EMAILS      comma-separated list of permitted emails

let certCache = { url: '', keys: null, at: 0 };

const b64urlBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function getKeys(teamDomain, fetchImpl) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (certCache.url === url && certCache.keys && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error('certs fetch failed');
  const { keys } = await res.json();
  certCache = { url, keys, at: Date.now() };
  return keys;
}

// Returns the verified email, or null. Exported for the self-check test.
export async function verifyAccessJwt(token, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch { return null; }
  if (header.alg !== 'RS256') return null;

  const jwk = (await getKeys(env.ACCESS_TEAM_DOMAIN, fetchImpl)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;

  const sec = now / 1000;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  if (typeof payload.exp !== 'number' || payload.exp < sec) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > sec + 60) return null;

  const allowed = env.ALLOWED_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const email = String(payload.email || '').toLowerCase();
  return allowed.includes(email) ? email : null;
}

const deny = (status, msg) => new Response(msg, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ALLOWED_EMAILS) return deny(503, 'auth not configured');

  // Only the header Access injects at the edge is trusted; the cookie is never read here.
  const email = await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'), env).catch(() => null);
  if (!email) return deny(401, 'unauthorized');

  // CSRF: state-changing requests must come from this same origin.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('Origin');
    if (!origin || origin !== new URL(request.url).origin) return deny(403, 'bad origin');
  }

  const res = await context.next();
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'private, no-store');
  return out;
}
