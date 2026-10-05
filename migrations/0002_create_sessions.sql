-- Logged-in sessions. The browser holds a random token in an HttpOnly cookie;
-- only its SHA-256 hash is stored here, so a leaked database can't be used to log in.
CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY, -- SHA-256 hash of the session token (hex)
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_user_id ON sessions (user_id);
