// Stock endpoints. Any logged-in user can view; only admins can adjust.
// Cashiers never see cost values. Every query is limited to the user's own store.
//
//   GET  /api/stock/summary          -> { productCount, lowCount, outCount, retailValueCents, costValueCents, missingCostCount }
//   GET  /api/stock/adjustments?search=&reason=&direction=in|out&productId=&from=&to=&page=&pageSize=  -> { items, total }
//            from/to are UTC "YYYY-MM-DD HH:MM:SS"; from is inclusive, to is exclusive
//   POST /api/stock/adjustments  { productId, mode: add|remove|set, quantity, reason, note }  -> adjustment
//
// Adjustments are never edited or deleted, so the log always adds up to the product's stock.

import type { SessionUser } from './session'

/**
 * Reasons an admin can pick. The system records the others: "opening" when a product is
 * created, "sale" when it's sold and "sale_return" when a sales return puts it back in stock.
 */
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
type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number]
const ALL_REASONS: readonly string[] = ['opening', 'sale', 'sale_return', ...ADJUSTMENT_REASONS]

type AdjustmentMode = 'add' | 'remove' | 'set'

interface AdjustmentRow {
  id: number
  product_id: number | null
  product_name: string
  product_sku: string
  unit_short_name: string
  reason: string
  quantity_before: number
  quantity_change: number
  quantity_after: number
  note: string | null
  user_name: string
  created_at: string
  image_updated_at: string | null
}

const MAX_QUANTITY = 1_000_000_000
const MAX_NOTE_LENGTH = 500
const MAX_PAGE_SIZE = 100
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

// The product's current name is shown when it still exists, else the name it had at the time
const ADJUSTMENT_COLUMNS = `a.id, a.product_id, COALESCE(p.name, a.product_name) AS product_name,
  COALESCE(p.sku, a.product_sku) AS product_sku, a.unit_short_name, a.reason, a.quantity_before,
  a.quantity_change, a.quantity_after, a.note, a.user_name, a.created_at, i.updated_at AS image_updated_at`
const ADJUSTMENT_FROM = `FROM stock_adjustments a
  LEFT JOIN products p ON p.id = a.product_id
  LEFT JOIN product_images i ON i.product_id = a.product_id`

/** ADJ-00042 */
const referenceFor = (id: number) => `ADJ-${String(id).padStart(5, '0')}`

function publicAdjustment(row: AdjustmentRow) {
  return {
    id: row.id,
    reference: referenceFor(row.id),
    product: {
      id: row.product_id, // null once the product has been deleted
      name: row.product_name,
      sku: row.product_sku,
      imageUrl:
        row.product_id !== null && row.image_updated_at
          ? `/api/products/${row.product_id}/image?v=${encodeURIComponent(row.image_updated_at)}`
          : null,
    },
    unitShortName: row.unit_short_name,
    reason: row.reason,
    quantityBefore: row.quantity_before,
    quantityChange: row.quantity_change,
    quantityAfter: row.quantity_after,
    note: row.note,
    userName: row.user_name,
    createdAt: row.created_at,
  }
}

const error = (message: string, status: number) => Response.json({ error: message }, { status })

/** Stock is kept to 3 decimals (grams of a kilo), which also hides float noise like 0.30000000000000004 */
const roundQuantity = (value: number) => Math.round(value * 1000) / 1000

const positiveId = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null

async function getSummary(db: D1Database, storeId: number, showCost: boolean): Promise<Response> {
  // Only active products: inactive ones aren't sold, so their stock isn't watched
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS product_count,
         COALESCE(SUM(quantity > 0 AND quantity <= alert_quantity), 0) AS low_count,
         COALESCE(SUM(quantity <= 0), 0) AS out_count,
         COALESCE(SUM(CASE WHEN quantity > 0 THEN ROUND(quantity * price_cents) END), 0) AS retail_cents,
         COALESCE(SUM(CASE WHEN quantity > 0 AND cost_cents IS NOT NULL THEN ROUND(quantity * cost_cents) END), 0)
           AS cost_cents,
         COALESCE(SUM(quantity > 0 AND cost_cents IS NULL), 0) AS missing_cost_count
       FROM products WHERE store_id = ? AND status = 'active'`,
    )
    .bind(storeId)
    .first<{
      product_count: number
      low_count: number
      out_count: number
      retail_cents: number
      cost_cents: number
      missing_cost_count: number
    }>()

  return Response.json({
    productCount: row?.product_count ?? 0,
    lowCount: row?.low_count ?? 0,
    outCount: row?.out_count ?? 0,
    retailValueCents: Math.round(row?.retail_cents ?? 0),
    costValueCents: showCost ? Math.round(row?.cost_cents ?? 0) : null,
    missingCostCount: showCost ? (row?.missing_cost_count ?? 0) : null,
  })
}

async function listAdjustments(db: D1Database, storeId: number, url: URL): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const reason = url.searchParams.get('reason')
  const direction = url.searchParams.get('direction')
  const productId = Number(url.searchParams.get('productId'))
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), MAX_PAGE_SIZE)
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)

  const where: string[] = ['a.store_id = ?']
  const params: unknown[] = [storeId]
  if (search) {
    // Escape LIKE wildcards so "%" and "_" are matched literally
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const conditions = [
      "COALESCE(p.name, a.product_name) LIKE ? ESCAPE '\\'",
      "COALESCE(p.sku, a.product_sku) LIKE ? ESCAPE '\\'",
      "a.note LIKE ? ESCAPE '\\'",
    ]
    params.push(pattern, pattern, pattern)
    // "ADJ-00042", "adj42" or "42" also finds adjustment 42
    const reference = search.match(/^(?:adj-?)?0*(\d{1,15})$/i)
    if (reference) {
      conditions.push('a.id = ?')
      params.push(Number(reference[1]))
    }
    where.push(`(${conditions.join(' OR ')})`)
  }
  if (reason && ALL_REASONS.includes(reason)) {
    where.push('a.reason = ?')
    params.push(reason)
  }
  if (direction === 'in') where.push('a.quantity_change > 0')
  else if (direction === 'out') where.push('a.quantity_change < 0')
  if (Number.isSafeInteger(productId) && productId > 0) {
    where.push('a.product_id = ?')
    params.push(productId)
  }
  if (from && TIMESTAMP_PATTERN.test(from)) {
    where.push('a.created_at >= ?')
    params.push(from)
  }
  if (to && TIMESTAMP_PATTERN.test(to)) {
    where.push('a.created_at < ?')
    params.push(to)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [items, count] = await db.batch<AdjustmentRow | { total: number }>([
    db
      .prepare(`SELECT ${ADJUSTMENT_COLUMNS} ${ADJUSTMENT_FROM} ${whereSql} ORDER BY a.id DESC LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, (page - 1) * pageSize),
    db
      .prepare(`SELECT COUNT(*) AS total FROM stock_adjustments a LEFT JOIN products p ON p.id = a.product_id ${whereSql}`)
      .bind(...params),
  ])

  return Response.json({
    items: (items!.results as AdjustmentRow[]).map(publicAdjustment),
    total: (count!.results[0] as { total: number }).total,
  })
}

async function createAdjustment(db: D1Database, request: Request, user: SessionUser): Promise<Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)

  const productId = positiveId(body.productId)
  if (!productId) return error('Choose a product', 400)

  const mode = body.mode as AdjustmentMode
  if (mode !== 'add' && mode !== 'remove' && mode !== 'set') return error('Choose add, remove or set', 400)

  if (typeof body.quantity !== 'number' || !Number.isFinite(body.quantity)) {
    return error('Quantity must be a number', 400)
  }
  const quantity = roundQuantity(body.quantity)
  if (quantity < 0 || quantity > MAX_QUANTITY) return error('Quantity is out of range', 400)
  if (mode !== 'set' && quantity <= 0) return error('Quantity must be more than zero', 400)

  const reason = body.reason as AdjustmentReason
  if (!ADJUSTMENT_REASONS.includes(reason)) return error('Choose a reason', 400)

  const note = typeof body.note === 'string' ? body.note.trim().replace(/\s+/g, ' ') || null : null
  if (note && note.length > MAX_NOTE_LENGTH) return error(`Note must be ${MAX_NOTE_LENGTH} characters or less`, 400)
  if (reason === 'other' && !note) return error('Add a note explaining the adjustment', 400)

  const product = await db
    .prepare(
      `SELECT p.quantity, u.allow_decimal FROM products p JOIN units u ON u.id = p.unit_id
       WHERE p.id = ? AND p.store_id = ?`,
    )
    .bind(productId, user.store_id)
    .first<{ quantity: number; allow_decimal: number }>()
  if (!product) return error('Product not found', 404)
  if (!product.allow_decimal && !Number.isInteger(quantity)) {
    return error("This product's unit only allows whole numbers", 400)
  }

  // The new quantity is worked out in SQL from the stock at that moment, and the log row and the
  // product update run in one batch (a transaction), so two adjustments at once can't lose either.
  // Each takes the stock column as that statement names it, and uses one ? for afterValue
  const afterSql = (column: string) => (mode === 'set' ? '?' : `ROUND(${column} + ?, 3)`)
  const guardSql = (column: string) => `${afterSql(column)} >= 0 AND ROUND(${afterSql(column)} - ${column}, 3) != 0`
  const afterValue = mode === 'remove' ? -quantity : quantity

  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO stock_adjustments (store_id, product_id, product_name, product_sku, unit_short_name, reason,
           quantity_before, quantity_change, quantity_after, note, user_id, user_name)
         SELECT p.store_id, p.id, p.name, p.sku, u.short_name, ?,
           p.quantity, ROUND(${afterSql('p.quantity')} - p.quantity, 3), ${afterSql('p.quantity')}, ?, ?, ?
         FROM products p JOIN units u ON u.id = p.unit_id
         WHERE p.id = ? AND p.store_id = ? AND ${guardSql('p.quantity')}
         RETURNING id`,
      )
      .bind(
        reason,
        afterValue,
        afterValue,
        note,
        user.id,
        user.full_name,
        productId,
        user.store_id,
        afterValue,
        afterValue,
      ),
    db
      .prepare(
        `UPDATE products SET quantity = ${afterSql('quantity')}, updated_at = datetime('now')
         WHERE id = ? AND store_id = ? AND ${guardSql('quantity')}`,
      )
      .bind(afterValue, productId, user.store_id, afterValue, afterValue),
  ])

  const id = (inserted!.results[0] as { id: number } | undefined)?.id
  if (!id) {
    // Nothing changed. Explain why, using the stock as it is now.
    const current = await db
      .prepare('SELECT quantity FROM products WHERE id = ? AND store_id = ?')
      .bind(productId, user.store_id)
      .first<{ quantity: number }>()
    if (!current) return error('Product not found', 404)
    if (mode === 'remove') return error(`Only ${current.quantity} in stock; you can't remove more than that`, 409)
    return error('That leaves the stock unchanged', 400)
  }

  const row = await db
    .prepare(`SELECT ${ADJUSTMENT_COLUMNS} ${ADJUSTMENT_FROM} WHERE a.id = ?`)
    .bind(id)
    .first<AdjustmentRow>()
  return row ? Response.json(publicAdjustment(row), { status: 201 }) : error('Adjustment not found', 404)
}

/** Handles /api/stock routes, or returns null if the path isn't one of them. */
export async function handleStock(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const isSummary = url.pathname === '/api/stock/summary'
  const isAdjustments = url.pathname === '/api/stock/adjustments'
  if (!isSummary && !isAdjustments) return null

  const isAdmin = user.role === 'admin'
  if (request.method !== 'GET' && !isAdmin) return error('Only admins can adjust stock', 403)

  if (isSummary && request.method === 'GET') return getSummary(db, user.store_id, isAdmin)
  if (isAdjustments && request.method === 'GET') return listAdjustments(db, user.store_id, url)
  if (isAdjustments && request.method === 'POST') return createAdjustment(db, request, user)

  return error('Method not allowed', 405)
}
