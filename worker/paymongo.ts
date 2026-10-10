// PayMongo (https://developers.paymongo.com): online payment of subscription renewals
// (subscription.ts) and of sales (saleCheckouts.ts), and sending stores their withdrawals from the
// platform's PayMongo Wallet (payoutTransfers.ts). Payments open a PayMongo checkout session:
// PayMongo hosts the payment page and calls our webhook (paymongoWebhook.ts) once it's paid.
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

const API_URL = 'https://api.paymongo.com'

/** PayMongo's names for payment methods, as ours (worker/documents.ts PAYMENT_METHODS) */
export const METHOD_NAMES: Record<string, string> = { gcash: 'gcash', paymaya: 'maya', card: 'card', qrph: 'qrph' }
export const METHOD_LABELS: Record<string, string> = {
  gcash: 'GCash',
  paymaya: 'Maya',
  card: 'card',
  qrph: 'QR Ph',
  grab_pay: 'GrabPay',
}

export const onlinePaymentEnabled = (env: PaymongoEnv) => !!env.PAYMONGO_SECRET_KEY

/** A request PayMongo turned down or didn't answer; `status` is 0 when it couldn't be reached */
export class PaymongoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly detail: string | null,
  ) {
    super(message)
  }

  /** Turned down for good: sending the same request again won't help (a 4xx other than 409 or 429) */
  get rejected() {
    return this.status >= 400 && this.status < 500 && this.status !== 409 && this.status !== 429
  }
}

async function callApi<T>(
  env: PaymongoEnv,
  method: 'GET' | 'POST',
  path: string, // with the API version, e.g. /v1/checkout_sessions
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${btoa(`${env.PAYMONGO_SECRET_KEY}:`)}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    throw new PaymongoError(`PayMongo ${path} could not be reached: ${err}`, 0, null, null)
  }
  const data = await res.json<{ errors?: { code?: string; detail?: string }[] } & T>().catch(() => null)
  if (!res.ok || !data) {
    const first = data?.errors?.[0]
    throw new PaymongoError(
      `PayMongo ${path} failed (${res.status}): ${first?.detail ?? 'no details'}`,
      res.status,
      first?.code ?? null,
      first?.detail ?? null,
    )
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
    '/v1/checkout_sessions',
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
  await callApi(env, 'POST', `/v1/checkout_sessions/${encodeURIComponent(id)}/expire`).catch((err) => console.warn(err))
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
  const { data } = await callApi<{ data: CheckoutSession }>(env, 'GET', `/v1/checkout_sessions/${encodeURIComponent(id)}`)
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

// --- Money out of the platform's PayMongo Wallet (Transfers API, v2) ---

/** The bank code (BIC) of PayMongo wallets: transfers are sent from it */
const PAYMONGO_BIC = 'PAEYPHM2XXX'

/** GCash's bank code (G-Xchange, Inc.) on InstaPay */
export const GCASH_BIC = 'GXCHPHM2XXX'

/** InstaPay's most per transfer, in centavos (₱50,000); PESONet carries more */
export const INSTAPAY_MAX_CENTS = 50_000_00

export type TransferProvider = 'instapay' | 'pesonet'

/** A bank or e-wallet that can receive transfers */
export interface ReceivingInstitution {
  code: string // BIC, PayMongo's provider_code
  name: string
}

// Kept per Worker instance for an hour: the list rarely changes and every withdrawal form needs it
const institutionCache = new Map<TransferProvider, { at: number; list: ReceivingInstitution[] }>()

/** The banks and e-wallets a transfer over `provider` can be sent to, by name */
export async function receivingInstitutions(env: PaymongoEnv, provider: TransferProvider): Promise<ReceivingInstitution[]> {
  const cached = institutionCache.get(provider)
  if (cached && Date.now() - cached.at < 3_600_000) return cached.list
  const { data } = await callApi<{
    data: { attributes: { name: string; provider_code: string; type?: string[] } }[]
  }>(env, 'GET', `/v1/wallets/receiving_institutions?provider=${provider}`)
  const list = data
    .filter((i) => !i.attributes.type?.length || i.attributes.type.includes('receiver'))
    .map((i) => ({ code: i.attributes.provider_code, name: i.attributes.name.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name))
  institutionCache.set(provider, { at: Date.now(), list })
  return list
}

interface WalletAccount {
  number: string
  name: string
}

let walletAccountCache: { key: string; account: WalletAccount } | null = null

/** The platform's activated PayMongo Wallet, which transfers are sent from */
async function sourceAccount(env: PaymongoEnv): Promise<WalletAccount> {
  if (walletAccountCache && walletAccountCache.key === env.PAYMONGO_SECRET_KEY) return walletAccountCache.account
  const { data } = await callApi<{
    data: { is_default?: boolean; status?: string; account?: { account_number?: string; account_name?: string } }[]
  }>(env, 'GET', '/v2/wallets/')
  const active = data.filter((w) => w.status === 'activated' && w.account?.account_number)
  const wallet = active.find((w) => w.is_default) ?? active[0]
  if (!wallet) {
    throw new PaymongoError('PayMongo: no activated wallet to send from', 422, 'no_activated_wallet', null)
  }
  const account = { number: wallet.account!.account_number!, name: wallet.account!.account_name ?? '' }
  walletAccountCache = { key: env.PAYMONGO_SECRET_KEY!, account }
  return account
}

/** A transfer as PayMongo has it */
export interface Transfer {
  id: string
  status: 'pending' | 'succeeded' | 'failed'
  batchTransferId: string | null
  referenceNumber: string | null // ours, as PayMongo stored it
  providerReferenceNumber: string | null // InstaPay's or PESONet's, on the bank statement
  feeCents: number | null
  failureCode: string | null
  failureMessage: string | null
}

type RawTransfer = Record<string, unknown> & { attributes?: Record<string, unknown> }

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

function readTransfer(raw: RawTransfer): Transfer {
  // v2 answers with the fields at the top; v1-style events nest them in attributes
  const t = { ...raw.attributes, ...raw }
  const status = t.status === 'succeeded' || t.status === 'failed' ? t.status : 'pending'
  const fee = Number(t.fee)
  return {
    // a wallet transaction (wallet_tr_…) names its transfer in transfer_id
    id: text(t.id)?.startsWith('tr_') ? String(t.id) : (text(t.transfer_id) ?? String(t.id ?? '')),
    status,
    batchTransferId: text(t.batch_transfer_id),
    referenceNumber: text(t.reference_number),
    providerReferenceNumber: text(t.provider_reference_number),
    feeCents: t.fee !== undefined && t.fee !== null && Number.isFinite(fee) && fee >= 0 ? Math.round(fee) : null,
    failureCode: text(t.failure_code) ?? text(t.error_code) ?? text(t.provider_error_code),
    failureMessage: text(t.failure_message) ?? text(t.error_message) ?? text(t.provider_error),
  }
}

export interface TransferInput {
  provider: TransferProvider
  amountCents: number
  destination: { bic: string; name: string; number: string }
  referenceNumber: string // ours: letters and digits only (PayMongo replaces anything else)
  description: string
  callbackUrl: string | null // told when its status changes
  metadata: Record<string, string>
  idempotencyKey: string // the same for every retry of this transfer, so it's sent at most once
}

/** Sends money from the platform's PayMongo Wallet to a bank account or e-wallet. */
export async function createTransfer(env: PaymongoEnv, input: TransferInput): Promise<Transfer> {
  const source = await sourceAccount(env)
  const { data } = await callApi<{ data: { id: string; transfers: RawTransfer[] } }>(
    env,
    'POST',
    '/v2/batch_transfers',
    {
      transfers: [
        {
          source_account: { number: source.number, name: source.name, bic: PAYMONGO_BIC },
          destination_account: input.destination,
          amount: input.amountCents,
          currency: 'PHP',
          provider: input.provider,
          reference_number: input.referenceNumber,
          purpose: 'Store withdrawal',
          description: input.description,
          ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
          metadata: input.metadata,
        },
      ],
    },
    { 'Idempotency-Key': input.idempotencyKey },
  )
  const transfer = data.transfers?.[0]
  if (!transfer) throw new PaymongoError('PayMongo: batch transfer created without a transfer', 502, null, null)
  return { ...readTransfer(transfer), batchTransferId: data.id ?? text(transfer.batch_transfer_id) }
}

/** A transfer's current status */
export async function retrieveTransfer(env: PaymongoEnv, id: string): Promise<Transfer> {
  const { data } = await callApi<{ data: RawTransfer }>(env, 'GET', `/v2/transfers/${encodeURIComponent(id)}`)
  return readTransfer(data)
}

/** The transfer sent with our reference number, if PayMongo has one (for a create whose answer was lost) */
export async function findTransfer(env: PaymongoEnv, referenceNumber: string): Promise<Transfer | null> {
  const { data } = await callApi<{ data: RawTransfer[] | null }>(
    env,
    'GET',
    `/v2/transfers?reference_number=${encodeURIComponent(referenceNumber)}`,
  )
  const match = (data ?? []).map(readTransfer).find((t) => t.referenceNumber === referenceNumber && t.id.startsWith('tr_'))
  return match ?? null
}
