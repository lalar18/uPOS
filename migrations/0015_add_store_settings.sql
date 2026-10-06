-- General settings, one set per store (edited on the General Settings page).
-- The defaults match how the app behaved before these settings existed.

-- Tax rate filled in on new POS sales, sales and quotations (1200 = 12%). Each document can still change it.
ALTER TABLE stores ADD COLUMN default_tax_rate_bp INTEGER NOT NULL DEFAULT 0
  CHECK (default_tax_rate_bp BETWEEN 0 AND 10000);

-- Days a new quotation stays valid; 0 leaves "valid until" blank
ALTER TABLE stores ADD COLUMN quotation_valid_days INTEGER NOT NULL DEFAULT 15
  CHECK (quotation_valid_days BETWEEN 0 AND 365);

-- Message printed at the bottom of receipts; '' prints none
ALTER TABLE stores ADD COLUMN receipt_footer TEXT NOT NULL DEFAULT 'Thank you for your purchase!';
