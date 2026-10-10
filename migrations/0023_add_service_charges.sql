-- Service charges: the platform owner's fees on online payments, set by super admins in the
-- US Panel (Income). See worker/serviceCharges.ts.
--   'renewal': added to a subscription renewal paid online through PayMongo
--   'sale':    added to a store's sale payment made with an online method (GCash, card, ...)
-- Stores see the charge only while paying; what they've paid in total is for super admins only.
CREATE TABLE service_charges (
  id         TEXT    PRIMARY KEY CHECK (id IN ('renewal', 'sale')),
  kind       TEXT    NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed', 'percent')),
  value      INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0 AND (kind = 'fixed' OR value <= 10000)), -- fixed: centavos; percent: basis points (250 = 2.5%)
  methods    TEXT    NOT NULL DEFAULT '[]', -- 'sale' only: JSON array of the payment methods it applies to
  updated_by INTEGER REFERENCES super_admins (id) ON DELETE SET NULL,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The renewal fee was a fixed PHP 10 until now; sales had none
INSERT INTO service_charges (id, kind, value) VALUES ('renewal', 'fixed', 1000);
INSERT INTO service_charges (id, kind, value, methods) VALUES ('sale', 'fixed', 0, '["card","gcash","maya"]');

-- What the store paid on top of the plan price, and what PayMongo kept of the payment
ALTER TABLE subscription_renewals ADD COLUMN service_charge_cents INTEGER NOT NULL DEFAULT 0 CHECK (service_charge_cents >= 0);
ALTER TABLE subscription_renewals ADD COLUMN processing_fee_cents INTEGER CHECK (processing_fee_cents >= 0);

-- Collected from the customer on top of amount_cents (not part of the sale or its balance)
ALTER TABLE sale_payments ADD COLUMN service_charge_cents INTEGER NOT NULL DEFAULT 0 CHECK (service_charge_cents >= 0);

CREATE INDEX idx_sale_payments_service_charge ON sale_payments (created_at) WHERE service_charge_cents > 0;
CREATE INDEX idx_subscription_renewals_paid_at ON subscription_renewals (paid_at) WHERE status = 'paid';
