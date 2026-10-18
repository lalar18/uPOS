-- PayMongo's gateway fee (1.34% of the amount, see GATEWAY_FEE_BP in worker/serviceCharges.ts),
-- passed on as a line of its own beside the service charge on everything that goes through PayMongo:
--   - sale payments made online (a checkout): added on top of the amount, paid by the customer
--   - subscription renewals paid online: added on top of the plan price (whole pesos, like the rest)
--   - store withdrawals: kept out of the amount, with the service charge; the store receives the rest
-- Like the service charge, it's fixed when the payment or withdrawal is opened. Rows from before
-- this have none (0).
ALTER TABLE sale_checkouts ADD COLUMN gateway_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (gateway_fee_cents >= 0);
ALTER TABLE sale_payments ADD COLUMN gateway_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (gateway_fee_cents >= 0);
ALTER TABLE subscription_renewals ADD COLUMN gateway_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (gateway_fee_cents >= 0);
ALTER TABLE wallet_withdrawals ADD COLUMN gateway_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (gateway_fee_cents >= 0);
ALTER TABLE store_payouts ADD COLUMN gateway_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (gateway_fee_cents >= 0);
