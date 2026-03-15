CREATE TABLE IF NOT EXISTS families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  qr_token TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS guest_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL,
  display_name TEXT,
  session_token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (family_id) REFERENCES families(id)
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL,
  guest_session_id INTEGER,
  original_url TEXT,
  filtered_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (family_id) REFERENCES families(id),
  FOREIGN KEY (guest_session_id) REFERENCES guest_sessions(id)
);

CREATE TABLE IF NOT EXISTS reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id INTEGER NOT NULL,
  guest_session_id INTEGER,
  reaction_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (photo_id) REFERENCES photos(id),
  FOREIGN KEY (guest_session_id) REFERENCES guest_sessions(id)
);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  moderator_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (photo_id) REFERENCES photos(id)
);

CREATE INDEX IF NOT EXISTS idx_families_qr_token ON families(qr_token);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_family_id ON guest_sessions(family_id);
CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);
