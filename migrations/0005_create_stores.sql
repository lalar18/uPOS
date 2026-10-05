-- Stores. Every user belongs to exactly one store, and store data (categories,
-- and later products, sales, ...) is only visible to users of that store.
CREATE TABLE stores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  email       TEXT,
  phone       TEXT,
  address     TEXT,
  city        TEXT,
  province    TEXT,
  postal_code TEXT,
  tin         TEXT, -- BIR Taxpayer Identification Number, printed on receipts
  is_active   INTEGER NOT NULL DEFAULT 1, -- 0 locks every user of the store out
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Existing users and categories move into this first store. Rename it from the Store Information page.
INSERT INTO stores (id, name) VALUES (1, 'My Store');

-- SQLite can't add a NOT NULL foreign key column to an existing table, so the
-- column is nullable and the triggers below reject users without a store.
ALTER TABLE users ADD COLUMN store_id INTEGER REFERENCES stores (id);
UPDATE users SET store_id = 1;
CREATE INDEX idx_users_store_id ON users (store_id);

CREATE TRIGGER users_require_store_on_insert BEFORE INSERT ON users
WHEN NEW.store_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'users.store_id is required');
END;

CREATE TRIGGER users_require_store_on_update BEFORE UPDATE OF store_id ON users
WHEN NEW.store_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'users.store_id is required');
END;

-- Categories become per store: two stores may each have a "Beverages" category.
-- Changing the UNIQUE constraints means rebuilding the table (nothing references it yet).
CREATE TABLE categories_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id   INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  name       TEXT    NOT NULL COLLATE NOCASE,
  slug       TEXT    NOT NULL, -- lowercase-words-with-dashes, used in URLs
  status     TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, name),
  UNIQUE (store_id, slug)
);

INSERT INTO categories_new (id, store_id, name, slug, status, created_at, updated_at)
SELECT id, 1, name, slug, status, created_at, updated_at FROM categories;

DROP TABLE categories;
ALTER TABLE categories_new RENAME TO categories;

CREATE INDEX idx_categories_store_status ON categories (store_id, status);
