CREATE INDEX IF NOT EXISTS idx_photos_family_status_created
ON photos(family_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reactions_photo_session
ON reactions(photo_id, guest_session_id);

CREATE INDEX IF NOT EXISTS idx_photo_comments_photo_created
ON photo_comments(photo_id, created_at);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_expires_at
ON guest_sessions(expires_at);
