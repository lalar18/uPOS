-- Profile pictures. The browser crops and resizes them before upload,
-- so each row holds one small image (a few dozen KB, never more than 2 MB).
CREATE TABLE user_avatars (
  user_id      INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  content_type TEXT    NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data         BLOB    NOT NULL,
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
