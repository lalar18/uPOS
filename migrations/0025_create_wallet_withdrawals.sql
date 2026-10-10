-- The store's wallet (see worker/storePayouts.ts): sales paid online are held by the platform,
-- without the service charge (the platform's income), until the store withdraws them. A store
-- admin asks for a withdrawal to a GCash number or a bank account; a super admin sends the money
-- and marks it sent (which records the store_payouts row), or rejects it.
--
-- Available to withdraw: payments through checkouts, less payouts, less the pending request.
CREATE TABLE wallet_withdrawals (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id          INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  -- Where to send it, as the store gave it
  destination       TEXT    NOT NULL CHECK (destination IN ('gcash', 'bank')),
  bank_name         TEXT    CHECK ((destination = 'bank') = (bank_name IS NOT NULL)),
  account_name      TEXT    NOT NULL,
  account_number    TEXT    NOT NULL,
  note              TEXT,
  status            TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'rejected', 'cancelled')),
  reject_reason     TEXT,
  requested_by      INTEGER REFERENCES users (id) ON DELETE SET NULL,
  requested_by_name TEXT    NOT NULL,
  reviewed_by       INTEGER REFERENCES super_admins (id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  reviewed_at       TEXT
);

CREATE INDEX idx_wallet_withdrawals_store_id ON wallet_withdrawals (store_id, id);
-- One request waits at a time, so a store can't ask for its balance twice
CREATE UNIQUE INDEX idx_wallet_withdrawals_pending ON wallet_withdrawals (store_id) WHERE status = 'pending';

-- The withdrawal a payout sent (null for payouts recorded without a request)
ALTER TABLE store_payouts ADD COLUMN withdrawal_id INTEGER REFERENCES wallet_withdrawals (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_store_payouts_withdrawal_id ON store_payouts (withdrawal_id) WHERE withdrawal_id IS NOT NULL;
