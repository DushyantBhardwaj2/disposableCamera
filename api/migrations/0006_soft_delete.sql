ALTER TABLE photos ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_photos_is_deleted
ON photos(is_deleted);
