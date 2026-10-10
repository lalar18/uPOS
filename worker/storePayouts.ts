// The store's wallet. A sale paid online (saleCheckouts.ts) is paid into the platform's PayMongo
// account, so the platform holds the sale amount for the store (not the service charge, which is
// the platform's income) until the store withdraws it. A store admin asks for a withdrawal to a
// GCash number or a bank account; a super admin sends it and marks it sent, which records the
// payout (usPanel/payouts.ts). See migration 0025.
//
//   GET    /api/wallet                    -> Wallet   (store admins only)
//   POST   /api/wallet/withdrawals        { amountCents, destination, bankName, accountName, accountNumber, note } -> Wallet (201)
//   DELETE /api/wallet/withdrawals/:id    -> Wallet   (cancels a pending request)

import { cleanNote, cleanText, error, formatReference, isCents } from './documents'
import type { SessionUser } from './session'

const MAX_SHOWN = 20
const MAX_NAME_LENGTH = 100

/** What the platform holds for a store and hasn't paid out: online payments less payouts (SQL, ?1 = store id) */
export const WALLET_BALANCE_SQL = `(SELECT COALESCE(SUM(amount_cents), 0) FROM sale_payments WHERE store_id = ?1 AND checkout_id IS NOT NULL)
  - (SELECT COALESCE(SUM(amount_cents), 0) FROM store_payouts WHERE store_id = ?1)`

/** The amount a store has asked to withdraw and is waiting for (SQL, ?1 = store id) */
export const PENDING_WITHDRAWAL_SQL = `(SELECT COALESCE(SUM(amount_cents), 0) FROM wallet_withdrawals WHERE store_id = ?1 AND status = 'pending')`

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

interface WithdrawalRow {
  id: number
  amount_cents: number
  destination: 'gcash' | 'bank'
  bank_name: string | null
  account_name: string
  account_number: string
  note: string | null
  status: 'pending' | 'sent' | 'rejected' | 'cancelled'
  payout_id: number | null
  reject_reason: string | null
  requested_by_name: string
  created_at: string
  reviewed_at: string | null
}

const WITHDRAWAL_COLUMNS = `w.id, w.amount_cents, w.destination, w.bank_name, w.account_name, w.account_number, w.note,
  w.status, (SELECT id FROM store_payouts WHERE withdrawal_id = w.id) AS payout_id, w.reject_reason, w.requested_by_name,
  w.created_at, w.reviewed_at`

const publicWithdrawal = (row: WithdrawalRow) => ({
  id: row.id,
  reference: formatReference('WD', row.id),
  amountCents: row.amount_cents,
  destination: row.destination,
  bankName: row.bank_name,
  accountName: row.account_name,
  accountNumber: row.account_number,
  note: row.note,
  status: row.status,
  payout: row.payout_id ? { id: row.payout_id, reference: formatReference('PO', row.payout_id) } : null,
  rejectReason: row.reject_reason,
  requestedBy: row.requested_by_name,
  createdAt: row.created_at,
  reviewedAt: row.reviewed_at,
})

/** The wallet: money collected online for a store, its payouts and withdrawal requests, and the balance */
export async function getWallet(db: D1Database, storeId: number) {
  const [totals, payouts, withdrawals, refunds] = await db.batch<unknown>([
    db
      .prepare(
        `SELECT
           (SELECT COALESCE(SUM(amount_cents), 0) FROM sale_payments
            WHERE store_id = ?1 AND checkout_id IS NOT NULL) AS collected,
           (SELECT COUNT(*) FROM sale_payments WHERE store_id = ?1 AND checkout_id IS NOT NULL) AS payments,
           (SELECT COALESCE(SUM(amount_cents), 0) FROM store_payouts WHERE store_id = ?1) AS paid_out,
           ${PENDING_WITHDRAWAL_SQL} AS pending`,
      )
      .bind(storeId),
    db
      .prepare(
        `SELECT p.id, p.amount_cents, p.method, p.reference, p.note, p.paid_date, sa.full_name AS created_by_name,
           p.created_at
         FROM store_payouts p LEFT JOIN super_admins sa ON sa.id = p.created_by
         WHERE p.store_id = ? ORDER BY p.paid_date DESC, p.id DESC LIMIT ?`,
      )
      .bind(storeId, MAX_SHOWN),
    db
      .prepare(`SELECT ${WITHDRAWAL_COLUMNS} FROM wallet_withdrawals w WHERE w.store_id = ? ORDER BY w.id DESC LIMIT ?`)
      .bind(storeId, MAX_SHOWN),
    db
      .prepare(
        `SELECT id, sale_id, method, amount_cents + service_charge_cents AS paid_cents, payment_reference, paid_at
         FROM sale_checkouts WHERE store_id = ? AND status = 'refund_due' ORDER BY id DESC`,
      )
      .bind(storeId),
  ])
  const row = totals!.results[0] as { collected: number; payments: number; paid_out: number; pending: number }
  const balance = row.collected - row.paid_out
  const requests = (withdrawals!.results as WithdrawalRow[]).map(publicWithdrawal)
  return {
    collectedCents: row.collected,
    onlinePayments: row.payments,
    paidOutCents: row.paid_out,
    balanceCents: balance, // held for the store
    pendingWithdrawalCents: row.pending,
    availableCents: Math.max(0, balance - row.pending), // can be withdrawn now
    payouts: (payouts!.results as PayoutRow[]).map(publicPayout),
    withdrawals: requests, // newest first
    pendingWithdrawal: requests.find((w) => w.status === 'pending') ?? null,
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

/** Validates where to send a withdrawal; returns it, or an error message. */
function readDestination(body: Record<string, unknown>) {
  const destination = body.destination
  if (destination !== 'gcash' && destination !== 'bank') return 'Choose GCash or a bank account'
  const accountName = cleanText(body.accountName)
  if (accountName.length < 2 || accountName.length > MAX_NAME_LENGTH) return 'Enter the account name'

  const digits = String(body.accountNumber ?? '').replace(/[\s-]/g, '')
  if (destination === 'gcash') {
    // 09171234567, 639171234567 or +639171234567 -> 09171234567
    const match = digits.match(/^(?:\+?63|0)(9\d{9})$/)
    if (!match) return 'Enter the GCash number, like 0917 123 4567'
    return { destination, bankName: null, accountName, accountNumber: `0${match[1]}` }
  }
  const bankName = cleanText(body.bankName)
  if (bankName.length < 2 || bankName.length > MAX_NAME_LENGTH) return 'Enter the bank name'
  if (!/^\d{6,20}$/.test(digits)) return 'Enter the bank account number (6 to 20 digits)'
  return { destination, bankName, accountName, accountNumber: digits }
}

async function requestWithdrawal(db: D1Database, request: Request, user: SessionUser): Promise<Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)
  if (!isCents(body.amountCents) || body.amountCents <= 0) return error('Enter the amount to withdraw', 400)
  const to = readDestination(body)
  if (typeof to === 'string') return error(to, 400)
  const note = cleanNote(body.note)
  if (note === undefined) return error('Note is too long', 400)

  // Inserted only while it fits the balance; the pending index allows one request at a time
  const result = await db
    .prepare(
      `INSERT INTO wallet_withdrawals (store_id, amount_cents, destination, bank_name, account_name, account_number,
         note, requested_by, requested_by_name)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
       WHERE ?2 <= ${WALLET_BALANCE_SQL}
       ON CONFLICT DO NOTHING`,
    )
    .bind(user.store_id, body.amountCents, to.destination, to.bankName, to.accountName, to.accountNumber, note, user.id, user.full_name)
    .run()
  if (!result.meta.changes) {
    const pending = await db
      .prepare(`SELECT 1 FROM wallet_withdrawals WHERE store_id = ? AND status = 'pending'`)
      .bind(user.store_id)
      .first()
    return pending
      ? error('You already have a withdrawal waiting. Cancel it to ask for a different amount.', 409)
      : error('The amount is more than your wallet balance', 400)
  }
  return Response.json(await getWallet(db, user.store_id), { status: 201 })
}

async function cancelWithdrawal(db: D1Database, id: number, user: SessionUser): Promise<Response> {
  const result = await db
    .prepare(
      `UPDATE wallet_withdrawals SET status = 'cancelled', reviewed_at = datetime('now')
       WHERE id = ? AND store_id = ? AND status = 'pending'`,
    )
    .bind(id, user.store_id)
    .run()
  if (!result.meta.changes) {
    const row = await db
      .prepare('SELECT status FROM wallet_withdrawals WHERE id = ? AND store_id = ?')
      .bind(id, user.store_id)
      .first<{ status: string }>()
    if (!row) return error('Withdrawal not found', 404)
    return error(row.status === 'sent' ? 'This withdrawal was already sent' : 'This withdrawal is no longer pending', 409)
  }
  return Response.json(await getWallet(db, user.store_id))
}

/** Handles /api/wallet[/withdrawals[/:id]], or returns null if the path isn't one of them. */
export async function handleWallet(db: D1Database, request: Request, url: URL, user: SessionUser): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/wallet(?:\/withdrawals(?:\/(\d+))?)?$/)
  if (!match) return null
  if (!user.is_admin) return error('Only the store admin can use the wallet', 403)

  if (url.pathname === '/api/wallet') {
    return request.method === 'GET' ? Response.json(await getWallet(db, user.store_id)) : error('Method not allowed', 405)
  }
  if (!match[1]) return request.method === 'POST' ? requestWithdrawal(db, request, user) : error('Method not allowed', 405)
  return request.method === 'DELETE' ? cancelWithdrawal(db, Number(match[1]), user) : error('Method not allowed', 405)
}
