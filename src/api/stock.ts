import { parseDbDate, readJson, sendJson } from './http'
import { formatQuantity } from './products'

export interface StockSummary {
  productCount: number // active products
  lowCount: number
  outCount: number
  retailValueCents: number // stock on hand at selling price
  costValueCents: number | null // at cost price; null for cashiers
  missingCostCount: number | null // products in stock without a cost price; null for cashiers
}

/** Reasons an admin can pick (keep in step with ADJUSTMENT_REASONS in worker/stock.ts). */
export const ADJUSTMENT_REASONS = [
  'received',
  'count',
  'returned',
  'damaged',
  'expired',
  'lost',
  'internal',
  'correction',
  'other',
] as const
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number]

const REASON_LABELS: Record<string, string> = {
  opening: 'Opening stock', // recorded when a product is created
  received: 'Stock received',
  count: 'Stock count',
  returned: 'Customer return',
  damaged: 'Damaged',
  expired: 'Expired',
  lost: 'Lost or stolen',
  internal: 'Internal use',
  correction: 'Correction',
  other: 'Other',
}

/** "damaged" -> "Damaged"; an unknown reason is shown as-is */
export const reasonLabel = (reason: string) => REASON_LABELS[reason] ?? reason

/** Every reason the list can be filtered by, opening stock included */
export const FILTER_REASONS = ['opening', ...ADJUSTMENT_REASONS] as const

export type AdjustmentMode = 'add' | 'remove' | 'set'

export interface StockAdjustment {
  id: number
  reference: string // "ADJ-00042"
  product: { id: number | null; name: string; sku: string; imageUrl: string | null } // id is null once deleted
  unitShortName: string
  reason: string
  quantityBefore: number
  quantityChange: number // positive added, negative removed
  quantityAfter: number
  note: string | null
  userName: string
  createdAt: string // UTC "YYYY-MM-DD HH:MM:SS"
}

export interface StockAdjustmentInput {
  productId: number
  mode: AdjustmentMode // add/remove `quantity`, or set the stock to it
  quantity: number
  reason: AdjustmentReason
  note: string | null
}

export interface StockAdjustmentQuery {
  search: string
  reason: string
  direction: 'in' | 'out' | ''
  productId: number | null
  from: string | null // UTC "YYYY-MM-DD HH:MM:SS", inclusive
  to: string | null // exclusive
  page: number
  pageSize: number
}

export async function getStockSummary(): Promise<StockSummary> {
  return readJson(await fetch('/api/stock/summary'))
}

export async function listStockAdjustments(
  query: StockAdjustmentQuery,
): Promise<{ items: StockAdjustment[]; total: number }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.search) params.set('search', query.search)
  if (query.reason) params.set('reason', query.reason)
  if (query.direction) params.set('direction', query.direction)
  if (query.productId) params.set('productId', String(query.productId))
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  return readJson(await fetch(`/api/stock/adjustments?${params}`))
}

export const createStockAdjustment = (input: StockAdjustmentInput) =>
  sendJson<StockAdjustment>('POST', '/api/stock/adjustments', input)

/** A local Date -> UTC "YYYY-MM-DD HH:MM:SS", the format D1 timestamps use */
export function toDbTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

/** 5 -> "+5", -2.5 -> "−2.5" */
export const formatChange = (value: number) => `${value > 0 ? '+' : '−'}${formatQuantity(Math.abs(value))}`

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/** A D1 UTC timestamp -> "06 Oct 2026, 3:15 PM" in local time */
export const formatDateTime = (value: string) => dateTimeFormat.format(parseDbDate(value))
