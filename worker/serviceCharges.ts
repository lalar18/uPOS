// Service charges: the platform owner's fees on online payments (see migration 0023).
// Super admins set them in the US Panel; stores only see the charge on the payment they're making.
//
//   GET /api/online-payment-charge -> { kind, value, methods }  (store users; the sale charge, for the payment dialogs)

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

/** The charge on a sale payment by `method` */
export const saleChargeCents = (charge: ServiceCharge, method: string, amountCents: number) =>
  charge.methods.includes(method) ? chargeCents(charge, amountCents) : 0

interface ChargeRow {
  id: 'renewal' | 'sale'
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
  const charges: ServiceCharges = { renewal: NO_CHARGE, sale: NO_CHARGE }
  for (const row of results) charges[row.id] = fromRow(row)
  return charges
}

export async function getServiceCharge(db: D1Database, id: keyof ServiceCharges): Promise<ServiceCharge> {
  const row = await db.prepare('SELECT id, kind, value, methods FROM service_charges WHERE id = ?').bind(id).first<ChargeRow>()
  return row ? fromRow(row) : NO_CHARGE
}

/** GET /api/online-payment-charge: the sale charge, so the payment dialogs can show it. */
export async function handleOnlinePaymentCharge(db: D1Database, request: Request): Promise<Response> {
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  return Response.json(await getServiceCharge(db, 'sale'))
}
