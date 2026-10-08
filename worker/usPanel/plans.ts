// Subscription plans, for super admins (US Panel). Plans can be edited but not added or
// removed (their ids are referenced by stores). Lowering a cap doesn't take anything away:
// stores already over it keep what they have but can't add more.
//
//   GET /api/us-panel/plans                                                   -> plans (with store counts)
//   PUT /api/us-panel/plans/:id  { name, maxUsers, maxAdmins, maxProducts, monthlyPrice } -> plan

import { cleanText, error } from '../documents'
import { PLAN_COLUMNS, publicPlan, type PlanRow } from '../subscription'

const MAX_NAME_LENGTH = 50
const MAX_COUNT = 1_000_000

const PLAN_SELECT = `SELECT ${PLAN_COLUMNS}, (SELECT COUNT(*) FROM stores WHERE plan_id = p.id) AS stores FROM plans p`

const withStores = (row: PlanRow & { stores: number }) => ({ ...publicPlan(row), stores: row.stores })

const isCount = (value: unknown, min: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= MAX_COUNT

async function updatePlan(db: D1Database, request: Request, id: string): Promise<Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body) return error('Invalid request body', 400)

  const name = cleanText(body.name)
  if (!name) return error('Plan name is required', 400)
  if (name.length > MAX_NAME_LENGTH) return error(`Plan name must be ${MAX_NAME_LENGTH} characters or less`, 400)
  if (!isCount(body.maxUsers, 1)) return error('Users must be at least 1', 400)
  const maxAdmins = body.maxAdmins ?? null
  if (maxAdmins !== null && !isCount(maxAdmins, 1)) return error('Admins must be at least 1, or left blank for any', 400)
  if (maxAdmins !== null && maxAdmins > body.maxUsers) return error("Admins can't be more than users", 400)
  if (!isCount(body.maxProducts, 0)) return error('Products must be 0 or more', 400)
  if (!isCount(body.monthlyPrice, 0)) return error('Monthly price must be a whole number of pesos', 400)

  const result = await db
    .prepare('UPDATE plans SET name = ?, max_users = ?, max_admins = ?, max_products = ?, monthly_price = ? WHERE id = ?')
    .bind(name, body.maxUsers, maxAdmins, body.maxProducts, body.monthlyPrice, id)
    .run()
  if (!result.meta.changes) return error('Plan not found', 404)
  const row = await db.prepare(`${PLAN_SELECT} WHERE p.id = ?`).bind(id).first<PlanRow & { stores: number }>()
  return Response.json(withStores(row!))
}

/** Handles /api/us-panel/plans[/:id], or returns null if the path isn't one of them. */
export async function handlePlans(db: D1Database, request: Request, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/us-panel/plans') {
    if (request.method !== 'GET') return error('Method not allowed', 405)
    const { results } = await db.prepare(`${PLAN_SELECT} ORDER BY p.sort_order`).all<PlanRow & { stores: number }>()
    return Response.json(results.map(withStores))
  }
  const match = url.pathname.match(/^\/api\/us-panel\/plans\/([a-z0-9_-]{1,40})$/)
  if (!match) return null
  if (request.method !== 'PUT') return error('Method not allowed', 405)
  return updatePlan(db, request, match[1]!)
}
