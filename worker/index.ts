import { handleBrands } from './brands'
import { handleCategories } from './categories'
import { handleCustomers } from './customers'
import { clearLoginFailures, loginKey, loginRetryAfter, recordLoginFailure, tooManyAttempts } from './loginThrottle'
import { verifyPassword } from './password'
import { handleProducts } from './products'
import { handleQuotations } from './quotations'
import { handleSales } from './sales'
import { handleSalesReturns } from './salesReturns'
import { handleStock } from './stock'
import { handleStore } from './store'
import { changePassword, deleteAvatar, serveAvatar, uploadAvatar } from './profile'
import { handleRoles } from './roles'
import {
  createSession,
  destroySession,
  getSessionUser,
  SESSION_USER_COLUMNS,
  SESSION_USER_JOINS,
  sessionUserFromRow,
  type SessionUser,
  type SessionUserRow,
} from './session'
import { handleSubcategories } from './subcategories'
import { handleSettings } from './settings'
import { handleSubscription, listPlans, subscriptionExpired } from './subscription'
import { handleSuppliers } from './suppliers'
import { handleUnits } from './units'
import { handleUsers } from './users'
import { handleVariantAttributes } from './variantAttributes'
import { handleWarranties } from './warranties'

interface Env {
  DB: D1Database
}

/** Shape of the user object sent to the browser (never includes password_hash). */
function publicUser(user: SessionUser) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: { id: user.role_id, name: user.role_name, isAdmin: user.is_admin },
    permissions: [...user.permissions],
    store: {
      id: user.store_id,
      name: user.store_name,
      subscription: { expiresAt: user.plan_expires_at, expired: user.subscription_expired },
    },
    // The version param changes on every upload, so browsers never show a stale picture
    avatarUrl: user.avatar_updated_at
      ? `/api/users/${user.id}/avatar?v=${encodeURIComponent(user.avatar_updated_at)}`
      : null,
  }
}

const notLoggedIn = () => Response.json({ error: 'Not logged in' }, { status: 401 })

const READ_METHODS = new Set(['GET', 'HEAD'])
const ALLOWED_WHILE_EXPIRED = /^\/api\/(profile|subscription)\//

// Added to every API response. Pages and static files get theirs from public/_headers.
const API_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
}

export default {
  async fetch(request, env) {
    const response = await route(request, env)
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      if (!response.headers.has(name)) response.headers.set(name, value)
    }
    return response
  },
} satisfies ExportedHandler<Env>

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  // Health check: confirms the Worker can reach D1
  if (url.pathname === '/api/health') {
    const row = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>()
    return Response.json({ db: row?.ok === 1 })
  }

  // Plans and prices, for the landing page
  if (url.pathname === '/api/plans' && request.method === 'GET') {
    return listPlans(env.DB)
  }

  if (url.pathname === '/api/login' && request.method === 'POST') {
    const body = await request
      .json<{ email?: string; password?: string; rememberMe?: boolean }>()
      .catch(() => null)
    if (!body?.email || !body.password) {
      return Response.json({ error: 'Email and password are required' }, { status: 400 })
    }

    // Checked before the password, so a blocked attacker learns nothing from further guesses
    const throttleKey = loginKey(request, body.email)
    const retryAfter = await loginRetryAfter(env.DB, throttleKey)
    if (retryAfter !== null) return tooManyAttempts(retryAfter)

    const row = await env.DB.prepare(
      `SELECT ${SESSION_USER_COLUMNS}, u.password_hash
       FROM users u
       ${SESSION_USER_JOINS}
       WHERE u.email = ? AND u.is_active = 1 AND st.is_active = 1`,
    )
      .bind(body.email.trim())
      .first<SessionUserRow & { password_hash: string }>()

    if (!row || !(await verifyPassword(body.password, row.password_hash))) {
      await recordLoginFailure(env.DB, throttleKey)
      return Response.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    await clearLoginFailures(env.DB, throttleKey)
    const cookie = await createSession(env.DB, row.id, body.rememberMe === true)
    return Response.json(publicUser(sessionUserFromRow(row)), { headers: { 'Set-Cookie': cookie } })
  }

  if (url.pathname === '/api/logout' && request.method === 'POST') {
    const cookie = await destroySession(env.DB, request)
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie } })
  }

  // Everything below requires a logged-in user
  const user = await getSessionUser(env.DB, request)

  // An expired store is read-only: only your own profile and renewing the plan can still be changed
  if (user?.subscription_expired && !READ_METHODS.has(request.method) && !ALLOWED_WHILE_EXPIRED.test(url.pathname)) {
    return subscriptionExpired(user)
  }

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

  if (url.pathname.startsWith('/api/subcategories')) {
    if (!user) return notLoggedIn()
    const response = await handleSubcategories(env.DB, request, url, user)
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

  if (url.pathname.startsWith('/api/variant-attributes')) {
    if (!user) return notLoggedIn()
    const response = await handleVariantAttributes(env.DB, request, url, user)
    if (response) return response
  }

  if (url.pathname.startsWith('/api/warranties')) {
    if (!user) return notLoggedIn()
    const response = await handleWarranties(env.DB, request, url, user)
    if (response) return response
  }

  if (url.pathname.startsWith('/api/products')) {
    if (!user) return notLoggedIn()
    const response = await handleProducts(env.DB, request, url, user)
    if (response) return response
  }

  if (url.pathname.startsWith('/api/stock/')) {
    if (!user) return notLoggedIn()
    const response = await handleStock(env.DB, request, url, user)
    if (response) return response
  }

  if (url.pathname.startsWith('/api/customers')) {
    if (!user) return notLoggedIn()
    const response = await handleCustomers(env.DB, request, url, user)
    if (response) return response
  }

  if (url.pathname.startsWith('/api/suppliers')) {
    if (!user) return notLoggedIn()
    const response = await handleSuppliers(env.DB, request, url, user)
    if (response) return response
  }

  // Checked before /api/sales, which it also starts with
  if (url.pathname.startsWith('/api/sales-returns')) {
    if (!user) return notLoggedIn()
    const response = await handleSalesReturns(env.DB, request, url, user)
    if (response) return response
  }

  if (url.pathname.startsWith('/api/sales')) {
    if (!user) return notLoggedIn()
    const response = await handleSales(env.DB, request, url, user)
    if (response) return response
  }

  if (url.pathname.startsWith('/api/quotations')) {
    if (!user) return notLoggedIn()
    const response = await handleQuotations(env.DB, request, url, user)
    if (response) return response
  }

  if (url.pathname === '/api/settings') {
    if (!user) return notLoggedIn()
    return handleSettings(env.DB, request, user)
  }

  if (url.pathname.startsWith('/api/users')) {
    if (!user) return notLoggedIn()
    const response = await handleUsers(env.DB, request, url, user)
    if (response) return response
  }

  if (url.pathname.startsWith('/api/roles')) {
    if (!user) return notLoggedIn()
    const response = await handleRoles(env.DB, request, url, user)
    if (response) return response
  }

  if (url.pathname.startsWith('/api/subscription')) {
    if (!user) return notLoggedIn()
    const response = await handleSubscription(env.DB, request, url, user)
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
}
