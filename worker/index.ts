import { verifyPassword } from './password'
import { createSession, destroySession, getSessionUser, type SessionUser } from './session'

interface Env {
  DB: D1Database
}

interface UserRow extends SessionUser {
  password_hash: string
  is_active: number
}

/** Shape of the user object sent to the browser (never includes password_hash). */
function publicUser(user: SessionUser) {
  return { id: user.id, email: user.email, fullName: user.full_name, role: user.role }
}

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

      const user = await env.DB.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1')
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

    // Returns the currently logged-in user (used by the frontend to check the session)
    if (url.pathname === '/api/me') {
      const user = await getSessionUser(env.DB, request)
      if (!user) return Response.json({ error: 'Not logged in' }, { status: 401 })
      return Response.json(publicUser(user))
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>
