-- Sign in and sign up with Google (see worker/google.ts).

-- The Google account (its stable "sub" ID) linked to a user. A user is linked the first time
-- they sign in with a Google account whose verified email matches theirs.
ALTER TABLE users ADD COLUMN google_sub TEXT;
CREATE UNIQUE INDEX idx_users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL;

-- Users who signed up with Google have no password: their password_hash is '' (which never
-- verifies) until they set one on their profile.

-- A Google account with no user yet, waiting for its owner to name their new store. The
-- browser holds a random token in an HttpOnly cookie; only its SHA-256 hash is stored here.
CREATE TABLE google_signups (
  id         TEXT PRIMARY KEY, -- SHA-256 hash of the signup token (hex)
  google_sub TEXT NOT NULL,
  email      TEXT NOT NULL,
  full_name  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
