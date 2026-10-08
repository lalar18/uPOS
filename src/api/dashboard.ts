import { toIsoDate } from '@/utils/date'
import { readJson, sendJson } from './http'

/** The widgets on a user's dashboard. */
export interface DashboardLayout {
  widgets: string[] // in order
  custom: boolean // false: the default set for the user's role
  locked: boolean // set by an admin; the user can't change it
  available: string[] // every widget the user's role may see, in the default order
}

export const getLayout = async (): Promise<DashboardLayout> => readJson(await fetch('/api/dashboard/layout'))

/** null goes back to the default set */
export const saveLayout = (widgets: string[] | null) =>
  sendJson<DashboardLayout>('PUT', '/api/dashboard/layout', { widgets })

/** Another user's dashboard (admins only) */
export const getUserDashboard = async (userId: number): Promise<DashboardLayout> =>
  readJson(await fetch(`/api/users/${userId}/dashboard`))

export const saveUserDashboard = (userId: number, widgets: string[] | null, locked: boolean) =>
  sendJson<DashboardLayout>('PUT', `/api/users/${userId}/dashboard`, { widgets, locked })

/** One widget's numbers. `today` is the device's local date, since sales are dated locally. */
export async function getWidget<T>(key: string, params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams({ today: toIsoDate(), ...params })
  return readJson(await fetch(`/api/dashboard/widgets/${key}?${query}`))
}

// --- Widget data ---

export interface SalesOverview {
  today: { cents: number; count: number; yesterdayCents: number }
  month: { cents: number; count: number; lastMonthCents: number } // last month: the same days of it
  collectedCents: number // payments received this month (refunds subtracted)
  receivable: { cents: number; count: number; overdue: number }
}

export interface SalesTrend {
  days: number
  points: { date: string; cents: number; count: number }[] // one per day, oldest first
}

export interface PaymentMethodTotals {
  items: { method: string; cents: number; count: number }[]
}

export interface ProfitSummary {
  netSalesCents: number // after discounts and returns, before tax
  costCents: number
  profitCents: number
  missingCost: number // lines sold without a cost price (counted as free)
}

export interface InventoryValue {
  products: number
  costCents: number
  retailCents: number
  missingCost: number
}

export interface TopProducts {
  items: { productId: number | null; name: string; sku: string; unitShortName: string; quantity: number; cents: number }[]
}

export interface TopCustomers {
  items: { id: number; name: string; count: number; cents: number }[]
}

export interface DashboardSale {
  id: number
  customerName: string
  saleDate: string
  dueDate: string | null
  source: 'pos' | 'manual'
  totalCents: number // after returns
  dueCents: number
  paidCents: number
}

export interface RecentSales {
  items: DashboardSale[]
}

export interface Receivables {
  items: DashboardSale[]
  cents: number
  count: number
  overdue: number
}

export interface DashboardProduct {
  id: number
  name: string
  sku: string
  quantity: number
  alertQuantity: number
  expiryDate: string | null
  unitShortName: string
}

export interface LowStock {
  items: DashboardProduct[]
  low: number
  out: number
}

export interface ExpiringProducts {
  items: DashboardProduct[]
  expired: number
  soon: number
  soonDays: number
}

export interface OpenQuotations {
  items: { id: number; customerName: string; quoteDate: string; validUntil: string | null; status: string; totalCents: number }[]
  count: number
  cents: number
}
