-- Product brands, per store (two stores may each have a "Nestlé" brand).
CREATE TABLE brands (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id   INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  name       TEXT    NOT NULL COLLATE NOCASE,
  status     TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, name)
);

CREATE INDEX idx_brands_store_status ON brands (store_id, status);

-- Brand logos live in their own table so listing brands never reads image bytes.
-- The browser resizes logos before upload, so each row is a few dozen KB.
CREATE TABLE brand_logos (
  brand_id     INTEGER PRIMARY KEY REFERENCES brands (id) ON DELETE CASCADE,
  content_type TEXT    NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data         BLOB    NOT NULL,
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
