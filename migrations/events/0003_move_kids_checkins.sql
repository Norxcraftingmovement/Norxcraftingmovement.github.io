-- Additive only; existing registration payloads are untouched.
CREATE TABLE IF NOT EXISTS move_kids_checkins (
  reference TEXT PRIMARY KEY REFERENCES move_kids_registrations(reference),
  checked_in_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
