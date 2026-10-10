-- Renewals paid online through PayMongo before the webhook knew every method or kept the service
-- charge, so Income (US Panel) shows where their money came from:
--   - payment_method was saved as 'other' for methods it didn't know yet (QR Ph); the note names it
--   - the renewal service charge (paid on top of the plan price) was saved as 0, so it counted as
--     subscription income; it's what was paid over the plan price for the months bought
UPDATE subscription_renewals
SET payment_method = CASE note
    WHEN 'Paid online through PayMongo (QR Ph)' THEN 'qrph'
    WHEN 'Paid online through PayMongo (GCash)' THEN 'gcash'
    WHEN 'Paid online through PayMongo (Maya)' THEN 'maya'
    WHEN 'Paid online through PayMongo (card)' THEN 'card'
  END
WHERE status = 'paid' AND payment_method = 'other' AND confirmed_by IS NULL
  AND note IN ('Paid online through PayMongo (QR Ph)', 'Paid online through PayMongo (GCash)',
               'Paid online through PayMongo (Maya)', 'Paid online through PayMongo (card)');

UPDATE subscription_renewals
SET service_charge_cents = (amount - months * (SELECT monthly_price FROM plans WHERE id = plan_id)) * 100
WHERE status = 'paid' AND service_charge_cents = 0 AND confirmed_by IS NULL AND paid_at < '2026-10-11'
  AND note LIKE 'Paid online through PayMongo%'
  AND amount > months * (SELECT monthly_price FROM plans WHERE id = plan_id);
