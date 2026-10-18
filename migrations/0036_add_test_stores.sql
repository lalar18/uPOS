-- Test stores, tagged by a super admin (US Panel) only. A test store's online payments, renewals
-- and withdrawals go through PayMongo's test mode (PAYMONGO_TEST_SECRET_KEY, see worker/paymongo.ts),
-- and its income is left out of the US Panel dashboard and income pages.
ALTER TABLE stores ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1));
