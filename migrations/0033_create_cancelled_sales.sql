-- Cancelled transactions (see cancelSale in worker/sales.ts). A sale nothing was paid on yet, such as
-- a POS sale left waiting for an online payment the customer walked away from, can be cancelled:
-- its products go back in stock (logged as "sale_cancel" stock adjustments) and the sale is removed,
-- so it doesn't stay behind as an unpaid invoice. This table keeps a record of what was cancelled.
CREATE TABLE cancelled_sales (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id       INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  sale_id        INTEGER NOT NULL UNIQUE, -- the removed sale's id (INV-00042), kept for reference
  source         TEXT    NOT NULL,
  customer_id    INTEGER REFERENCES customers (id) ON DELETE SET NULL,
  customer_name  TEXT    NOT NULL,
  sale_date      TEXT    NOT NULL, -- YYYY-MM-DD
  total_cents    INTEGER NOT NULL CHECK (total_cents >= 0),
  items          TEXT    NOT NULL, -- JSON: [{ productId, name, sku, unit, quantity, priceCents, totalCents }]
  reason         TEXT,
  sold_by        TEXT    NOT NULL, -- who made the sale
  sold_at        TEXT    NOT NULL,
  user_id        INTEGER REFERENCES users (id) ON DELETE SET NULL, -- who cancelled it
  user_name      TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cancelled_sales_store_created ON cancelled_sales (store_id, created_at);
