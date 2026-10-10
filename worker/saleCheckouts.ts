// Online payment of sales through PayMongo (see migration 0024). The cashier picks card, GCash or
// Maya; a checkout session is opened for that one method, with the service charge set in the US
// Panel (serviceCharges.ts) as a line item of its own, and the customer pays on PayMongo's page
// (scanning its QR code with their phone, or on the store's device). PayMongo's webhook, or the
// status check the payment dialog keeps making, then records the payment on the sale.
//
// The money goes to the platform's PayMongo account: the platform keeps the service charge (less
// PayMongo's fee) and owes the store the sale amount (see usPanel/payouts.ts).
//
//   POST   /api/sales/:id/checkouts       { method, amountCents } -> checkout (201)
//   GET    /api/sales/:id/checkouts/:cid  -> checkout   (checks PayMongo while it's pending)
//   DELETE /api/sales/:id/checkouts/:cid  -> checkout   (cancels it, unless it was just paid)
//
// A new sale can open its checkout as it's saved (sales.ts, `onlinePayment`).

import { cleanText, error, isCents } from './documents'
import {
  createCheckoutSession,
  expireCheckoutSession,
  METHOD_LABELS,
  onlinePaymentEnabled,
  paidCheckout,
  retrieveCheckoutSession,
  type PaidCheckout,
  type PaymongoEnv,
} from './paymongo'
import { getServiceCharge, saleChargeCents } from './serviceCharges'
import type { SessionUser } from './session'

/** Methods a sale can be paid online with, by PayMongo's name for each */
export const CHECKOUT_METHODS = { card: 'card', gcash: 'gcash', maya: 'paymaya' } as const
export type CheckoutMethod = keyof typeof CHECKOUT_METHODS

/** PayMongo's smallest payment, in centavos (₱20) */
export const MIN_CHECKOUT_CENTS = 2000

/** Online payment needs PayMongo's keys, and a store selling in pesos (PayMongo takes PHP only) */
export const checkoutAvailable = (env: PaymongoEnv, user: SessionUser) =>
  onlinePaymentEnabled(env) && user.store_currency === 'PHP'

export const isCheckoutMethod = (method: unknown): method is CheckoutMethod =>
  typeof method === 'string' && Object.hasOwn(CHECKOUT_METHODS, method)

interface CheckoutRow {
  id: number
  sale_id: number
  method: CheckoutMethod
  amount_cents: number
  service_charge_cents: number
  checkout_session_id: string
  checkout_url: string
  status: 'pending' | 'paid' | 'cancelled' | 'refund_due'
  created_at: string
  paid_at: string | null
}

export const CHECKOUT_COLUMNS = `id, sale_id, method, amount_cents, service_charge_cents, checkout_session_id,
  checkout_url, status, created_at, paid_at`

export function publicCheckout(row: CheckoutRow) {
  return {
    id: row.id,
    saleId: row.sale_id,
    method: row.method,
    amountCents: row.amount_cents, // towards the sale
    serviceChargeCents: row.service_charge_cents,
    totalCents: row.amount_cents + row.service_charge_cents, // what the customer pays
    status: row.status,
    checkoutUrl: row.status === 'pending' ? row.checkout_url : null,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  }
}

export type PublicCheckout = ReturnType<typeof publicCheckout>

/** Validates { method, amountCents }; returns it or an error message. */
export function readOnlinePayment(value: unknown): { method: CheckoutMethod; amountCents: number } | string {
  const body = value as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return 'Invalid online payment'
  if (!isCheckoutMethod(body.method)) return 'Online payment is by card, GCash or Maya'
  if (!isCents(body.amountCents) || body.amountCents <= 0) return 'Payment amount must be more than zero'
  return { method: body.method, amountCents: body.amountCents }
}

const getCheckout = (db: D1Database, storeId: number, saleId: number, id: number) =>
  db
    .prepare(`SELECT ${CHECKOUT_COLUMNS} FROM sale_checkouts WHERE id = ? AND sale_id = ? AND store_id = ?`)
    .bind(id, saleId, storeId)
    .first<CheckoutRow>()

/**
 * Opens a checkout session for `amountCents` of a sale's balance, replacing any checkout still
 * waiting for it. Returns the checkout, or an error response.
 */
export async function openSaleCheckout(
  db: D1Database,
  env: PaymongoEnv,
  user: SessionUser,
  saleId: number,
  input: { method: CheckoutMethod; amountCents: number },
  origin: string,
): Promise<PublicCheckout | Response> {
  if (!checkoutAvailable(env, user)) {
    return error(
      user.store_currency === 'PHP' ? 'Online payment is not available' : 'Online payment is only for stores selling in pesos (PHP)',
      400,
    )
  }
  const storeId = user.store_id
  const sale = await db
    .prepare(
      `SELECT s.id, s.total_cents - s.returned_cents - s.paid_cents AS due_cents, st.name AS store_name
       FROM sales s JOIN stores st ON st.id = s.store_id WHERE s.id = ? AND s.store_id = ?`,
    )
    .bind(saleId, storeId)
    .first<{ id: number; due_cents: number; store_name: string }>()
  if (!sale) return error('Sale not found', 404)
  if (sale.due_cents <= 0) return error('This invoice is already fully paid', 409)
  if (input.amountCents > sale.due_cents) return error('The payment is more than the balance due', 400)

  const chargeCents = saleChargeCents(await getServiceCharge(db, 'sale'), input.method, input.amountCents)
  if (input.amountCents + chargeCents < MIN_CHECKOUT_CENTS) {
    return error(`Online payments must be at least ₱${(MIN_CHECKOUT_CENTS / 100).toFixed(2)}`, 400)
  }

  // Only one checkout can wait for a sale, so it isn't paid online twice
  const waiting = await db
    .prepare(`SELECT ${CHECKOUT_COLUMNS} FROM sale_checkouts WHERE sale_id = ? AND status = 'pending'`)
    .bind(saleId)
    .first<CheckoutRow>()
  if (waiting) {
    const result = await cancelCheckout(db, env, waiting)
    if (result.status === 'paid') return error('The customer just paid online. Refresh to see the payment.', 409)
  }

  const reference = `INV-${String(saleId).padStart(5, '0')}`
  const back = `${origin}/payment-complete?status=`
  let session: { id: string; url: string }
  try {
    session = await createCheckoutSession(env, {
      lineItems: [
        { name: `${reference} · ${cleanText(sale.store_name)}`, cents: input.amountCents },
        { name: 'Service charge', cents: chargeCents },
      ],
      paymentMethodTypes: [CHECKOUT_METHODS[input.method]],
      description: `Payment to ${cleanText(sale.store_name)} for ${reference}`,
      referenceNumber: reference,
      metadata: { kind: 'sale', sale_id: String(saleId) },
      successUrl: `${back}success`,
      cancelUrl: `${back}cancelled`,
    })
  } catch (err) {
    console.error(err)
    return error('Could not open the online payment. Please try again in a moment.', 502)
  }

  const row = await db
    .prepare(
      `INSERT INTO sale_checkouts (store_id, sale_id, method, amount_cents, service_charge_cents,
         checkout_session_id, checkout_url, user_id, user_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING RETURNING ${CHECKOUT_COLUMNS}`,
    )
    .bind(storeId, saleId, input.method, input.amountCents, chargeCents, session.id, session.url, user.id, user.full_name)
    .first<CheckoutRow>()
  if (!row) {
    // Another till opened one for this sale at the same moment
    await expireCheckoutSession(env, session.id)
    return error('An online payment is already waiting for this sale. Refresh and try again.', 409)
  }
  return publicCheckout(row)
}

/**
 * Records a paid checkout session on its sale. Safe to repeat (PayMongo retries its webhook, and
 * the payment dialog checks too). If the sale was settled another way in the meantime, the
 * checkout is marked 'refund_due' instead, as the customer paid twice.
 */
export async function recordSaleCheckout(db: D1Database, sessionId: string, paid: PaidCheckout): Promise<void> {
  const row = await db
    .prepare(`SELECT ${CHECKOUT_COLUMNS} FROM sale_checkouts WHERE checkout_session_id = ?`)
    .bind(sessionId)
    .first<CheckoutRow>()
  if (!row) {
    console.error('PayMongo: paid checkout session for an unknown sale checkout', sessionId)
    return
  }
  if (row.status === 'paid' || row.status === 'refund_due') return
  if (paid.cents < row.amount_cents + row.service_charge_cents) {
    console.warn('PayMongo: checkout paid less than expected', sessionId, paid.cents)
  }

  const label = METHOD_LABELS[paid.method] ?? METHOD_LABELS[CHECKOUT_METHODS[row.method]]
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO sale_payments (store_id, sale_id, amount_cents, method, reference, note, service_charge_cents,
             processing_fee_cents, checkout_id, paid_date, user_id, user_name)
           SELECT store_id, sale_id, amount_cents, method, ?, ?, service_charge_cents, ?, id,
             date('now', '+8 hours'), user_id, user_name
           FROM sale_checkouts WHERE id = ?
           ON CONFLICT DO NOTHING`,
        )
        .bind(paid.paymentId, `Paid online through PayMongo (${label})`, paid.processingFeeCents, row.id),
      // Recalculating paid_cents runs the sales CHECK, so a sale already paid another way fails here
      db
        .prepare(
          `UPDATE sales SET paid_cents = (SELECT COALESCE(SUM(amount_cents), 0) FROM sale_payments WHERE sale_id = sales.id)
           WHERE id = ?`,
        )
        .bind(row.sale_id),
      db
        .prepare(
          `UPDATE sale_checkouts SET status = 'paid', paid_at = datetime('now'), payment_reference = ?,
             processing_fee_cents = ?
           WHERE id = ?`,
        )
        .bind(paid.paymentId, paid.processingFeeCents, row.id),
    ])
  } catch (err) {
    console.error('PayMongo: sale checkout paid but the sale has no balance left; refund the customer', row.id, err)
    await db
      .prepare(
        `UPDATE sale_checkouts SET status = 'refund_due', paid_at = datetime('now'), payment_reference = ?,
           processing_fee_cents = ?
         WHERE id = ? AND status IN ('pending', 'cancelled')`,
      )
      .bind(paid.paymentId, paid.processingFeeCents, row.id)
      .run()
  }
}

/** Asks PayMongo about a waiting checkout, records it if paid; returns the checkout as it is now. */
async function refreshCheckout(db: D1Database, env: PaymongoEnv, row: CheckoutRow): Promise<CheckoutRow> {
  if (row.status !== 'pending' || !onlinePaymentEnabled(env)) return row
  try {
    const session = await retrieveCheckoutSession(env, row.checkout_session_id)
    const paid = paidCheckout(session)
    if (paid) await recordSaleCheckout(db, row.checkout_session_id, paid)
    else if (session.attributes.status === 'expired') {
      await db.prepare(`UPDATE sale_checkouts SET status = 'cancelled' WHERE id = ? AND status = 'pending'`).bind(row.id).run()
    } else return row
  } catch (err) {
    console.warn(err) // the webhook may still record it
    return row
  }
  return (await db.prepare(`SELECT ${CHECKOUT_COLUMNS} FROM sale_checkouts WHERE id = ?`).bind(row.id).first<CheckoutRow>())!
}

/** Closes a waiting checkout so it can't be paid; if it was paid just before, records that instead. */
async function cancelCheckout(db: D1Database, env: PaymongoEnv, row: CheckoutRow): Promise<CheckoutRow> {
  if (row.status !== 'pending') return row
  await expireCheckoutSession(env, row.checkout_session_id)
  const now = await refreshCheckout(db, env, row)
  if (now.status !== 'pending') return now
  await db.prepare(`UPDATE sale_checkouts SET status = 'cancelled' WHERE id = ? AND status = 'pending'`).bind(row.id).run()
  return { ...now, status: 'cancelled' }
}

/**
 * Closes the checkout waiting for a sale once it asks for more than the sale still owes (it was
 * paid another way), so the customer isn't charged twice.
 */
export async function closeOutdatedCheckout(db: D1Database, env: PaymongoEnv, saleId: number): Promise<void> {
  const row = await db
    .prepare(
      `SELECT c.* FROM sale_checkouts c JOIN sales s ON s.id = c.sale_id
       WHERE c.sale_id = ? AND c.status = 'pending' AND c.amount_cents > s.total_cents - s.returned_cents - s.paid_cents`,
    )
    .bind(saleId)
    .first<CheckoutRow>()
  if (row) await cancelCheckout(db, env, row)
}

/** The checkout waiting for a sale's payment, if any, for the sale's detail */
export async function pendingCheckout(db: D1Database, storeId: number, saleId: number) {
  const row = await db
    .prepare(`SELECT ${CHECKOUT_COLUMNS} FROM sale_checkouts WHERE sale_id = ? AND store_id = ? AND status = 'pending'`)
    .bind(saleId, storeId)
    .first<CheckoutRow>()
  return row ? publicCheckout(row) : null
}

/** Handles /api/sales/:id/checkouts[/:cid], or returns null if the path isn't one of them. */
export async function handleSaleCheckouts(
  db: D1Database,
  env: PaymongoEnv,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/sales\/(\d+)\/checkouts(?:\/(\d+))?$/)
  if (!match) return null
  const saleId = Number(match[1])

  if (!match[2]) {
    if (request.method !== 'POST') return error('Method not allowed', 405)
    const body = await request.json().catch(() => null)
    const input = readOnlinePayment(body)
    if (typeof input === 'string') return error(input, 400)
    const checkout = await openSaleCheckout(db, env, user, saleId, input, url.origin)
    return checkout instanceof Response ? checkout : Response.json(checkout, { status: 201 })
  }

  const row = await getCheckout(db, user.store_id, saleId, Number(match[2]))
  if (!row) return error('Online payment not found', 404)
  if (request.method === 'GET') return Response.json(publicCheckout(await refreshCheckout(db, env, row)))
  if (request.method === 'DELETE') return Response.json(publicCheckout(await cancelCheckout(db, env, row)))
  return error('Method not allowed', 405)
}
