-- QR Ph: sales can be paid online by scanning a QR Ph code with any bank or e-wallet app, as
-- subscription renewals already can (see worker/saleCheckouts.ts).
--
-- sale_checkouts is rebuilt to allow the method. Dropping the old table nulls the checkout_id of
-- the payments made through it (ON DELETE SET NULL), so those links are kept aside and restored.
CREATE TABLE sale_checkouts_new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id             INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  sale_id              INTEGER NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  method               TEXT    NOT NULL CHECK (method IN ('card', 'gcash', 'maya', 'qrph')),
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

INSERT INTO sale_checkouts_new SELECT id, store_id, sale_id, method, amount_cents, service_charge_cents,
  checkout_session_id, checkout_url, status, payment_reference, processing_fee_cents, user_id, user_name,
  created_at, paid_at
FROM sale_checkouts;

CREATE TABLE sale_checkout_links AS SELECT id, checkout_id FROM sale_payments WHERE checkout_id IS NOT NULL;

DROP TABLE sale_checkouts;
ALTER TABLE sale_checkouts_new RENAME TO sale_checkouts;

UPDATE sale_payments SET checkout_id = (SELECT checkout_id FROM sale_checkout_links l WHERE l.id = sale_payments.id)
WHERE id IN (SELECT id FROM sale_checkout_links);
DROP TABLE sale_checkout_links;

CREATE INDEX idx_sale_checkouts_sale_id ON sale_checkouts (sale_id);
CREATE UNIQUE INDEX idx_sale_checkouts_pending ON sale_checkouts (sale_id) WHERE status = 'pending';

-- The sale service charge applies to QR Ph like the other online methods
UPDATE service_charges
SET methods = json_insert(methods, '$[#]', 'qrph')
WHERE id = 'sale' AND json_valid(methods) AND NOT EXISTS (SELECT 1 FROM json_each(methods) WHERE value = 'qrph');
