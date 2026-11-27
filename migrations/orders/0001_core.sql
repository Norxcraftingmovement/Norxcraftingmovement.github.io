-- Orders V2 core schema (additive; never touches migrations/events). Baht are whole integers.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL) STRICT;
CREATE TABLE collections (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived'))) STRICT;
CREATE TABLE products (id INTEGER PRIMARY KEY, collection_id INTEGER REFERENCES collections(id), slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, short_name TEXT, fit TEXT, description TEXT, image_key TEXT, sort INTEGER NOT NULL DEFAULT 0, legacy_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived'))) STRICT;
CREATE TABLE product_variants (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
  sleeve TEXT NOT NULL CHECK (sleeve IN ('short','long')), price_baht INTEGER NOT NULL CHECK (price_baht >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), UNIQUE (product_id, sleeve)) STRICT;
CREATE TABLE product_sizes (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
  size TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), UNIQUE (product_id, size)) STRICT;
CREATE TABLE rounds (id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('fixed','rolling')),
  opens_at TEXT, closes_at TEXT, payment_due_at TEXT, shipping_baht INTEGER NOT NULL DEFAULT 0 CHECK (shipping_baht >= 0),
  deliveries TEXT NOT NULL CHECK (json_valid(deliveries)), ready_text TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','archived'))) STRICT;
CREATE TABLE round_products (round_id INTEGER NOT NULL REFERENCES rounds(id), product_id INTEGER NOT NULL REFERENCES products(id),
  PRIMARY KEY (round_id, product_id)) STRICT;
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;
CREATE TABLE orders (id INTEGER PRIMARY KEY, order_no TEXT NOT NULL UNIQUE, request_key TEXT UNIQUE, payload_hash TEXT,
  round_id INTEGER REFERENCES rounds(id), customer_id INTEGER NOT NULL REFERENCES customers(id),
  source TEXT NOT NULL CHECK (source IN ('web','facebook','google_form','manual','v1_import')),
  delivery TEXT NOT NULL CHECK (delivery IN ('city','event','ship')),
  subtotal_baht INTEGER NOT NULL CHECK (subtotal_baht >= 0), shipping_baht INTEGER NOT NULL CHECK (shipping_baht >= 0),
  total_baht INTEGER NOT NULL CHECK (total_baht = subtotal_baht + shipping_baht),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','slip_received','confirmed','refunded','cancelled')),
  fulfillment_status TEXT NOT NULL DEFAULT 'received' CHECK (fulfillment_status IN ('received','in_production','qc','ready_pickup','ready_ship','shipped','cancelled')),
  payment_due_at TEXT, paid_amount_baht INTEGER NOT NULL DEFAULT 0, paid_at TEXT, note TEXT, tracking_token_hash TEXT UNIQUE,
  is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0,1)), legacy_ref TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;
CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id), sleeve TEXT NOT NULL CHECK (sleeve IN ('short','long')), size TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 99), unit_price_baht INTEGER NOT NULL CHECK (unit_price_baht >= 0),
  line_total_baht INTEGER NOT NULL CHECK (line_total_baht = qty * unit_price_baht),
  production_status TEXT NOT NULL DEFAULT 'pending' CHECK (production_status IN ('pending','batched','produced','received'))) STRICT;
CREATE TABLE shipping_addresses (order_id INTEGER PRIMARY KEY REFERENCES orders(id), recipient TEXT NOT NULL, phone TEXT NOT NULL,
  address TEXT NOT NULL, postal_code TEXT, edited_at TEXT) STRICT;
CREATE TABLE shipments (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), provider TEXT, tracking_no TEXT, shipped_at TEXT,
  label_printed_count INTEGER NOT NULL DEFAULT 0, last_label_at TEXT) STRICT;
CREATE TABLE payments (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), amount_baht INTEGER NOT NULL CHECK (amount_baht > 0),
  method TEXT, reference TEXT, slip_key TEXT, status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','confirmed','void')),
  recorded_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;
CREATE TABLE order_status_history (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
  kind TEXT NOT NULL CHECK (kind IN ('payment','fulfillment')), from_status TEXT, to_status TEXT NOT NULL, actor TEXT,
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, note TEXT) STRICT;
CREATE TABLE audit_log (id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, actor_hash TEXT, action TEXT NOT NULL,
  entity TEXT NOT NULL, entity_id TEXT, before TEXT CHECK (before IS NULL OR json_valid(before)), after TEXT CHECK (after IS NULL OR json_valid(after))) STRICT;
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK (json_valid(value))) STRICT;
CREATE INDEX idx_orders_status ON orders(payment_status, fulfillment_status);
CREATE INDEX idx_orders_round ON orders(round_id);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_items_order ON order_items(order_id);
CREATE INDEX idx_items_prod ON order_items(product_id, sleeve, size);
CREATE INDEX idx_shipments_order ON shipments(order_id);
