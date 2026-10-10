// PayMongo (https://developers.paymongo.com): online payment of subscription renewals
// (subscription.ts) and of sales (saleCheckouts.ts). Both open a PayMongo checkout session: PayMongo
// hosts the payment page and calls our webhook (paymongoWebhook.ts) once it's paid.
//
// Set PAYMONGO_SECRET_KEY (sk_test_… / sk_live_…) to turn on online payment, and
// PAYMONGO_WEBHOOK_SECRET (whsk_…, shown when the webhook is created) so payments are recorded.
// Both are secrets: `npx wrangler secret put PAYMONGO_SECRET_KEY` (and .dev.vars locally).
// Without them, renewals wait for a super admin to confirm the payment, as before, and sales
// can only record payments taken some other way.

export interface PaymongoEnv {
  PAYMONGO_SECRET_KEY?: string
  PAYMONGO_WEBHOOK_SECRET?: string
}

const API_URL = 'https://api.paymongo.com/v1'

/** PayMongo's names for payment methods, as ours (worker/documents.ts PAYMENT_METHODS) */
export const METHOD_NAMES: Record<string, string> = { gcash: 'gcash', paymaya: 'maya', card: 'card' }
export const METHOD_LABELS: Record<string, string> = {
  gcash: 'GCash',
  paymaya: 'Maya',
  card: 'card',
  qrph: 'QR Ph',
  grab_pay: 'GrabPay',
}

export const onlinePaymentEnabled = (env: PaymongoEnv) => !!env.PAYMONGO_SECRET_KEY

async function callApi<T>(env: PaymongoEnv, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
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
  lineItems: { name: string; cents: number }[] // in PHP
  paymentMethodTypes: string[] // PayMongo's names; each must be enabled on the account in live mode
  description: string
  referenceNumber: string
  metadata: Record<string, string> // read back by the webhook
  successUrl: string
  cancelUrl: string
}

/** Opens a checkout session; the customer pays at its URL. */
export async function createCheckoutSession(env: PaymongoEnv, input: CheckoutInput): Promise<{ id: string; url: string }> {
  const { data } = await callApi<{ data: { id: string; attributes: { checkout_url: string } } }>(
    env,
    'POST',
    '/checkout_sessions',
    {
      data: {
        attributes: {
          line_items: input.lineItems
            .filter((item) => item.cents > 0)
            .map((item) => ({ name: item.name, amount: item.cents, currency: 'PHP', quantity: 1 })),
          payment_method_types: input.paymentMethodTypes,
          description: input.description,
          reference_number: input.referenceNumber,
          metadata: input.metadata,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
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
  await callApi(env, 'POST', `/checkout_sessions/${encodeURIComponent(id)}/expire`).catch((err) => console.warn(err))
}

export interface PaymongoPayment {
  id: string
  attributes: { amount: number; fee?: number; net_amount?: number; status: string; source?: { type?: string } }
}

export interface CheckoutSession {
  id: string
  attributes: {
    status?: string // 'active' | 'expired'
    metadata?: Record<string, string | undefined> | null
    payment_method_used?: string | null
    payments?: PaymongoPayment[]
  }
}

/** A checkout session as PayMongo has it now (for when its webhook hasn't arrived) */
export async function retrieveCheckoutSession(env: PaymongoEnv, id: string): Promise<CheckoutSession> {
  const { data } = await callApi<{ data: CheckoutSession }>(env, 'GET', `/checkout_sessions/${encodeURIComponent(id)}`)
  return data
}

/** What a session's paid payments came to, or null if nothing is paid yet */
export function paidCheckout(session: CheckoutSession) {
  const payments = (session.attributes.payments ?? []).filter((p) => p.attributes.status === 'paid')
  if (!payments.length) return null
  const method = session.attributes.payment_method_used ?? payments[0]!.attributes.source?.type ?? ''
  return {
    paymentId: payments[0]!.id,
    cents: payments.reduce((sum, p) => sum + p.attributes.amount, 0),
    method, // PayMongo's name
    processingFeeCents: processingFee(payments),
  }
}

export type PaidCheckout = NonNullable<ReturnType<typeof paidCheckout>>

/** What PayMongo kept of the payments (its fee and taxes), in centavos, or null if it didn't say */
function processingFee(payments: PaymongoPayment[]): number | null {
  let total = 0
  for (const { attributes: a } of payments) {
    if (typeof a.net_amount === 'number') total += a.amount - a.net_amount
    else if (typeof a.fee === 'number') total += a.fee
    else return null
  }
  return Math.max(total, 0)
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null
  return Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16))
}

/**
 * Checks the Paymongo-Signature header ("t=<timestamp>,te=<test sig>,li=<live sig>"): the
 * signature is the HMAC-SHA256 of "<timestamp>.<raw body>" with the webhook's secret.
 */
export async function verifySignature(secret: string, header: string, rawBody: string, livemode: boolean) {
  const parts = Object.fromEntries(header.split(',').map((part) => part.trim().split('=', 2) as [string, string]))
  const signature = hexToBytes(parts[livemode ? 'li' : 'te'] ?? '')
  if (!parts.t || !signature) return false
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'verify',
  ])
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(`${parts.t}.${rawBody}`))
}
