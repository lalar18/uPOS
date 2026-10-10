// Payouts to stores of their online sales, for super admins (US Panel). Sales paid online go into
// the platform's PayMongo account (see saleCheckouts.ts) and sit in the store's wallet
// (storePayouts.ts); this is where super admins see what each store is owed, send the
// withdrawals stores ask for, and record other money sent to them.
//
//   GET  /api/us-panel/payouts                  -> { stores, totals }   (stores with online sales, payouts or requests)
//   GET  /api/us-panel/stores/:id/payouts       -> Wallet
//   POST /api/us-panel/stores/:id/payouts       { amountCents, method, reference, note, paidDate } -> Wallet (201)
//   POST /api/us-panel/withdrawals/:id/send     { reference, note, paidDate } -> Wallet   (records the payout)
//   POST /api/us-panel/withdrawals/:id/reject   { reason } -> Wallet

import { cleanNote, cleanText, documentDate, error, isCents, MAX_REFERENCE_LENGTH, PAYMENT_METHODS } from '../documents'
import { getWallet, PENDING_WITHDRAWAL_SQL, WALLET_BALANCE_SQL } from '../storePayouts'
import type { SuperAdmin } from './session'

interface StoreBalanceRow {
  id: number
  name: string
  collected: number
  paid_out: number
  refunds_due: number
  last_payout: string | null
  pending_id: number | null
  pending_cents: number | null
  pending_at: string | null
}

async function listBalances(db: D1Database): Promise<Response> {
  const { results } = await db
    .prepare(
      `SELECT st.id, st.name,
         COALESCE(c.collected, 0) AS collected, COALESCE(p.paid_out, 0) AS paid_out,
         (SELECT COUNT(*) FROM sale_checkouts WHERE store_id = st.id AND status = 'refund_due') AS refunds_due,
         p.last_payout, w.id AS pending_id, w.amount_cents AS pending_cents, w.created_at AS pending_at
       FROM stores st
       LEFT JOIN (SELECT store_id, SUM(amount_cents) AS collected FROM sale_payments
                  WHERE checkout_id IS NOT NULL GROUP BY store_id) c ON c.store_id = st.id
       LEFT JOIN (SELECT store_id, SUM(amount_cents) AS paid_out, MAX(paid_date) AS last_payout FROM store_payouts
                  GROUP BY store_id) p ON p.store_id = st.id
       LEFT JOIN wallet_withdrawals w ON w.store_id = st.id AND w.status = 'pending'
       WHERE c.collected IS NOT NULL OR p.paid_out IS NOT NULL
         OR EXISTS (SELECT 1 FROM sale_checkouts WHERE store_id = st.id AND status = 'refund_due')
       ORDER BY w.id IS NULL, w.created_at, COALESCE(c.collected, 0) - COALESCE(p.paid_out, 0) DESC, st.name`,
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
    // The withdrawal the store asked for, waiting to be sent
    pendingWithdrawal: r.pending_id ? { id: r.pending_id, amountCents: r.pending_cents!, createdAt: r.pending_at! } : null,
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
      pendingWithdrawals: stores.filter((s) => s.pendingWithdrawal).length,
    },
  })
}

/** Validates the payment reference, note and date of money sent; returns them or an error message. */
function readSent(body: Record<string, unknown>) {
  const reference = cleanText(body.reference) || null
  if (reference && reference.length > MAX_REFERENCE_LENGTH) {
    return `Reference must be ${MAX_REFERENCE_LENGTH} characters or less`
  }
  const note = cleanNote(body.note)
  if (note === undefined) return 'Note is too long'
  const paidDate = documentDate(body.paidDate)
  if (!paidDate) return 'Payout date must be a valid date, not in the future'
  return { reference, note, paidDate }
}

/** A payout made without a withdrawal request; it can't touch the amount a pending request holds. */
async function recordPayout(db: D1Database, request: Request, storeId: number, admin: SuperAdmin): Promise<Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)
  if (!isCents(body.amountCents) || body.amountCents <= 0) return error('Enter the amount paid out', 400)
  const method = body.method as string
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) return error('Choose how it was paid out', 400)
  const sent = readSent(body)
  if (typeof sent === 'string') return error(sent, 400)

  // Inserted only while it fits the balance, so two payouts at once can't pay out too much
  const result = await db
    .prepare(
      `INSERT INTO store_payouts (store_id, amount_cents, method, reference, note, paid_date, created_by)
       SELECT st.id, ?2, ?3, ?4, ?5, ?6, ?7 FROM stores st
       WHERE st.id = ?1 AND ?2 <= ${WALLET_BALANCE_SQL} - ${PENDING_WITHDRAWAL_SQL}`,
    )
    .bind(storeId, body.amountCents, method, sent.reference, sent.note, sent.paidDate, admin.id)
    .run()
  if (!result.meta.changes) {
    const store = await db.prepare('SELECT 1 FROM stores WHERE id = ?').bind(storeId).first()
    return store
      ? error('The payout is more than the store is owed (less any withdrawal it asked for)', 400)
      : error('Store not found', 404)
  }
  return Response.json(await getWallet(db, storeId), { status: 201 })
}

/** Records the money sent for a pending withdrawal as a payout, and marks the request sent. */
async function sendWithdrawal(db: D1Database, request: Request, id: number, admin: SuperAdmin): Promise<Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)
  const sent = readSent(body)
  if (typeof sent === 'string') return error(sent, 400)

  const row = await db
    .prepare('SELECT store_id, status FROM wallet_withdrawals WHERE id = ?')
    .bind(id)
    .first<{ store_id: number; status: string }>()
  if (!row) return error('Withdrawal not found', 404)
  if (row.status !== 'pending') return error('This withdrawal is no longer pending', 409)

  // Both happen only while the request is pending and fits the balance (the store may have
  // cancelled it, or another super admin sent it, a moment ago); the payout's withdrawal_id is
  // unique, so it can't be sent twice
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO store_payouts (store_id, amount_cents, method, reference, note, paid_date, created_by, withdrawal_id)
         SELECT w.store_id, w.amount_cents, CASE w.destination WHEN 'gcash' THEN 'gcash' ELSE 'bank_transfer' END,
           ?2, ?3, ?4, ?5, w.id
         FROM wallet_withdrawals w
         WHERE w.id = ?1 AND w.status = 'pending' AND w.amount_cents <= ${WALLET_BALANCE_SQL.replaceAll('?1', 'w.store_id')}
         ON CONFLICT DO NOTHING`,
      )
      .bind(id, sent.reference, sent.note, sent.paidDate, admin.id),
    db
      .prepare(
        `UPDATE wallet_withdrawals SET status = 'sent', reviewed_by = ?2, reviewed_at = datetime('now')
         WHERE id = ?1 AND status = 'pending' AND EXISTS (SELECT 1 FROM store_payouts WHERE withdrawal_id = ?1)`,
      )
      .bind(id, admin.id),
  ])
  if (!inserted!.meta.changes) {
    return error('This withdrawal is no longer pending, or is more than the store is owed', 409)
  }
  return Response.json(await getWallet(db, row.store_id))
}

async function rejectWithdrawal(db: D1Database, request: Request, id: number, admin: SuperAdmin): Promise<Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)
  const reason = cleanNote(body.reason)
  if (!reason) return error(reason === undefined ? 'Reason is too long' : 'Tell the store why', 400)

  const row = await db
    .prepare(
      `UPDATE wallet_withdrawals SET status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = datetime('now')
       WHERE id = ? AND status = 'pending' RETURNING store_id`,
    )
    .bind(reason, admin.id, id)
    .first<{ store_id: number }>()
  if (!row) {
    const exists = await db.prepare('SELECT 1 FROM wallet_withdrawals WHERE id = ?').bind(id).first()
    return exists ? error('This withdrawal is no longer pending', 409) : error('Withdrawal not found', 404)
  }
  return Response.json(await getWallet(db, row.store_id))
}

/** Handles /api/us-panel/payouts, /stores/:id/payouts and /withdrawals/:id/(send|reject), or returns null. */
export async function handlePayouts(
  db: D1Database,
  request: Request,
  url: URL,
  admin: SuperAdmin,
): Promise<Response | null> {
  if (url.pathname === '/api/us-panel/payouts') {
    return request.method === 'GET' ? listBalances(db) : error('Method not allowed', 405)
  }
  const withdrawal = url.pathname.match(/^\/api\/us-panel\/withdrawals\/(\d+)\/(send|reject)$/)
  if (withdrawal) {
    if (request.method !== 'POST') return error('Method not allowed', 405)
    const id = Number(withdrawal[1])
    return withdrawal[2] === 'send' ? sendWithdrawal(db, request, id, admin) : rejectWithdrawal(db, request, id, admin)
  }
  const match = url.pathname.match(/^\/api\/us-panel\/stores\/(\d+)\/payouts$/)
  if (!match) return null
  const storeId = Number(match[1])
  if (request.method === 'GET') {
    const store = await db.prepare('SELECT 1 FROM stores WHERE id = ?').bind(storeId).first()
    return store ? Response.json(await getWallet(db, storeId)) : error('Store not found', 404)
  }
  if (request.method === 'POST') return recordPayout(db, request, storeId, admin)
  return error('Method not allowed', 405)
}
