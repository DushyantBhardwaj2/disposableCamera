INSERT INTO families (name, slug, qr_token, is_active)
VALUES
  ('Balodhi Family', 'balodhi', 'BALODHI-QR-2026', 1),
  ('Sharma Family', 'sharma', 'SHARMA-QR-2026', 1),
  ('Friends Gang', 'friends', 'FRIENDS-QR-2026', 1)
ON CONFLICT(qr_token) DO NOTHING;
