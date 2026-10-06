import { handleBrands } from './brands'
import { handleCategories } from './categories'
import { verifyPassword } from './password'
import { handleProducts } from './products'
import { handleStore } from './store'
import { changePassword, deleteAvatar, serveAvatar, uploadAvatar } from './profile'
import { createSession, destroySession, getSessionUser, type SessionUser } from './session'
import { handleUnits } from './units'

interface Env {
  DB: D1Database
}

interface UserRow extends SessionUser {
  password_hash: string
  is_active: number
}

/** Shape of the user object sent to the browser (never includes password_hash). */
function publicUser(user: SessionUser) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    store: { id: user.store_id, name: user.store_name },
    // The version param changes on every upload, so browsers never show a stale picture
    avatarUrl: user.avatar_updated_at
      ? `/api/users/${user.id}/avatar?v=${encodeURIComponent(user.avatar_updated_at)}`
      : null,
  }
}

const notLoggedIn = () => Response.json({ error: 'Not logged in' }, { status: 401 })

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // Health check: confirms the Worker can reach D1
    if (url.pathname === '/api/health') {
      const row = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>()
      return Response.json({ db: row?.ok === 1 })
    }

    if (url.pathname === '/api/login' && request.method === 'POST') {
      const body = await request
        .json<{ email?: string; password?: string; rememberMe?: boolean }>()
        .catch(() => null)
      if (!body?.email || !body.password) {
        return Response.json({ error: 'Email and password are required' }, { status: 400 })
      }

      const user = await env.DB.prepare(
        `SELECT u.*, st.name AS store_name, a.updated_at AS avatar_updated_at
         FROM users u
         JOIN stores st ON st.id = u.store_id
         LEFT JOIN user_avatars a ON a.user_id = u.id
         WHERE u.email = ? AND u.is_active = 1 AND st.is_active = 1`,
      )
        .bind(body.email.trim())
        .first<UserRow>()

      if (!user || !(await verifyPassword(body.password, user.password_hash))) {
        return Response.json({ error: 'Invalid email or password' }, { status: 401 })
      }

      const cookie = await createSession(env.DB, user.id, body.rememberMe === true)
      return Response.json(publicUser(user), { headers: { 'Set-Cookie': cookie } })
    }

    if (url.pathname === '/api/logout' && request.method === 'POST') {
      const cookie = await destroySession(env.DB, request)
      return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie } })
    }

    // Everything below requires a logged-in user
    const user = await getSessionUser(env.DB, request)

    // Returns the currently logged-in user (used by the frontend to check the session)
    if (url.pathname === '/api/me') {
      if (!user) return notLoggedIn()
      return Response.json(publicUser(user))
    }

    // Upload (PUT, raw image body) or remove (DELETE) your own avatar; responds with the updated user
    if (url.pathname === '/api/profile/avatar' && (request.method === 'PUT' || request.method === 'DELETE')) {
      if (!user) return notLoggedIn()
      const result =
        request.method === 'PUT' ? await uploadAvatar(env.DB, request, user) : await deleteAvatar(env.DB, user)
      if (!result.ok) return result
      const updated = await getSessionUser(env.DB, request)
      return updated ? Response.json(publicUser(updated)) : notLoggedIn()
    }

    if (url.pathname === '/api/profile/password' && request.method === 'POST') {
      if (!user) return notLoggedIn()
      return changePassword(env.DB, request, user)
    }

    if (url.pathname.startsWith('/api/categories')) {
      if (!user) return notLoggedIn()
      const response = await handleCategories(env.DB, request, url, user)
      if (response) return response
    }

    if (url.pathname.startsWith('/api/brands')) {
      if (!user) return notLoggedIn()
      const response = await handleBrands(env.DB, request, url, user)
      if (response) return response
    }

    if (url.pathname.startsWith('/api/units')) {
      if (!user) return notLoggedIn()
      const response = await handleUnits(env.DB, request, url, user)
      if (response) return response
    }

    if (url.pathname.startsWith('/api/products')) {
      if (!user) return notLoggedIn()
      const response = await handleProducts(env.DB, request, url, user)
      if (response) return response
    }

    if (url.pathname === '/api/store') {
      if (!user) return notLoggedIn()
      return handleStore(env.DB, request, user)
    }

    const avatarMatch = url.pathname.match(/^\/api\/users\/(\d+)\/avatar$/)
    if (avatarMatch && request.method === 'GET') {
      if (!user) return notLoggedIn()
      return serveAvatar(env.DB, Number(avatarMatch[1]), user)
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>
