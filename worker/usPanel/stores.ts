// Stores, for super admins (US Panel). Unlike the store's own pages, these reach every store.
//
//   GET    /api/us-panel/stores?search=&status=&planId=&test=&sort=&page=&pageSize=  -> { items, total }
//   POST   /api/us-panel/stores    { ...store info, planId, admin: { fullName, email, password } } -> store
//            (new stores start on the standard free trial, TRIAL_PERIOD)
//   GET    /api/us-panel/stores/:id                                   -> store (with usage and activity)
//   PUT    /api/us-panel/stores/:id                { ...store info }   -> store
//   PUT    /api/us-panel/stores/:id/status         { active }          -> store
//   PUT    /api/us-panel/stores/:id/test           { test }            -> store   (tags a test store, see below)
//   PUT    /api/us-panel/stores/:id/subscription   { planId, expiresOn } -> store   (override, no payment)
//   DELETE /api/us-panel/stores/:id/sessions                           -> { ok }    (signs every user out)
//   GET    /api/us-panel/stores/:id/users                              -> users
//   PUT    /api/us-panel/stores/:id/users/:userId/status   { active }  -> { ok }
//   PUT    /api/us-panel/stores/:id/users/:userId/password { password } -> { ok }
//
// status: active (open, not expired), expiring (within EXPIRING_DAYS), expired, disabled, pending (renewal waiting)
// test: 1 for test stores only, 0 for the others
//
// A test store (migration 0036) pays and is paid through PayMongo's test mode, and its income is
// left out of the dashboard and income pages. Only super admins tag one: the store's own pages
// can't change it.

import { cleanText, error, isDate, likePattern, positiveId, readPaging, referenceId } from '../documents'
import { hashPassword } from '../password'
import { WALLET_BALANCE_SQL } from '../storePayouts'
import { readStoreInput } from '../store'
import { PLAN_COLUMNS, publicPlan, TRIAL_PERIOD, type PlanRow } from '../subscription'
import { EMAIL_PATTERN, emailTaken, MAX_FULL_NAME_LENGTH, readPassword } from '../users'

export const EXPIRING_DAYS = 7

interface StoreListRow {
  id: number
  name: string
  email: string | null
  phone: string | null
  city: string | null
  is_active: number
  is_test: number
  plan_id: string
  plan_name: string
  plan_expires_at: string | null
  expired: number
  users: number
  products: number
  pending_renewal: number
  created_at: string
}

interface StoreDetailRow extends PlanRow {
  store_id: number
  store_name: string
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  tin: string | null
  is_active: number
  is_test: number
  plan_expires_at: string | null
  expired: number
  users: number
  admins: number
  products: number
  sales: number
  last_sale_at: string | null
  created_at: string
  updated_at: string
}

interface StoreUserRow {
  id: number
  email: string
  full_name: string
  role_name: string
  is_admin: number
  is_active: number
  created_at: string
}

const EXPIRED_SQL = "(st.plan_expires_at IS NULL OR st.plan_expires_at <= datetime('now'))"

const LIST_COLUMNS = `st.id, st.name, st.email, st.phone, st.city, st.is_active, st.is_test, st.plan_id, p.name AS plan_name,
  st.plan_expires_at, ${EXPIRED_SQL} AS expired,
  (SELECT COUNT(*) FROM users WHERE store_id = st.id) AS users,
  (SELECT COUNT(*) FROM products WHERE store_id = st.id) AS products,
  EXISTS (SELECT 1 FROM subscription_renewals WHERE store_id = st.id AND status = 'pending') AS pending_renewal,
  st.created_at`

function publicListStore(row: StoreListRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    city: row.city,
    active: row.is_active === 1,
    test: row.is_test === 1,
    plan: { id: row.plan_id, name: row.plan_name },
    expiresAt: row.plan_expires_at,
    expired: row.expired === 1,
    users: row.users,
    products: row.products,
    pendingRenewal: row.pending_renewal === 1,
    createdAt: row.created_at,
  }
}

function publicStoreDetail(row: StoreDetailRow) {
  return {
    id: row.store_id,
    name: row.store_name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    province: row.province,
    postalCode: row.postal_code,
    tin: row.tin,
    active: row.is_active === 1,
    test: row.is_test === 1,
    plan: publicPlan(row),
    expiresAt: row.plan_expires_at,
    expired: row.expired === 1,
    usage: { users: row.users, admins: row.admins, products: row.products },
    activity: { sales: row.sales, lastSaleAt: row.last_sale_at },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const storeNotFound = () => error('Store not found', 404)

async function getStoreDetail(db: D1Database, id: number): Promise<Response> {
  const row = await db
    .prepare(
      `SELECT ${PLAN_COLUMNS}, st.id AS store_id, st.name AS store_name, st.email, st.phone, st.address, st.city,
         st.province, st.postal_code, st.tin, st.is_active, st.is_test, st.plan_expires_at, ${EXPIRED_SQL} AS expired,
         (SELECT COUNT(*) FROM users WHERE store_id = st.id) AS users,
         (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE u.store_id = st.id AND r.is_admin = 1) AS admins,
         (SELECT COUNT(*) FROM products WHERE store_id = st.id) AS products,
         (SELECT COUNT(*) FROM sales WHERE store_id = st.id) AS sales,
         (SELECT MAX(created_at) FROM sales WHERE store_id = st.id) AS last_sale_at,
         st.created_at, st.updated_at
       FROM stores st JOIN plans p ON p.id = st.plan_id WHERE st.id = ?`,
    )
    .bind(id)
    .first<StoreDetailRow>()
  return row ? Response.json(publicStoreDetail(row)) : storeNotFound()
}

async function listStores(db: D1Database, url: URL): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const status = url.searchParams.get('status')
  const planId = url.searchParams.get('planId')
  const { pageSize, offset } = readPaging(url)

  const where: string[] = []
  const params: unknown[] = []
  if (search) {
    // Name, contact details, store code (STR-00042), or the email of any of its users
    const pattern = likePattern(search)
    where.push(`(st.name LIKE ? ESCAPE '\\' OR st.email LIKE ? ESCAPE '\\' OR st.phone LIKE ? ESCAPE '\\'
      OR st.id = ? OR EXISTS (SELECT 1 FROM users u WHERE u.store_id = st.id AND u.email LIKE ? ESCAPE '\\'))`)
    params.push(pattern, pattern, pattern, referenceId(search, 'STR') ?? 0, pattern)
  }
  if (status === 'active') where.push(`st.is_active = 1 AND NOT ${EXPIRED_SQL}`)
  if (status === 'expiring') {
    where.push(`st.is_active = 1 AND NOT ${EXPIRED_SQL} AND st.plan_expires_at <= datetime('now', ?)`)
    params.push(`+${EXPIRING_DAYS} days`)
  }
  if (status === 'expired') where.push(`st.is_active = 1 AND ${EXPIRED_SQL}`)
  if (status === 'disabled') where.push('st.is_active = 0')
  if (status === 'pending') {
    where.push("EXISTS (SELECT 1 FROM subscription_renewals WHERE store_id = st.id AND status = 'pending')")
  }
  if (planId) {
    where.push('st.plan_id = ?')
    params.push(planId)
  }
  const test = url.searchParams.get('test')
  if (test === '1' || test === '0') where.push(`st.is_test = ${test}`)
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const orderSql = url.searchParams.get('sort') === 'expiry' ? 'st.plan_expires_at IS NOT NULL, st.plan_expires_at, st.id' : 'st.id DESC'

  const [items, count] = await db.batch<StoreListRow | { total: number }>([
    db
      .prepare(
        `SELECT ${LIST_COLUMNS} FROM stores st JOIN plans p ON p.id = st.plan_id ${whereSql}
         ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
      )
      .bind(...params, pageSize, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM stores st ${whereSql}`).bind(...params),
  ])
  return Response.json({
    items: (items!.results as StoreListRow[]).map(publicListStore),
    total: (count!.results[0] as { total: number }).total,
  })
}

/** Adds a store on a plan (on the standard free trial), with its first admin user. */
async function createStore(db: D1Database, request: Request): Promise<Response> {
  const info = await readStoreInput(request.clone())
  if (info instanceof Response) return info
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body) return error('Invalid request body', 400)

  const planId = typeof body.planId === 'string' ? body.planId : ''
  if (!(await db.prepare('SELECT 1 FROM plans WHERE id = ?').bind(planId).first())) return error('Choose a plan', 400)

  const admin = (body.admin ?? {}) as Record<string, unknown>
  const adminName = cleanText(admin.fullName)
  if (!adminName) return error("The admin's full name is required", 400)
  if (adminName.length > MAX_FULL_NAME_LENGTH) {
    return error(`The admin's full name must be ${MAX_FULL_NAME_LENGTH} characters or less`, 400)
  }
  const adminEmail = cleanText(admin.email).toLowerCase()
  if (adminEmail.length > 254 || !EMAIL_PATTERN.test(adminEmail)) return error("Enter the admin's email address", 400)
  const password = readPassword(admin.password)
  if (password instanceof Response) return password
  if (await emailTaken(db, adminEmail)) return error('Another account already uses the admin email', 409)

  // The insert triggers add the store's Admin and Cashier roles
  const store = await db
    .prepare(
      `INSERT INTO stores (name, email, phone, address, city, province, postal_code, tin, plan_id, plan_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?)) RETURNING id`,
    )
    .bind(
      info.name,
      info.email,
      info.phone,
      info.address,
      info.city,
      info.province,
      info.postalCode,
      info.tin,
      planId,
      TRIAL_PERIOD,
    )
    .first<{ id: number }>()
  if (!store) return error('Could not add the store', 500)

  try {
    await db
      .prepare(
        `INSERT INTO users (store_id, email, full_name, role_id, password_hash)
         SELECT ?, ?, ?, r.id, ? FROM roles r WHERE r.store_id = ? AND r.is_admin = 1`,
      )
      .bind(store.id, adminEmail, adminName, await hashPassword(password), store.id)
      .run()
  } catch (e) {
    // Don't leave a store nobody can sign in to (its roles go with it)
    await db.prepare('DELETE FROM stores WHERE id = ?').bind(store.id).run()
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('UNIQUE')) return error('Another account already uses the admin email', 409)
    throw e
  }

  const response = await getStoreDetail(db, store.id)
  return new Response(response.body, { status: 201, headers: response.headers })
}

async function updateStore(db: D1Database, request: Request, id: number): Promise<Response> {
  const info = await readStoreInput(request)
  if (info instanceof Response) return info
  const result = await db
    .prepare(
      `UPDATE stores SET name = ?, email = ?, phone = ?, address = ?, city = ?, province = ?,
         postal_code = ?, tin = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(info.name, info.email, info.phone, info.address, info.city, info.province, info.postalCode, info.tin, id)
    .run()
  return result.meta.changes ? getStoreDetail(db, id) : storeNotFound()
}

const signOutStoreUsers = (db: D1Database, storeId: number) =>
  db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE store_id = ?)').bind(storeId)

/** A disabled store's users can't sign in at all (and are signed out now). */
async function setStoreStatus(db: D1Database, request: Request, id: number): Promise<Response> {
  const body = await request.json<{ active?: unknown }>().catch(() => null)
  if (typeof body?.active !== 'boolean') return error('active must be true or false', 400)
  const [result] = await db.batch([
    db.prepare("UPDATE stores SET is_active = ?, updated_at = datetime('now') WHERE id = ?").bind(body.active ? 1 : 0, id),
    ...(body.active ? [] : [signOutStoreUsers(db, id)]),
  ])
  return result!.meta.changes ? getStoreDetail(db, id) : storeNotFound()
}

/**
 * Tags a store as a test store, or a test store as a real one. Its PayMongo payments move to the
 * other mode's keys, so not while anything is on its way through PayMongo (it would be checked
 * with the wrong keys), nor while its wallet holds money (paid in the other mode).
 */
async function setTestStore(db: D1Database, request: Request, id: number): Promise<Response> {
  const body = await request.json<{ test?: unknown }>().catch(() => null)
  if (typeof body?.test !== 'boolean') return error('test must be true or false', 400)
  const store = await db
    .prepare(
      `SELECT is_test,
         EXISTS (SELECT 1 FROM sale_checkouts WHERE store_id = ?1 AND status = 'pending') AS checkouts,
         EXISTS (SELECT 1 FROM subscription_renewals WHERE store_id = ?1 AND status = 'pending'
                 AND checkout_session_id IS NOT NULL) AS renewals,
         EXISTS (SELECT 1 FROM wallet_withdrawals WHERE store_id = ?1 AND status = 'pending') AS withdrawals,
         ${WALLET_BALANCE_SQL} AS balance
       FROM stores WHERE id = ?1`,
    )
    .bind(id)
    .first<{ is_test: number; checkouts: number; renewals: number; withdrawals: number; balance: number }>()
  if (!store) return storeNotFound()
  if (store.is_test === (body.test ? 1 : 0)) return getStoreDetail(db, id)
  if (store.checkouts) return error('The store has a sale waiting for an online payment. Wait for it or cancel it first.', 409)
  if (store.renewals) return error('The store has a renewal waiting for an online payment. Settle or cancel it first.', 409)
  if (store.withdrawals) return error('The store has a withdrawal waiting. Send or reject it first.', 409)
  if (store.balance) return error("The store's wallet still holds money. Pay it out first.", 409)

  await db.prepare("UPDATE stores SET is_test = ?, updated_at = datetime('now') WHERE id = ?").bind(body.test ? 1 : 0, id).run()
  return getStoreDetail(db, id)
}

/** Moves a store to a plan and sets when it expires, without a payment (e.g. a goodwill extension). */
async function setSubscription(db: D1Database, request: Request, id: number): Promise<Response> {
  const body = await request.json<{ planId?: unknown; expiresOn?: unknown }>().catch(() => null)
  const planId = typeof body?.planId === 'string' ? body.planId : ''
  if (!(await db.prepare('SELECT 1 FROM plans WHERE id = ?').bind(planId).first())) return error('Choose a plan', 400)
  if (!isDate(body?.expiresOn)) return error('Choose the expiry date', 400)

  // Runs to the end of that day in the Philippines (23:59:59 UTC+8). The override replaces any
  // plan change paid for earlier that hadn't started yet.
  const [result] = await db.batch([
    db
      .prepare(
        `UPDATE stores SET plan_id = ?, plan_expires_at = datetime(?, '+16 hours', '-1 second'), updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(planId, body!.expiresOn, id),
    db.prepare('UPDATE subscription_renewals SET plan_scheduled = 0 WHERE store_id = ? AND plan_scheduled = 1').bind(id),
  ])
  return result!.meta.changes ? getStoreDetail(db, id) : storeNotFound()
}

async function listStoreUsers(db: D1Database, storeId: number): Promise<Response> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.email, u.full_name, r.name AS role_name, r.is_admin, u.is_active, u.created_at
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.store_id = ? ORDER BY r.is_admin DESC, u.full_name, u.id LIMIT 500`,
    )
    .bind(storeId)
    .all<StoreUserRow>()
  return Response.json(
    results.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: { name: row.role_name, isAdmin: row.is_admin === 1 },
      active: row.is_active === 1,
      createdAt: row.created_at,
    })),
  )
}

async function setUserStatus(db: D1Database, request: Request, storeId: number, userId: number): Promise<Response> {
  const body = await request.json<{ active?: unknown }>().catch(() => null)
  if (typeof body?.active !== 'boolean') return error('active must be true or false', 400)
  const [result] = await db.batch([
    db
      .prepare("UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ? AND store_id = ?")
      .bind(body.active ? 1 : 0, userId, storeId),
    ...(body.active ? [] : [db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId)]),
  ])
  return result!.meta.changes ? Response.json({ ok: true }) : error('User not found', 404)
}

/** Sets a new password for a store user (e.g. a locked-out admin); they're signed out everywhere. */
async function resetUserPassword(db: D1Database, request: Request, storeId: number, userId: number): Promise<Response> {
  const body = await request.json<{ password?: unknown }>().catch(() => null)
  const password = readPassword(body?.password)
  if (password instanceof Response) return password
  const [result] = await db.batch([
    db
      .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ? AND store_id = ?")
      .bind(await hashPassword(password), userId, storeId),
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND store_id = ?)')
      .bind(userId, userId, storeId),
  ])
  return result!.meta.changes ? Response.json({ ok: true }) : error('User not found', 404)
}

/** Handles /api/us-panel/stores[...], or returns null if the path isn't one of them. */
export async function handleStores(db: D1Database, request: Request, url: URL): Promise<Response | null> {
  const path = url.pathname.slice('/api/us-panel/stores'.length)
  const method = request.method

  if (path === '') {
    if (method === 'GET') return listStores(db, url)
    if (method === 'POST') return createStore(db, request)
    return error('Method not allowed', 405)
  }

  const match = path.match(/^\/(\d+)(\/.*)?$/)
  if (!match) return null
  const storeId = positiveId(Number(match[1]))
  if (!storeId) return storeNotFound()
  const rest = match[2] ?? ''

  if (rest === '') {
    if (method === 'GET') return getStoreDetail(db, storeId)
    if (method === 'PUT') return updateStore(db, request, storeId)
  }
  if (rest === '/status' && method === 'PUT') return setStoreStatus(db, request, storeId)
  if (rest === '/test' && method === 'PUT') return setTestStore(db, request, storeId)
  if (rest === '/subscription' && method === 'PUT') return setSubscription(db, request, storeId)
  if (rest === '/sessions' && method === 'DELETE') {
    await signOutStoreUsers(db, storeId).run()
    return Response.json({ ok: true })
  }
  if (rest === '/users' && method === 'GET') return listStoreUsers(db, storeId)

  const userMatch = rest.match(/^\/users\/(\d+)\/(status|password)$/)
  if (userMatch && method === 'PUT') {
    const userId = Number(userMatch[1])
    return userMatch[2] === 'status'
      ? setUserStatus(db, request, storeId, userId)
      : resetUserPassword(db, request, storeId, userId)
  }
  return null
}
