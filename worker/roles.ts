// Role endpoints, for admins only. Every query is limited to the admin's own store.
//
//   GET    /api/roles                              -> { items }  (Admin first, then by name)
//   POST   /api/roles      { name, permissions }   -> role
//   PUT    /api/roles/:id  { name, permissions }   -> role
//   DELETE /api/roles/:id                          -> { ok }
//
// The built-in Admin role always has every permission and can't be changed or deleted.
// A role can only be deleted once no user has it. Permission changes apply to signed-in
// users on their next request.

import { cleanText, error } from './documents'
import { isPermission, parsePermissions, PERMISSIONS, type Permission } from './permissions'
import type { SessionUser } from './session'

interface RoleRow {
  id: number
  name: string
  is_admin: number
  permissions: string
  user_count: number
  created_at: string
  updated_at: string
}

interface RoleInput {
  name: string
  permissions: Permission[]
}

const MAX_NAME_LENGTH = 50
const MAX_ROLES = 50

const ROLE_COLUMNS = `r.id, r.name, r.is_admin, r.permissions, r.created_at, r.updated_at,
  (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count`

function publicRole(row: RoleRow) {
  const isAdmin = row.is_admin === 1
  return {
    id: row.id,
    name: row.name,
    isAdmin,
    permissions: isAdmin ? [...PERMISSIONS] : parsePermissions(row.permissions),
    userCount: row.user_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const duplicateName = () => error('A role with this name already exists', 409)
const adminLocked = () => error('The Admin role always has every permission and cannot be changed', 409)

async function getRole(db: D1Database, storeId: number, id: number): Promise<RoleRow | null> {
  return db
    .prepare(`SELECT ${ROLE_COLUMNS} FROM roles r WHERE r.id = ? AND r.store_id = ?`)
    .bind(id, storeId)
    .first<RoleRow>()
}

async function readRoleInput(request: Request): Promise<RoleInput | Response> {
  const body = await request.json<{ name?: unknown; permissions?: unknown }>().catch(() => null)

  const name = cleanText(body?.name)
  if (!name) return error('Role name is required', 400)
  if (name.length > MAX_NAME_LENGTH) return error(`Role name must be ${MAX_NAME_LENGTH} characters or less`, 400)

  const permissions = body?.permissions
  if (!Array.isArray(permissions) || !permissions.every(isPermission)) {
    return error('permissions must be a list of permission names', 400)
  }
  // Stored in catalog order, without duplicates
  return { name, permissions: PERMISSIONS.filter((p) => permissions.includes(p)) }
}

async function nameTaken(db: D1Database, storeId: number, name: string, excludeId = 0): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM roles WHERE store_id = ? AND name = ? AND id != ?')
    .bind(storeId, name, excludeId)
    .first()
  return row !== null
}

/** Turns a UNIQUE failure on the name (two saves racing) into a friendly 409, or rethrows. */
function uniqueConflict(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e)
  if (message.includes('UNIQUE') && message.includes('roles.')) return duplicateName()
  throw e
}

async function listRoles(db: D1Database, storeId: number): Promise<Response> {
  const { results } = await db
    .prepare(`SELECT ${ROLE_COLUMNS} FROM roles r WHERE r.store_id = ? ORDER BY r.is_admin DESC, r.name, r.id`)
    .bind(storeId)
    .all<RoleRow>()
  return Response.json({ items: results.map(publicRole) })
}

async function createRole(db: D1Database, storeId: number, request: Request): Promise<Response> {
  const input = await readRoleInput(request)
  if (input instanceof Response) return input
  if (await nameTaken(db, storeId, input.name)) return duplicateName()

  try {
    const row = await db
      .prepare(
        `INSERT INTO roles (store_id, name, permissions)
         SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM roles WHERE store_id = ?) < ?
         RETURNING id, name, is_admin, permissions, created_at, updated_at, 0 AS user_count`,
      )
      .bind(storeId, input.name, JSON.stringify(input.permissions), storeId, MAX_ROLES)
      .first<RoleRow>()
    if (!row) return error(`A store can have at most ${MAX_ROLES} roles`, 409)
    return Response.json(publicRole(row), { status: 201 })
  } catch (e) {
    return uniqueConflict(e)
  }
}

async function updateRole(db: D1Database, storeId: number, request: Request, id: number): Promise<Response> {
  const input = await readRoleInput(request)
  if (input instanceof Response) return input

  const existing = await getRole(db, storeId, id)
  if (!existing) return error('Role not found', 404)
  if (existing.is_admin === 1) return adminLocked()
  if (await nameTaken(db, storeId, input.name, id)) return duplicateName()

  try {
    const result = await db
      .prepare(
        `UPDATE roles SET name = ?, permissions = ?, updated_at = datetime('now')
         WHERE id = ? AND store_id = ? AND is_admin = 0`,
      )
      .bind(input.name, JSON.stringify(input.permissions), id, storeId)
      .run()
    if (!result.meta.changes) return error('Role not found', 404)
  } catch (e) {
    return uniqueConflict(e)
  }
  const row = await getRole(db, storeId, id)
  return row ? Response.json(publicRole(row)) : error('Role not found', 404)
}

async function deleteRole(db: D1Database, storeId: number, id: number): Promise<Response> {
  const existing = await getRole(db, storeId, id)
  if (!existing) return error('Role not found', 404)
  if (existing.is_admin === 1) return error('The Admin role cannot be deleted', 409)
  if (existing.user_count > 0) {
    const users = existing.user_count === 1 ? '1 user has' : `${existing.user_count} users have`
    return error(`${users} this role. Give them another role first.`, 409)
  }

  try {
    const result = await db
      .prepare('DELETE FROM roles WHERE id = ? AND store_id = ? AND is_admin = 0')
      .bind(id, storeId)
      .run()
    return result.meta.changes ? Response.json({ ok: true }) : error('Role not found', 404)
  } catch (e) {
    // A user was given this role after the check above (users.role_id references it)
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('FOREIGN KEY')) return error('Users have this role. Give them another role first.', 409)
    throw e
  }
}

/** Handles /api/roles routes, or returns null if the path isn't one of them. */
export async function handleRoles(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const isCollection = url.pathname === '/api/roles'
  const itemMatch = url.pathname.match(/^\/api\/roles\/(\d+)$/)
  if (!isCollection && !itemMatch) return null

  if (!user.is_admin) return error('Only admins can manage roles', 403)

  const storeId = user.store_id
  if (isCollection && request.method === 'GET') return listRoles(db, storeId)
  if (isCollection && request.method === 'POST') return createRole(db, storeId, request)
  if (itemMatch && request.method === 'PUT') return updateRole(db, storeId, request, Number(itemMatch[1]))
  if (itemMatch && request.method === 'DELETE') return deleteRole(db, storeId, Number(itemMatch[1]))

  return error('Method not allowed', 405)
}
