import { parseDbDate, readJson, sendJson } from './http'

export interface Plan {
  id: string
  name: string
  maxUsers: number
  maxAdmins: number | null // null: any of the users may be admins
  maxProducts: number
  monthlyPrice: number // whole pesos
}

export interface Renewal {
  id: number
  plan: { id: string; name: string }
  status: 'pending' | 'paid'
  requestedBy: string | null
  periodStart: string | null // set once paid (UTC "YYYY-MM-DD HH:MM:SS")
  periodEnd: string | null
  createdAt: string
  paidAt: string | null
}

export interface Subscription {
  plan: Plan
  expiresAt: string | null // UTC "YYYY-MM-DD HH:MM:SS"
  expired: boolean
  usage: { users: number; admins: number; products: number }
  plans: Plan[] // every plan, cheapest first
  pendingRenewal: Renewal | null // waiting for payment
  renewals: Renewal[] // paid ones, newest first
  onlinePayment: boolean // renewals are paid on PayMongo's checkout page (else confirmed by a super admin)
  onlinePaymentFees: Record<string, number> // by plan id: whole pesos added to a renewal paid online (0: none)
}

/** Every plan and its price; works without logging in (the landing page uses it). */
export const getPlans = async (): Promise<Plan[]> => readJson(await fetch('/api/plans'))

/** 1499 as "₱1,499" */
export const formatPrice = (pesos: number) => `₱${pesos.toLocaleString('en-US')}`

export const getSubscription = async (): Promise<Subscription> => readJson(await fetch('/api/subscription'))

/**
 * Asks to renew for another month, on this plan; it takes effect once paid. With online payment,
 * `checkoutUrl` is the PayMongo page to pay it on.
 */
export const requestRenewal = (planId: string) =>
  sendJson<Renewal & { checkoutUrl: string | null }>('POST', '/api/subscription/renewals', { planId })

/** A new PayMongo payment page for a renewal waiting for payment. */
export const payRenewalOnline = (id: number) =>
  sendJson<{ checkoutUrl: string }>('POST', `/api/subscription/renewals/${id}/checkout`)

export const cancelRenewal = (id: number) => sendJson<{ ok: true }>('DELETE', `/api/subscription/renewals/${id}`)

/** Days until `expiresAt`, rounded up (1 on the last day, 0 or less once expired) */
export const daysLeft = (expiresAt: string, now = new Date()) =>
  Math.ceil((parseDbDate(expiresAt).getTime() - now.getTime()) / 86_400_000)

/** A UTC timestamp as "Oct 8, 2026" */
export const formatDate = (value: string) =>
  parseDbDate(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** "1 admin + 2 users", "5 users", "1 user" */
export function describeSeats(plan: Plan): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  if (plan.maxAdmins === null || plan.maxAdmins >= plan.maxUsers) return plural(plan.maxUsers, 'user')
  return `${plural(plan.maxAdmins, 'admin')} + ${plural(plan.maxUsers - plan.maxAdmins, 'user')}`
}
