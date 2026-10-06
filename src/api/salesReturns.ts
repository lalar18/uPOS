import { readJson, sendJson } from './http'
import type { DocumentCustomer, PaymentMethod } from './sales'

/** Reasons an admin can pick (keep in step with RETURN_REASONS in worker/salesReturns.ts). */
export const RETURN_REASONS = ['defective', 'wrong_item', 'not_as_described', 'changed_mind', 'expired', 'other'] as const
export type ReturnReason = (typeof RETURN_REASONS)[number]

const REASON_LABELS: Record<string, string> = {
  defective: 'Defective or damaged',
  wrong_item: 'Wrong item',
  not_as_described: 'Not as described',
  changed_mind: 'Changed mind',
  expired: 'Expired',
  other: 'Other',
}

/** "wrong_item" -> "Wrong item"; an unknown reason is shown as-is */
export const returnReasonLabel = (reason: string) => REASON_LABELS[reason] ?? reason

export interface SalesReturnSummary {
  id: number
  reference: string // "SR-00004"
  sale: { id: number; reference: string }
  customer: Pick<DocumentCustomer, 'id' | 'name'>
  returnDate: string // YYYY-MM-DD
  reason: string
  restock: boolean // the goods went back into stock
  totalCents: number // credited to the sale
  refundCents: number // money given back
  itemCount: number
  note: string | null
  userName: string
  createdAt: string
}

export interface SalesReturn extends SalesReturnSummary {
  items: {
    id: number
    saleItemId: number
    productId: number | null
    name: string
    sku: string
    unitShortName: string
    quantity: number
    priceCents: number
    totalCents: number
  }[]
}

export interface SalesReturnInput {
  uid: string
  saleId: number
  returnDate: string
  reason: ReturnReason
  restock: boolean
  note: string | null
  refundMethod: PaymentMethod | null // needed when money is given back
  items: { saleItemId: number; quantity: number }[]
}

export interface SalesReturnQuery {
  search: string
  reason: string
  from: string | null
  to: string | null
  page: number
  pageSize: number
}

export async function listSalesReturns(
  query: SalesReturnQuery,
): Promise<{ items: SalesReturnSummary[]; total: number; sums: { totalCents: number; refundCents: number } }> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.search) params.set('search', query.search)
  if (query.reason) params.set('reason', query.reason)
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  return readJson(await fetch(`/api/sales-returns?${params}`))
}

export async function getSalesReturn(id: number): Promise<SalesReturn> {
  return readJson(await fetch(`/api/sales-returns/${id}`))
}

export const createSalesReturn = (input: SalesReturnInput) =>
  sendJson<SalesReturn>('POST', '/api/sales-returns', input)
