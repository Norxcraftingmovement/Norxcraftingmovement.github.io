-- Event name per round: shown to customers as "รับที่งาน <name>" when the round offers pickup at an event.
-- '' = not set: the storefront falls back to the shop-wide setting (settings.storefront.eventName), so rounds imported from V1 behave as before.
-- ADD COLUMN is not idempotent: apply once, through `wrangler d1 migrations apply` (it records the migration).
ALTER TABLE rounds ADD COLUMN event_name TEXT NOT NULL DEFAULT '' CHECK (length(event_name) <= 120);
