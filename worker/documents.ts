// Helpers shared by sales, sales returns and quotations: validating line items and
// customers, working out totals, and reading list filters.

/** Payment methods a user can pick (keep in step with PAYMENT_METHODS in src/api/sales.ts). */
export const PAYMENT_METHODS = ['cash', 'card', 'gcash', 'maya', 'bank_transfer', 'cheque', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const WALK_IN_CUSTOMER = 'Walk-in Customer'

export const MAX_LINES = 200
export const MAX_NOTE_LENGTH = 500
export const MAX_REFERENCE_LENGTH = 50
export const MAX_CENTS = 100_000_000_00 // ₱100 million
export const MAX_QUANTITY = 1_000_000_000
export const MAX_PAGE_SIZE = 100

export const error = (message: string, status: number) => Response.json({ error: message }, { status })

export const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '')

/** A trimmed note, or null when blank. Line breaks are kept. Returns undefined when too long. */
export function cleanNote(value: unknown): string | null | undefined {
  const note = typeof value === 'string' ? value.trim() || null : null
  return note && note.length > MAX_NOTE_LENGTH ? undefined : note
}

export const positiveId = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null

export const isCents = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_CENTS

/** Quantities are kept to 3 decimals (grams of a kilo), which also hides float noise */
export const roundQuantity = (value: number) => Math.round(value * 1000) / 1000

/** True for a real calendar date written as YYYY-MM-DD (so 2026-02-30 is rejected) */
export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

/** null/undefined/'' -> null, a valid date -> itself, anything else -> undefined (invalid). */
export function optionalDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null
  return isDate(value) ? value : undefined
}

/** Today's date in UTC, as YYYY-MM-DD */
export const utcToday = () => new Date().toISOString().slice(0, 10)

/**
 * A document date sent by the browser (its local date). Dates more than a day ahead
 * of UTC can't be "today" anywhere, so they're rejected.
 */
export function documentDate(value: unknown): string | null {
  if (!isDate(value)) return null
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  return value <= tomorrow ? value : null
}

/** The browser's id for this save. Retrying with the same uid finds the first save instead of adding twice. */
export function readUid(value: unknown): string | null {
  if (value === undefined || value === null) return crypto.randomUUID()
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : null
}

/** INV-00042 */
export const formatReference = (prefix: string, id: number) => `${prefix}-${String(id).padStart(5, '0')}`

/** "INV-00042", "inv42" or "42" -> 42, for searching by reference */
export function referenceId(search: string, prefix: string): number | null {
  const match = search.match(new RegExp(`^(?:${prefix}-?)?0*(\\d{1,15})$`, 'i'))
  return match ? Number(match[1]) : null
}

/** A LIKE pattern matching `search` anywhere, with % and _ matched literally (use ESCAPE '\') */
export const likePattern = (search: string) => `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

export function readPaging(url: URL): { page: number; pageSize: number; offset: number } {
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), MAX_PAGE_SIZE)
  const page = Math.max(Math.floor(Number(url.searchParams.get('page'))) || 1, 1)
  return { page, pageSize, offset: (page - 1) * pageSize }
}

/** Turns a constraint failure into a message, or returns null if `e` is something else. */
export function constraintMessage(e: unknown): string | null {
  const message = e instanceof Error ? e.message : String(e)
  if (message.includes('CHECK constraint failed') || message.includes('FOREIGN KEY constraint failed')) return message
  return null
}

// --- Totals (keep in step with computeTotals in src/api/sales.ts) ---

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

/** Validates the discount and tax rate in a body; returns them, or an error Response. */
export function readAdjustments(body: Record<string, unknown>): { discountCents: number; taxRateBp: number } | Response {
  const discountCents = body.discountCents ?? 0
  if (!isCents(discountCents)) return error('Discount must be a valid amount', 400)
  const taxRateBp = body.taxRateBp ?? 0
  if (!Number.isSafeInteger(taxRateBp) || (taxRateBp as number) < 0 || (taxRateBp as number) > 10_000) {
    return error('Tax rate must be between 0% and 100%', 400)
  }
  return { discountCents, taxRateBp: taxRateBp as number }
}

// --- Customers ---

/** null -> walk-in; an id -> that customer of this store; undefined when not found. */
export async function readCustomer(
  db: D1Database,
  storeId: number,
  value: unknown,
): Promise<{ id: number | null; name: string } | undefined> {
  if (value === null || value === undefined) return { id: null, name: WALK_IN_CUSTOMER }
  const id = positiveId(value)
  if (!id) return undefined
  const row = await db
    .prepare('SELECT id, name FROM customers WHERE id = ? AND store_id = ?')
    .bind(id, storeId)
    .first<{ id: number; name: string }>()
  return row ?? undefined
}

// --- Line items ---

export interface Line {
  productId: number
  name: string
  sku: string
  unitShortName: string
  quantity: number
  priceCents: number
  costCents: number | null
  totalCents: number
  stock: number // the product's stock when read
  catalogPriceCents: number
  status: 'active' | 'inactive'
}

interface ProductSnapshot {
  id: number
  name: string
  sku: string
  price_cents: number
  cost_cents: number | null
  quantity: number
  status: 'active' | 'inactive'
  unit_short_name: string
  allow_decimal: number
}

/**
 * Validates `items` ([{ productId, quantity, priceCents }]) against this store's products.
 * Each product may appear once. The price is taken as sent; callers decide who may change it.
 */
export async function readLines(db: D1Database, storeId: number, items: unknown): Promise<Line[] | Response> {
  if (!Array.isArray(items) || items.length === 0) return error('Add at least one product', 400)
  if (items.length > MAX_LINES) return error(`A document can have up to ${MAX_LINES} products`, 400)

  const wanted: { productId: number; quantity: number; priceCents: number }[] = []
  const seen = new Set<number>()
  for (const item of items as Record<string, unknown>[]) {
    const productId = positiveId(item?.productId)
    if (!productId) return error('Invalid product', 400)
    if (seen.has(productId)) return error('Each product can only be listed once', 400)
    seen.add(productId)

    if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity)) {
      return error('Quantity must be a number', 400)
    }
    const quantity = roundQuantity(item.quantity)
    if (quantity <= 0 || quantity > MAX_QUANTITY) return error('Quantity must be more than zero', 400)
    if (!isCents(item.priceCents)) return error('Price must be a valid amount', 400)
    wanted.push({ productId, quantity, priceCents: item.priceCents })
  }

  const { results } = await db
    .prepare(
      `SELECT p.id, p.name, p.sku, p.price_cents, p.cost_cents, p.quantity, p.status,
         u.short_name AS unit_short_name, u.allow_decimal
       FROM products p JOIN units u ON u.id = p.unit_id
       WHERE p.store_id = ? AND p.id IN (SELECT value FROM json_each(?))`,
    )
    .bind(storeId, JSON.stringify(wanted.map((w) => w.productId)))
    .all<ProductSnapshot>()
  const products = new Map(results.map((row) => [row.id, row]))

  const lines: Line[] = []
  for (const w of wanted) {
    const product = products.get(w.productId)
    if (!product) return error('A product in the list no longer exists. Remove it and try again.', 400)
    if (!product.allow_decimal && !Number.isInteger(w.quantity)) {
      return error(`${product.name} can only be sold in whole numbers`, 400)
    }
    const totalCents = lineTotal(w.quantity, w.priceCents)
    if (totalCents > MAX_CENTS) return error(`The amount for ${product.name} is too large`, 400)
    lines.push({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      unitShortName: product.unit_short_name,
      quantity: w.quantity,
      priceCents: w.priceCents,
      costCents: product.cost_cents,
      totalCents,
      stock: product.quantity,
      catalogPriceCents: product.price_cents,
      status: product.status,
    })
  }
  return lines
}

/** The lines as JSON for json_each() in a batch, so a whole list is written by one statement. */
export const linesJson = (lines: Line[]) =>
  JSON.stringify(
    lines.map((line, position) => ({
      productId: line.productId,
      name: line.name,
      sku: line.sku,
      unit: line.unitShortName,
      quantity: line.quantity,
      price: line.priceCents,
      cost: line.costCents,
      total: line.totalCents,
      position,
    })),
  )
