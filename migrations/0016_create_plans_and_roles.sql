-- Subscription plans and roles.

-- Subscription plans. Every store (client) is on one plan, which caps how many users
-- (counting inactive ones) and products it can have. Stores already over a cap keep
-- what they have but can't add more. Change a store's plan with:
--   npx wrangler d1 execute usystems_pos_db --remote --command "UPDATE stores SET plan_id = 'standard' WHERE id = 1"
CREATE TABLE plans (
  id           TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL,
  max_users    INTEGER NOT NULL CHECK (max_users >= 1),
  max_admins   INTEGER CHECK (max_admins >= 1), -- NULL: any of the users may be admins
  max_products INTEGER NOT NULL CHECK (max_products >= 0),
  sort_order   INTEGER NOT NULL
);

INSERT INTO plans (id, name, max_users, max_admins, max_products, sort_order) VALUES
  ('basic',    'Basic',    1, 1,    500,  1),
  ('standard', 'Standard', 3, 1,    1000, 2),
  ('premium',  'Premium',  5, NULL, 2000, 3);

-- SQLite can't add a foreign key column with a non-NULL default, so triggers check it instead
ALTER TABLE stores ADD COLUMN plan_id TEXT NOT NULL DEFAULT 'basic';

CREATE TRIGGER stores_check_plan_on_insert BEFORE INSERT ON stores
WHEN NOT EXISTS (SELECT 1 FROM plans WHERE id = NEW.plan_id)
BEGIN
  SELECT RAISE(ABORT, 'stores.plan_id must be a plan');
END;

CREATE TRIGGER stores_check_plan_on_update BEFORE UPDATE OF plan_id ON stores
WHEN NOT EXISTS (SELECT 1 FROM plans WHERE id = NEW.plan_id)
BEGIN
  SELECT RAISE(ABORT, 'stores.plan_id must be a plan');
END;

-- Roles, per store. Each store has one built-in Admin role, which has every permission
-- (including managing users and roles) and can't be changed or deleted. Other roles hold
-- the permissions listed in worker/permissions.ts.
CREATE TABLE roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id    INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  name        TEXT    NOT NULL COLLATE NOCASE,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  permissions TEXT    NOT NULL DEFAULT '[]', -- JSON array of permission keys; ignored for the Admin role
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, name)
);

CREATE UNIQUE INDEX idx_roles_one_admin_per_store ON roles (store_id) WHERE is_admin = 1;

-- The Cashier role can do what cashiers could do before roles existed
INSERT INTO roles (store_id, name, is_admin) SELECT id, 'Admin', 1 FROM stores;
INSERT INTO roles (store_id, name, permissions) SELECT id, 'Cashier', '["sales.create","quotations.manage"]' FROM stores;

CREATE TRIGGER stores_create_roles AFTER INSERT ON stores
BEGIN
  INSERT INTO roles (store_id, name, is_admin) VALUES (NEW.id, 'Admin', 1);
  INSERT INTO roles (store_id, name, permissions) VALUES (NEW.id, 'Cashier', '["sales.create","quotations.manage"]');
END;

-- Users move from the fixed admin/cashier column to a role of their store.
-- Deleting a role that users still have fails (the API checks first and says so).
ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES roles (id);

UPDATE users SET role_id = (
  SELECT r.id FROM roles r WHERE r.store_id = users.store_id AND r.is_admin = (users.role = 'admin')
);

ALTER TABLE users DROP COLUMN role;
CREATE INDEX idx_users_role_id ON users (role_id);

CREATE TRIGGER users_check_role_on_insert BEFORE INSERT ON users
WHEN NOT EXISTS (SELECT 1 FROM roles WHERE id = NEW.role_id AND store_id = NEW.store_id)
BEGIN
  SELECT RAISE(ABORT, 'users.role_id must be a role of the user''s store');
END;

CREATE TRIGGER users_check_role_on_update BEFORE UPDATE OF role_id, store_id ON users
WHEN NOT EXISTS (SELECT 1 FROM roles WHERE id = NEW.role_id AND store_id = NEW.store_id)
BEGIN
  SELECT RAISE(ABORT, 'users.role_id must be a role of the user''s store');
END;
