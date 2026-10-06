-- Units of measure, per store (two stores may each have a "Kilogram" unit).
CREATE TABLE units (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id      INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  name          TEXT    NOT NULL COLLATE NOCASE, -- "Kilogram"
  short_name    TEXT    NOT NULL COLLATE NOCASE, -- "kg", shown next to quantities
  allow_decimal INTEGER NOT NULL DEFAULT 0 CHECK (allow_decimal IN (0, 1)), -- 1 lets stock be 1.5 kg
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, name),
  UNIQUE (store_id, short_name)
);

CREATE INDEX idx_units_store_status ON units (store_id, status);

-- Give every existing store a few common units to start with
INSERT INTO units (store_id, name, short_name, allow_decimal)
SELECT s.id, u.name, u.short_name, u.allow_decimal
FROM stores s
CROSS JOIN (
  SELECT 'Piece' AS name, 'pc' AS short_name, 0 AS allow_decimal
  UNION ALL SELECT 'Pack', 'pack', 0
  UNION ALL SELECT 'Box', 'box', 0
  UNION ALL SELECT 'Kilogram', 'kg', 1
  UNION ALL SELECT 'Liter', 'L', 1
) u;
