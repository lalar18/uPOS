-- Online payment (PayMongo). Renewing from the Subscription page opens a PayMongo checkout
-- session for the pending renewal; PayMongo's webhook marks the renewal paid (with no
-- confirmed_by, since no super admin confirmed it). See worker/paymongo.ts.

-- The renewal's latest checkout session (a new one replaces it when the admin pays again)
ALTER TABLE subscription_renewals ADD COLUMN checkout_session_id TEXT;
