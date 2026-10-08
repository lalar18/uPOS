// Labels and badges shared by the US Panel pages.
import type { RenewalStatus } from '@/api/usPanel'
import { daysLeft } from '@/api/subscription'

/** Keep in step with EXPIRING_DAYS in worker/usPanel/stores.ts */
export const EXPIRING_DAYS = 7

export interface Badge {
  label: string
  class: string
}

/** Where a store stands: disabled, expired, expiring soon or active */
export function storeStatus(store: { active: boolean; expired: boolean; expiresAt: string | null }): Badge {
  if (!store.active) return { label: 'Disabled', class: 'bg-secondary' }
  if (store.expired || !store.expiresAt) return { label: 'Expired', class: 'bg-danger' }
  if (daysLeft(store.expiresAt) <= EXPIRING_DAYS) return { label: 'Expiring', class: 'bg-warning' }
  return { label: 'Active', class: 'bg-success' }
}

const RENEWAL_BADGES: Record<RenewalStatus, Badge> = {
  pending: { label: 'Waiting for payment', class: 'bg-warning' },
  paid: { label: 'Paid', class: 'bg-success' },
  cancelled: { label: 'Cancelled', class: 'bg-secondary' },
}

export const renewalBadge = (status: RenewalStatus) => RENEWAL_BADGES[status]

/** "in 3 days", "today", "2 days ago" */
export function relativeDays(expiresAt: string): string {
  const days = daysLeft(expiresAt)
  const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`
  if (days > 0) return `in ${plural(days)}`
  return days === 0 ? 'today' : `${plural(-days)} ago`
}
