// Cookie-based sessions stored in D1.

import { parsePermissions, PERMISSIONS, type Permission } from './permissions'

const COOKIE_NAME = 'session'
const SHORT_SESSION_SECONDS = 60 * 60 * 12 // 12 hours
const REMEMBER_ME_SECONDS = 60 * 60 * 24 * 30 // 30 days

export interface SessionUser {
  id: number
  email: string
  full_name: string
  store_id: number
  store_name: string
  avatar_updated_at: string | null
  role_id: number
  role_name: string
  is_admin: boolean // has the store's Admin role
  permissions: ReadonlySet<Permission> // every permission for admins
  plan_expires_at: string | null
  subscription_expired: boolean // the store is read-only until its plan is renewed
}

/** Columns (and joins, as `FROM ...`) that sessionUserFromRow() reads. Alias the users table `u`. */
export const SESSION_USER_COLUMNS = `u.id, u.email, u.full_name, u.store_id, st.name AS store_name,
  a.updated_at AS avatar_updated_at, u.role_id, r.name AS role_name, r.is_admin, r.permissions,
  st.plan_expires_at, (st.plan_expires_at IS NULL OR st.plan_expires_at <= datetime('now')) AS subscription_expired`
export const SESSION_USER_JOINS = `JOIN stores st ON st.id = u.store_id
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN user_avatars a ON a.user_id = u.id`

export interface SessionUserRow extends Omit<SessionUser, 'is_admin' | 'permissions' | 'subscription_expired'> {
  is_admin: number
  permissions: string
  subscription_expired: number
}

export function sessionUserFromRow(row: SessionUserRow): SessionUser {
  const isAdmin = row.is_admin === 1
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    store_id: row.store_id,
    store_name: row.store_name,
    avatar_updated_at: row.avatar_updated_at,
    role_id: row.role_id,
    role_name: row.role_name,
    is_admin: isAdmin,
    permissions: new Set(isAdmin ? PERMISSIONS : parsePermissions(row.permissions)),
    plan_expires_at: row.plan_expires_at,
    subscription_expired: row.subscription_expired === 1,
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A random session token (hex). Only its sha256Hex() is stored. */
export const newSessionToken = () =>
  [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')

export function readSessionToken(request: Request, cookieName = COOKIE_NAME): string | null {
  const cookies = request.headers.get('Cookie') ?? ''
  for (const part of cookies.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === cookieName) return rest.join('=') || null
  }
  return null
}

function sessionCookie(token: string, maxAgeSeconds: number | null): string {
  const maxAge = maxAgeSeconds === null ? '' : `; Max-Age=${maxAgeSeconds}`
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${maxAge}`
}

/** Creates a session and returns the Set-Cookie header value for it. */
export async function createSession(db: D1Database, userId: number, rememberMe: boolean): Promise<string> {
  const token = newSessionToken()
  const lifetime = rememberMe ? REMEMBER_ME_SECONDS : SHORT_SESSION_SECONDS

  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', ?))")
    .bind(await sha256Hex(token), userId, `+${lifetime} seconds`)
    .run()

  // Without "remember me" the cookie is dropped when the browser closes
  return sessionCookie(token, rememberMe ? lifetime : null)
}

/** Returns the logged-in user for this request, or null. */
export async function getSessionUser(db: D1Database, request: Request): Promise<SessionUser | null> {
  const token = readSessionToken(request)
  if (!token) return null

  // The role is read on every request, so permission changes apply right away
  const row = await db
    .prepare(
      `SELECT ${SESSION_USER_COLUMNS}
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       ${SESSION_USER_JOINS}
       WHERE s.id = ? AND s.expires_at > datetime('now') AND u.is_active = 1 AND st.is_active = 1`,
    )
    .bind(await sha256Hex(token))
    .first<SessionUserRow>()
  return row ? sessionUserFromRow(row) : null
}

/** Signs the user out everywhere except this request's session (e.g. after a password change). */
export async function destroyOtherSessions(db: D1Database, request: Request, userId: number): Promise<void> {
  const token = readSessionToken(request)
  await db
    .prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
    .bind(userId, token ? await sha256Hex(token) : '')
    .run()
}

/** Deletes this request's session and returns a Set-Cookie header that clears the cookie. */
export async function destroySession(db: D1Database, request: Request): Promise<string> {
  const token = readSessionToken(request)
  if (token) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run()
  }
  return sessionCookie('', 0)
}
