export async function onRequestGet(context) {
  const key = context.params.key;
  const value = await context.env.KANBAN_KV.get(key);
  return new Response(value === null ? 'null' : value, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestPut(context) {
  const key = context.params.key;
  const body = await context.request.text();
  await context.env.KANBAN_KV.put(key, body);
  return new Response('ok');
}
