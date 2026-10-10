-- Withdrawals sent through PayMongo (see worker/payoutTransfers.ts): a super admin sends a store's
-- withdrawal from the platform's PayMongo Wallet to the store's GCash or bank account over InstaPay
-- (or PESONet above ₱50,000), instead of sending it by hand and marking it sent.
--
-- Where to send it: the receiving bank or e-wallet's code (BIC) from PayMongo's list. Null on
-- requests made before this, and when PayMongo isn't set up (the bank name is typed in then).
ALTER TABLE wallet_withdrawals ADD COLUMN bank_code TEXT;

-- Every transfer sent through PayMongo, kept whatever happened to it. The withdrawal stays
-- 'pending' while its transfer is: it can't be cancelled, rejected or marked sent then. Once
-- PayMongo says it succeeded, it's recorded as the withdrawal's payout (store_payouts.transfer_id)
-- and the withdrawal is 'sent'; if it failed, the withdrawal waits to be sent again or rejected.
CREATE TABLE payout_transfers (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id                  INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  withdrawal_id             INTEGER NOT NULL REFERENCES wallet_withdrawals (id) ON DELETE CASCADE,
  amount_cents              INTEGER NOT NULL CHECK (amount_cents > 0),
  provider                  TEXT    NOT NULL CHECK (provider IN ('instapay', 'pesonet')),
  -- Where it was sent, as it was sent
  bank_code                 TEXT    NOT NULL,
  bank_name                 TEXT    NOT NULL,
  account_name              TEXT    NOT NULL,
  account_number            TEXT    NOT NULL,
  callback_url              TEXT,    -- PayMongo calls it when the status changes
  -- References: ours (sent to PayMongo), PayMongo's ids, and the InstaPay/PESONet reference on the bank statement
  reference_number          TEXT    NOT NULL UNIQUE,
  transfer_id               TEXT    UNIQUE, -- tr_…, once PayMongo answered
  batch_transfer_id         TEXT,
  provider_reference_number TEXT,
  fee_cents                 INTEGER CHECK (fee_cents >= 0), -- what PayMongo charged the platform
  status                    TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  failure_code              TEXT,
  failure_message           TEXT,
  created_by                INTEGER REFERENCES super_admins (id) ON DELETE SET NULL,
  created_by_name           TEXT    NOT NULL,
  created_at                TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at              TEXT     -- when it succeeded or failed
);

CREATE INDEX idx_payout_transfers_store_id ON payout_transfers (store_id, id);
CREATE INDEX idx_payout_transfers_withdrawal_id ON payout_transfers (withdrawal_id, id);
-- One transfer at a time per withdrawal, so it can't be sent twice
CREATE UNIQUE INDEX idx_payout_transfers_pending ON payout_transfers (withdrawal_id) WHERE status = 'pending';

-- The transfer a payout was sent with (null for payouts sent by hand)
ALTER TABLE store_payouts ADD COLUMN transfer_id INTEGER REFERENCES payout_transfers (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_store_payouts_transfer_id ON store_payouts (transfer_id) WHERE transfer_id IS NOT NULL;
