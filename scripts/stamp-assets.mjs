// Stamps every css/js reference in public/index.html with ?v=<content hash>, so a deploy changes the URL of any
// asset whose content changed. Needed because the custom domain makes browsers cache /css and /js for 4h while
// index.html is always fresh. Run after editing anything in public/css or public/js:  node scripts/stamp-assets.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../public/', import.meta.url);
const ASSET = /((?:href|src)=")((?:css|js)\/[\w.-]+\.(?:css|js))(?:\?v=[0-9a-f]+)?(")/g;
export const hashOf = (path) => createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex').slice(0, 10);
export const stamped = (html) => html.replace(ASSET, (_, a, path, z) => `${a}${path}?v=${hashOf(path)}${z}`);

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = new URL('index.html', root), html = readFileSync(file, 'utf8'), out = stamped(html);
  if (out !== html) writeFileSync(file, out);
  console.log(out !== html ? 'index.html: asset versions updated' : 'index.html: asset versions already current');
}
