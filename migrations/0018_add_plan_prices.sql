-- Monthly price of each plan, in whole pesos (shown on the landing page's pricing section).
-- Change a price with:
--   npx wrangler d1 execute usystems_pos_db --remote --command "UPDATE plans SET monthly_price = 999 WHERE id = 'standard'"
ALTER TABLE plans ADD COLUMN monthly_price INTEGER NOT NULL DEFAULT 0 CHECK (monthly_price >= 0);

UPDATE plans SET monthly_price = 499 WHERE id = 'basic';
UPDATE plans SET monthly_price = 999 WHERE id = 'standard';
UPDATE plans SET monthly_price = 1499 WHERE id = 'premium';
