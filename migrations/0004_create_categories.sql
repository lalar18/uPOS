-- Product categories
CREATE TABLE categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  slug       TEXT    NOT NULL UNIQUE, -- lowercase-words-with-dashes, used in URLs
  status     TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_categories_status ON categories (status);
