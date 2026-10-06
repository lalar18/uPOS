-- Warranties offered on products, per store ("1 Year Limited Warranty").
CREATE TABLE warranties (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id      INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  name          TEXT    NOT NULL COLLATE NOCASE,
  description   TEXT,
  duration      INTEGER NOT NULL CHECK (duration > 0),
  duration_unit TEXT    NOT NULL CHECK (duration_unit IN ('day', 'month', 'year')),
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, name)
);

CREATE INDEX idx_warranties_store_status ON warranties (store_id, status);

-- Variant attributes, per store: "Size" with values S, M, L; "Color" with Red, Blue.
CREATE TABLE variant_attributes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id   INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  name       TEXT    NOT NULL COLLATE NOCASE,
  status     TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, name)
);

CREATE INDEX idx_variant_attributes_store_status ON variant_attributes (store_id, status);

-- The values of an attribute, kept in the order the user typed them.
CREATE TABLE variant_attribute_values (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  attribute_id INTEGER NOT NULL REFERENCES variant_attributes (id) ON DELETE CASCADE,
  value        TEXT    NOT NULL COLLATE NOCASE,
  position     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (attribute_id, value)
);

-- Dates are 'YYYY-MM-DD'. Expired products are those whose expiry_date has passed.
ALTER TABLE products ADD COLUMN manufactured_date TEXT;
ALTER TABLE products ADD COLUMN expiry_date TEXT;
-- Deleting a warranty leaves its products without one
ALTER TABLE products ADD COLUMN warranty_id INTEGER REFERENCES warranties (id) ON DELETE SET NULL;

CREATE INDEX idx_products_store_expiry ON products (store_id, expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX idx_products_warranty_id ON products (warranty_id);
