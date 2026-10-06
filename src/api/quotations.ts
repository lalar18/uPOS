import { readJson, sendJson } from './http'
import type { Badge, DocumentCustomer } from './sales'

export const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'declined'] as const
export type EditableQuotationStatus = (typeof QUOTATION_STATUSES)[number]
export type QuotationStatus = EditableQuotationStatus | 'converted'

const STATUS_BADGES: Record<QuotationStatus | 'expired', Badge> = {
  draft: { label: 'Draft', className: 'bg-secondary' },
  sent: { label: 'Sent', className: 'bg-info' },
  accepted: { label: 'Accepted', className: 'bg-success' },
  declined: { label: 'Declined', className: 'bg-danger' },
  converted: { label: 'Converted', className: 'bg-primary' },
  expired: { label: 'Expired', className: 'bg-warning' },
}

export const quotationStatusLabel = (status: QuotationStatus | 'expired') => STATUS_BADGES[status].label

export interface QuotationSummary {
  id: number
  reference: string // "QT-00007"
  customer: DocumentCustomer
  quoteDate: string // YYYY-MM-DD
  validUntil: string | null
  status: QuotationStatus
  subtotalCents: number
  discountCents: number
  taxRateBp: number
  taxCents: number
  totalCents: number
  note: string | null
  itemCount: number
  sale: { id: number; reference: string } | null // the sale it was converted into
  userName: string
  createdAt: string
  updatedAt: string
}

export interface QuotationItem {
  id: number
  productId: number | null // null once the product has been deleted
  name: string
  sku: string
  unitShortName: string
  quantity: number
  priceCents: number
  totalCents: number
  // The product as it is now (null once deleted)
  product: { priceCents: number; quantity: number; status: 'active' | 'inactive'; allowDecimal: boolean } | null
  imageUrl: string | null
}

export interface Quotation extends QuotationSummary {
  items: QuotationItem[]
}

export interface QuotationInput {
  uid: string
  customerId: number | null
  quoteDate: string
  validUntil: string | null
  status: EditableQuotationStatus
  items: { productId: number; quantity: number; priceCents: number }[]
  discountCents: number
  taxRateBp: number
  note: string | null
}

export interface QuotationQuery {
  search: string
  status: '' | QuotationStatus | 'expired'
  from: string | null
  to: string | null
  today: string
  page: number
  pageSize: number
}

/** A draft or sent quotation past its valid-until date shows as expired. */
export function quotationBadge(quotation: QuotationSummary, today: string): Badge {
  const isOpen = quotation.status === 'draft' || quotation.status === 'sent'
  if (isOpen && quotation.validUntil && quotation.validUntil < today) return STATUS_BADGES.expired
  return STATUS_BADGES[quotation.status]
}

export async function listQuotations(query: QuotationQuery): Promise<{ items: QuotationSummary[]; total: number }> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    today: query.today,
  })
  if (query.search) params.set('search', query.search)
  if (query.status) params.set('status', query.status)
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  return readJson(await fetch(`/api/quotations?${params}`))
}

export async function getQuotation(id: number): Promise<Quotation> {
  return readJson(await fetch(`/api/quotations/${id}`))
}

export const createQuotation = (input: QuotationInput) => sendJson<Quotation>('POST', '/api/quotations', input)

export const updateQuotation = (id: number, input: QuotationInput) =>
  sendJson<Quotation>('PUT', `/api/quotations/${id}`, input)

export const setQuotationStatus = (id: number, status: EditableQuotationStatus) =>
  sendJson<Quotation>('PATCH', `/api/quotations/${id}`, { status })

export const deleteQuotation = (id: number) => sendJson<{ ok: true }>('DELETE', `/api/quotations/${id}`)
