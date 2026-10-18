// Service charges on online payments and withdrawals (see worker/serviceCharges.ts). Stores see the
// charge only on the payment or withdrawal being made; super admins set it in the US Panel.
import { formatMoney } from '@/utils/money'
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

/**
 * The charge kept out of a withdrawal of `amountCents`, never all of it so something is sent
 * (keep in step with payoutChargeCents in worker/serviceCharges.ts)
 */
export const payoutChargeCents = (charge: Pick<ServiceCharge, 'kind' | 'value'>, amountCents: number) =>
  Math.min(chargeCents({ ...charge, methods: [] }, amountCents), Math.max(amountCents - 1, 0))

/** PayMongo's gateway fee in basis points (keep in step with GATEWAY_FEE_BP in worker/serviceCharges.ts) */
export const GATEWAY_FEE_BP = 134

/** The gateway fee's rate, for showing beside it: "1.34%" */
export const GATEWAY_FEE_LABEL = `${GATEWAY_FEE_BP / 100}%`

/** The gateway fee on `amountCents` (keep in step with gatewayFeeCents in worker/serviceCharges.ts) */
export const gatewayFeeCents = (amountCents: number) =>
  amountCents > 0 ? Math.round((amountCents * GATEWAY_FEE_BP) / 10_000) : 0

/**
 * The gateway fee kept out of a withdrawal beside its service charge
 * (keep in step with payoutGatewayFeeCents in worker/serviceCharges.ts)
 */
export const payoutGatewayFeeCents = (amountCents: number, chargeCents: number) =>
  Math.min(gatewayFeeCents(amountCents), Math.max(amountCents - chargeCents - 1, 0))

/** The rate as set, for showing beside a charge: "2.5%" or "₱15.00 flat" */
export const chargeRateLabel = (charge: Pick<ServiceCharge, 'kind' | 'value'>) =>
  charge.kind === 'percent' ? `${charge.value / 100}%` : `${formatMoney(charge.value)} flat`

/** The charge on a sale payment by `method` (0 while the charge isn't loaded) */
export const saleChargeCents = (charge: ServiceCharge | null, method: string, amountCents: number) =>
  charge?.methods.includes(method) ? chargeCents(charge, amountCents) : 0

export interface OnlinePaymentCharge extends ServiceCharge {
  checkout: boolean // whether sales can be paid online (through PayMongo) in this store
}

/** The charge on sale payments by online methods; null if it can't be loaded */
export const getOnlinePaymentCharge = (): Promise<OnlinePaymentCharge | null> =>
  fetch('/api/online-payment-charge')
    .then((res) => readJson<OnlinePaymentCharge>(res))
    .catch(() => null)

/**
 * The charge on a sale payment recorded by hand: none on GCash, which went straight to the store's
 * own GCash account (keep in step with recordedChargeCents in worker/serviceCharges.ts)
 */
export const recordedChargeCents = (charge: ServiceCharge | null, method: string, amountCents: number) =>
  method === 'gcash' ? 0 : saleChargeCents(charge, method, amountCents)
