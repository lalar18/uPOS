-- Subscription expiry and renewals. Plans are billed monthly: each paid renewal adds one
-- month to the store's plan_expires_at. Once that passes, the store is read-only (users can
-- still sign in and view everything, but can't save anything) until it's renewed.

-- UTC, "YYYY-MM-DD HH:MM:SS" like every other timestamp. NULL counts as expired.
ALTER TABLE stores ADD COLUMN plan_expires_at TEXT;

-- Existing stores get 30 days, and so does every new store
UPDATE stores SET plan_expires_at = datetime('now', '+30 days');

CREATE TRIGGER stores_start_subscription AFTER INSERT ON stores
WHEN NEW.plan_expires_at IS NULL
BEGIN
  UPDATE stores SET plan_expires_at = datetime('now', '+30 days') WHERE id = NEW.id;
END;

-- A store admin asks to renew (optionally on another plan) from the Subscription page,
-- which adds a 'pending' row. Until online payment exists, the platform owner confirms it
-- once paid, which extends the store by a month and moves it to the renewal's plan:
--   npx wrangler d1 execute usystems_pos_db --remote --command "UPDATE subscription_renewals SET status = 'paid' WHERE id = 1"
-- (later, the payment gateway's webhook will run that same UPDATE).
CREATE TABLE subscription_renewals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id     INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  plan_id      TEXT    NOT NULL REFERENCES plans (id),
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  requested_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  period_start TEXT, -- set when paid: the old expiry, or now if it had already passed
  period_end   TEXT, -- set when paid: period_start + 1 month (the store's new expiry)
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  paid_at      TEXT
);

CREATE INDEX idx_subscription_renewals_store ON subscription_renewals (store_id, created_at);

-- At most one pending renewal per store
CREATE UNIQUE INDEX idx_subscription_renewals_one_pending ON subscription_renewals (store_id) WHERE status = 'pending';

-- Paid and cancelled renewals are final
CREATE TRIGGER subscription_renewals_final BEFORE UPDATE OF status ON subscription_renewals
WHEN OLD.status != 'pending'
BEGIN
  SELECT RAISE(ABORT, 'Only a pending renewal can change status');
END;

CREATE TRIGGER subscription_renewals_paid AFTER UPDATE OF status ON subscription_renewals
WHEN NEW.status = 'paid'
BEGIN
  UPDATE subscription_renewals
  SET paid_at = datetime('now'),
      period_start = (
        SELECT MAX(COALESCE(st.plan_expires_at, datetime('now')), datetime('now'))
        FROM stores st WHERE st.id = NEW.store_id
      )
  WHERE id = NEW.id;

  UPDATE subscription_renewals SET period_end = datetime(period_start, '+1 month') WHERE id = NEW.id;

  UPDATE stores
  SET plan_id = NEW.plan_id,
      plan_expires_at = (SELECT period_end FROM subscription_renewals WHERE id = NEW.id),
      updated_at = datetime('now')
  WHERE id = NEW.store_id;
END;
