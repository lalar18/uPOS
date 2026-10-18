-- A store's own GCash account, set up by the admin on the General Settings page. It isn't a payment
-- gateway: the admin uploads the QR code GCash generated for their account, the POS shows it to the
-- customer, the money goes straight to that GCash account, and the cashier types in the reference no.
-- The POS only offers GCash once this is set up.
CREATE TABLE store_gcash_accounts (
  store_id        INTEGER PRIMARY KEY REFERENCES stores (id) ON DELETE CASCADE,
  account_name    TEXT    NOT NULL,
  account_number  TEXT    NOT NULL DEFAULT '', -- the GCash mobile number, shown under the QR; '' shows none
  qr_content_type TEXT    NOT NULL CHECK (qr_content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  qr_data         BLOB    NOT NULL, -- resized in the browser before upload (a few hundred KB at most)
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
