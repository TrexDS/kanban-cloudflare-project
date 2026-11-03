// Minimal D1 binding over node:sqlite (real SQL semantics, incl. the CAS upsert). Test-only.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function d1(rows = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../migrations/0001_docs.sql', import.meta.url), 'utf8'));
  for (const [k, v] of Object.entries(rows)) db.prepare('INSERT INTO docs VALUES (?, ?, 1)').run(k, v);
  return {
    db,
    prepare: (sql) => ({
      bind: (...args) => ({
        first: async (col) => { const r = db.prepare(sql).get(...args); return r === undefined ? null : col ? r[col] : r; }
      })
    })
  };
}
