CREATE TABLE move_kids_registrations (
  request_key TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
