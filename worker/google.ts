// Sign in and sign up with Google (OAuth 2.0 authorization code flow with PKCE).
//
//   GET  /api/auth/google?remember=1&redirect=/path  -> 302 to Google's consent screen
//   GET  /api/auth/google/callback                   -> 302 back into the app:
//          a user with this Google account (or its verified email) is signed in and sent on;
//          an unknown Google account goes to /signup to name its new store;
//          failures go to /login?error=<code>
//   GET  /api/signup/google                          -> { email, fullName }   (the pending Google signup)
//   POST /api/signup/google  { name, ...store info }  -> { ok }  creates the store (Basic plan, free trial)
//                                                        with the Google account as its Admin, and signs in
//
// Set GOOGLE_CLIENT_ID (in wrangler.jsonc vars) and GOOGLE_CLIENT_SECRET (a secret) to turn this on.

import { createSession, newSessionToken, readSessionToken, sha256Hex } from './session'
import { readStoreInput } from './store'
import { emailTaken, MAX_FULL_NAME_LENGTH } from './users'

export interface GoogleEnv {
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
}

/** New stores from a Google signup start on this plan, free for this many days. */
const SIGNUP_PLAN_ID = 'basic'
const SIGNUP_TRIAL_DAYS = 14

const STATE_COOKIE = 'google_oauth'
const STATE_COOKIE_PATH = '/api/auth/google'
const STATE_SECONDS = 60 * 10 // time allowed on Google's consent screen
const SIGNUP_COOKIE = 'google_signup'
const SIGNUP_COOKIE_PATH = '/api/signup'
const SIGNUP_SECONDS = 60 * 30 // time allowed to name the store

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

/** Codes the login page turns into messages (see LoginView.vue). */
type LoginError = 'google_unavailable' | 'google_failed' | 'google_unverified' | 'google_mismatch' | 'account_disabled'

interface OAuthState {
  state: string
  verifier: string // PKCE code_verifier
  remember: boolean
  redirect: string
}

interface GoogleProfile {
  sub: string
  email: string
  emailVerified: boolean
  name: string
}

const error = (message: string, status: number) => Response.json({ error: message }, { status })

function cookie(name: string, value: string, path: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

function redirectTo(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location })
  for (const value of cookies) headers.append('Set-Cookie', value)
  return new Response(null, { status: 302, headers })
}

const clearStateCookie = () => cookie(STATE_COOKIE, '', STATE_COOKIE_PATH, 0)
const loginFailed = (code: LoginError) => redirectTo(`/login?error=${code}`, [clearStateCookie()])

/** Only paths inside the app ("//host" would leave it). */
const safeRedirect = (value: string | null) => (value && /^\/(?![/\\])/.test(value) ? value : '/')

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const callbackUrl = (url: URL) => `${url.origin}/api/auth/google/callback`

/** Sends the browser to Google, remembering (in a short-lived cookie) where to come back to. */
async function startSignIn(env: GoogleEnv, url: URL): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return loginFailed('google_unavailable')

  const oauth: OAuthState = {
    state: newSessionToken(),
    verifier: base64Url(crypto.getRandomValues(new Uint8Array(32))),
    remember: url.searchParams.get('remember') === '1',
    redirect: safeRedirect(url.searchParams.get('redirect')),
  }
  const challenge = base64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(oauth.verifier))),
  )

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(url),
    response_type: 'code',
    scope: 'openid email profile',
    state: oauth.state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  return redirectTo(`${AUTHORIZE_URL}?${params}`, [
    cookie(STATE_COOKIE, encodeURIComponent(JSON.stringify(oauth)), STATE_COOKIE_PATH, STATE_SECONDS),
  ])
}

function readOAuthState(request: Request): OAuthState | null {
  const raw = readSessionToken(request, STATE_COOKIE)
  if (!raw) return null
  try {
    const value = JSON.parse(decodeURIComponent(raw))
    return typeof value?.state === 'string' && typeof value.verifier === 'string' ? (value as OAuthState) : null
  } catch {
    return null
  }
}

/**
 * Swaps the authorization code for an ID token. The token comes straight from Google over
 * TLS in exchange for our client secret, so its claims can be trusted without checking its
 * signature (https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo).
 */
async function fetchProfile(env: GoogleEnv, url: URL, code: string, verifier: string): Promise<GoogleProfile | null> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: callbackUrl(url),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  })
  if (!res.ok) {
    console.error('Google token exchange failed', res.status, await res.text())
    return null
  }
  const { id_token: idToken } = await res.json<{ id_token?: string }>()
  const payload = idToken?.split('.')[1]
  if (!payload) return null

  const claims = JSON.parse(decodeBase64Url(payload)) as Record<string, unknown>
  if (!ISSUERS.includes(claims.iss as string) || claims.aud !== env.GOOGLE_CLIENT_ID) return null
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') return null

  return {
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === 'string' ? claims.name.trim().replace(/\s+/g, ' ') : '',
  }
}

/** Google redirects here after the consent screen. */
async function finishSignIn(db: D1Database, env: GoogleEnv, request: Request, url: URL): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return loginFailed('google_unavailable')

  // The visitor closed or cancelled Google's consent screen
  if (url.searchParams.get('error')) return redirectTo('/login', [clearStateCookie()])

  // The state must match the cookie set when this browser left for Google (stops login CSRF)
  const oauth = readOAuthState(request)
  const code = url.searchParams.get('code')
  if (!oauth || !code || url.searchParams.get('state') !== oauth.state) return loginFailed('google_failed')

  const profile = await fetchProfile(env, url, code, oauth.verifier)
  if (!profile) return loginFailed('google_failed')
  if (!profile.emailVerified) return loginFailed('google_unverified')

  // The user linked to this Google account, or else the one with its email
  const user = await db
    .prepare(
      `SELECT u.id, u.google_sub, u.is_active AND st.is_active AS active
       FROM users u JOIN stores st ON st.id = u.store_id
       WHERE u.google_sub = ? OR u.email = ?
       ORDER BY u.google_sub = ? DESC LIMIT 1`,
    )
    .bind(profile.sub, profile.email, profile.sub)
    .first<{ id: number; google_sub: string | null; active: number }>()

  if (user) {
    if (user.google_sub && user.google_sub !== profile.sub) return loginFailed('google_mismatch')
    if (!user.active) return loginFailed('account_disabled')
    if (!user.google_sub) {
      await db
        .prepare("UPDATE users SET google_sub = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(profile.sub, user.id)
        .run()
    }
    const session = await createSession(db, user.id, oauth.remember)
    return redirectTo(oauth.redirect, [session, clearStateCookie()])
  }

  // A new Google account: hold its details while its owner names their store
  const token = newSessionToken()
  const fullName = (profile.name || profile.email.split('@')[0]!).slice(0, MAX_FULL_NAME_LENGTH)
  await db.batch([
    db.prepare("DELETE FROM google_signups WHERE expires_at <= datetime('now') OR google_sub = ?").bind(profile.sub),
    db
      .prepare(
        "INSERT INTO google_signups (id, google_sub, email, full_name, expires_at) VALUES (?, ?, ?, ?, datetime('now', ?))",
      )
      .bind(await sha256Hex(token), profile.sub, profile.email, fullName, `+${SIGNUP_SECONDS} seconds`),
  ])
  return redirectTo('/signup', [cookie(SIGNUP_COOKIE, token, SIGNUP_COOKIE_PATH, SIGNUP_SECONDS), clearStateCookie()])
}

interface SignupRow {
  id: string
  google_sub: string
  email: string
  full_name: string
}

async function pendingSignup(db: D1Database, request: Request): Promise<SignupRow | null> {
  const token = readSessionToken(request, SIGNUP_COOKIE)
  if (!token) return null
  return db
    .prepare(
      "SELECT id, google_sub, email, full_name FROM google_signups WHERE id = ? AND expires_at > datetime('now')",
    )
    .bind(await sha256Hex(token))
    .first<SignupRow>()
}

const signupExpired = () => error('Your Google sign-up has expired. Please sign up with Google again.', 410)

/** Creates the store (on a free trial) with the Google account as its Admin, then signs in. */
async function completeSignup(db: D1Database, request: Request): Promise<Response> {
  const signup = await pendingSignup(db, request)
  if (!signup) return signupExpired()

  const info = await readStoreInput(request)
  if (info instanceof Response) return info
  if (await emailTaken(db, signup.email)) {
    return error('An account already uses this email. Sign in with Google instead.', 409)
  }

  // The insert triggers add the store's Admin and Cashier roles
  const store = await db
    .prepare(
      `INSERT INTO stores (name, email, phone, address, city, province, postal_code, tin, plan_id, plan_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?)) RETURNING id`,
    )
    .bind(
      info.name,
      info.email ?? signup.email,
      info.phone,
      info.address,
      info.city,
      info.province,
      info.postalCode,
      info.tin,
      SIGNUP_PLAN_ID,
      `+${SIGNUP_TRIAL_DAYS} days`,
    )
    .first<{ id: number }>()
  if (!store) return error('Could not create the store', 500)

  let user: { id: number } | null
  try {
    // No password ('' never verifies): they sign in with Google, or set one on their profile
    user = await db
      .prepare(
        `INSERT INTO users (store_id, email, full_name, role_id, password_hash, google_sub)
         SELECT ?, ?, ?, r.id, '', ? FROM roles r WHERE r.store_id = ? AND r.is_admin = 1 RETURNING id`,
      )
      .bind(store.id, signup.email, signup.full_name, signup.google_sub, store.id)
      .first<{ id: number }>()
    if (!user) throw new Error('The new store has no Admin role')
  } catch (e) {
    // Don't leave a store nobody can sign in to (its roles go with it)
    await db.prepare('DELETE FROM stores WHERE id = ?').bind(store.id).run()
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('UNIQUE')) return error('An account already uses this email. Sign in with Google instead.', 409)
    throw e
  }

  await db.prepare('DELETE FROM google_signups WHERE id = ?').bind(signup.id).run()
  const session = await createSession(db, user.id, false)
  const headers = new Headers()
  headers.append('Set-Cookie', session)
  headers.append('Set-Cookie', cookie(SIGNUP_COOKIE, '', SIGNUP_COOKIE_PATH, 0))
  return Response.json({ ok: true }, { status: 201, headers })
}

/** Handles /api/auth/google* and /api/signup/google, or returns null. */
export async function handleGoogle(
  db: D1Database,
  env: GoogleEnv,
  request: Request,
  url: URL,
): Promise<Response | null> {
  if (url.pathname === '/api/auth/google' && request.method === 'GET') return startSignIn(env, url)
  if (url.pathname === '/api/auth/google/callback' && request.method === 'GET') {
    return finishSignIn(db, env, request, url)
  }

  if (url.pathname === '/api/signup/google') {
    if (request.method === 'GET') {
      const signup = await pendingSignup(db, request)
      if (!signup) return signupExpired()
      return Response.json({
        email: signup.email,
        fullName: signup.full_name,
        plan: SIGNUP_PLAN_ID,
        trialDays: SIGNUP_TRIAL_DAYS,
      })
    }
    if (request.method === 'POST') return completeSignup(db, request)
  }
  return null
}
