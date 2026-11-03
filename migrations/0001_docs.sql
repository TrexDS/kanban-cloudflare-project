-- One row per app key (same JSON shape as the old KV values); rev drives If-Match CAS.
CREATE TABLE IF NOT EXISTS docs (
  key  TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  rev  INTEGER NOT NULL
);
