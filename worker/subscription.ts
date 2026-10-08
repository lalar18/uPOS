// Subscription plans. Each store is on one plan (stores.plan_id), which caps its users
// (inactive ones count too; delete a user to free the seat), how many of them may have
// the Admin role, and its products. Plans are billed monthly and run until
// stores.plan_expires_at; after that the store is read-only (see index.ts) until renewed.
//
// Admins request a renewal (optionally on another plan) here. Until online payment exists,
// the platform owner marks it paid in the database, which extends the store by a month
// (see migrations/0017_add_subscription_expiry.sql).
//
//   GET    /api/plans                       -> plans, cheapest first (public: the landing page's pricing)
//   GET    /api/subscription                -> { plan, expiresAt, expired, usage, plans, pendingRenewal, renewals }
//   POST   /api/subscription/renewals       { planId } -> renewal   (admins; one pending at a time)
//   DELETE /api/subscription/renewals/:id   -> { ok }                (admins; cancels a pending renewal)
//
// The caps are checked inside the INSERT / UPDATE statements themselves (with the SQL
// below), so two saves at once can't both take the last seat.

import { error } from './documents'
import type { SessionUser } from './session'

interface PlanRow {
  id: string
  name: string
  max_users: number
  max_admins: number | null
  max_products: number
  monthly_price: number // whole pesos
}

export interface PlanUsage {
  plan: PlanRow
  users: number
  admins: number
  products: number
}

const PLAN_COLUMNS = 'p.id, p.name, p.max_users, p.max_admins, p.max_products, p.monthly_price'

/** SQL that's true while store `?` can add a user (binds: storeId, storeId) */
export const USER_SEAT_FREE = `(SELECT COUNT(*) FROM users WHERE store_id = ?) <
  (SELECT p.max_users FROM stores st JOIN plans p ON p.id = st.plan_id WHERE st.id = ?)`

/** SQL that's true while store `?` can give one more user the Admin role (binds: storeId) */
export const ADMIN_SEAT_FREE = `(SELECT p.max_admins IS NULL OR p.max_admins > (
    SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE u.store_id = st.id AND r.is_admin = 1)
  FROM stores st JOIN plans p ON p.id = st.plan_id WHERE st.id = ?)`

/** SQL that's true while store `?` can add a product (binds: storeId, storeId) */
export const PRODUCT_SLOT_FREE = `(SELECT COUNT(*) FROM products WHERE store_id = ?) <
  (SELECT p.max_products FROM stores st JOIN plans p ON p.id = st.plan_id WHERE st.id = ?)`

function publicPlan(row: PlanRow) {
  return {
    id: row.id,
    name: row.name,
    maxUsers: row.max_users,
    maxAdmins: row.max_admins,
    maxProducts: row.max_products,
    monthlyPrice: row.monthly_price,
  }
}

const listPlanRows = (db: D1Database) =>
  db.prepare(`SELECT ${PLAN_COLUMNS} FROM plans p ORDER BY p.sort_order`).all<PlanRow>()

/** GET /api/plans: every plan and its price, for visitors who aren't logged in. */
export async function listPlans(db: D1Database): Promise<Response> {
  const plans = await listPlanRows(db)
  return Response.json(plans.results.map(publicPlan))
}

export async function getPlanUsage(db: D1Database, storeId: number): Promise<PlanUsage | null> {
  const row = await db
    .prepare(
      `SELECT ${PLAN_COLUMNS},
         (SELECT COUNT(*) FROM users WHERE store_id = st.id) AS users,
         (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
            WHERE u.store_id = st.id AND r.is_admin = 1) AS admins,
         (SELECT COUNT(*) FROM products WHERE store_id = st.id) AS products
       FROM stores st JOIN plans p ON p.id = st.plan_id WHERE st.id = ?`,
    )
    .bind(storeId)
    .first<PlanRow & { users: number; admins: number; products: number }>()
  if (!row) return null
  const { users, admins, products, ...plan } = row
  return { plan, users, admins, products }
}

const upgradeHint = 'Upgrade your subscription plan to add more.'

export const userLimitReached = (usage: PlanUsage) =>
  error(`Your ${usage.plan.name} plan allows ${usage.plan.max_users} user${usage.plan.max_users === 1 ? '' : 's'}. ${upgradeHint}`, 409)

export const adminLimitReached = (usage: PlanUsage) =>
  error(`Your ${usage.plan.name} plan allows ${usage.plan.max_admins} admin${usage.plan.max_admins === 1 ? '' : 's'}. ${upgradeHint}`, 409)

export const productLimitReached = (usage: PlanUsage) =>
  error(`Your ${usage.plan.name} plan allows ${usage.plan.max_products.toLocaleString('en-US')} products. ${upgradeHint}`, 409)

/** "Oct 8, 2026", for error messages (the browser formats dates itself) */
export const formatExpiry = (value: string | null) =>
  value
    ? new Date(value.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'Asia/Manila',
      })
    : null

/** Refuses a change while the store's subscription has expired (it stays viewable). */
export function subscriptionExpired(user: SessionUser): Response {
  const since = formatExpiry(user.plan_expires_at)
  return error(
    `Your subscription ${since ? `expired on ${since}` : 'has expired'}, so changes can't be saved. ` +
      (user.is_admin ? 'Renew it on the Subscription page.' : 'Ask your store admin to renew it.'),
    402,
  )
}

interface RenewalRow {
  id: number
  plan_id: string
  plan_name: string
  status: 'pending' | 'paid' | 'cancelled'
  requested_by_name: string | null
  period_start: string | null
  period_end: string | null
  created_at: string
  paid_at: string | null
}

const RENEWAL_COLUMNS = `sr.id, sr.plan_id, p.name AS plan_name, sr.status, u.full_name AS requested_by_name,
  sr.period_start, sr.period_end, sr.created_at, sr.paid_at`
const RENEWAL_JOINS = `JOIN plans p ON p.id = sr.plan_id LEFT JOIN users u ON u.id = sr.requested_by`

function publicRenewal(row: RenewalRow) {
  return {
    id: row.id,
    plan: { id: row.plan_id, name: row.plan_name },
    status: row.status,
    requestedBy: row.requested_by_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  }
}

const MAX_RENEWALS_SHOWN = 12

async function getSubscription(db: D1Database, user: SessionUser): Promise<Response> {
  const [usage, plans, renewals] = await Promise.all([
    getPlanUsage(db, user.store_id),
    listPlanRows(db),
    db
      .prepare(
        `SELECT ${RENEWAL_COLUMNS} FROM subscription_renewals sr ${RENEWAL_JOINS}
         WHERE sr.store_id = ? AND sr.status != 'cancelled' ORDER BY sr.id DESC LIMIT ?`,
      )
      .bind(user.store_id, MAX_RENEWALS_SHOWN + 1) // + the pending one, if any
      .all<RenewalRow>(),
  ])
  if (!usage) return error('Store not found', 404)
  const pending = renewals.results.find((r) => r.status === 'pending')
  return Response.json({
    plan: publicPlan(usage.plan),
    expiresAt: user.plan_expires_at,
    expired: user.subscription_expired,
    usage: { users: usage.users, admins: usage.admins, products: usage.products },
    plans: plans.results.map(publicPlan),
    pendingRenewal: pending ? publicRenewal(pending) : null,
    renewals: renewals.results.filter((r) => r.status === 'paid').slice(0, MAX_RENEWALS_SHOWN).map(publicRenewal),
  })
}

async function requestRenewal(db: D1Database, user: SessionUser, request: Request): Promise<Response> {
  const body = await request.json<{ planId?: unknown }>().catch(() => null)
  const planId = typeof body?.planId === 'string' ? body.planId : ''
  const plan = await db.prepare('SELECT id FROM plans WHERE id = ?').bind(planId).first()
  if (!plan) return error('Choose a plan', 400)

  // The partial unique index allows one pending renewal per store
  const row = await db
    .prepare(
      `INSERT INTO subscription_renewals (store_id, plan_id, requested_by) VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING RETURNING id`,
    )
    .bind(user.store_id, planId, user.id)
    .first<{ id: number }>()
  if (!row) return error('A renewal is already waiting for payment. Cancel it first to choose another plan.', 409)

  const renewal = await db
    .prepare(`SELECT ${RENEWAL_COLUMNS} FROM subscription_renewals sr ${RENEWAL_JOINS} WHERE sr.id = ?`)
    .bind(row.id)
    .first<RenewalRow>()
  return Response.json(publicRenewal(renewal!), { status: 201 })
}

async function cancelRenewal(db: D1Database, user: SessionUser, id: number): Promise<Response> {
  const result = await db
    .prepare(`UPDATE subscription_renewals SET status = 'cancelled' WHERE id = ? AND store_id = ? AND status = 'pending'`)
    .bind(id, user.store_id)
    .run()
  if (result.meta.changes === 0) return error('That renewal is no longer pending', 404)
  return Response.json({ ok: true })
}

/** Handles /api/subscription and /api/subscription/renewals[/:id]. */
export async function handleSubscription(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  if (url.pathname === '/api/subscription') {
    if (request.method !== 'GET') return error('Method not allowed', 405)
    return getSubscription(db, user)
  }

  const isCollection = url.pathname === '/api/subscription/renewals'
  const itemMatch = url.pathname.match(/^\/api\/subscription\/renewals\/(\d+)$/)
  if (!isCollection && !itemMatch) return null

  if (!user.is_admin) return error('Only admins can renew the subscription', 403)
  if (isCollection && request.method === 'POST') return requestRenewal(db, user, request)
  if (itemMatch && request.method === 'DELETE') return cancelRenewal(db, user, Number(itemMatch[1]))
  return error('Method not allowed', 405)
}
