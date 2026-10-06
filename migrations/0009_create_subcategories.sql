-- Sub categories sit under a category ("Beverages" > "Soft Drinks"). Names are unique within their category.
CREATE TABLE subcategories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id    INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  -- Deleting a category deletes its sub categories too
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  name        TEXT    NOT NULL COLLATE NOCASE,
  description TEXT,
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (category_id, name)
);

CREATE INDEX idx_subcategories_store_status ON subcategories (store_id, status);

-- Deleting a sub category leaves its products in the parent category only
ALTER TABLE products ADD COLUMN subcategory_id INTEGER REFERENCES subcategories (id) ON DELETE SET NULL;
CREATE INDEX idx_products_subcategory_id ON products (subcategory_id);
