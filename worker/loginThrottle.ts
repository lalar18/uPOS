// Login throttling: too many failed attempts for one email, or from one IP, within the
// window blocks further attempts until the oldest failure ages out.

const WINDOW_MINUTES = 15
const MAX_FAILURES_PER_EMAIL = 5
const MAX_FAILURES_PER_IP = 20

export interface LoginKey {
  email: string
  ip: string
}

export function loginKey(request: Request, email: string): LoginKey {
  return {
    email: email.trim().toLowerCase(),
    ip: request.headers.get('CF-Connecting-IP') ?? 'unknown',
  }
}

/** Returns how many seconds until another attempt is allowed, or null if allowed now. */
export async function loginRetryAfter(db: D1Database, key: LoginKey): Promise<number | null> {
  const window = `-${WINDOW_MINUTES} minutes`
  const [byEmail, byIp] = await db.batch<{ failures: number; seconds_left: number | null }>([
    db
      .prepare(
        `SELECT COUNT(*) AS failures,
                CAST(strftime('%s', MIN(created_at), '+${WINDOW_MINUTES} minutes') - strftime('%s', 'now') AS INTEGER) AS seconds_left
         FROM login_failures WHERE email = ? AND created_at > datetime('now', ?)`,
      )
      .bind(key.email, window),
    db
      .prepare(
        `SELECT COUNT(*) AS failures,
                CAST(strftime('%s', MIN(created_at), '+${WINDOW_MINUTES} minutes') - strftime('%s', 'now') AS INTEGER) AS seconds_left
         FROM login_failures WHERE ip = ? AND created_at > datetime('now', ?)`,
      )
      .bind(key.ip, window),
  ])

  const waits: number[] = []
  const email = byEmail.results[0]
  const ip = byIp.results[0]
  if (email && email.failures >= MAX_FAILURES_PER_EMAIL) waits.push(email.seconds_left ?? 60)
  if (ip && ip.failures >= MAX_FAILURES_PER_IP) waits.push(ip.seconds_left ?? 60)
  return waits.length ? Math.max(1, ...waits) : null
}

/** Records a failed attempt and prunes failures that are older than the window. */
export async function recordLoginFailure(db: D1Database, key: LoginKey): Promise<void> {
  await db.batch([
    db.prepare('INSERT INTO login_failures (email, ip) VALUES (?, ?)').bind(key.email, key.ip),
    db.prepare("DELETE FROM login_failures WHERE created_at <= datetime('now', ?)").bind(`-${WINDOW_MINUTES} minutes`),
  ])
}

/** Clears an email's failures after a successful login. */
export async function clearLoginFailures(db: D1Database, key: LoginKey): Promise<void> {
  await db.prepare('DELETE FROM login_failures WHERE email = ?').bind(key.email).run()
}

export function tooManyAttempts(retryAfterSeconds: number): Response {
  const minutes = Math.ceil(retryAfterSeconds / 60)
  return Response.json(
    { error: `Too many failed login attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  )
}
