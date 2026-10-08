-- Super admins: the platform owner's staff. They sign in to the US Panel (/us-panel) to
-- support stores: add stores, manage their plans, users and status, and record the
-- payments that renew subscriptions. They don't belong to a store, and have their own
-- sessions (and cookie), separate from store users.
CREATE TABLE super_admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL, -- format: pbkdf2$<iterations>$<salt b64>$<hash b64>
  full_name     TEXT    NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Sample super admin. Email: superadmin@example.com / Password: Admin@12345
-- Change this password (US Panel > Account) before going live.
INSERT INTO super_admins (email, password_hash, full_name) VALUES (
  'superadmin@example.com',
  'pbkdf2$100000$+l9CO05ooNZiIYBDcSzeuA==$Ut6ACrHvsS8eKnIeqQipwYqcaKvvqUvBkX3oNBSVpDU=',
  'Super Admin'
);

-- Like sessions, only the SHA-256 hash of the token is stored
CREATE TABLE super_admin_sessions (
  id             TEXT    PRIMARY KEY,
  super_admin_id INTEGER NOT NULL REFERENCES super_admins (id) ON DELETE CASCADE,
  expires_at     TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_super_admin_sessions_admin ON super_admin_sessions (super_admin_id);

-- Payment details, recorded when a super admin marks a renewal paid. A renewal can now
-- cover several months (paid in advance); store admins still request one month at a time.
ALTER TABLE subscription_renewals ADD COLUMN months INTEGER NOT NULL DEFAULT 1 CHECK (months BETWEEN 1 AND 24);
ALTER TABLE subscription_renewals ADD COLUMN amount INTEGER CHECK (amount >= 0); -- whole pesos received
ALTER TABLE subscription_renewals ADD COLUMN payment_method TEXT;
ALTER TABLE subscription_renewals ADD COLUMN payment_reference TEXT;
ALTER TABLE subscription_renewals ADD COLUMN note TEXT;
ALTER TABLE subscription_renewals ADD COLUMN confirmed_by INTEGER REFERENCES super_admins (id) ON DELETE SET NULL;

CREATE INDEX idx_subscription_renewals_status ON subscription_renewals (status, created_at);

-- Same as before, but extends the store by the renewal's months instead of always one
DROP TRIGGER subscription_renewals_paid;

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

  UPDATE subscription_renewals SET period_end = datetime(period_start, '+' || months || ' months') WHERE id = NEW.id;

  UPDATE stores
  SET plan_id = NEW.plan_id,
      plan_expires_at = (SELECT period_end FROM subscription_renewals WHERE id = NEW.id),
      updated_at = datetime('now')
  WHERE id = NEW.store_id;
END;
