// Subscription plans. Each store is on one plan (stores.plan_id), which caps its users
// (inactive ones count too; delete a user to free the seat), how many of them may have
// the Admin role, and its products. Plans are billed monthly and run until
// stores.plan_expires_at; after that the store is read-only (see index.ts) until renewed.
//
// Admins request a renewal (optionally on another plan) here. With online payment on (see
// paymongo.ts), they pay it on PayMongo's checkout page and its webhook marks it paid;
// otherwise a super admin marks it paid in the US Panel (see usPanel/billing.ts). Either way
// the store is extended by the months paid for.
//
// Moving to another plan: a plan that costs the same or more applies as soon as it's paid; a
// cheaper one waits until the period already paid for runs out (applyDuePlanChanges). Another
// plan can only be requested if the store fits its caps, and while a cheaper plan is pending or
// scheduled the store is held to its caps. A store over its caps anyway (a super admin moved it,
// or lowered a plan's caps) keeps what it has but can't add more.
//
//   GET    /api/plans                               -> plans, cheapest first (public: the landing page's pricing)
//   GET    /api/subscription                        -> { plan, expiresAt, expired, usage, plans, pendingRenewal,
//                                                       scheduledPlan, renewals, onlinePayment, onlinePaymentFees }
//   POST   /api/subscription/renewals               { planId } -> renewal + { checkoutUrl } (admins; one pending at a time)
//   POST   /api/subscription/renewals/:id/checkout  -> { checkoutUrl }  (admins; pays a pending renewal online)
//   DELETE /api/subscription/renewals/:id           -> { ok }           (admins; cancels a pending renewal)
//
// The caps are checked inside the INSERT / UPDATE statements themselves (with the SQL
// below), so two saves at once can't both take the last seat.

import { error } from './documents'
import {
  createCheckoutSession,
  expireCheckoutSession,
  onlinePaymentEnabled,
  type PaymongoEnv,
} from './paymongo'
import { getServiceCharge, renewalChargePesos } from './serviceCharges'
import type { SessionUser } from './session'

/** Offered on a renewal's checkout page (PayMongo's names) */
const RENEWAL_PAYMENT_METHODS = ['gcash', 'paymaya', 'card', 'qrph', 'grab_pay']

export interface PlanRow {
  id: string
  name: string
  max_users: number
  max_admins: number | null
  max_products: number
  monthly_price: number // whole pesos
}

export interface PlanUsage {
  plan: PlanRow
  upcoming: PlanRow[] // other plans the store is moving to (see CAPPING_PLAN_IDS)
  users: number
  admins: number
  products: number
}

/**
 * Every new store (Google signup or added in the US Panel) starts with this free trial: one
 * calendar month, as an SQLite datetime modifier. Keep TRIAL_LABEL in src/api/subscription.ts in step.
 */
export const TRIAL_PERIOD = '+1 month'

export const PLAN_COLUMNS = 'p.id, p.name, p.max_users, p.max_admins, p.max_products, p.monthly_price'

/**
 * Ids of the plans whose caps store `?` is held to: its own, and any it's moving to (a scheduled
 * plan change, or a renewal waiting for payment), so it can't grow past a smaller plan it's about
 * to be on. The lowest cap of these applies. (binds: storeId, storeId)
 */
const CAPPING_PLAN_IDS = `SELECT plan_id FROM stores WHERE id = ?
  UNION SELECT plan_id FROM subscription_renewals WHERE store_id = ? AND (status = 'pending' OR plan_scheduled = 1)`

/** SQL that's true while store `?` can add a user (binds: storeId × 3) */
export const USER_SEAT_FREE = `(SELECT COUNT(*) FROM users WHERE store_id = ?) <
  (SELECT MIN(max_users) FROM plans WHERE id IN (${CAPPING_PLAN_IDS}))`

/** SQL that's true while store `?` can give one more user the Admin role (binds: storeId × 3) */
export const ADMIN_SEAT_FREE = `(SELECT cap IS NULL OR cap > (
    SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE u.store_id = ? AND r.is_admin = 1)
  FROM (SELECT MIN(max_admins) AS cap FROM plans WHERE id IN (${CAPPING_PLAN_IDS})))` // MIN skips NULL (any)

/** SQL that's true while store `?` can add a product (binds: storeId × 3) */
export const PRODUCT_SLOT_FREE = `(SELECT COUNT(*) FROM products WHERE store_id = ?) <
  (SELECT MIN(max_products) FROM plans WHERE id IN (${CAPPING_PLAN_IDS}))`

/** The binds of USER_SEAT_FREE, ADMIN_SEAT_FREE and PRODUCT_SLOT_FREE */
export const capBinds = (storeId: number) => [storeId, storeId, storeId]

export function publicPlan(row: PlanRow) {
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
  const [row, upcoming] = await Promise.all([
    db
      .prepare(
        `SELECT ${PLAN_COLUMNS},
           (SELECT COUNT(*) FROM users WHERE store_id = st.id) AS users,
           (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
              WHERE u.store_id = st.id AND r.is_admin = 1) AS admins,
           (SELECT COUNT(*) FROM products WHERE store_id = st.id) AS products
         FROM stores st JOIN plans p ON p.id = st.plan_id WHERE st.id = ?`,
      )
      .bind(storeId)
      .first<PlanRow & { users: number; admins: number; products: number }>(),
    db
      .prepare(
        `SELECT ${PLAN_COLUMNS} FROM plans p
         WHERE p.id IN (${CAPPING_PLAN_IDS}) AND p.id != (SELECT plan_id FROM stores WHERE id = ?)`,
      )
      .bind(storeId, storeId, storeId)
      .all<PlanRow>(),
  ])
  if (!row) return null
  const { users, admins, products, ...plan } = row
  return { plan, upcoming: upcoming.results, users, admins, products }
}

type Cap = 'max_users' | 'max_admins' | 'max_products'

/** The plan whose cap applies (the lowest of the store's plan and those it's moving to); its cap null: any */
export function cappingPlan(usage: PlanUsage, cap: Cap): PlanRow {
  const capOf = (p: PlanRow) => p[cap] ?? Infinity
  return usage.upcoming.reduce((low, p) => (capOf(p) < capOf(low) ? p : low), usage.plan)
}

function limitReached(usage: PlanUsage, cap: Cap, noun: string): Response {
  const plan = cappingPlan(usage, cap)
  const max = plan[cap] ?? 0
  const allows = `${max.toLocaleString('en-US')} ${noun}${max === 1 ? '' : 's'}`
  return plan.id === usage.plan.id
    ? error(`Your ${plan.name} plan allows ${allows}. Upgrade your subscription plan to add more.`, 409)
    : error(`Your store is moving to the ${plan.name} plan, which allows ${allows}, so no more can be added.`, 409)
}

export const userLimitReached = (usage: PlanUsage) => limitReached(usage, 'max_users', 'user')
export const adminLimitReached = (usage: PlanUsage) => limitReached(usage, 'max_admins', 'admin')
export const productLimitReached = (usage: PlanUsage) => limitReached(usage, 'max_products', 'product')

/** True when the store has as many users as its caps allow */
export const usersFull = (usage: PlanUsage) => usage.users >= cappingPlan(usage, 'max_users').max_users

/** True when the store has as many admins as its caps allow */
export function adminsFull(usage: PlanUsage): boolean {
  const max = cappingPlan(usage, 'max_admins').max_admins
  return max !== null && usage.admins >= max
}

/**
 * What a store has over a plan's caps, e.g. ["1 user (you have 5)", "500 products (you have 1,240)"].
 * Keep in step with planOverage in src/api/subscription.ts.
 */
export function planOverage(usage: Pick<PlanUsage, 'users' | 'admins' | 'products'>, plan: PlanRow): string[] {
  const count = (n: number, noun: string) => `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`
  const over: string[] = []
  if (usage.users > plan.max_users) over.push(`${count(plan.max_users, 'user')} (you have ${usage.users})`)
  if (plan.max_admins !== null && usage.admins > plan.max_admins) {
    over.push(`${count(plan.max_admins, 'admin')} (you have ${usage.admins})`)
  }
  if (usage.products > plan.max_products) {
    over.push(`${count(plan.max_products, 'product')} (you have ${usage.products.toLocaleString('en-US')})`)
  }
  return over
}

const joinList = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/** "YYYY-MM-DD HH:MM:SS" (UTC), like the timestamps in the database */
const sqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

/**
 * Moves stores to the plans of paid renewals whose periods have started (a cheaper plan waits for
 * its period: see migrations/0032_schedule_plan_changes.sql). One store, or every store with null.
 */
export async function applyDuePlanChanges(db: D1Database, storeId: number | null): Promise<void> {
  const now = sqlNow()
  const onlyStore = storeId === null ? '' : 'AND store_id = ?'
  const storeBind = storeId === null ? [] : [storeId]
  await db.batch([
    // The latest period that has started decides the plan
    db
      .prepare(
        `UPDATE stores SET plan_id = (
           SELECT sr.plan_id FROM subscription_renewals sr
           WHERE sr.store_id = stores.id AND sr.plan_scheduled = 1 AND sr.period_start <= ?
           ORDER BY sr.period_start DESC, sr.id DESC LIMIT 1
         ), updated_at = datetime('now')
         WHERE id IN (SELECT store_id FROM subscription_renewals WHERE plan_scheduled = 1 AND period_start <= ? ${onlyStore})`,
      )
      .bind(now, now, ...storeBind),
    db
      .prepare(`UPDATE subscription_renewals SET plan_scheduled = 0 WHERE plan_scheduled = 1 AND period_start <= ? ${onlyStore}`)
      .bind(now, ...storeBind),
  ])
}

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

async function getSubscription(db: D1Database, env: PaymongoEnv, user: SessionUser): Promise<Response> {
  const [usage, plans, renewals, charge, scheduled] = await Promise.all([
    getPlanUsage(db, user.store_id),
    listPlanRows(db),
    db
      .prepare(
        `SELECT ${RENEWAL_COLUMNS} FROM subscription_renewals sr ${RENEWAL_JOINS}
         WHERE sr.store_id = ? AND sr.status != 'cancelled' ORDER BY sr.id DESC LIMIT ?`,
      )
      .bind(user.store_id, MAX_RENEWALS_SHOWN + 1) // + the pending one, if any
      .all<RenewalRow>(),
    getServiceCharge(db, 'renewal'),
    // The next paid change to another plan, once its period starts
    db
      .prepare(
        `SELECT sr.plan_id, p.name AS plan_name, sr.period_start
         FROM subscription_renewals sr JOIN plans p ON p.id = sr.plan_id JOIN stores st ON st.id = sr.store_id
         WHERE sr.store_id = ? AND sr.plan_scheduled = 1 AND sr.plan_id != st.plan_id
         ORDER BY sr.period_start, sr.id LIMIT 1`,
      )
      .bind(user.store_id)
      .first<{ plan_id: string; plan_name: string; period_start: string }>(),
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
    scheduledPlan: scheduled
      ? { plan: { id: scheduled.plan_id, name: scheduled.plan_name }, startsAt: scheduled.period_start }
      : null,
    renewals: renewals.results.filter((r) => r.status === 'paid').slice(0, MAX_RENEWALS_SHOWN).map(publicRenewal),
    onlinePayment: onlinePaymentEnabled(env),
    // Whole pesos added to each plan's price when paid online, by plan id
    onlinePaymentFees: Object.fromEntries(
      plans.results.map((p) => [p.id, onlinePaymentEnabled(env) ? renewalChargePesos(charge, p.monthly_price) : 0]),
    ),
  })
}

/**
 * Opens a PayMongo checkout session for a pending renewal (replacing any earlier one) and returns
 * its URL, or null when online payment is off, the plan is free or the renewal isn't pending.
 */
async function openCheckout(
  db: D1Database,
  env: PaymongoEnv,
  user: SessionUser,
  renewalId: number,
  origin: string,
): Promise<string | null> {
  if (!onlinePaymentEnabled(env)) return null
  const renewal = await db
    .prepare(
      `SELECT p.name AS plan_name, p.monthly_price, sr.checkout_session_id
       FROM subscription_renewals sr JOIN plans p ON p.id = sr.plan_id
       WHERE sr.id = ? AND sr.store_id = ? AND sr.status = 'pending'`,
    )
    .bind(renewalId, user.store_id)
    .first<{ plan_name: string; monthly_price: number; checkout_session_id: string | null }>()
  if (!renewal || renewal.monthly_price <= 0) return null

  const feeCents = renewalChargePesos(await getServiceCharge(db, 'renewal'), renewal.monthly_price) * 100
  const back = `${origin}/subscription?payment=`
  const session = await createCheckoutSession(env, {
    lineItems: [
      { name: `${renewal.plan_name} plan, 1 month`, cents: renewal.monthly_price * 100 },
      // The renewal service charge, a line item of its own
      { name: 'Service charge', cents: feeCents },
    ],
    paymentMethodTypes: RENEWAL_PAYMENT_METHODS,
    description: `Subscription renewal for ${user.store_name}`,
    referenceNumber: `RNW-${renewalId}`,
    // The charge is read back from here when paid, as it may change before then
    metadata: { kind: 'renewal', renewal_id: String(renewalId), service_charge_cents: String(feeCents) },
    successUrl: `${back}success`,
    cancelUrl: `${back}cancelled`,
  })
  await db
    .prepare('UPDATE subscription_renewals SET checkout_session_id = ? WHERE id = ?')
    .bind(session.id, renewalId)
    .run()
  // Only the newest session can be paid, so the renewal isn't paid twice
  if (renewal.checkout_session_id) await expireCheckoutSession(env, renewal.checkout_session_id)
  return session.url
}

function checkoutFailed(err: unknown): Response {
  console.error(err)
  return error('Could not open the payment page. Please try again in a moment.', 502)
}

async function requestRenewal(
  db: D1Database,
  env: PaymongoEnv,
  user: SessionUser,
  request: Request,
  origin: string,
): Promise<Response> {
  const body = await request.json<{ planId?: unknown }>().catch(() => null)
  const planId = typeof body?.planId === 'string' ? body.planId : ''
  const plan = await db.prepare(`SELECT ${PLAN_COLUMNS} FROM plans p WHERE p.id = ?`).bind(planId).first<PlanRow>()
  if (!plan) return error('Choose a plan', 400)

  // Another plan has to fit what the store has (renewing its own plan is always allowed)
  const usage = await getPlanUsage(db, user.store_id)
  if (!usage) return error('Store not found', 404)
  const over = usage.plan.id === plan.id ? [] : planOverage(usage, plan)
  if (over.length) {
    return error(
      `The ${plan.name} plan allows ${joinList(over)}. Remove the extra ones first, or choose a bigger plan.`,
      409,
    )
  }

  // The partial unique index allows one pending renewal per store
  const row = await db
    .prepare(
      `INSERT INTO subscription_renewals (store_id, plan_id, requested_by) VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING RETURNING id`,
    )
    .bind(user.store_id, planId, user.id)
    .first<{ id: number }>()
  if (!row) return error('A renewal is already waiting for payment. Cancel it first to choose another plan.', 409)

  let checkoutUrl: string | null
  try {
    checkoutUrl = await openCheckout(db, env, user, row.id, origin)
  } catch (err) {
    // Nothing was paid yet: drop the request, so the admin can simply try again
    await db.prepare('DELETE FROM subscription_renewals WHERE id = ?').bind(row.id).run()
    return checkoutFailed(err)
  }

  const renewal = await db
    .prepare(`SELECT ${RENEWAL_COLUMNS} FROM subscription_renewals sr ${RENEWAL_JOINS} WHERE sr.id = ?`)
    .bind(row.id)
    .first<RenewalRow>()
  return Response.json({ ...publicRenewal(renewal!), checkoutUrl }, { status: 201 })
}

/** Opens a new checkout session for a pending renewal (e.g. the admin left the payment page). */
async function payOnline(
  db: D1Database,
  env: PaymongoEnv,
  user: SessionUser,
  id: number,
  origin: string,
): Promise<Response> {
  if (!onlinePaymentEnabled(env)) return error('Online payment is not available', 404)
  try {
    const checkoutUrl = await openCheckout(db, env, user, id, origin)
    if (!checkoutUrl) return error('That renewal is no longer waiting for payment', 404)
    return Response.json({ checkoutUrl })
  } catch (err) {
    return checkoutFailed(err)
  }
}

async function cancelRenewal(db: D1Database, env: PaymongoEnv, user: SessionUser, id: number): Promise<Response> {
  const pending = await db
    .prepare(`SELECT checkout_session_id FROM subscription_renewals WHERE id = ? AND store_id = ? AND status = 'pending'`)
    .bind(id, user.store_id)
    .first<{ checkout_session_id: string | null }>()
  if (!pending) return error('That renewal is no longer pending', 404)
  // Closed first, so it can't be paid once cancelled (if it was just paid, the webhook still records it)
  if (pending.checkout_session_id) await expireCheckoutSession(env, pending.checkout_session_id)

  const result = await db
    .prepare(`UPDATE subscription_renewals SET status = 'cancelled' WHERE id = ? AND store_id = ? AND status = 'pending'`)
    .bind(id, user.store_id)
    .run()
  if (result.meta.changes === 0) return error('That renewal is no longer pending', 404)
  return Response.json({ ok: true })
}

/** Handles /api/subscription and /api/subscription/renewals[/:id[/checkout]]. */
export async function handleSubscription(
  db: D1Database,
  env: PaymongoEnv,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  if (url.pathname === '/api/subscription') {
    if (request.method !== 'GET') return error('Method not allowed', 405)
    return getSubscription(db, env, user)
  }

  const isCollection = url.pathname === '/api/subscription/renewals'
  const itemMatch = url.pathname.match(/^\/api\/subscription\/renewals\/(\d+)$/)
  const checkoutMatch = url.pathname.match(/^\/api\/subscription\/renewals\/(\d+)\/checkout$/)
  if (!isCollection && !itemMatch && !checkoutMatch) return null

  if (!user.is_admin) return error('Only admins can renew the subscription', 403)
  if (isCollection && request.method === 'POST') return requestRenewal(db, env, user, request, url.origin)
  if (checkoutMatch && request.method === 'POST') return payOnline(db, env, user, Number(checkoutMatch[1]), url.origin)
  if (itemMatch && request.method === 'DELETE') return cancelRenewal(db, env, user, Number(itemMatch[1]))
  return error('Method not allowed', 405)
}
