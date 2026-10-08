import { parseDbDate, readJson, sendJson } from './http'

export interface Plan {
  id: string
  name: string
  maxUsers: number
  maxAdmins: number | null // null: any of the users may be admins
  maxProducts: number
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
}

export const getSubscription = async (): Promise<Subscription> => readJson(await fetch('/api/subscription'))

/** Asks to renew for another month, on this plan; it takes effect once paid. */
export const requestRenewal = (planId: string) => sendJson<Renewal>('POST', '/api/subscription/renewals', { planId })

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
