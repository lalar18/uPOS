// User management for admins. Every query is limited to the admin's own store.
//
//   GET    /api/users?search=&roleId=&status=&page=&pageSize=           -> { items, total }
//   POST   /api/users              { email, fullName, roleId, active, password } -> user
//   PUT    /api/users/:id          { email, fullName, roleId, active }           -> user
//   PUT    /api/users/:id/password { password }                                  -> { ok }
//   DELETE /api/users/:id                                                         -> { ok }
//
// Safety rules, so a store can never lock itself out:
// - admins can't change their own role or status, delete themselves, or reset their own
//   password here (they use My Profile for that);
// - the store always keeps at least one active admin. The UPDATE / DELETE statements
//   check this themselves, so two admins saving at once can't both slip past it.
//
// The store's subscription plan caps its users and admins (see subscription.ts).
//
// Sales, stock adjustments etc. keep a copy of the user's name, so deleting a user
// keeps their history readable.

import { cleanText, error, likePattern, positiveId, readPaging } from './documents'
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password'
import type { SessionUser } from './session'
import {
  ADMIN_SEAT_FREE,
  adminLimitReached,
  getPlanUsage,
  USER_SEAT_FREE,
  userLimitReached,
} from './subscription'

interface UserRow {
  id: number
  email: string
  full_name: string
  role_id: number
  role_name: string
  role_is_admin: number
  is_active: number
  avatar_updated_at: string | null
  created_at: string
  updated_at: string
}

interface UserInput {
  email: string
  fullName: string
  roleId: number
  active: boolean
}

interface RoleInfo {
  id: number
  is_admin: number
}

const MAX_FULL_NAME_LENGTH = 100
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const USER_COLUMNS = `u.id, u.email, u.full_name, u.role_id, r.name AS role_name, r.is_admin AS role_is_admin,
  u.is_active, a.updated_at AS avatar_updated_at, u.created_at, u.updated_at`
const USER_FROM = 'FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN user_avatars a ON a.user_id = u.id'

/** SQL that's true while user `?` is an active admin (binds: userId) */
const IS_ACTIVE_ADMIN = `EXISTS (SELECT 1 FROM users s JOIN roles sr ON sr.id = s.role_id
  WHERE s.id = ? AND sr.is_admin = 1 AND s.is_active = 1)`

/** SQL that's true while the store has an active admin other than user `?` (binds: storeId, userId) */
const ANOTHER_ACTIVE_ADMIN = `EXISTS (SELECT 1 FROM users o JOIN roles orl ON orl.id = o.role_id
  WHERE o.store_id = ? AND o.id != ? AND orl.is_admin = 1 AND o.is_active = 1)`

function publicUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: { id: row.role_id, name: row.role_name, isAdmin: row.role_is_admin === 1 },
    active: row.is_active === 1,
    avatarUrl: row.avatar_updated_at
      ? `/api/users/${row.id}/avatar?v=${encodeURIComponent(row.avatar_updated_at)}`
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const duplicateEmail = () => error('Another account already uses this email', 409)
const lastAdmin = () => error('The store needs at least one active admin. Make another user an admin first.', 409)
const roleNotFound = () => error('Choose a role for this user', 400)

async function getUser(db: D1Database, storeId: number, id: number): Promise<UserRow | null> {
  return db
    .prepare(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = ? AND u.store_id = ?`)
    .bind(id, storeId)
    .first<UserRow>()
}

async function getRole(db: D1Database, storeId: number, id: number): Promise<RoleInfo | null> {
  return db.prepare('SELECT id, is_admin FROM roles WHERE id = ? AND store_id = ?').bind(id, storeId).first<RoleInfo>()
}

function readPassword(value: unknown): string | Response {
  if (typeof value !== 'string' || !value) return error('Password is required', 400)
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) {
    return error(`Password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters`, 400)
  }
  return value
}

function readUserInput(body: Record<string, unknown>): UserInput | Response {
  const email = cleanText(body.email).toLowerCase()
  if (!email) return error('Email is required', 400)
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return error('Enter a valid email address', 400)

  const fullName = cleanText(body.fullName)
  if (!fullName) return error('Full name is required', 400)
  if (fullName.length > MAX_FULL_NAME_LENGTH) {
    return error(`Full name must be ${MAX_FULL_NAME_LENGTH} characters or less`, 400)
  }

  const roleId = positiveId(body.roleId)
  if (roleId === null) return roleNotFound()
  const active = body.active ?? true
  if (typeof active !== 'boolean') return error('active must be true or false', 400)

  return { email, fullName, roleId, active }
}

/** Emails are unique across every store (they're the login), so this checks all users. */
async function emailTaken(db: D1Database, email: string, excludeId = 0): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').bind(email, excludeId).first()
  return row !== null
}

/** Turns a UNIQUE failure on email (two saves racing) into a friendly 409, or rethrows. */
function uniqueConflict(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e)
  if (message.includes('UNIQUE') && message.includes('users.email')) return duplicateEmail()
  if (message.includes('users.role_id')) return roleNotFound() // the role was deleted while saving
  throw e
}

const readBody = (request: Request) =>
  request.json<Record<string, unknown>>().catch(() => null)

async function listUsers(db: D1Database, storeId: number, url: URL): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const roleId = positiveId(Number(url.searchParams.get('roleId')))
  const status = url.searchParams.get('status')
  const { pageSize, offset } = readPaging(url)

  const where: string[] = ['u.store_id = ?']
  const params: unknown[] = [storeId]
  if (search) {
    const pattern = likePattern(search)
    where.push("(u.full_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')")
    params.push(pattern, pattern)
  }
  if (roleId !== null) {
    where.push('u.role_id = ?')
    params.push(roleId)
  }
  if (status === 'active' || status === 'inactive') {
    where.push('u.is_active = ?')
    params.push(status === 'active' ? 1 : 0)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [items, count] = await db.batch<UserRow | { total: number }>([
    db
      .prepare(`SELECT ${USER_COLUMNS} ${USER_FROM} ${whereSql} ORDER BY u.full_name, u.id LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM users u ${whereSql}`).bind(...params),
  ])

  return Response.json({
    items: (items!.results as UserRow[]).map(publicUser),
    total: (count!.results[0] as { total: number }).total,
  })
}

async function createUser(db: D1Database, admin: SessionUser, request: Request): Promise<Response> {
  const body = await readBody(request)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)
  const input = readUserInput(body)
  if (input instanceof Response) return input
  const password = readPassword(body.password)
  if (password instanceof Response) return password
  const role = await getRole(db, admin.store_id, input.roleId)
  if (!role) return roleNotFound()
  if (await emailTaken(db, input.email)) return duplicateEmail()

  const storeId = admin.store_id
  try {
    const created = await db
      .prepare(
        `INSERT INTO users (store_id, email, full_name, role_id, is_active, password_hash)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE ${USER_SEAT_FREE} AND (? = 0 OR ${ADMIN_SEAT_FREE})
         RETURNING id`,
      )
      .bind(
        storeId,
        input.email,
        input.fullName,
        role.id,
        input.active ? 1 : 0,
        await hashPassword(password),
        storeId,
        storeId,
        role.is_admin,
        storeId,
      )
      .first<{ id: number }>()
    if (!created) {
      // The plan is full: say which cap stopped it
      const usage = await getPlanUsage(db, storeId)
      if (!usage) return error('Store not found', 404)
      return usage.users >= usage.plan.max_users ? userLimitReached(usage) : adminLimitReached(usage)
    }
    const row = await getUser(db, storeId, created.id)
    return row ? Response.json(publicUser(row), { status: 201 }) : error('Could not add the user', 500)
  } catch (e) {
    return uniqueConflict(e)
  }
}

async function updateUser(db: D1Database, admin: SessionUser, request: Request, id: number): Promise<Response> {
  const body = await readBody(request)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)
  const input = readUserInput(body)
  if (input instanceof Response) return input

  const storeId = admin.store_id
  const existing = await getUser(db, storeId, id)
  if (!existing) return error('User not found', 404)
  if (id === admin.id && (input.roleId !== existing.role_id || !input.active)) {
    return error("You can't change your own role or status. Ask another admin.", 409)
  }
  const role = await getRole(db, storeId, input.roleId)
  if (!role) return roleNotFound()
  if (await emailTaken(db, input.email, id)) return duplicateEmail()

  const staysActiveAdmin = role.is_admin === 1 && input.active
  // Only a user who isn't an admin yet takes up an admin seat
  const becomesAdmin = role.is_admin === 1 && existing.role_is_admin !== 1
  try {
    const result = await db
      .prepare(
        `UPDATE users SET email = ?, full_name = ?, role_id = ?, is_active = ?, updated_at = datetime('now')
         WHERE id = ? AND store_id = ?
           AND (? = 1 OR NOT ${IS_ACTIVE_ADMIN} OR ${ANOTHER_ACTIVE_ADMIN})
           AND (? = 0 OR ${ADMIN_SEAT_FREE})`,
      )
      .bind(
        input.email,
        input.fullName,
        role.id,
        input.active ? 1 : 0,
        id,
        storeId,
        staysActiveAdmin ? 1 : 0,
        id,
        storeId,
        id,
        becomesAdmin ? 1 : 0,
        storeId,
      )
      .run()
    // No row changed: the last-admin rule or the plan stopped it, or the user was just deleted
    if (!result.meta.changes) {
      if (!(await getUser(db, storeId, id))) return error('User not found', 404)
      if (becomesAdmin) {
        const usage = await getPlanUsage(db, storeId)
        if (usage && usage.plan.max_admins !== null && usage.admins >= usage.plan.max_admins) {
          return adminLimitReached(usage)
        }
      }
      return lastAdmin()
    }
  } catch (e) {
    return uniqueConflict(e)
  }

  // A deactivated user is signed out everywhere right away
  if (!input.active) await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run()

  const row = await getUser(db, storeId, id)
  return row ? Response.json(publicUser(row)) : error('User not found', 404)
}

async function resetPassword(db: D1Database, admin: SessionUser, request: Request, id: number): Promise<Response> {
  if (id === admin.id) return error('Change your own password from My Profile', 409)
  const body = await readBody(request)
  const password = readPassword(body?.password)
  if (password instanceof Response) return password

  const result = await db
    .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ? AND store_id = ?")
    .bind(await hashPassword(password), id, admin.store_id)
    .run()
  if (!result.meta.changes) return error('User not found', 404)

  // Anyone signed in with the old password is signed out
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run()
  return Response.json({ ok: true })
}

async function deleteUser(db: D1Database, admin: SessionUser, id: number): Promise<Response> {
  if (id === admin.id) return error("You can't delete your own account", 409)
  const existing = await getUser(db, admin.store_id, id)
  if (!existing) return error('User not found', 404)

  // Sessions and avatar go with the user (ON DELETE CASCADE); history keeps the name
  const result = await db
    .prepare(
      `DELETE FROM users WHERE id = ? AND store_id = ?
         AND (NOT ${IS_ACTIVE_ADMIN} OR ${ANOTHER_ACTIVE_ADMIN})`,
    )
    .bind(id, admin.store_id, id, admin.store_id, id)
    .run()
  if (!result.meta.changes) return (await getUser(db, admin.store_id, id)) ? lastAdmin() : error('User not found', 404)
  return Response.json({ ok: true })
}

/** Handles /api/users routes (except avatars), or returns null if the path isn't one of them. */
export async function handleUsers(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const isCollection = url.pathname === '/api/users'
  const itemMatch = url.pathname.match(/^\/api\/users\/(\d+)$/)
  const passwordMatch = url.pathname.match(/^\/api\/users\/(\d+)\/password$/)
  if (!isCollection && !itemMatch && !passwordMatch) return null

  if (!user.is_admin) return error('Only admins can manage users', 403)

  if (isCollection && request.method === 'GET') return listUsers(db, user.store_id, url)
  if (isCollection && request.method === 'POST') return createUser(db, user, request)
  if (itemMatch && request.method === 'PUT') return updateUser(db, user, request, Number(itemMatch[1]))
  if (itemMatch && request.method === 'DELETE') return deleteUser(db, user, Number(itemMatch[1]))
  if (passwordMatch && request.method === 'PUT') return resetPassword(db, user, request, Number(passwordMatch[1]))

  return error('Method not allowed', 405)
}
