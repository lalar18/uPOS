-- Failed login attempts, used to slow down password guessing (see worker/loginThrottle.ts).
-- Rows older than the throttle window are pruned on each new failure, so this stays small.
CREATE TABLE login_failures (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL, -- lowercased, as typed (may not belong to a real user)
  ip         TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_login_failures_email ON login_failures (email, created_at);
CREATE INDEX idx_login_failures_ip ON login_failures (ip, created_at);
