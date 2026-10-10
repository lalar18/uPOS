// PayMongo's webhook: records a paid checkout session against what it was opened for, a
// subscription renewal (subscription.ts) or a sale (saleCheckouts.ts).
//
//   POST /api/webhooks/paymongo   (PayMongo only; signed with the webhook's secret)
//
// The webhook is created in the PayMongo dashboard (Developers > Webhooks) for the
// checkout_session.payment.paid event, pointing at https://<your domain>/api/webhooks/paymongo.

import {
  METHOD_LABELS,
  METHOD_NAMES,
  paidCheckout,
  verifySignature,
  type CheckoutSession,
  type PaidCheckout,
  type PaymongoEnv,
} from './paymongo'
import { recordSaleCheckout } from './saleCheckouts'

interface CheckoutSessionEvent {
  data?: { attributes?: { type?: string; livemode?: boolean; data?: CheckoutSession } }
}

/** POST /api/webhooks/paymongo */
export async function handlePaymongoWebhook(db: D1Database, env: PaymongoEnv, request: Request): Promise<Response> {
  if (!env.PAYMONGO_WEBHOOK_SECRET) return Response.json({ error: 'Webhook not configured' }, { status: 503 })

  const rawBody = await request.text()
  let event: CheckoutSessionEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400 })
  }
  const attributes = event.data?.attributes
  const valid = await verifySignature(
    env.PAYMONGO_WEBHOOK_SECRET,
    request.headers.get('Paymongo-Signature') ?? '',
    rawBody,
    attributes?.livemode === true,
  )
  if (!valid) return Response.json({ error: 'Invalid signature' }, { status: 401 })

  // Other events are acknowledged and ignored (the webhook only needs this one)
  const session = attributes?.data
  if (attributes?.type !== 'checkout_session.payment.paid' || !session) return Response.json({ ok: true })

  const paid = paidCheckout(session)
  if (!paid) {
    console.error('PayMongo: paid checkout session without a payment', session.id)
    return Response.json({ ok: true })
  }

  if (session.attributes.metadata?.kind === 'sale') {
    await recordSaleCheckout(db, session.id, paid)
    return Response.json({ ok: true })
  }
  return recordRenewalPayment(db, session, paid)
}

/** Marks the renewal a checkout session was opened for paid. */
async function recordRenewalPayment(db: D1Database, session: CheckoutSession, paid: PaidCheckout): Promise<Response> {
  const renewalId = Number(session.attributes.metadata?.renewal_id)
  if (!Number.isSafeInteger(renewalId)) {
    console.error('PayMongo: paid checkout session without a renewal', session.id)
    return Response.json({ ok: true })
  }

  const serviceCharge = Number(session.attributes.metadata?.service_charge_cents)
  const values = [
    Math.round(paid.cents / 100),
    METHOD_NAMES[paid.method] ?? 'other',
    paid.paymentId,
    `Paid online through PayMongo${METHOD_LABELS[paid.method] ? ` (${METHOD_LABELS[paid.method]})` : ''}`,
    session.id,
    Number.isSafeInteger(serviceCharge) && serviceCharge > 0 ? Math.min(serviceCharge, paid.cents) : 0,
    paid.processingFeeCents,
  ]
  const markPaid = (id: number) =>
    db
      .prepare(
        `UPDATE subscription_renewals
         SET amount = ?, payment_method = ?, payment_reference = ?, note = ?, checkout_session_id = ?,
           service_charge_cents = ?, processing_fee_cents = ?, status = 'paid'
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(...values, id)
      .run()

  if ((await markPaid(renewalId)).meta.changes) return Response.json({ ok: true })

  // Not pending any more: either this event was already recorded (PayMongo retries), or the
  // renewal was cancelled after it was paid. The store paid either way, so record it once.
  const existing = await db
    .prepare('SELECT store_id, plan_id, payment_reference FROM subscription_renewals WHERE id = ?')
    .bind(renewalId)
    .first<{ store_id: number; plan_id: string; payment_reference: string | null }>()
  const recorded = await db
    .prepare('SELECT 1 FROM subscription_renewals WHERE payment_reference = ?')
    .bind(paid.paymentId)
    .first()
  if (!existing || recorded) return Response.json({ ok: true })

  // Goes through 'pending' so the same trigger extends the store
  const row = await db
    .prepare(
      `INSERT INTO subscription_renewals (store_id, plan_id) VALUES (?, ?)
       ON CONFLICT DO NOTHING RETURNING id`,
    )
    .bind(existing.store_id, existing.plan_id)
    .first<{ id: number }>()
  if (!row) {
    // Another renewal is pending. Failing makes PayMongo retry (and flags it in its dashboard),
    // so a super admin can settle the pending one and the payment still gets recorded.
    console.error('PayMongo: payment for a cancelled renewal while another is pending', renewalId, paid.paymentId)
    return Response.json({ error: 'Store has another pending renewal' }, { status: 409 })
  }
  await markPaid(row.id)
  return Response.json({ ok: true })
}
