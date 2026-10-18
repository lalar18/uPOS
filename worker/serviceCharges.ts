// Service charges: the platform owner's fees on online payments and on withdrawals (see migrations
// 0023 and 0031). Super admins set them in the US Panel; stores only see the charge on the payment
// or withdrawal they're making.
//
//   GET /api/online-payment-charge -> { kind, value, methods, checkout }  (store users; the sale charge, for the payment
//                                     dialogs; checkout: whether sales can be paid online, see saleCheckouts.ts)

import { PAYMENT_METHODS } from './documents'

export type ChargeKind = 'fixed' | 'percent'

export interface ServiceCharge {
  kind: ChargeKind
  value: number // fixed: centavos; percent: basis points (250 = 2.5%)
  methods: string[] // payment methods it applies to ('sale' only)
}

export interface ServiceCharges {
  renewal: ServiceCharge
  sale: ServiceCharge
  payout: ServiceCharge // kept out of a store's withdrawal (storePayouts.ts)
}

/** Methods a sale charge can apply to: every one but cash */
export const ONLINE_METHODS = PAYMENT_METHODS.filter((m) => m !== 'cash')

const NO_CHARGE: ServiceCharge = { kind: 'fixed', value: 0, methods: [] }

/** The charge on a payment of `amountCents` (keep in step with chargeCents in src/utils/serviceCharge.ts) */
export function chargeCents(charge: ServiceCharge, amountCents: number): number {
  if (charge.value <= 0 || amountCents <= 0) return 0
  return charge.kind === 'fixed' ? charge.value : Math.round((amountCents * charge.value) / 10_000)
}

/** The charge on a renewal, in whole pesos (renewals are billed in whole pesos) */
export const renewalChargePesos = (charge: ServiceCharge, pesos: number) =>
  Math.round(chargeCents(charge, pesos * 100) / 100)

/**
 * PayMongo's gateway fee, in basis points (134 = 1.34%), passed on beside the service charge on
 * everything paid or sent through PayMongo (migration 0035). Keep GATEWAY_FEE_BP in
 * src/api/serviceCharge.ts in step.
 */
export const GATEWAY_FEE_BP = 134

/** The gateway fee on `amountCents` (keep in step with gatewayFeeCents in src/api/serviceCharge.ts) */
export const gatewayFeeCents = (amountCents: number) =>
  amountCents > 0 ? Math.round((amountCents * GATEWAY_FEE_BP) / 10_000) : 0

/** The gateway fee on a renewal, in whole pesos */
export const renewalGatewayFeePesos = (pesos: number) => Math.round(gatewayFeeCents(pesos * 100) / 100)

/**
 * The gateway fee kept out of a withdrawal of `amountCents` beside its service charge, never all
 * the rest so something is sent (keep in step with payoutGatewayFeeCents in src/api/serviceCharge.ts)
 */
export const payoutGatewayFeeCents = (amountCents: number, chargeCents: number) =>
  Math.min(gatewayFeeCents(amountCents), Math.max(amountCents - chargeCents - 1, 0))

/**
 * The charge kept out of a withdrawal of `amountCents`, never all of it so something is sent
 * (keep in step with payoutChargeCents in src/api/serviceCharge.ts)
 */
export const payoutChargeCents = (charge: ServiceCharge, amountCents: number) =>
  Math.min(chargeCents(charge, amountCents), Math.max(amountCents - 1, 0))

/** The charge on a sale payment by `method` */
export const saleChargeCents = (charge: ServiceCharge, method: string, amountCents: number) =>
  charge.methods.includes(method) ? chargeCents(charge, amountCents) : 0

/**
 * The charge on a sale payment recorded by hand. A GCash payment recorded by hand went straight to
 * the store's own GCash account (see worker/gcash.ts), not through the platform, so it has none.
 * (keep in step with recordedChargeCents in src/api/serviceCharge.ts)
 */
export const recordedChargeCents = (charge: ServiceCharge, method: string, amountCents: number) =>
  method === 'gcash' ? 0 : saleChargeCents(charge, method, amountCents)

interface ChargeRow {
  id: keyof ServiceCharges
  kind: ChargeKind
  value: number
  methods: string
}

function parseMethods(json: string): string[] {
  try {
    const list = JSON.parse(json)
    return Array.isArray(list) ? list.filter((m) => typeof m === 'string') : []
  } catch {
    return []
  }
}

const fromRow = (row: ChargeRow): ServiceCharge => ({ kind: row.kind, value: row.value, methods: parseMethods(row.methods) })

export async function getServiceCharges(db: D1Database): Promise<ServiceCharges> {
  const { results } = await db.prepare('SELECT id, kind, value, methods FROM service_charges').all<ChargeRow>()
  const charges: ServiceCharges = { renewal: NO_CHARGE, sale: NO_CHARGE, payout: NO_CHARGE }
  for (const row of results) charges[row.id] = fromRow(row)
  return charges
}

export async function getServiceCharge(db: D1Database, id: keyof ServiceCharges): Promise<ServiceCharge> {
  const row = await db.prepare('SELECT id, kind, value, methods FROM service_charges WHERE id = ?').bind(id).first<ChargeRow>()
  return row ? fromRow(row) : NO_CHARGE
}

/** GET /api/online-payment-charge: the sale charge, so the payment dialogs can show it. */
export async function handleOnlinePaymentCharge(
  db: D1Database,
  request: Request,
  checkout: boolean,
): Promise<Response> {
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  return Response.json({ ...(await getServiceCharge(db, 'sale')), checkout })
}
