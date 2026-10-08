// Super admin sign-in for the US Panel. Works like store sessions (session.ts), but with its
// own table and cookie. The cookie is only sent to /api/us-panel, is SameSite=Strict, and
// there's no "remember me": a super admin can change any store, so sessions stay short.
//
//   POST /api/us-panel/login     { email, password }               -> super admin
//   POST /api/us-panel/logout                                       -> { ok }
//   GET  /api/us-panel/me                                           -> super admin
//   PUT  /api/us-panel/me/password { currentPassword, newPassword }  -> { ok }

import { error } from '../documents'
import { clearLoginFailures, loginKey, loginRetryAfter, recordLoginFailure, tooManyAttempts } from '../loginThrottle'
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, verifyPassword } from '../password'
import { newSessionToken, readSessionToken, sha256Hex } from '../session'

const COOKIE_NAME = 'us_session'
const COOKIE_PATH = '/api/us-panel'
const SESSION_SECONDS = 60 * 60 * 8 // 8 hours

export interface SuperAdmin {
  id: number
  email: string
  full_name: string
}

export const publicSuperAdmin = (admin: SuperAdmin) => ({ id: admin.id, email: admin.email, fullName: admin.full_name })

function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${COOKIE_NAME}=${token}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`
}

/** Returns the signed-in super admin for this request, or null. */
export async function getSuperAdmin(db: D1Database, request: Request): Promise<SuperAdmin | null> {
  const token = readSessionToken(request, COOKIE_NAME)
  if (!token) return null
  return db
    .prepare(
      `SELECT a.id, a.email, a.full_name
       FROM super_admin_sessions s JOIN super_admins a ON a.id = s.super_admin_id
       WHERE s.id = ? AND s.expires_at > datetime('now') AND a.is_active = 1`,
    )
    .bind(await sha256Hex(token))
    .first<SuperAdmin>()
}

export async function login(db: D1Database, request: Request): Promise<Response> {
  const body = await request.json<{ email?: unknown; password?: unknown }>().catch(() => null)
  if (typeof body?.email !== 'string' || typeof body.password !== 'string' || !body.email || !body.password) {
    return error('Email and password are required', 400)
  }

  // Throttled apart from store logins, so neither can lock the other out
  const throttleKey = loginKey(request, `us-panel:${body.email.trim()}`)
  const retryAfter = await loginRetryAfter(db, throttleKey)
  if (retryAfter !== null) return tooManyAttempts(retryAfter)

  const row = await db
    .prepare('SELECT id, email, full_name, password_hash FROM super_admins WHERE email = ? AND is_active = 1')
    .bind(body.email.trim())
    .first<SuperAdmin & { password_hash: string }>()
  if (!row || !(await verifyPassword(body.password, row.password_hash))) {
    await recordLoginFailure(db, throttleKey)
    return error('Invalid email or password', 401)
  }
  await clearLoginFailures(db, throttleKey)

  const token = newSessionToken()
  await db.batch([
    db
      .prepare("INSERT INTO super_admin_sessions (id, super_admin_id, expires_at) VALUES (?, ?, datetime('now', ?))")
      .bind(await sha256Hex(token), row.id, `+${SESSION_SECONDS} seconds`),
    db.prepare("DELETE FROM super_admin_sessions WHERE expires_at <= datetime('now')"),
  ])
  return Response.json(publicSuperAdmin(row), { headers: { 'Set-Cookie': sessionCookie(token, SESSION_SECONDS) } })
}

export async function logout(db: D1Database, request: Request): Promise<Response> {
  const token = readSessionToken(request, COOKIE_NAME)
  if (token) await db.prepare('DELETE FROM super_admin_sessions WHERE id = ?').bind(await sha256Hex(token)).run()
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('', 0) } })
}

/** Changes the super admin's own password and signs out their other sessions. */
export async function changePassword(db: D1Database, request: Request, admin: SuperAdmin): Promise<Response> {
  const body = await request.json<{ currentPassword?: unknown; newPassword?: unknown }>().catch(() => null)
  const current = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
  const next = typeof body?.newPassword === 'string' ? body.newPassword : ''
  if (!current) return error('Enter your current password', 400)
  if (next.length < MIN_PASSWORD_LENGTH || next.length > MAX_PASSWORD_LENGTH) {
    return error(`New password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters`, 400)
  }

  const row = await db
    .prepare('SELECT password_hash FROM super_admins WHERE id = ?')
    .bind(admin.id)
    .first<{ password_hash: string }>()
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    return error('Your current password is incorrect', 400)
  }

  const token = readSessionToken(request, COOKIE_NAME)
  await db.batch([
    db
      .prepare("UPDATE super_admins SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(await hashPassword(next), admin.id),
    db
      .prepare('DELETE FROM super_admin_sessions WHERE super_admin_id = ? AND id != ?')
      .bind(admin.id, token ? await sha256Hex(token) : ''),
  ])
  return Response.json({ ok: true })
}
