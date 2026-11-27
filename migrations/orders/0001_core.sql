-- Orders V2 core schema. Not yet applied to any D1 database (frozen after first apply). Baht = whole integers.
-- Time columns hold ISO-8601 UTC strings with milliseconds ("YYYY-MM-DDTHH:MM:SS.sssZ") so string comparison == time comparison.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE collections (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived'))) STRICT;
-- slug is the public product id used by the storefront cart ("drop02", "drop03").
CREATE TABLE products (id INTEGER PRIMARY KEY, collection_id INTEGER REFERENCES collections(id), slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, short_name TEXT, fit TEXT NOT NULL, fit_name TEXT NOT NULL, description TEXT, image_key TEXT, sort INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived'))) STRICT;
CREATE TABLE product_variants (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
  sleeve TEXT NOT NULL CHECK (sleeve IN ('short','long')), price_baht INTEGER NOT NULL CHECK (price_baht >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), UNIQUE (product_id, sleeve)) STRICT;
CREATE TABLE product_sizes (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
  size TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), UNIQUE (product_id, size)) STRICT;
-- code = V1 round id ("ROUND-003"); the storefront sends it as roundId. successor_of UNIQUE makes weekly rolling
-- round creation race-safe (INSERT OR IGNORE). V1 round states: draft, open, closed, sent.
CREATE TABLE rounds (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  opens_at TEXT NOT NULL CHECK (opens_at GLOB '????-??-??T??:??:??.???Z'), closes_at TEXT NOT NULL CHECK (closes_at GLOB '????-??-??T??:??:??.???Z'), payment_due_at TEXT NOT NULL CHECK (payment_due_at GLOB '????-??-??T??:??:??.???Z'),
  shipping_baht INTEGER NOT NULL DEFAULT 0 CHECK (shipping_baht >= 0), supplier_shipping_baht INTEGER NOT NULL DEFAULT 0 CHECK (supplier_shipping_baht >= 0),
  deliveries TEXT NOT NULL CHECK (json_valid(deliveries)), ready_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','sent')), sent_at TEXT,
  successor_of INTEGER UNIQUE REFERENCES rounds(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) STRICT;
-- Payment and fulfillment are separate axes. V1's single status maps onto both (see src/orders-core.mjs LEGACY).
-- 'deferred_on_site' = จ่ายหน้างาน: NOT paid; counted for production, excluded from received revenue.
CREATE TABLE orders (id INTEGER PRIMARY KEY, order_no TEXT NOT NULL UNIQUE, request_key TEXT UNIQUE, fingerprint TEXT,
  round_id INTEGER NOT NULL REFERENCES rounds(id), customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('web','facebook','google_form','manual','v1_import')),
  delivery TEXT NOT NULL CHECK (delivery IN ('city','event','ship')),
  subtotal_baht INTEGER NOT NULL CHECK (subtotal_baht >= 0), shipping_baht INTEGER NOT NULL CHECK (shipping_baht >= 0),
  total_baht INTEGER NOT NULL CHECK (total_baht = subtotal_baht + shipping_baht),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','deferred_on_site','slip_received','confirmed','refunded','cancelled')),
  fulfillment_status TEXT NOT NULL DEFAULT 'received' CHECK (fulfillment_status IN ('received','in_production','qc','ready_pickup','ready_ship','shipped','completed','cancelled')),
  payment_due_at TEXT, paid_at TEXT, received_at TEXT, note TEXT NOT NULL DEFAULT '', round_snapshot TEXT CHECK (round_snapshot IS NULL OR json_valid(round_snapshot)),
  tracking_token_hash TEXT UNIQUE, is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0,1)), legacy_ref TEXT UNIQUE,
  status_updated_at TEXT, status_updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) STRICT;
-- Snapshot columns keep the name/fit/price shown at order time (V1 behaviour), unaffected by later catalog edits.
CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id),
  sleeve TEXT NOT NULL CHECK (sleeve IN ('short','long')), size TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 99), unit_price_baht INTEGER NOT NULL CHECK (unit_price_baht >= 1),
  line_total_baht INTEGER NOT NULL CHECK (line_total_baht = qty * unit_price_baht),
  product_name TEXT NOT NULL, fit TEXT NOT NULL, fit_name TEXT NOT NULL,
  production_status TEXT NOT NULL DEFAULT 'pending' CHECK (production_status IN ('pending','batched','produced','received')),
  UNIQUE (order_id, product_id, sleeve, size)) STRICT;
CREATE TABLE shipping_addresses (order_id INTEGER PRIMARY KEY REFERENCES orders(id), recipient TEXT NOT NULL, phone TEXT NOT NULL,
  address TEXT NOT NULL, postal_code TEXT, edited_at TEXT) STRICT;
CREATE TABLE shipments (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), provider TEXT, tracking_no TEXT, shipped_at TEXT,
  label_printed_count INTEGER NOT NULL DEFAULT 0, last_label_at TEXT) STRICT;
CREATE TABLE payments (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), amount_baht INTEGER NOT NULL CHECK (amount_baht > 0),
  method TEXT, reference TEXT, slip_key TEXT, status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','confirmed','void')),
  recorded_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) STRICT;
CREATE TABLE order_status_history (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
  kind TEXT NOT NULL CHECK (kind IN ('payment','fulfillment','legacy')), from_status TEXT, to_status TEXT NOT NULL, actor TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), note TEXT) STRICT;
CREATE TABLE audit_log (id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), actor_hash TEXT, action TEXT NOT NULL,
  entity TEXT NOT NULL, entity_id TEXT, before TEXT CHECK (before IS NULL OR json_valid(before)), after TEXT CHECK (after IS NULL OR json_valid(after))) STRICT;
-- Owner-editable configuration (sender, storefront info incl. bank account, notification recipient). Never in the repo.
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK (json_valid(value))) STRICT;
-- Notification outbox: written in the SAME atomic batch as the order, delivered later with retry/backoff.
CREATE TABLE notification_queue (id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id), channel TEXT NOT NULL, template TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','dead')),
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5, next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  locked_at TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), sent_at TEXT,
  UNIQUE (order_id, channel, template)) STRICT;
CREATE INDEX idx_notif_due ON notification_queue(status, next_attempt_at);
CREATE TABLE notification_failures (id INTEGER PRIMARY KEY, queue_id INTEGER NOT NULL REFERENCES notification_queue(id), at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  attempt INTEGER NOT NULL, error TEXT NOT NULL) STRICT;
-- Order creation and notification delivery are measured separately.
CREATE TABLE latency_log (id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('order_creation','notification')), ref TEXT,
  ms INTEGER NOT NULL CHECK (ms >= 0), at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) STRICT;
CREATE INDEX idx_latency_kind ON latency_log(kind, at);
CREATE INDEX idx_orders_status ON orders(payment_status, fulfillment_status);
CREATE INDEX idx_orders_round ON orders(round_id);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_orders_updated ON orders(updated_at);
CREATE INDEX idx_items_order ON order_items(order_id);
CREATE INDEX idx_items_prod ON order_items(product_id, sleeve, size);
CREATE UNIQUE INDEX uq_shipments_order ON shipments(order_id);
