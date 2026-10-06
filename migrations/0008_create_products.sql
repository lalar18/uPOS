-- Products, per store. SKUs (and barcodes, when set) are unique within a store.
CREATE TABLE products (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id       INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  sku            TEXT    NOT NULL COLLATE NOCASE,
  barcode        TEXT,
  -- Deleting a category or brand leaves its products uncategorised / unbranded
  category_id    INTEGER REFERENCES categories (id) ON DELETE SET NULL,
  brand_id       INTEGER REFERENCES brands (id) ON DELETE SET NULL,
  -- A unit can't be deleted while products use it (the API explains why first)
  unit_id        INTEGER NOT NULL REFERENCES units (id) ON DELETE RESTRICT,
  price_cents    INTEGER NOT NULL CHECK (price_cents >= 0), -- selling price, in centavos
  cost_cents     INTEGER CHECK (cost_cents >= 0),           -- purchase cost, in centavos
  quantity       REAL    NOT NULL DEFAULT 0,                -- stock on hand, in the product's unit
  alert_quantity REAL    NOT NULL DEFAULT 0,                -- "low stock" at or below this
  description    TEXT,
  status         TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, sku)
);

CREATE UNIQUE INDEX idx_products_store_barcode ON products (store_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_products_store_status ON products (store_id, status);
CREATE INDEX idx_products_category_id ON products (category_id);
CREATE INDEX idx_products_brand_id ON products (brand_id);
CREATE INDEX idx_products_unit_id ON products (unit_id);

-- Product images live in their own table so listing products never reads image bytes.
-- The browser resizes images before upload, so each row is a few dozen KB.
CREATE TABLE product_images (
  product_id   INTEGER PRIMARY KEY REFERENCES products (id) ON DELETE CASCADE,
  content_type TEXT    NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data         BLOB    NOT NULL,
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
