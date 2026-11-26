# Media Manager MVP — MOVE KIDS
Status: R2 Standard subscription and Zero Trust Free activated after owner approval; both base fees $0/month, usage beyond allowance may incur charges. Private bucket norx-event-media created (public access disabled). Access app NORX Media Manager configured for /admin/media and /admin/media/* only; Allow policy contains exactly the NORX owner email. Feature branch prepared for deployment, demo remains read-only.
## Scope
- Admin /admin/media/; upload PUT /admin/media/poster. Fixed event key only; JPG/PNG/WebP, 4 MiB maximum, signature check; uncropped preview, explicit replace.
- Public GET/HEAD /media/events/move-kids-2026/poster; private R2 storage; no public writes/listing; no-store. Event page hides figure if missing.
- Access JWT requires exact issuer, audience, valid RS256 signature, expiry, SHA-256 of normalized administrator email. No raw email in repository. Fail closed; same-origin mutation.
- Production config binds MEDIA_BUCKET; preview intentionally has no R2 binding and cannot upload. Existing shop and registration flags unchanged.
## Verification
Unit tests simulate R2 and signed JWTs. Production must verify public homepage, registration stays closed, no-poster path, Access login, and authorized upload with owner-approved image. Do not claim a successful real upload until it has occurred.
