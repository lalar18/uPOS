-- Online payment of sales through PayMongo (see worker/saleCheckouts.ts). The cashier picks card,
-- GCash or Maya and the customer pays on PayMongo's checkout page (by its QR code or link). The
-- money goes to the platform's PayMongo account: the platform keeps the service charge and pays
-- the sale amount out to the store (store_payouts).

-- One checkout session per attempt. 'refund_due': paid after the sale was settled another way,
-- so it couldn't be recorded and the customer is owed a refund (from the PayMongo dashboard).
CREATE TABLE sale_checkouts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id             INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  sale_id              INTEGER NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  method               TEXT    NOT NULL CHECK (method IN ('card', 'gcash', 'maya')),
  amount_cents         INTEGER NOT NULL CHECK (amount_cents > 0),          -- paid towards the sale
  service_charge_cents INTEGER NOT NULL DEFAULT 0 CHECK (service_charge_cents >= 0), -- on top, for the platform
  checkout_session_id  TEXT    NOT NULL UNIQUE,
  checkout_url         TEXT    NOT NULL,
  status               TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'refund_due')),
  payment_reference    TEXT,    -- PayMongo's payment id, once paid
  processing_fee_cents INTEGER CHECK (processing_fee_cents >= 0), -- what PayMongo kept
  user_id              INTEGER REFERENCES users (id) ON DELETE SET NULL,
  user_name            TEXT    NOT NULL,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  paid_at              TEXT
);

CREATE INDEX idx_sale_checkouts_sale_id ON sale_checkouts (sale_id);
-- A sale has one checkout waiting at a time, so it can't be paid online twice at once
CREATE UNIQUE INDEX idx_sale_checkouts_pending ON sale_checkouts (sale_id) WHERE status = 'pending';

-- A payment made through a checkout (the platform holds the money until it's paid out)
ALTER TABLE sale_payments ADD COLUMN checkout_id INTEGER REFERENCES sale_checkouts (id) ON DELETE SET NULL;
ALTER TABLE sale_payments ADD COLUMN processing_fee_cents INTEGER CHECK (processing_fee_cents >= 0);
CREATE UNIQUE INDEX idx_sale_payments_checkout_id ON sale_payments (checkout_id) WHERE checkout_id IS NOT NULL;

-- Money the platform sent a store for its online sales, recorded by super admins (US Panel).
-- Owed to a store: its payments through checkouts, less these.
CREATE TABLE store_payouts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id     INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method       TEXT    NOT NULL,
  reference    TEXT,
  note         TEXT,
  paid_date    TEXT    NOT NULL, -- YYYY-MM-DD
  created_by   INTEGER REFERENCES super_admins (id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_store_payouts_store_id ON store_payouts (store_id, paid_date);
