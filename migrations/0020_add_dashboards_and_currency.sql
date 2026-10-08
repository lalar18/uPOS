-- Customizable dashboards and the store's currency.

-- The dashboard widgets each user sees, in order: a JSON array of widget keys (see
-- worker/dashboard.ts). NULL shows the default set for the user's role.
ALTER TABLE users ADD COLUMN dashboard_widgets TEXT;

-- 1 when an admin has fixed the user's dashboard, so the user can't add or remove widgets
-- (and can only load the widgets the admin picked)
ALTER TABLE users ADD COLUMN dashboard_locked INTEGER NOT NULL DEFAULT 0 CHECK (dashboard_locked IN (0, 1));

-- ISO 4217 code that amounts are shown in (changed on the General Settings page). Amounts
-- are stored as whole hundredths, so only currencies with 2 decimal places are allowed
-- (the API checks the list). Changing it relabels amounts; it doesn't convert them.
ALTER TABLE stores ADD COLUMN currency TEXT NOT NULL DEFAULT 'PHP';
