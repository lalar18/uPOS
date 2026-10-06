-- Stock adjustments: a permanent log of every change to a product's stock.
-- Rows are never edited or deleted; a mistake is fixed with another adjustment,
-- so the log always adds up to the product's current quantity.
--
-- The product's name, SKU and unit, and the user's name, are copied onto each
-- row so the history still reads correctly after a product or user is deleted.
-- The reason is checked by the API (not a CHECK constraint) so new reasons,
-- like sales, can be added later without rebuilding the table.
CREATE TABLE stock_adjustments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id        INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  product_id      INTEGER REFERENCES products (id) ON DELETE SET NULL,
  product_name    TEXT    NOT NULL,
  product_sku     TEXT    NOT NULL,
  unit_short_name TEXT    NOT NULL,
  reason          TEXT    NOT NULL,
  quantity_before REAL    NOT NULL,
  quantity_change REAL    NOT NULL CHECK (quantity_change != 0), -- positive adds, negative removes
  quantity_after  REAL    NOT NULL CHECK (quantity_after >= 0),
  note            TEXT,
  user_id         INTEGER REFERENCES users (id) ON DELETE SET NULL,
  user_name       TEXT    NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_stock_adjustments_store_created ON stock_adjustments (store_id, created_at);
CREATE INDEX idx_stock_adjustments_product_created ON stock_adjustments (product_id, created_at);

-- Products that already have stock start their history with an opening balance
INSERT INTO stock_adjustments (store_id, product_id, product_name, product_sku, unit_short_name, reason,
  quantity_before, quantity_change, quantity_after, user_name, created_at)
SELECT p.store_id, p.id, p.name, p.sku, u.short_name, 'opening', 0, p.quantity, p.quantity, 'System', p.created_at
FROM products p
JOIN units u ON u.id = p.unit_id
WHERE p.quantity > 0;
