-- Users who can log in to the POS (admins and cashiers)
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL, -- format: pbkdf2$<iterations>$<salt b64>$<hash b64>
  full_name     TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'cashier' CHECK (role IN ('admin', 'cashier')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Sample user. Email: admin@example.com / Password: Admin@12345
-- Change this password (or delete this user) before going live.
INSERT INTO users (email, password_hash, full_name, role) VALUES (
  'admin@example.com',
  'pbkdf2$100000$+l9CO05ooNZiIYBDcSzeuA==$Ut6ACrHvsS8eKnIeqQipwYqcaKvvqUvBkX3oNBSVpDU=',
  'Sample Admin',
  'admin'
);
