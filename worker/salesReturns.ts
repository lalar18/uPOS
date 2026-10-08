// Sales return endpoints. Any logged-in user can view returns; only roles with sales.returns can record one,
// because a return can hand money back. Every query is limited to the user's own store.
//
//   GET  /api/sales-returns?search=&reason=&from=&to=&page=&pageSize=  -> { items, total, sums: { totalCents, refundCents } }
//            from/to: YYYY-MM-DD, both inclusive
//   GET  /api/sales-returns/:id     -> return with items
//   POST /api/sales-returns  { uid, saleId, returnDate, reason, restock, note, refundMethod,
//                              items: [{ saleItemId, quantity }] }  -> return (201; 200 when `uid` was already saved)
//
// A return credits the sale with its share of the sale total (so discounts and tax are
// returned in proportion). If the customer had paid more than the sale's new total, the
// difference is refunded as a negative payment. Restocked goods go back into stock as
// "sale_return" stock adjustments. Everything is saved in one transaction.

import {
  cleanNote,
  constraintMessage,
  documentDate,
  error,
  isDate,
  likePattern,
  lineTotal,
  MAX_LINES,
  PAYMENT_METHODS,
  positiveId,
  readPaging,
  readUid,
  referenceId,
  roundQuantity,
  type PaymentMethod,
} from './documents'
import { can } from './permissions'
import { returnReference, saleReference } from './sales'
import type { SessionUser } from './session'

/** Reasons an admin can pick (keep in step with RETURN_REASONS in src/api/salesReturns.ts). */
const RETURN_REASONS = ['defective', 'wrong_item', 'not_as_described', 'changed_mind', 'expired', 'other'] as const
type ReturnReason = (typeof RETURN_REASONS)[number]

interface ReturnRow {
  id: number
  sale_id: number
  customer_id: number | null
  customer_name: string
  return_date: string
  reason: string
  restock: number
  total_cents: number
  refund_cents: number
  note: string | null
  user_name: string
  created_at: string
  item_count: number
}

interface ReturnItemRow {
  id: number
  sale_item_id: number
  product_id: number | null
  product_name: string
  product_sku: string
  unit_short_name: string
  quantity: number
  price_cents: number
  total_cents: number
}

const RETURN_COLUMNS = `r.id, r.sale_id, s.customer_id, COALESCE(c.name, s.customer_name) AS customer_name,
  r.return_date, r.reason, r.restock, r.total_cents, r.refund_cents, r.note, r.user_name, r.created_at,
  (SELECT COUNT(*) FROM sales_return_items WHERE return_id = r.id) AS item_count`
const RETURN_FROM = `FROM sales_returns r
  JOIN sales s ON s.id = r.sale_id
  LEFT JOIN customers c ON c.id = s.customer_id`

function publicReturn(row: ReturnRow) {
  return {
    id: row.id,
    reference: returnReference(row.id),
    sale: { id: row.sale_id, reference: saleReference(row.sale_id) },
    customer: { id: row.customer_id, name: row.customer_name },
    returnDate: row.return_date,
    reason: row.reason,
    restock: row.restock === 1,
    totalCents: row.total_cents,
    refundCents: row.refund_cents,
    itemCount: row.item_count,
    note: row.note,
    userName: row.user_name,
    createdAt: row.created_at,
  }
}

async function getReturnDetail(db: D1Database, storeId: number, id: number) {
  const [header, items] = await db.batch<unknown>([
    db.prepare(`SELECT ${RETURN_COLUMNS} ${RETURN_FROM} WHERE r.id = ? AND r.store_id = ?`).bind(id, storeId),
    db
      .prepare(
        `SELECT ri.id, ri.sale_item_id, ri.product_id, ri.product_name, ri.product_sku, ri.unit_short_name,
           ri.quantity, ri.price_cents, ri.total_cents
         FROM sales_return_items ri JOIN sales_returns r ON r.id = ri.return_id
         WHERE ri.return_id = ? AND r.store_id = ? ORDER BY ri.id`,
      )
      .bind(id, storeId),
  ])
  const row = header!.results[0] as ReturnRow | undefined
  if (!row) return null
  return {
    ...publicReturn(row),
    items: (items!.results as ReturnItemRow[]).map((item) => ({
      id: item.id,
      saleItemId: item.sale_item_id,
      productId: item.product_id,
      name: item.product_name,
      sku: item.product_sku,
      unitShortName: item.unit_short_name,
      quantity: item.quantity,
      priceCents: item.price_cents,
      totalCents: item.total_cents,
    })),
  }
}

async function listReturns(db: D1Database, storeId: number, url: URL): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const reason = url.searchParams.get('reason')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const { pageSize, offset } = readPaging(url)

  const where: string[] = ['r.store_id = ?']
  const params: unknown[] = [storeId]
  if (search) {
    const pattern = likePattern(search)
    const conditions = ["COALESCE(c.name, s.customer_name) LIKE ? ESCAPE '\\'", "r.note LIKE ? ESCAPE '\\'"]
    params.push(pattern, pattern)
    // "SR-00004" finds the return; "INV-00042" finds returns of that sale; a bare number finds either
    const returnId = /^inv/i.test(search) ? null : referenceId(search, 'SR')
    const saleId = /^sr/i.test(search) ? null : referenceId(search, 'INV')
    if (returnId !== null) {
      conditions.push('r.id = ?')
      params.push(returnId)
    }
    if (saleId !== null) {
      conditions.push('r.sale_id = ?')
      params.push(saleId)
    }
    where.push(`(${conditions.join(' OR ')})`)
  }
  if (reason && (RETURN_REASONS as readonly string[]).includes(reason)) {
    where.push('r.reason = ?')
    params.push(reason)
  }
  if (isDate(from)) {
    where.push('r.return_date >= ?')
    params.push(from)
  }
  if (isDate(to)) {
    where.push('r.return_date <= ?')
    params.push(to)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [items, sums] = await db.batch<ReturnRow | Record<string, number>>([
    db
      .prepare(`SELECT ${RETURN_COLUMNS} ${RETURN_FROM} ${whereSql} ORDER BY r.return_date DESC, r.id DESC LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, offset),
    db
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(r.total_cents), 0) AS total_cents,
           COALESCE(SUM(r.refund_cents), 0) AS refund_cents
         ${RETURN_FROM} ${whereSql}`,
      )
      .bind(...params),
  ])
  const totals = sums!.results[0] as Record<string, number>

  return Response.json({
    items: (items!.results as ReturnRow[]).map(publicReturn),
    total: totals.total ?? 0,
    sums: { totalCents: totals.total_cents ?? 0, refundCents: totals.refund_cents ?? 0 },
  })
}

interface SaleForReturn {
  total_cents: number
  subtotal_cents: number
  returned_cents: number
  paid_cents: number
}

interface SaleItemForReturn {
  id: number
  product_id: number | null
  product_name: string
  quantity: number
  returned_quantity: number
  price_cents: number
  allow_decimal: number | null
}

async function findReturnByUid(db: D1Database, storeId: number, uid: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT id FROM sales_returns WHERE store_id = ? AND uid = ?')
    .bind(storeId, uid)
    .first<{ id: number }>()
  return row?.id ?? null
}

async function createReturn(db: D1Database, request: Request, user: SessionUser): Promise<Response> {
  const storeId = user.store_id
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)

  const uid = readUid(body.uid)
  if (!uid) return error('Invalid request id', 400)
  const existingId = await findReturnByUid(db, storeId, uid)
  if (existingId !== null) return Response.json(await getReturnDetail(db, storeId, existingId))

  const saleId = positiveId(body.saleId)
  if (!saleId) return error('Choose the sale being returned', 400)
  const returnDate = documentDate(body.returnDate)
  if (!returnDate) return error('Return date must be a valid date, not in the future', 400)
  const reason = body.reason as ReturnReason
  if (!RETURN_REASONS.includes(reason)) return error('Choose a reason for the return', 400)
  if (typeof body.restock !== 'boolean') return error('Say whether the goods go back into stock', 400)
  const restock = body.restock
  const note = cleanNote(body.note)
  if (note === undefined) return error('Note is too long', 400)
  if (reason === 'other' && !note) return error('Add a note explaining the return', 400)

  const [saleResult, itemsResult] = await db.batch<unknown>([
    db
      .prepare('SELECT total_cents, subtotal_cents, returned_cents, paid_cents FROM sales WHERE id = ? AND store_id = ?')
      .bind(saleId, storeId),
    db
      .prepare(
        `SELECT si.id, si.product_id, si.product_name, si.quantity, si.returned_quantity, si.price_cents, u.allow_decimal
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN products p ON p.id = si.product_id
         LEFT JOIN units u ON u.id = p.unit_id
         WHERE si.sale_id = ? AND s.store_id = ?`,
      )
      .bind(saleId, storeId),
  ])
  const sale = saleResult!.results[0] as SaleForReturn | undefined
  if (!sale) return error('Sale not found', 404)
  const saleItems = new Map((itemsResult!.results as SaleItemForReturn[]).map((item) => [item.id, item]))

  // The items and quantities being returned
  if (!Array.isArray(body.items) || body.items.length === 0) return error('Choose at least one item to return', 400)
  if (body.items.length > MAX_LINES) return error('Too many items', 400)
  const lines: { saleItemId: number; quantity: number }[] = []
  let grossCents = 0
  for (const raw of body.items as Record<string, unknown>[]) {
    const saleItemId = positiveId(raw?.saleItemId)
    const item = saleItemId ? saleItems.get(saleItemId) : undefined
    if (!saleItemId || !item) return error('An item is not part of this sale', 400)
    if (lines.some((l) => l.saleItemId === saleItemId)) return error('Each item can only be listed once', 400)
    if (typeof raw.quantity !== 'number' || !Number.isFinite(raw.quantity)) return error('Quantity must be a number', 400)
    const quantity = roundQuantity(raw.quantity)
    if (quantity <= 0) return error('Return quantities must be more than zero', 400)
    if (item.allow_decimal === 0 && !Number.isInteger(quantity)) {
      return error(`${item.product_name} can only be returned in whole numbers`, 400)
    }
    const returnable = roundQuantity(item.quantity - item.returned_quantity)
    if (quantity > returnable) {
      return error(`Only ${returnable} of ${item.product_name} can still be returned`, 409)
    }
    lines.push({ saleItemId, quantity })
    grossCents += lineTotal(quantity, item.price_cents)
  }

  // The credit is the items' share of the sale total. Returning everything that's left
  // credits exactly what's left, so rounding never leaves a centavo behind.
  const remainingCents = sale.total_cents - sale.returned_cents
  const returnsEverything = [...saleItems.values()].every((item) => {
    const line = lines.find((l) => l.saleItemId === item.id)
    return roundQuantity(item.quantity - item.returned_quantity - (line?.quantity ?? 0)) <= 0
  })
  const totalCents = returnsEverything
    ? remainingCents
    : Math.min(
        sale.subtotal_cents > 0 ? Math.round((grossCents * sale.total_cents) / sale.subtotal_cents) : 0,
        remainingCents,
      )

  const refundCents = Math.max(sale.paid_cents - (remainingCents - totalCents), 0)
  const refundMethod = (body.refundMethod ?? null) as PaymentMethod | null
  if (refundMethod !== null && !PAYMENT_METHODS.includes(refundMethod)) return error('Choose a refund method', 400)
  if (refundCents > 0 && refundMethod === null) return error('Choose how the refund is paid', 400)

  const itemsJson = JSON.stringify(lines)
  const returnSql = 'sales_returns r WHERE r.store_id = ? AND r.uid = ?'
  const statements = [
    db
      .prepare(
        `INSERT INTO sales_returns (store_id, uid, sale_id, return_date, reason, restock, total_cents, note,
           user_id, user_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(storeId, uid, saleId, returnDate, reason, restock ? 1 : 0, totalCents, note, user.id, user.full_name),
    db
      .prepare(
        `INSERT INTO sales_return_items (return_id, sale_item_id, product_id, product_name, product_sku,
           unit_short_name, quantity, price_cents, total_cents)
         SELECT r.id, si.id, si.product_id, si.product_name, si.product_sku, si.unit_short_name,
           json_extract(j.value, '$.quantity'), si.price_cents,
           ROUND(json_extract(j.value, '$.quantity') * si.price_cents)
         FROM json_each(?) j
         JOIN sale_items si ON si.id = json_extract(j.value, '$.saleItemId') AND si.sale_id = ?,
         ${returnSql}`,
      )
      .bind(itemsJson, saleId, storeId, uid),
    // The CHECK (returned_quantity <= quantity) stops two returns at once returning too much
    db
      .prepare(
        `UPDATE sale_items SET returned_quantity = ROUND(returned_quantity +
           (SELECT json_extract(j.value, '$.quantity') FROM json_each(?1) j
            WHERE json_extract(j.value, '$.saleItemId') = sale_items.id), 3)
         WHERE sale_id = ?2 AND id IN (SELECT json_extract(value, '$.saleItemId') FROM json_each(?1))`,
      )
      .bind(itemsJson, saleId),
  ]

  if (restock) {
    // Items of deleted products have no product_id and are skipped. Each product appears
    // once per sale, so each restocked product gets one log row and one update.
    statements.push(
      db
        .prepare(
          `INSERT INTO stock_adjustments (store_id, product_id, product_name, product_sku, unit_short_name, reason,
             quantity_before, quantity_change, quantity_after, note, user_id, user_name)
           SELECT p.store_id, p.id, p.name, p.sku, u.short_name, 'sale_return', p.quantity,
             json_extract(j.value, '$.quantity'), ROUND(p.quantity + json_extract(j.value, '$.quantity'), 3),
             'SR-' || printf('%05d', r.id) || ' (INV-' || printf('%05d', si.sale_id) || ')', ?, ?
           FROM json_each(?) j
           JOIN sale_items si ON si.id = json_extract(j.value, '$.saleItemId') AND si.sale_id = ?
           JOIN products p ON p.id = si.product_id AND p.store_id = ?
           JOIN units u ON u.id = p.unit_id,
           ${returnSql}`,
        )
        .bind(user.id, user.full_name, itemsJson, saleId, storeId, storeId, uid),
      db
        .prepare(
          `UPDATE products SET
             quantity = ROUND(quantity + (SELECT json_extract(j.value, '$.quantity') FROM json_each(?1) j
                                          JOIN sale_items si ON si.id = json_extract(j.value, '$.saleItemId')
                                          WHERE si.sale_id = ?2 AND si.product_id = products.id), 3),
             updated_at = datetime('now')
           WHERE store_id = ?3 AND id IN (SELECT si.product_id FROM json_each(?1) j
                                          JOIN sale_items si ON si.id = json_extract(j.value, '$.saleItemId')
                                          WHERE si.sale_id = ?2)`,
        )
        .bind(itemsJson, saleId, storeId),
    )
  }

  statements.push(
    // Refund whatever was paid beyond the sale's new total, worked out from the payments as they are now
    db
      .prepare(
        `INSERT INTO sale_payments (store_id, sale_id, return_id, amount_cents, method, note, paid_date,
           user_id, user_name)
         SELECT x.store_id, x.id, r.id, x.net_cents - x.paid_cents, ?, 'Refund', ?, ?, ?
         FROM (SELECT s.id, s.store_id,
                 s.total_cents - (SELECT COALESCE(SUM(total_cents), 0) FROM sales_returns WHERE sale_id = s.id) AS net_cents,
                 (SELECT COALESCE(SUM(amount_cents), 0) FROM sale_payments WHERE sale_id = s.id) AS paid_cents
               FROM sales s WHERE s.id = ? AND s.store_id = ?) x,
         ${returnSql} AND x.paid_cents > x.net_cents`,
      )
      .bind(refundMethod, returnDate, user.id, user.full_name, saleId, storeId, storeId, uid),
    // Both totals change in one statement, so the sales CHECKs see the finished result
    db
      .prepare(
        `UPDATE sales SET
           returned_cents = (SELECT COALESCE(SUM(total_cents), 0) FROM sales_returns WHERE sale_id = sales.id),
           paid_cents = (SELECT COALESCE(SUM(amount_cents), 0) FROM sale_payments WHERE sale_id = sales.id)
         WHERE id = ? AND store_id = ?`,
      )
      .bind(saleId, storeId),
    db
      .prepare(
        `UPDATE sales_returns SET refund_cents =
           COALESCE((SELECT -SUM(amount_cents) FROM sale_payments WHERE return_id = sales_returns.id), 0)
         WHERE store_id = ? AND uid = ?`,
      )
      .bind(storeId, uid),
    db.prepare(`SELECT r.id FROM ${returnSql}`).bind(storeId, uid),
  )

  let id: number
  try {
    const results = await db.batch(statements)
    id = (results[results.length - 1]!.results[0] as { id: number }).id
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('UNIQUE') && message.includes('sales_returns.store_id')) {
      const sameId = await findReturnByUid(db, storeId, uid)
      if (sameId !== null) return Response.json(await getReturnDetail(db, storeId, sameId))
    }
    if (message.includes('NOT NULL') && message.includes('sale_payments.method')) {
      return error('A payment was added while saving, so this return needs a refund. Choose how it is paid.', 409)
    }
    if (constraintMessage(e)) {
      return error('The sale changed while saving, so nothing was returned. Refresh and try again.', 409)
    }
    throw e
  }

  const detail = await getReturnDetail(db, storeId, id)
  return detail ? Response.json(detail, { status: 201 }) : error('Return not found', 404)
}

/** Handles /api/sales-returns routes, or returns null if the path isn't one of them. */
export async function handleSalesReturns(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const isCollection = url.pathname === '/api/sales-returns'
  const itemMatch = url.pathname.match(/^\/api\/sales-returns\/(\d+)$/)
  if (!isCollection && !itemMatch) return null

  if (request.method !== 'GET' && !can(user, 'sales.returns')) return error("You don't have permission to record returns", 403)

  if (isCollection && request.method === 'GET') return listReturns(db, user.store_id, url)
  if (isCollection && request.method === 'POST') return createReturn(db, request, user)
  if (itemMatch && request.method === 'GET') {
    const detail = await getReturnDetail(db, user.store_id, Number(itemMatch[1]))
    return detail ? Response.json(detail) : error('Return not found', 404)
  }

  return error('Method not allowed', 405)
}
