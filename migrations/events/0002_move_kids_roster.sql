-- Read-only roster for authorized D1 dashboard users. Never expose via a public API.
CREATE VIEW IF NOT EXISTS move_kids_roster AS
SELECT
  reference,
  created_at,
  json_extract(payload, '$.fullName') AS full_name,
  json_extract(payload, '$.nickname') AS nickname,
  json_extract(payload, '$.age') AS age,
  json_extract(payload, '$.phone') AS phone,
  json_extract(payload, '$.emergencyName') AS emergency_name,
  json_extract(payload, '$.emergencyPhone') AS emergency_phone,
  json_extract(payload, '$.emergencyRelationship') AS emergency_relationship,
  json_extract(payload, '$.experience') AS experience,
  json_extract(payload, '$.mediaConsent') AS media_consent
FROM move_kids_registrations;
