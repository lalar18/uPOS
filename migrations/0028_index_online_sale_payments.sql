-- Income (US Panel) counts only the service charges on sale payments made online through PayMongo
-- (those with a checkout), since a charge on a payment the store recorded by hand was collected by
-- the store, not the platform. Index those payments by time instead (see worker/usPanel/income.ts).
DROP INDEX IF EXISTS idx_sale_payments_service_charge;
CREATE INDEX idx_sale_payments_online ON sale_payments (created_at) WHERE checkout_id IS NOT NULL;
