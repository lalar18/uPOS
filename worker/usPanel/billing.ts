// Subscription billing, for super admins (US Panel). A store admin asks to renew from the
// Subscription page (a 'pending' renewal); once the store pays, a super admin confirms it here
// with the payment details, which extends the store by the months paid for (see the
// subscription_renewals_paid trigger). A payment can also be recorded without a request.
//
//   GET  /api/us-panel/renewals?status=&storeId=&search=&page=&pageSize=  -> { items, total }
//   POST /api/us-panel/renewals/:id/pay     { months, amount, paymentMethod, reference, note } -> renewal
//   POST /api/us-panel/renewals/:id/cancel                                  -> renewal
//   POST /api/us-panel/stores/:id/payments  { planId, months, amount, paymentMethod, reference, note } -> renewal

import {
  cleanNote,
  cleanText,
  error,
  likePattern,
  MAX_REFERENCE_LENGTH,
  PAYMENT_METHODS,
  positiveId,
  readPaging,
  referenceId,
} from '../documents'
import type { SuperAdmin } from './session'

const MAX_MONTHS = 24 // keep in step with the CHECK on subscription_renewals.months
const MAX_AMOUNT = 10_000_000 // whole pesos

interface RenewalRow {
  id: number
  store_id: number
  store_name: string
  plan_id: string
  plan_name: string
  monthly_price: number
  status: 'pending' | 'paid' | 'cancelled'
  months: number
  amount: number | null
  payment_method: string | null
  payment_reference: string | null
  note: string | null
  requested_by_name: string | null
  confirmed_by_name: string | null
  period_start: string | null
  period_end: string | null
  created_at: string
  paid_at: string | null
}

export const RENEWAL_SELECT =`SELECT sr.id, sr.store_id, st.name AS store_name, sr.plan_id, p.name AS plan_name, p.monthly_price,
    sr.status, sr.months, sr.amount, sr.payment_method, sr.payment_reference, sr.note,
    u.full_name AS requested_by_name, sa.full_name AS confirmed_by_name,
    sr.period_start, sr.period_end, sr.created_at, sr.paid_at
  FROM subscription_renewals sr
  JOIN stores st ON st.id = sr.store_id
  JOIN plans p ON p.id = sr.plan_id
  LEFT JOIN users u ON u.id = sr.requested_by
  LEFT JOIN super_admins sa ON sa.id = sr.confirmed_by`

export function publicRenewal(row: RenewalRow) {
  return {
    id: row.id,
    store: { id: row.store_id, name: row.store_name },
    plan: { id: row.plan_id, name: row.plan_name, monthlyPrice: row.monthly_price },
    status: row.status,
    months: row.months,
    amount: row.amount,
    paymentMethod: row.payment_method,
    reference: row.payment_reference,
    note: row.note,
    requestedBy: row.requested_by_name, // null when a super admin recorded the payment directly
    confirmedBy: row.confirmed_by_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  }
}

async function renewalResponse(db: D1Database, id: number, status = 200): Promise<Response> {
  const row = await db.prepare(`${RENEWAL_SELECT} WHERE sr.id = ?`).bind(id).first<RenewalRow>()
  return row ? Response.json(publicRenewal(row), { status }) : error('Renewal not found', 404)
}

/** Recent renewals of one store, newest first (for the store's page). */
export async function listStoreRenewals(db: D1Database, storeId: number, limit = 50) {
  const { results } = await db
    .prepare(`${RENEWAL_SELECT} WHERE sr.store_id = ? ORDER BY sr.id DESC LIMIT ?`)
    .bind(storeId, limit)
    .all<RenewalRow>()
  return results.map(publicRenewal)
}

async function listRenewals(db: D1Database, url: URL): Promise<Response> {
  const status = url.searchParams.get('status')
  const storeId = positiveId(Number(url.searchParams.get('storeId')))
  const search = url.searchParams.get('search')?.trim() ?? ''
  const { pageSize, offset } = readPaging(url)

  const where: string[] = []
  const params: unknown[] = []
  if (status === 'pending' || status === 'paid' || status === 'cancelled') {
    where.push('sr.status = ?')
    params.push(status)
  }
  if (storeId) {
    where.push('sr.store_id = ?')
    params.push(storeId)
  }
  if (search) {
    const pattern = likePattern(search)
    where.push(`(st.name LIKE ? ESCAPE '\\' OR sr.payment_reference LIKE ? ESCAPE '\\' OR st.id = ?)`)
    params.push(pattern, pattern, referenceId(search, 'STR') ?? 0)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const [items, count] = await db.batch<RenewalRow | { total: number }>([
    // Pending ones first (oldest first: they've waited longest), then the rest newest first
    db
      .prepare(
        `${RENEWAL_SELECT} ${whereSql}
         ORDER BY sr.status = 'pending' DESC, CASE WHEN sr.status = 'pending' THEN sr.id ELSE -sr.id END
         LIMIT ? OFFSET ?`,
      )
      .bind(...params, pageSize, offset),
    db
      .prepare(`SELECT COUNT(*) AS total FROM subscription_renewals sr JOIN stores st ON st.id = sr.store_id ${whereSql}`)
      .bind(...params),
  ])
  return Response.json({
    items: (items!.results as RenewalRow[]).map(publicRenewal),
    total: (count!.results[0] as { total: number }).total,
  })
}

interface PaymentInput {
  months: number
  amount: number
  paymentMethod: string
  reference: string | null
  note: string | null
}

function readPayment(body: Record<string, unknown> | null): PaymentInput | Response {
  if (!body) return error('Invalid request body', 400)
  const months = body.months ?? 1
  if (!Number.isSafeInteger(months) || (months as number) < 1 || (months as number) > MAX_MONTHS) {
    return error(`Months must be between 1 and ${MAX_MONTHS}`, 400)
  }
  const amount = body.amount
  if (!Number.isSafeInteger(amount) || (amount as number) < 0 || (amount as number) > MAX_AMOUNT) {
    return error('Enter the amount received, in whole pesos', 400)
  }
  const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod : ''
  if (!(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) return error('Choose a payment method', 400)
  const reference = cleanText(body.reference)
  if (reference.length > MAX_REFERENCE_LENGTH) {
    return error(`Reference must be ${MAX_REFERENCE_LENGTH} characters or less`, 400)
  }
  const note = cleanNote(body.note)
  if (note === undefined) return error('Note is too long', 400)
  return { months: months as number, amount: amount as number, paymentMethod, reference: reference || null, note }
}

/** Marks a pending renewal paid; the trigger extends the store and moves it to the renewal's plan. */
function markPaid(db: D1Database, id: number, input: PaymentInput, admin: SuperAdmin) {
  return db
    .prepare(
      `UPDATE subscription_renewals
       SET months = ?, amount = ?, payment_method = ?, payment_reference = ?, note = ?, confirmed_by = ?, status = 'paid'
       WHERE id = ? AND status = 'pending'`,
    )
    .bind(input.months, input.amount, input.paymentMethod, input.reference, input.note, admin.id, id)
    .run()
}

async function payRenewal(db: D1Database, request: Request, id: number, admin: SuperAdmin): Promise<Response> {
  const input = readPayment(await request.json<Record<string, unknown>>().catch(() => null))
  if (input instanceof Response) return input
  const result = await markPaid(db, id, input, admin)
  if (!result.meta.changes) return error('That renewal is no longer pending', 409)
  return renewalResponse(db, id)
}

async function cancelRenewal(db: D1Database, id: number, admin: SuperAdmin): Promise<Response> {
  const result = await db
    .prepare(`UPDATE subscription_renewals SET status = 'cancelled', confirmed_by = ? WHERE id = ? AND status = 'pending'`)
    .bind(admin.id, id)
    .run()
  if (!result.meta.changes) return error('That renewal is no longer pending', 409)
  return renewalResponse(db, id)
}

/** Records a payment a store made without asking from its Subscription page. */
export async function recordStorePayment(
  db: D1Database,
  request: Request,
  storeId: number,
  admin: SuperAdmin,
): Promise<Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  const input = readPayment(body)
  if (input instanceof Response) return input
  const planId = typeof body?.planId === 'string' ? body.planId : ''
  if (!(await db.prepare('SELECT 1 FROM plans WHERE id = ?').bind(planId).first())) return error('Choose a plan', 400)
  if (!(await db.prepare('SELECT 1 FROM stores WHERE id = ?').bind(storeId).first())) return error('Store not found', 404)

  // Goes through 'pending' so the same trigger extends the store
  const row = await db
    .prepare(
      `INSERT INTO subscription_renewals (store_id, plan_id) VALUES (?, ?)
       ON CONFLICT DO NOTHING RETURNING id`,
    )
    .bind(storeId, planId)
    .first<{ id: number }>()
  if (!row) {
    return error('This store has a renewal waiting for payment. Confirm or cancel it on the Billing tab instead.', 409)
  }
  await markPaid(db, row.id, input, admin)
  return renewalResponse(db, row.id, 201)
}

/** Handles /api/us-panel/renewals[...], or returns null if the path isn't one of them. */
export async function handleRenewals(
  db: D1Database,
  request: Request,
  url: URL,
  admin: SuperAdmin,
): Promise<Response | null> {
  if (url.pathname === '/api/us-panel/renewals') {
    return request.method === 'GET' ? listRenewals(db, url) : error('Method not allowed', 405)
  }
  const match = url.pathname.match(/^\/api\/us-panel\/renewals\/(\d+)\/(pay|cancel)$/)
  if (!match) return null
  if (request.method !== 'POST') return error('Method not allowed', 405)
  const id = Number(match[1])
  return match[2] === 'pay' ? payRenewal(db, request, id, admin) : cancelRenewal(db, id, admin)
}
