// Service charges on online payments (see worker/serviceCharges.ts). Stores see the charge only
// on the payment being made; super admins set it in the US Panel.
import { readJson } from './http'

export type ChargeKind = 'fixed' | 'percent'

export interface ServiceCharge {
  kind: ChargeKind
  value: number // fixed: centavos; percent: basis points (250 = 2.5%)
  methods: string[] // payment methods it applies to (sale charge only)
}

/** The charge on a payment of `amountCents` (keep in step with chargeCents in worker/serviceCharges.ts) */
export function chargeCents(charge: ServiceCharge, amountCents: number): number {
  if (charge.value <= 0 || amountCents <= 0) return 0
  return charge.kind === 'fixed' ? charge.value : Math.round((amountCents * charge.value) / 10_000)
}

/** The charge on a sale payment by `method` (0 while the charge isn't loaded) */
export const saleChargeCents = (charge: ServiceCharge | null, method: string, amountCents: number) =>
  charge?.methods.includes(method) ? chargeCents(charge, amountCents) : 0

/** The charge on sale payments by online methods; null if it can't be loaded */
export const getOnlinePaymentCharge = (): Promise<ServiceCharge | null> =>
  fetch('/api/online-payment-charge')
    .then((res) => readJson<ServiceCharge>(res))
    .catch(() => null)
