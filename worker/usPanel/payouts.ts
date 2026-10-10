// Payouts to stores of their online sales, for super admins (US Panel). Sales paid online go into
// the platform's PayMongo account (see saleCheckouts.ts); this is where super admins see what each
// store is owed and record the money sent to it.
//
//   GET  /api/us-panel/payouts             -> { stores, totals }   (stores with online sales or payouts)
//   GET  /api/us-panel/stores/:id/payouts  -> PayoutSummary
//   POST /api/us-panel/stores/:id/payouts  { amountCents, method, reference, note, paidDate } -> PayoutSummary (201)

import { cleanNote, cleanText, documentDate, error, isCents, MAX_REFERENCE_LENGTH, PAYMENT_METHODS } from '../documents'
import { getPayoutSummary } from '../storePayouts'
import type { SuperAdmin } from './session'

interface StoreBalanceRow {
  id: number
  name: string
  collected: number
  paid_out: number
  refunds_due: number
  last_payout: string | null
}

async function listBalances(db: D1Database): Promise<Response> {
  const { results } = await db
    .prepare(
      `SELECT st.id, st.name,
         COALESCE(c.collected, 0) AS collected, COALESCE(p.paid_out, 0) AS paid_out,
         (SELECT COUNT(*) FROM sale_checkouts WHERE store_id = st.id AND status = 'refund_due') AS refunds_due,
         p.last_payout
       FROM stores st
       LEFT JOIN (SELECT store_id, SUM(amount_cents) AS collected FROM sale_payments
                  WHERE checkout_id IS NOT NULL GROUP BY store_id) c ON c.store_id = st.id
       LEFT JOIN (SELECT store_id, SUM(amount_cents) AS paid_out, MAX(paid_date) AS last_payout FROM store_payouts
                  GROUP BY store_id) p ON p.store_id = st.id
       WHERE c.collected IS NOT NULL OR p.paid_out IS NOT NULL
         OR EXISTS (SELECT 1 FROM sale_checkouts WHERE store_id = st.id AND status = 'refund_due')
       ORDER BY COALESCE(c.collected, 0) - COALESCE(p.paid_out, 0) DESC, st.name`,
    )
    .all<StoreBalanceRow>()

  const stores = results.map((r) => ({
    id: r.id,
    name: r.name,
    collectedCents: r.collected,
    paidOutCents: r.paid_out,
    balanceCents: r.collected - r.paid_out,
    refundsDue: r.refunds_due,
    lastPayoutDate: r.last_payout,
  }))
  const sum = (field: 'collectedCents' | 'paidOutCents' | 'balanceCents' | 'refundsDue') =>
    stores.reduce((total, s) => total + s[field], 0)
  return Response.json({
    stores,
    totals: {
      collectedCents: sum('collectedCents'),
      paidOutCents: sum('paidOutCents'),
      balanceCents: sum('balanceCents'),
      refundsDue: sum('refundsDue'),
    },
  })
}

async function recordPayout(db: D1Database, request: Request, storeId: number, admin: SuperAdmin): Promise<Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)
  if (!isCents(body.amountCents) || body.amountCents <= 0) return error('Enter the amount paid out', 400)
  const method = body.method as string
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) return error('Choose how it was paid out', 400)
  const reference = cleanText(body.reference) || null
  if (reference && reference.length > MAX_REFERENCE_LENGTH) {
    return error(`Reference must be ${MAX_REFERENCE_LENGTH} characters or less`, 400)
  }
  const note = cleanNote(body.note)
  if (note === undefined) return error('Note is too long', 400)
  const paidDate = documentDate(body.paidDate)
  if (!paidDate) return error('Payout date must be a valid date, not in the future', 400)

  // Inserted only while it fits the balance, so two payouts at once can't pay out too much
  const result = await db
    .prepare(
      `INSERT INTO store_payouts (store_id, amount_cents, method, reference, note, paid_date, created_by)
       SELECT st.id, ?2, ?3, ?4, ?5, ?6, ?7 FROM stores st
       WHERE st.id = ?1
         AND ?2 <= (SELECT COALESCE(SUM(amount_cents), 0) FROM sale_payments WHERE store_id = ?1 AND checkout_id IS NOT NULL)
                 - (SELECT COALESCE(SUM(amount_cents), 0) FROM store_payouts WHERE store_id = ?1)`,
    )
    .bind(storeId, body.amountCents, method, reference, note, paidDate, admin.id)
    .run()
  if (!result.meta.changes) {
    const store = await db.prepare('SELECT 1 FROM stores WHERE id = ?').bind(storeId).first()
    return store ? error('The payout is more than the store is owed', 400) : error('Store not found', 404)
  }
  return Response.json(await getPayoutSummary(db, storeId), { status: 201 })
}

/** Handles /api/us-panel/payouts and /api/us-panel/stores/:id/payouts, or returns null. */
export async function handlePayouts(
  db: D1Database,
  request: Request,
  url: URL,
  admin: SuperAdmin,
): Promise<Response | null> {
  if (url.pathname === '/api/us-panel/payouts') {
    return request.method === 'GET' ? listBalances(db) : error('Method not allowed', 405)
  }
  const match = url.pathname.match(/^\/api\/us-panel\/stores\/(\d+)\/payouts$/)
  if (!match) return null
  const storeId = Number(match[1])
  if (request.method === 'GET') {
    const store = await db.prepare('SELECT 1 FROM stores WHERE id = ?').bind(storeId).first()
    return store ? Response.json(await getPayoutSummary(db, storeId)) : error('Store not found', 404)
  }
  if (request.method === 'POST') return recordPayout(db, request, storeId, admin)
  return error('Method not allowed', 405)
}
