-- The service charge rate set when an online sale payment was opened, so the payment dialog can
-- show how its service charge was worked out (see worker/saleCheckouts.ts). Checkouts opened
-- before this have none (NULL).
ALTER TABLE sale_checkouts ADD COLUMN service_charge_kind TEXT CHECK (service_charge_kind IN ('fixed', 'percent'));
ALTER TABLE sale_checkouts ADD COLUMN service_charge_value INTEGER CHECK (service_charge_value >= 0); -- fixed: centavos; percent: basis points
