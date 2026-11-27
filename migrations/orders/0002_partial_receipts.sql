-- Orders V2 · 0002 partial receipts: how many pieces of each item have arrived from the factory.
-- RECOVERED 2026-11-27: the original file was lost with the unpushed commit 7b20b5f. Reconstructed from the
-- staging D1 schema, where this migration was applied on 2026-11-27 (d1_migrations name 0002_partial_receipts.sql).
-- The column below is the ONLY schema difference between staging and 0001_core.sql. Additive; existing rows get 0.
ALTER TABLE order_items ADD COLUMN received_qty INTEGER NOT NULL DEFAULT 0 CHECK (received_qty BETWEEN 0 AND qty);
