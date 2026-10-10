// The US Panel API (super admins only). See worker/usPanel/.
import { readJson, sendJson } from './http'
import type { ServiceCharge } from './serviceCharge'
import type { Plan } from './subscription'
import type { StoreInput } from './store'

const BASE = '/api/us-panel'

export interface SuperAdmin {
  id: number
  email: string
  fullName: string
}

// --- Overview ---

export interface Overview {
  stores: { total: number; active: number; expiring: number; expired: number; disabled: number }
  plans: { id: string; name: string; monthlyPrice: number; stores: number; active: number }[]
  revenue: { thisMonth: number; lastMonth: number; allTime: number } // whole pesos
  pendingRenewals: { total: number; items: Renewal[] }
  expiringStores: { id: number; name: string; planName: string; expiresAt: string; expired: boolean; pendingRenewal: boolean }[]
}

export const getOverview = async (): Promise<Overview> => readJson(await fetch(`${BASE}/overview`))

// --- Stores ---

export type StoreStatusFilter = 'active' | 'expiring' | 'expired' | 'disabled' | 'pending' | ''

export interface StoreSummary {
  id: number
  name: string
  email: string | null
  phone: string | null
  city: string | null
  active: boolean
  plan: { id: string; name: string }
  expiresAt: string | null
  expired: boolean
  users: number
  products: number
  pendingRenewal: boolean
  createdAt: string
}

export interface StoreDetail {
  id: number
  name: string
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  tin: string | null
  active: boolean
  plan: Plan
  expiresAt: string | null
  expired: boolean
  usage: { users: number; admins: number; products: number }
  activity: { sales: number; lastSaleAt: string | null }
  createdAt: string
  updatedAt: string
}

export interface StoreQuery {
  search: string
  status: StoreStatusFilter
  planId: string
  sort: 'newest' | 'expiry'
  page: number
  pageSize: number
}

export interface NewStoreInput extends StoreInput {
  planId: string
  trialDays: number // free days before the first payment is due
  admin: { fullName: string; email: string; password: string }
}

export interface StoreUser {
  id: number
  email: string
  fullName: string
  role: { name: string; isAdmin: boolean }
  active: boolean
  createdAt: string
}

export async function listStores(query: StoreQuery): Promise<{ items: StoreSummary[]; total: number }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), sort: query.sort })
  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  if (query.planId) params.set('planId', query.planId)
  return readJson(await fetch(`${BASE}/stores?${params}`))
}

export const createStore = (input: NewStoreInput) => sendJson<StoreDetail>('POST', `${BASE}/stores`, input)

export const getStore = async (id: number): Promise<StoreDetail> => readJson(await fetch(`${BASE}/stores/${id}`))

export const updateStore = (id: number, input: StoreInput) => sendJson<StoreDetail>('PUT', `${BASE}/stores/${id}`, input)

export const setStoreActive = (id: number, active: boolean) =>
  sendJson<StoreDetail>('PUT', `${BASE}/stores/${id}/status`, { active })

/** Moves the store to a plan and sets its expiry (YYYY-MM-DD, end of that day), without a payment. */
export const setStoreSubscription = (id: number, planId: string, expiresOn: string) =>
  sendJson<StoreDetail>('PUT', `${BASE}/stores/${id}/subscription`, { planId, expiresOn })

export const signOutStoreUsers = (id: number) => sendJson<{ ok: true }>('DELETE', `${BASE}/stores/${id}/sessions`)

export const listStoreUsers = async (id: number): Promise<StoreUser[]> =>
  readJson(await fetch(`${BASE}/stores/${id}/users`))

export const setStoreUserActive = (storeId: number, userId: number, active: boolean) =>
  sendJson<{ ok: true }>('PUT', `${BASE}/stores/${storeId}/users/${userId}/status`, { active })

export const resetStoreUserPassword = (storeId: number, userId: number, password: string) =>
  sendJson<{ ok: true }>('PUT', `${BASE}/stores/${storeId}/users/${userId}/password`, { password })

// --- Billing ---

export type RenewalStatus = 'pending' | 'paid' | 'cancelled'

export interface Renewal {
  id: number
  store: { id: number; name: string }
  plan: { id: string; name: string; monthlyPrice: number }
  status: RenewalStatus
  months: number
  amount: number | null // whole pesos received
  serviceChargeCents: number // part of amount, added for paying online
  processingFeeCents: number | null // kept by PayMongo (null: not paid online)
  paymentMethod: string | null
  reference: string | null
  note: string | null
  requestedBy: string | null // null when recorded from the panel
  confirmedBy: string | null // the super admin who confirmed or cancelled it
  periodStart: string | null
  periodEnd: string | null
  createdAt: string
  paidAt: string | null
}

export interface PaymentInput {
  months: number
  amount: number
  paymentMethod: string
  reference: string
  note: string
}

export interface RenewalQuery {
  status: RenewalStatus | ''
  search: string
  page: number
  pageSize: number
}

/** Keep in step with MAX_MONTHS in worker/usPanel/billing.ts */
export const MAX_PAID_MONTHS = 24

export async function listRenewals(query: RenewalQuery): Promise<{ items: Renewal[]; total: number }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.status) params.set('status', query.status)
  if (query.search) params.set('search', query.search)
  return readJson(await fetch(`${BASE}/renewals?${params}`))
}

export const listStoreRenewals = async (storeId: number): Promise<Renewal[]> =>
  readJson(await fetch(`${BASE}/stores/${storeId}/renewals`))

export const payRenewal = (id: number, input: PaymentInput) =>
  sendJson<Renewal>('POST', `${BASE}/renewals/${id}/pay`, input)

export const cancelRenewal = (id: number) => sendJson<Renewal>('POST', `${BASE}/renewals/${id}/cancel`)

export const recordStorePayment = (storeId: number, input: PaymentInput & { planId: string }) =>
  sendJson<Renewal>('POST', `${BASE}/stores/${storeId}/payments`, input)

// --- Plans ---

export interface PanelPlan extends Plan {
  stores: number // stores on this plan
}

export type PlanInput = Omit<Plan, 'id'>

export const listPanelPlans = async (): Promise<PanelPlan[]> => readJson(await fetch(`${BASE}/plans`))

export const updatePlan = (id: string, input: PlanInput) => sendJson<PanelPlan>('PUT', `${BASE}/plans/${id}`, input)

// --- Income and service charges ---

/** Money in centavos */
export interface IncomeTotals {
  subscriptionsCents: number // renewals received, less their service charges
  renewalChargesCents: number // service charges on renewals paid online
  saleChargesCents: number // service charges stores collected on online sale payments
  processingFeesCents: number // kept by PayMongo
  netCents: number // subscriptions + service charges - PayMongo fees
  renewals: number
  salePayments: number
}

export interface Income {
  year: number
  firstYear: number // earliest year with income
  months: (IncomeTotals & { month: string })[] // "2026-01" .. "2026-12", in Philippine time
  stores: (IncomeTotals & { id: number; name: string })[] // highest net first
  totals: IncomeTotals
}

export interface ServiceCharges {
  renewal: ServiceCharge
  sale: ServiceCharge
}

export const getIncome = async (year: number): Promise<Income> => readJson(await fetch(`${BASE}/income?year=${year}`))

export const getServiceCharges = async (): Promise<ServiceCharges> => readJson(await fetch(`${BASE}/service-charges`))

export const updateServiceCharges = (input: ServiceCharges) =>
  sendJson<ServiceCharges>('PUT', `${BASE}/service-charges`, input)

// --- Account ---

export const changeSuperAdminPassword = (currentPassword: string, newPassword: string) =>
  sendJson<{ ok: true }>('PUT', `${BASE}/me/password`, { currentPassword, newPassword })
