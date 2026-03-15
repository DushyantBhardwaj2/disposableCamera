CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app_settings (key, value)
VALUES ('upload_enabled', '1')
ON CONFLICT(key) DO NOTHING;
