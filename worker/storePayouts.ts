// Payouts of online sales. A sale paid online (saleCheckouts.ts) is paid into the platform's
// PayMongo account, so the platform owes the store the sale amount (not the service charge, which
// is the platform's) until a super admin pays it out and records it (usPanel/payouts.ts).
//
//   GET /api/online-payouts  -> PayoutSummary   (store admins: what the platform holds for the store)

import { error, formatReference } from './documents'
import type { SessionUser } from './session'

const MAX_PAYOUTS_SHOWN = 20

interface PayoutRow {
  id: number
  amount_cents: number
  method: string
  reference: string | null
  note: string | null
  paid_date: string
  created_by_name: string | null
  created_at: string
}

const publicPayout = (row: PayoutRow) => ({
  id: row.id,
  reference: formatReference('PO', row.id),
  amountCents: row.amount_cents,
  method: row.method,
  paymentReference: row.reference,
  note: row.note,
  paidDate: row.paid_date,
  recordedBy: row.created_by_name,
  createdAt: row.created_at,
})

/** Money collected online for a store, what was paid out to it, and the balance owed */
export async function getPayoutSummary(db: D1Database, storeId: number) {
  const [totals, payouts, refunds] = await db.batch<unknown>([
    db
      .prepare(
        `SELECT
           (SELECT COALESCE(SUM(amount_cents), 0) FROM sale_payments
            WHERE store_id = ?1 AND checkout_id IS NOT NULL) AS collected,
           (SELECT COUNT(*) FROM sale_payments WHERE store_id = ?1 AND checkout_id IS NOT NULL) AS payments,
           (SELECT COALESCE(SUM(amount_cents), 0) FROM store_payouts WHERE store_id = ?1) AS paid_out`,
      )
      .bind(storeId),
    db
      .prepare(
        `SELECT p.id, p.amount_cents, p.method, p.reference, p.note, p.paid_date, sa.full_name AS created_by_name,
           p.created_at
         FROM store_payouts p LEFT JOIN super_admins sa ON sa.id = p.created_by
         WHERE p.store_id = ? ORDER BY p.paid_date DESC, p.id DESC LIMIT ?`,
      )
      .bind(storeId, MAX_PAYOUTS_SHOWN),
    db
      .prepare(
        `SELECT id, sale_id, method, amount_cents + service_charge_cents AS paid_cents, payment_reference, paid_at
         FROM sale_checkouts WHERE store_id = ? AND status = 'refund_due' ORDER BY id DESC`,
      )
      .bind(storeId),
  ])
  const row = totals!.results[0] as { collected: number; payments: number; paid_out: number }
  return {
    collectedCents: row.collected,
    onlinePayments: row.payments,
    paidOutCents: row.paid_out,
    balanceCents: row.collected - row.paid_out,
    payouts: (payouts!.results as PayoutRow[]).map(publicPayout),
    // Online payments made after the sale was already settled: the customer is owed a refund
    refundsDue: (
      refunds!.results as {
        id: number
        sale_id: number
        method: string
        paid_cents: number
        payment_reference: string | null
        paid_at: string | null
      }[]
    ).map((r) => ({
      id: r.id,
      sale: { id: r.sale_id, reference: formatReference('INV', r.sale_id) },
      method: r.method,
      paidCents: r.paid_cents,
      paymentReference: r.payment_reference,
      paidAt: r.paid_at,
    })),
  }
}

/** GET /api/online-payouts (store admins) */
export async function handleOnlinePayouts(db: D1Database, request: Request, user: SessionUser): Promise<Response> {
  if (request.method !== 'GET') return error('Method not allowed', 405)
  if (!user.is_admin) return error('Only admins can see online payouts', 403)
  return Response.json(await getPayoutSummary(db, user.store_id))
}
