import { readJson, sendJson } from './http'

/** Payment methods (keep in step with PAYMENT_METHODS in worker/documents.ts). */
export const PAYMENT_METHODS = ['cash', 'card', 'gcash', 'maya', 'bank_transfer', 'cheque', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  gcash: 'GCash',
  maya: 'Maya',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  other: 'Other',
}

/** "gcash" -> "GCash"; an unknown method is shown as-is */
export const paymentMethodLabel = (method: string) => METHOD_LABELS[method] ?? method

export const WALK_IN_CUSTOMER = 'Walk-in Customer'

export type SaleSource = 'pos' | 'manual'
export type PaymentStatus = 'paid' | 'partial' | 'unpaid'
export type ReturnStatus = 'none' | 'partial' | 'full'

export interface DocumentCustomer {
  id: number | null // null for walk-in (or a deleted customer)
  name: string
  phone: string | null
  address: string | null
}

export interface SaleSummary {
  id: number
  reference: string // "INV-00042"
  source: SaleSource
  customer: DocumentCustomer
  quotation: { id: number; reference: string } | null
  saleDate: string // YYYY-MM-DD
  dueDate: string | null
  subtotalCents: number
  discountCents: number
  taxRateBp: number // 1200 = 12%
  taxCents: number
  totalCents: number
  returnedCents: number // credited back by returns
  paidCents: number // net of refunds
  dueCents: number // total - returned - paid
  paymentStatus: PaymentStatus
  returnStatus: ReturnStatus
  itemCount: number
  note: string | null
  userName: string
  createdAt: string
}

export interface SaleItem {
  id: number
  productId: number | null // null once the product has been deleted
  name: string
  sku: string
  unitShortName: string
  allowDecimal: boolean
  quantity: number
  priceCents: number
  totalCents: number
  returnedQuantity: number
  imageUrl: string | null
}

export interface SalePayment {
  id: number
  amountCents: number // negative for a refund
  tenderedCents: number | null // cash handed over
  changeCents: number | null
  method: string
  reference: string | null
  note: string | null
  paidDate: string
  return: { id: number; reference: string } | null // set on refunds
  userName: string
  createdAt: string
}

export interface Sale extends SaleSummary {
  items: SaleItem[]
  payments: SalePayment[]
  returns: { id: number; reference: string; returnDate: string; reason: string; totalCents: number; refundCents: number }[]
  onlineCheckout: SaleCheckout | null // an online payment waiting to be paid
}

// --- Online payment through PayMongo (see worker/saleCheckouts.ts) ---

/** Methods a sale can be paid online with (keep in step with CHECKOUT_METHODS in worker/saleCheckouts.ts) */
export const CHECKOUT_METHODS = ['card', 'gcash', 'maya'] as const
export type CheckoutMethod = (typeof CHECKOUT_METHODS)[number]
export const isCheckoutMethod = (method: string): method is CheckoutMethod =>
  (CHECKOUT_METHODS as readonly string[]).includes(method)

/** PayMongo's smallest payment (keep in step with MIN_CHECKOUT_CENTS in worker/saleCheckouts.ts) */
export const MIN_CHECKOUT_CENTS = 2000

export interface SaleCheckout {
  id: number
  saleId: number
  method: CheckoutMethod
  amountCents: number // towards the sale
  serviceChargeCents: number
  totalCents: number // what the customer pays
  status: 'pending' | 'paid' | 'cancelled' | 'refund_due'
  checkoutUrl: string | null // while pending
  createdAt: string
  paidAt: string | null
}

export interface OnlinePaymentInput {
  method: CheckoutMethod
  amountCents: number
}

export const openSaleCheckout = (saleId: number, input: OnlinePaymentInput) =>
  sendJson<SaleCheckout>('POST', `/api/sales/${saleId}/checkouts`, input)

/** The checkout as it is now (the server asks PayMongo while it's pending) */
export const getSaleCheckout = (saleId: number, id: number) =>
  sendJson<SaleCheckout>('GET', `/api/sales/${saleId}/checkouts/${id}`)

/** Cancels a waiting checkout; it comes back 'paid' if the customer paid just before */
export const cancelSaleCheckout = (saleId: number, id: number) =>
  sendJson<SaleCheckout>('DELETE', `/api/sales/${saleId}/checkouts/${id}`)

export interface PaymentInput {
  amountCents: number
  method: PaymentMethod
  reference: string | null
  note?: string | null
  tenderedCents?: number | null // cash only
}

export interface SaleInput {
  uid: string // reuse it when retrying, so the sale is never saved twice
  source: SaleSource
  customerId: number | null
  quotationId?: number | null
  saleDate: string
  dueDate: string | null
  items: { productId: number; quantity: number; priceCents: number }[]
  discountCents: number
  taxRateBp: number
  note: string | null
  payments: PaymentInput[]
  onlinePayment?: OnlinePaymentInput | null // opened as the sale is saved; comes back as onlineCheckout
}

export interface SaleQuery {
  search: string
  payment: '' | PaymentStatus | 'due' | 'overdue'
  source: '' | SaleSource
  from: string | null // YYYY-MM-DD, inclusive
  to: string | null // inclusive
  today: string // the device's date, for "overdue"
  page: number
  pageSize: number
}

export interface SaleSums {
  totalCents: number // after returns
  paidCents: number
  dueCents: number
}

export async function listSales(query: SaleQuery): Promise<{ items: SaleSummary[]; total: number; sums: SaleSums }> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    today: query.today,
  })
  if (query.search) params.set('search', query.search)
  if (query.payment) params.set('payment', query.payment)
  if (query.source) params.set('source', query.source)
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  return readJson(await fetch(`/api/sales?${params}`))
}

export async function getSale(id: number): Promise<Sale> {
  return readJson(await fetch(`/api/sales/${id}`))
}

/** checkoutError: the sale was saved, but its online payment couldn't be opened */
export const createSale = (input: SaleInput) =>
  sendJson<Sale & { checkoutError?: string }>('POST', '/api/sales', input)

export const addSalePayment = (id: number, input: PaymentInput & { paidDate: string }) =>
  sendJson<Sale>('POST', `/api/sales/${id}/payments`, input)

// --- Totals (keep in step with computeTotals in worker/documents.ts) ---

export const lineTotal = (quantity: number, priceCents: number) => Math.round(quantity * priceCents)

export interface Totals {
  subtotalCents: number
  discountCents: number
  taxRateBp: number
  taxCents: number
  totalCents: number
}

/** Tax is added on top of the discounted subtotal: 12% is taxRateBp 1200. */
export function computeTotals(lineTotals: number[], discountCents: number, taxRateBp: number): Totals {
  const subtotalCents = lineTotals.reduce((sum, value) => sum + value, 0)
  const taxCents = Math.round(((subtotalCents - discountCents) * taxRateBp) / 10_000)
  return { subtotalCents, discountCents, taxRateBp, taxCents, totalCents: subtotalCents - discountCents + taxCents }
}

// --- Status badges ---

export interface Badge {
  label: string
  className: string // a Bootstrap badge background
}

/** Paid / Partially paid / Unpaid / Overdue / Returned, for lists and invoices. */
export function invoiceBadge(sale: SaleSummary, today: string): Badge {
  if (sale.returnStatus === 'full') return { label: 'Returned', className: 'bg-secondary' }
  if (sale.dueCents > 0 && sale.dueDate && sale.dueDate < today) return { label: 'Overdue', className: 'bg-danger' }
  if (sale.paymentStatus === 'paid') return { label: 'Paid', className: 'bg-success' }
  if (sale.paymentStatus === 'partial') return { label: 'Partially paid', className: 'bg-warning' }
  return { label: 'Unpaid', className: 'bg-danger' }
}
