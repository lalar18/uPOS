// Cookie-based sessions stored in D1.

const COOKIE_NAME = 'session'
const SHORT_SESSION_SECONDS = 60 * 60 * 12 // 12 hours
const REMEMBER_ME_SECONDS = 60 * 60 * 24 * 30 // 30 days

export interface SessionUser {
  id: number
  email: string
  full_name: string
  role: 'admin' | 'cashier'
  store_id: number
  store_name: string
  avatar_updated_at: string | null
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function readSessionToken(request: Request): string | null {
  const cookies = request.headers.get('Cookie') ?? ''
  for (const part of cookies.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === COOKIE_NAME) return rest.join('=') || null
  }
  return null
}

function sessionCookie(token: string, maxAgeSeconds: number | null): string {
  const maxAge = maxAgeSeconds === null ? '' : `; Max-Age=${maxAgeSeconds}`
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${maxAge}`
}

/** Creates a session and returns the Set-Cookie header value for it. */
export async function createSession(db: D1Database, userId: number, rememberMe: boolean): Promise<string> {
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
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

  return db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.role, u.store_id, st.name AS store_name,
              a.updated_at AS avatar_updated_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN stores st ON st.id = u.store_id
       LEFT JOIN user_avatars a ON a.user_id = u.id
       WHERE s.id = ? AND s.expires_at > datetime('now') AND u.is_active = 1 AND st.is_active = 1`,
    )
    .bind(await sha256Hex(token))
    .first<SessionUser>()
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
