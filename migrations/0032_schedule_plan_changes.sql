-- Plan changes follow the periods paid for. A paid renewal that starts later (the store hadn't
-- expired yet) is "scheduled": its plan becomes the store's plan when its period starts (see
-- applyDuePlanChanges in worker/subscription.ts, run on sign-in and by the cron). A plan that
-- costs the same or more still switches as soon as it's paid, so an upgrade isn't kept waiting;
-- a cheaper one waits, so the store keeps the plan it already paid for until that runs out.
--
-- While a cheaper plan is scheduled or a renewal on one is waiting for payment, the store's caps
-- are the lowest of those plans' (USER_SEAT_FREE etc. in worker/subscription.ts), so it can't
-- grow past what it's moving to. A super admin's override (US Panel) drops any scheduled change.

ALTER TABLE subscription_renewals ADD COLUMN plan_scheduled INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_subscription_renewals_scheduled ON subscription_renewals (store_id, period_start) WHERE plan_scheduled = 1;

-- Same as before, except that the store moves to the renewal's plan when its period starts,
-- unless the plan costs at least as much as the current one
DROP TRIGGER subscription_renewals_paid;

CREATE TRIGGER subscription_renewals_paid AFTER UPDATE OF status ON subscription_renewals
WHEN NEW.status = 'paid'
BEGIN
  UPDATE subscription_renewals
  SET paid_at = datetime('now'),
      period_start = (
        SELECT MAX(COALESCE(st.plan_expires_at, datetime('now')), datetime('now'))
        FROM stores st WHERE st.id = NEW.store_id
      )
  WHERE id = NEW.id;

  UPDATE subscription_renewals
  SET period_end = datetime(period_start, '+' || months || ' months'),
      plan_scheduled = period_start > datetime('now')
  WHERE id = NEW.id;

  UPDATE stores
  SET plan_id = CASE
        WHEN (SELECT plan_scheduled FROM subscription_renewals WHERE id = NEW.id) = 0 THEN NEW.plan_id
        WHEN (SELECT monthly_price FROM plans WHERE id = NEW.plan_id) >=
             (SELECT monthly_price FROM plans WHERE id = stores.plan_id) THEN NEW.plan_id
        ELSE plan_id
      END,
      plan_expires_at = (SELECT period_end FROM subscription_renewals WHERE id = NEW.id),
      updated_at = datetime('now')
  WHERE id = NEW.store_id;
END;
