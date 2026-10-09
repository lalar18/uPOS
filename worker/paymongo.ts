// Online payment of subscription renewals through PayMongo (https://developers.paymongo.com).
//
// A store admin's renewal (see subscription.ts) opens a PayMongo checkout session: PayMongo hosts
// the payment page (GCash, Maya, cards, QR Ph, GrabPay) and sends the admin back to the
// Subscription page afterwards. PayMongo then calls our webhook, which marks the renewal paid; the
// subscription_renewals_paid trigger extends the store, as when a super admin confirms a payment.
//
//   POST /api/webhooks/paymongo   (PayMongo only; signed with the webhook's secret)
//
// Set PAYMONGO_SECRET_KEY (sk_test_… / sk_live_…) to turn on online payment, and
// PAYMONGO_WEBHOOK_SECRET (whsk_…, shown when the webhook is created) so payments are recorded.
// Both are secrets: `npx wrangler secret put PAYMONGO_SECRET_KEY` (and .dev.vars locally).
// Without them, renewals wait for a super admin to confirm the payment, as before.

export interface PaymongoEnv {
  PAYMONGO_SECRET_KEY?: string
  PAYMONGO_WEBHOOK_SECRET?: string
}

const API_URL = 'https://api.paymongo.com/v1'

/** Offered on the checkout page (each must be enabled on the PayMongo account in live mode) */
const PAYMENT_METHOD_TYPES = ['gcash', 'paymaya', 'card', 'qrph', 'grab_pay']

/** PayMongo's names for payment methods, as ours (worker/documents.ts PAYMENT_METHODS) */
const METHOD_NAMES: Record<string, string> = { gcash: 'gcash', paymaya: 'maya', card: 'card' }
const METHOD_LABELS: Record<string, string> = {
  gcash: 'GCash',
  paymaya: 'Maya',
  card: 'card',
  qrph: 'QR Ph',
  grab_pay: 'GrabPay',
}

export const onlinePaymentEnabled = (env: PaymongoEnv) => !!env.PAYMONGO_SECRET_KEY

async function callApi<T>(env: PaymongoEnv, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${env.PAYMONGO_SECRET_KEY}:`)}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json<{ errors?: { detail?: string }[] } & T>().catch(() => null)
  if (!res.ok || !data) {
    throw new Error(`PayMongo ${path} failed (${res.status}): ${data?.errors?.[0]?.detail ?? 'no details'}`)
  }
  return data
}

export interface CheckoutInput {
  renewalId: number
  storeName: string
  planName: string
  pesos: number // whole pesos
  origin: string // the app's origin, for the return URLs
}

/** Opens a checkout session for a renewal; the admin pays at its URL. */
export async function createCheckoutSession(
  env: PaymongoEnv,
  input: CheckoutInput,
): Promise<{ id: string; url: string }> {
  const back = `${input.origin}/subscription?payment=`
  const { data } = await callApi<{ data: { id: string; attributes: { checkout_url: string } } }>(
    env,
    '/checkout_sessions',
    {
      data: {
        attributes: {
          line_items: [
            { name: `${input.planName} plan, 1 month`, amount: input.pesos * 100, currency: 'PHP', quantity: 1 },
          ],
          payment_method_types: PAYMENT_METHOD_TYPES,
          description: `Subscription renewal for ${input.storeName}`,
          reference_number: `RNW-${input.renewalId}`,
          metadata: { renewal_id: String(input.renewalId) },
          success_url: `${back}success`,
          cancel_url: `${back}cancelled`,
          show_description: true,
          show_line_items: true,
        },
      },
    },
  )
  return { id: data.id, url: data.attributes.checkout_url }
}

/** Closes a checkout session so it can't be paid any more (best effort: it may be paid or expired already). */
export async function expireCheckoutSession(env: PaymongoEnv, id: string): Promise<void> {
  if (!onlinePaymentEnabled(env)) return
  await callApi(env, `/checkout_sessions/${encodeURIComponent(id)}/expire`).catch((err) => console.warn(err))
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null
  return Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16))
}

/**
 * Checks the Paymongo-Signature header ("t=<timestamp>,te=<test sig>,li=<live sig>"): the
 * signature is the HMAC-SHA256 of "<timestamp>.<raw body>" with the webhook's secret.
 */
async function verifySignature(secret: string, header: string, rawBody: string, livemode: boolean) {
  const parts = Object.fromEntries(header.split(',').map((part) => part.trim().split('=', 2) as [string, string]))
  const signature = hexToBytes(parts[livemode ? 'li' : 'te'] ?? '')
  if (!parts.t || !signature) return false
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'verify',
  ])
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(`${parts.t}.${rawBody}`))
}

interface PaymongoPayment {
  id: string
  attributes: { amount: number; status: string; source?: { type?: string } }
}

interface CheckoutSessionEvent {
  data?: {
    attributes?: {
      type?: string
      livemode?: boolean
      data?: {
        id: string
        attributes: {
          metadata?: { renewal_id?: string } | null
          payment_method_used?: string | null
          payments?: PaymongoPayment[]
        }
      }
    }
  }
}

/** POST /api/webhooks/paymongo: records a paid checkout session against its renewal. */
export async function handlePaymongoWebhook(db: D1Database, env: PaymongoEnv, request: Request): Promise<Response> {
  if (!env.PAYMONGO_WEBHOOK_SECRET) return Response.json({ error: 'Webhook not configured' }, { status: 503 })

  const rawBody = await request.text()
  let event: CheckoutSessionEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400 })
  }
  const attributes = event.data?.attributes
  const valid = await verifySignature(
    env.PAYMONGO_WEBHOOK_SECRET,
    request.headers.get('Paymongo-Signature') ?? '',
    rawBody,
    attributes?.livemode === true,
  )
  if (!valid) return Response.json({ error: 'Invalid signature' }, { status: 401 })

  // Other events are acknowledged and ignored (the webhook only needs this one)
  const session = attributes?.data
  if (attributes?.type !== 'checkout_session.payment.paid' || !session) return Response.json({ ok: true })

  const renewalId = Number(session.attributes.metadata?.renewal_id)
  const payments = (session.attributes.payments ?? []).filter((p) => p.attributes.status === 'paid')
  if (!Number.isSafeInteger(renewalId) || !payments.length) {
    console.error('PayMongo: paid checkout session without a renewal or payment', session.id)
    return Response.json({ ok: true })
  }

  const method = session.attributes.payment_method_used ?? payments[0].attributes.source?.type ?? ''
  const cents = payments.reduce((sum, p) => sum + p.attributes.amount, 0)
  const values = [
    Math.round(cents / 100),
    METHOD_NAMES[method] ?? 'other',
    payments[0].id,
    `Paid online through PayMongo${METHOD_LABELS[method] ? ` (${METHOD_LABELS[method]})` : ''}`,
    session.id,
  ]
  const markPaid = (id: number) =>
    db
      .prepare(
        `UPDATE subscription_renewals
         SET amount = ?, payment_method = ?, payment_reference = ?, note = ?, checkout_session_id = ?, status = 'paid'
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(...values, id)
      .run()

  if ((await markPaid(renewalId)).meta.changes) return Response.json({ ok: true })

  // Not pending any more: either this event was already recorded (PayMongo retries), or the
  // renewal was cancelled after it was paid. The store paid either way, so record it once.
  const existing = await db
    .prepare('SELECT store_id, plan_id, payment_reference FROM subscription_renewals WHERE id = ?')
    .bind(renewalId)
    .first<{ store_id: number; plan_id: string; payment_reference: string | null }>()
  const recorded = await db
    .prepare('SELECT 1 FROM subscription_renewals WHERE payment_reference = ?')
    .bind(payments[0].id)
    .first()
  if (!existing || recorded) return Response.json({ ok: true })

  // Goes through 'pending' so the same trigger extends the store
  const row = await db
    .prepare(
      `INSERT INTO subscription_renewals (store_id, plan_id) VALUES (?, ?)
       ON CONFLICT DO NOTHING RETURNING id`,
    )
    .bind(existing.store_id, existing.plan_id)
    .first<{ id: number }>()
  if (!row) {
    // Another renewal is pending. Failing makes PayMongo retry (and flags it in its dashboard),
    // so a super admin can settle the pending one and the payment still gets recorded.
    console.error('PayMongo: payment for a cancelled renewal while another is pending', renewalId, payments[0].id)
    return Response.json({ error: 'Store has another pending renewal' }, { status: 409 })
  }
  await markPaid(row.id)
  return Response.json({ ok: true })
}
