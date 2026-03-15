CREATE TABLE IF NOT EXISTS photo_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id INTEGER NOT NULL,
  guest_session_id INTEGER,
  display_name TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (photo_id) REFERENCES photos(id),
  FOREIGN KEY (guest_session_id) REFERENCES guest_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_photo_comments_photo_id ON photo_comments(photo_id);
