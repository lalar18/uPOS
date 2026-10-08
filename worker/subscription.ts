// Subscription plans. Each store is on one plan (stores.plan_id), which caps its users
// (inactive ones count too; delete a user to free the seat), how many of them may have
// the Admin role, and its products. Plans are changed by the platform owner in the
// database (see migrations/0016_create_plans_and_roles.sql), not from the app.
//
//   GET /api/subscription   -> { plan, usage: { users, admins, products }, plans }
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
}

export interface PlanUsage {
  plan: PlanRow
  users: number
  admins: number
  products: number
}

const PLAN_COLUMNS = 'p.id, p.name, p.max_users, p.max_admins, p.max_products'

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
  }
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

/** Handles GET /api/subscription. */
export async function handleSubscription(db: D1Database, request: Request, user: SessionUser): Promise<Response> {
  if (request.method !== 'GET') return error('Method not allowed', 405)
  const [usage, plans] = await Promise.all([
    getPlanUsage(db, user.store_id),
    db.prepare(`SELECT ${PLAN_COLUMNS} FROM plans p ORDER BY p.sort_order`).all<PlanRow>(),
  ])
  if (!usage) return error('Store not found', 404)
  return Response.json({
    plan: publicPlan(usage.plan),
    usage: { users: usage.users, admins: usage.admins, products: usage.products },
    plans: plans.results.map(publicPlan),
  })
}
