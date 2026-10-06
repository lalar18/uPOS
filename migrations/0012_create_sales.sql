-- Sales module: customers, quotations, sales (each sale is also its invoice),
-- payments and sales returns. Money is whole centavos; quantities are in the product's unit.
--
-- Product, customer and user names are copied onto each row so documents still read
-- correctly after the product, customer or user is renamed or deleted.
--
-- Payment methods and return reasons are checked by the API (not CHECK constraints)
-- so new ones can be added later without rebuilding these tables.

-- Customers, per store. A sale or quotation without a customer is for a walk-in customer.
CREATE TABLE customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id   INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  name       TEXT    NOT NULL COLLATE NOCASE,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  status     TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_customers_store_name ON customers (store_id, name);

-- Quotations (price offers). They don't touch stock; converting one creates a sale.
-- "Expired" isn't stored: a draft or sent quotation past valid_until is shown as expired.
CREATE TABLE quotations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id       INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  uid            TEXT    NOT NULL, -- random id from the browser, so a retried save never adds twice
  customer_id    INTEGER REFERENCES customers (id) ON DELETE SET NULL,
  customer_name  TEXT    NOT NULL,
  quote_date     TEXT    NOT NULL, -- YYYY-MM-DD
  valid_until    TEXT,             -- YYYY-MM-DD
  status         TEXT    NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'converted')),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0 AND discount_cents <= subtotal_cents),
  tax_rate_bp    INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000), -- 1200 = 12%
  tax_cents      INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents    INTEGER NOT NULL CHECK (total_cents >= 0),
  note           TEXT,
  user_id        INTEGER REFERENCES users (id) ON DELETE SET NULL,
  user_name      TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, uid)
);

CREATE INDEX idx_quotations_store_date ON quotations (store_id, quote_date);
CREATE INDEX idx_quotations_customer_id ON quotations (customer_id);

CREATE TABLE quotation_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id    INTEGER NOT NULL REFERENCES quotations (id) ON DELETE CASCADE,
  product_id      INTEGER REFERENCES products (id) ON DELETE SET NULL,
  product_name    TEXT    NOT NULL,
  product_sku     TEXT    NOT NULL,
  unit_short_name TEXT    NOT NULL,
  quantity        REAL    NOT NULL CHECK (quantity > 0),
  price_cents     INTEGER NOT NULL CHECK (price_cents >= 0),
  total_cents     INTEGER NOT NULL CHECK (total_cents >= 0), -- ROUND(quantity * price_cents)
  position        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_quotation_items_quotation_id ON quotation_items (quotation_id);
CREATE INDEX idx_quotation_items_product_id ON quotation_items (product_id);

-- Sales. Every sale is also its invoice (INV-00042). Sales are never edited or deleted:
-- money comes in through sale_payments and goods come back through sales_returns.
--
-- paid_cents and returned_cents are recalculated from those tables in the same transaction
-- that changes them; the CHECKs below then make overpaying or over-returning impossible.
-- The balance due is total_cents - returned_cents - paid_cents.
CREATE TABLE sales (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id       INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  uid            TEXT    NOT NULL, -- random id from the browser, so a retried checkout never sells twice
  source         TEXT    NOT NULL CHECK (source IN ('pos', 'manual')),
  customer_id    INTEGER REFERENCES customers (id) ON DELETE SET NULL,
  customer_name  TEXT    NOT NULL,
  quotation_id   INTEGER REFERENCES quotations (id) ON DELETE SET NULL,
  sale_date      TEXT    NOT NULL, -- YYYY-MM-DD, the store's local date
  due_date       TEXT,             -- YYYY-MM-DD, when an unpaid balance is due
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0 AND discount_cents <= subtotal_cents),
  tax_rate_bp    INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000), -- 1200 = 12%
  tax_cents      INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents    INTEGER NOT NULL CHECK (total_cents >= 0),
  returned_cents INTEGER NOT NULL DEFAULT 0 CHECK (returned_cents >= 0 AND returned_cents <= total_cents),
  paid_cents     INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0 AND paid_cents <= total_cents - returned_cents),
  note           TEXT,
  user_id        INTEGER REFERENCES users (id) ON DELETE SET NULL,
  user_name      TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, uid)
);

CREATE INDEX idx_sales_store_date ON sales (store_id, sale_date);
CREATE INDEX idx_sales_customer_id ON sales (customer_id);
-- A quotation can only be converted into one sale
CREATE UNIQUE INDEX idx_sales_quotation_id ON sales (quotation_id) WHERE quotation_id IS NOT NULL;

CREATE TABLE sale_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id           INTEGER NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  product_id        INTEGER REFERENCES products (id) ON DELETE SET NULL,
  product_name      TEXT    NOT NULL,
  product_sku       TEXT    NOT NULL,
  unit_short_name   TEXT    NOT NULL,
  quantity          REAL    NOT NULL CHECK (quantity > 0),
  price_cents       INTEGER NOT NULL CHECK (price_cents >= 0),
  cost_cents        INTEGER CHECK (cost_cents >= 0), -- the product's cost when sold, for profit reports
  total_cents       INTEGER NOT NULL CHECK (total_cents >= 0), -- ROUND(quantity * price_cents)
  returned_quantity REAL    NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0 AND returned_quantity <= quantity),
  position          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_sale_items_sale_id ON sale_items (sale_id);
CREATE INDEX idx_sale_items_product_id ON sale_items (product_id);

-- Returned goods. A return credits the sale; when the customer had already paid
-- more than the new total, the difference is refunded as a negative sale payment.
CREATE TABLE sales_returns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id     INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  uid          TEXT    NOT NULL, -- random id from the browser, so a retried save never returns twice
  sale_id      INTEGER NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  return_date  TEXT    NOT NULL, -- YYYY-MM-DD
  reason       TEXT    NOT NULL,
  restock      INTEGER NOT NULL CHECK (restock IN (0, 1)), -- 1 puts the goods back in stock
  total_cents  INTEGER NOT NULL CHECK (total_cents >= 0),  -- value credited to the sale
  refund_cents INTEGER NOT NULL DEFAULT 0 CHECK (refund_cents >= 0), -- money given back
  note         TEXT,
  user_id      INTEGER REFERENCES users (id) ON DELETE SET NULL,
  user_name    TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, uid)
);

CREATE INDEX idx_sales_returns_store_date ON sales_returns (store_id, return_date);
CREATE INDEX idx_sales_returns_sale_id ON sales_returns (sale_id);

CREATE TABLE sales_return_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id       INTEGER NOT NULL REFERENCES sales_returns (id) ON DELETE CASCADE,
  sale_item_id    INTEGER NOT NULL REFERENCES sale_items (id) ON DELETE CASCADE,
  product_id      INTEGER REFERENCES products (id) ON DELETE SET NULL,
  product_name    TEXT    NOT NULL,
  product_sku     TEXT    NOT NULL,
  unit_short_name TEXT    NOT NULL,
  quantity        REAL    NOT NULL CHECK (quantity > 0),
  price_cents     INTEGER NOT NULL CHECK (price_cents >= 0),
  total_cents     INTEGER NOT NULL CHECK (total_cents >= 0)
);

CREATE INDEX idx_sales_return_items_return_id ON sales_return_items (return_id);
CREATE INDEX idx_sales_return_items_sale_item_id ON sales_return_items (sale_item_id);

-- Money received for a sale. A refund (from a sales return) is a negative amount.
CREATE TABLE sale_payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id       INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  sale_id        INTEGER NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  return_id      INTEGER REFERENCES sales_returns (id) ON DELETE CASCADE, -- set on refunds
  amount_cents   INTEGER NOT NULL CHECK (amount_cents != 0),
  tendered_cents INTEGER CHECK (tendered_cents >= amount_cents), -- cash handed over; change = tendered - amount
  method         TEXT    NOT NULL,
  reference      TEXT, -- GCash reference no., card approval code, cheque no.
  note           TEXT,
  paid_date      TEXT    NOT NULL, -- YYYY-MM-DD
  user_id        INTEGER REFERENCES users (id) ON DELETE SET NULL,
  user_name      TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sale_payments_sale_id ON sale_payments (sale_id);
CREATE INDEX idx_sale_payments_store_date ON sale_payments (store_id, paid_date);
