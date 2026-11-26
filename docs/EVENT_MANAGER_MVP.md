# Event Manager MVP
Purpose: owner-only MOVE KIDS operational dashboard; registration remains closed, poster not required. No new event publication or new signup form schema in this phase.
- /admin/events/ and private roster, CSV, check-in routes require the same signed Access JWT as Media Manager; exact production host, owner only. Extend existing Access application to /admin/events and /admin/events/* before production deployment. Preview uses fixed synthetic in-memory data only; no access to D1 or CSV.
- Roster shows count, checked-in count, read-only signup state, search (POST so contact searches are not URL query parameters), pagination, emergency contact and media opt-out. Content is inserted as text, not HTML. CSV formula-injection protection; no-store; owner should download only for event operations.
- Check-in explicitly confirmed; idempotent; undo only changes check-in state; no changes to registration rows.
- Additive migration 0003 creates a separate check-in table. Apply exact SQL in D1 Studio once (initial migrations were manually applied); never rerun or modify existing registration tables. Verify production schema and 0 synthetic writes before deployment.
- Unit tests use synthetic participants in real in-memory SQLite via D1 adapter. Live check-in must not be tested with fabricated participant entries in production.
- Existing JWT transport issue: temporary public-key fallback expires 2026-11-28T18:30:00Z, fail closed if live retrieval is still unavailable. Resolve before expiry. Do not disable verification.
