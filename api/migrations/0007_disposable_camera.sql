-- Add disposable camera fields to families
ALTER TABLE families ADD COLUMN event_date TEXT;
ALTER TABLE families ADD COLUMN photo_limit_per_guest INTEGER DEFAULT 25;
ALTER TABLE families ADD COLUMN event_active INTEGER DEFAULT 1;

-- Add shot tracking to guest_sessions
ALTER TABLE guest_sessions ADD COLUMN shots_remaining INTEGER;
ALTER TABLE guest_sessions ADD COLUMN total_shots_taken INTEGER DEFAULT 0;

-- Update existing families with defaults
UPDATE families SET
  event_date = '2026-12-12',
  photo_limit_per_guest = COALESCE(photo_limit_per_guest, 25),
  event_active = 1
WHERE event_date IS NULL;

-- Create index for event queries
CREATE INDEX IF NOT EXISTS idx_families_event_active ON families(event_active);