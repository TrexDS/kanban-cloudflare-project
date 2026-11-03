// Daily snapshot of the kanban docs (D1 table `docs`) into KANBAN_KV_BACKUPS as "<YYYY-MM-DD>/<key>",
// with sha256/bytes in metadata and a "<YYYY-MM-DD>/_manifest". No fetch handler: cron only.
const KEYS = ['thread-kanban-data', 'job-pipeline-data', 'daily-log-data'];
const KEEP_SECONDS = 35 * 24 * 3600;

const sha256 = async (text) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');

export async function snapshot(env, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const manifest = { day, taken_at: now.toISOString(), keys: [] };
  for (const key of KEYS) {
    const value = await env.DB.prepare('SELECT body FROM docs WHERE key = ?').bind(key).first('body');
    // A missing source key is recorded, never written as an empty backup.
    if (value === null) { manifest.keys.push({ key, missing: true }); continue; }
    const meta = { sha256: await sha256(value), bytes: new TextEncoder().encode(value).length };
    await env.BACKUPS.put(`${day}/${key}`, value, { expirationTtl: KEEP_SECONDS, metadata: meta });
    manifest.keys.push({ key, ...meta });
  }
  await env.BACKUPS.put(`${day}/_manifest`, JSON.stringify(manifest), { expirationTtl: KEEP_SECONDS });
  return manifest;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(snapshot(env, new Date(event.scheduledTime)).then((m) => console.log('backup ok', JSON.stringify(m))));
  }
};
