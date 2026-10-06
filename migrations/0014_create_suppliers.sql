-- Suppliers, per store: who the store buys its stock from.
--
-- When purchases are added, reference this table with
--   supplier_id INTEGER REFERENCES suppliers (id) ON DELETE RESTRICT
-- and copy supplier_name onto each purchase (like sales do with customer_name), so a
-- supplier with purchases can't be deleted and renaming one never changes old purchases.
CREATE TABLE suppliers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id       INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  name           TEXT    NOT NULL COLLATE NOCASE,
  contact_person TEXT,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  note           TEXT,
  status         TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One supplier per name in a store (case-insensitive, from the column's NOCASE collation)
CREATE UNIQUE INDEX idx_suppliers_store_name ON suppliers (store_id, name);
