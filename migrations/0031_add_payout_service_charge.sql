-- A service charge on withdrawals (see worker/storePayouts.ts): the platform keeps it out of the
-- amount a store withdraws from its wallet, and sends the rest. Super admins set it in the US
-- Panel (Income) with the other charges; the store sees it, and what it'll receive, before asking.
--
-- A withdrawal's amount_cents is still what leaves the wallet. Its service charge is fixed when
-- it's requested, so changing the rate later doesn't change what a waiting request receives.
-- Payouts made for a request keep the same split (amount_cents leaves the wallet, the store gets
-- amount_cents - service_charge_cents); a transfer through PayMongo sends only that rest.

-- service_charges' id CHECK can't be altered in SQLite, so the table is rebuilt with 'payout' allowed
CREATE TABLE service_charges_new (
  id         TEXT    PRIMARY KEY CHECK (id IN ('renewal', 'sale', 'payout')),
  kind       TEXT    NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed', 'percent')),
  value      INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0 AND (kind = 'fixed' OR value <= 10000)), -- fixed: centavos; percent: basis points (250 = 2.5%)
  methods    TEXT    NOT NULL DEFAULT '[]', -- 'sale' only: JSON array of the payment methods it applies to
  updated_by INTEGER REFERENCES super_admins (id) ON DELETE SET NULL,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO service_charges_new (id, kind, value, methods, updated_by, updated_at)
  SELECT id, kind, value, methods, updated_by, updated_at FROM service_charges;
DROP TABLE service_charges;
ALTER TABLE service_charges_new RENAME TO service_charges;

-- Off until a super admin sets it
INSERT INTO service_charges (id, kind, value) VALUES ('payout', 'fixed', 0);

-- The charge on a withdrawal, and the rate it was worked out from (null on requests made before this)
ALTER TABLE wallet_withdrawals ADD COLUMN service_charge_cents INTEGER NOT NULL DEFAULT 0 CHECK (service_charge_cents >= 0);
ALTER TABLE wallet_withdrawals ADD COLUMN service_charge_kind TEXT CHECK (service_charge_kind IN ('fixed', 'percent'));
ALTER TABLE wallet_withdrawals ADD COLUMN service_charge_value INTEGER CHECK (service_charge_value >= 0);

-- The part of a payout the platform kept (its income); the store received amount_cents less this
ALTER TABLE store_payouts ADD COLUMN service_charge_cents INTEGER NOT NULL DEFAULT 0 CHECK (service_charge_cents >= 0);

CREATE INDEX idx_store_payouts_service_charge ON store_payouts (created_at) WHERE service_charge_cents > 0;
