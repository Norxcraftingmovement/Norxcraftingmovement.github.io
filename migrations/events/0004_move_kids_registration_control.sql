-- Owner controls registration from the dashboard; default is closed.
CREATE TABLE IF NOT EXISTS event_registration_control (
  slug TEXT PRIMARY KEY,
  registration_open INTEGER NOT NULL DEFAULT 0 CHECK (registration_open IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
INSERT INTO event_registration_control (slug, registration_open)
VALUES ('move-kids-2026', 0) ON CONFLICT(slug) DO NOTHING;
