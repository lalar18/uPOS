// Sale endpoints. Every sale is also its invoice (INV-00042). Any logged-in user can view
// sales; roles with sales.create can sell and record payments, and only roles with
// sales.price can sell at a price other than the product's (others may use the price on
// the quotation being converted). Every query is limited to
// the user's own store. Sales are never edited or deleted: mistakes are fixed with a return.
//
//   GET  /api/sales?search=&payment=&source=&customerId=&from=&to=&today=&page=&pageSize=
//            -> { items, total, sums: { totalCents, paidCents, dueCents } }
//            payment: paid | partial | unpaid | due (any balance) | overdue (due before `today`)
//            source: pos | manual; from/to/today: YYYY-MM-DD, from and to inclusive
//   GET  /api/sales/:id                    -> sale with items, payments, returns and onlineCheckout
//   POST /api/sales     (SaleInput)        -> sale   (201; 200 when `uid` was already saved)
//   POST /api/sales/:id/payments  { amountCents, method, reference, note, tenderedCents, paidDate } -> sale
//   /api/sales/:id/checkouts...            online payment through PayMongo (see saleCheckouts.ts)
//
// A new sale can also be paid online: with `onlinePayment: { method, amountCents }`, its checkout
// is opened once the sale is saved and comes back as `checkout` (or `checkoutError` if PayMongo
// failed: the sale stays saved with a balance, and the cashier can try again or take another
// payment). The amount counts as paid for the walk-in rule, as it's paid before the customer leaves.
//
// A sale takes its products out of stock (logged as "sale" stock adjustments) in the same
// transaction that saves it. The stock log's CHECK (quantity_after >= 0) means a sale that
// would take stock below zero fails as a whole, even when two tills sell the last item at once.
//
// A payment by an online method also records the service charge collected on top of it (see
// serviceCharges.ts). It isn't part of the sale, and isn't sent back to the store.

import {
  computeTotals,
  constraintMessage,
  documentDate,
  error,
  formatReference,
  isCents,
  likePattern,
  linesJson,
  MAX_CENTS,
  MAX_REFERENCE_LENGTH,
  optionalDate,
  PAYMENT_METHODS,
  positiveId,
  readAdjustments,
  readCustomer,
  readLines,
  readPaging,
  readUid,
  referenceId,
  cleanNote,
  cleanText,
  isDate,
  utcToday,
  WALK_IN_CUSTOMER,
  type PaymentMethod,
} from './documents'
import type { PaymongoEnv } from './paymongo'
import { can } from './permissions'
import {
  checkoutAvailable,
  closeOutdatedCheckout,
  handleSaleCheckouts,
  MIN_CHECKOUT_CENTS,
  openSaleCheckout,
  pendingCheckout,
  readOnlinePayment,
} from './saleCheckouts'
import { getServiceCharge, saleChargeCents } from './serviceCharges'
import type { SessionUser } from './session'

const MAX_PAYMENTS = 5

interface SaleRow {
  id: number
  source: 'pos' | 'manual'
  customer_id: number | null
  customer_name: string
  customer_phone: string | null
  customer_address: string | null
  quotation_id: number | null
  sale_date: string
  due_date: string | null
  subtotal_cents: number
  discount_cents: number
  tax_rate_bp: number
  tax_cents: number
  total_cents: number
  returned_cents: number
  paid_cents: number
  note: string | null
  user_name: string
  created_at: string
  item_count: number
  has_returns: number
  fully_returned: number
}

interface SaleItemRow {
  id: number
  product_id: number | null
  product_name: string
  product_sku: string
  unit_short_name: string
  quantity: number
  price_cents: number
  total_cents: number
  returned_quantity: number
  allow_decimal: number | null
  image_updated_at: string | null
}

interface PaymentRow {
  id: number
  return_id: number | null
  amount_cents: number
  tendered_cents: number | null
  method: string
  reference: string | null
  note: string | null
  paid_date: string
  user_name: string
  created_at: string
}

interface ReturnSummaryRow {
  id: number
  return_date: string
  reason: string
  total_cents: number
  refund_cents: number
}

// The customer's current name is shown when they still exist, else the name they had at the time
const SALE_COLUMNS = `s.id, s.source, s.customer_id, COALESCE(c.name, s.customer_name) AS customer_name,
  c.phone AS customer_phone, c.address AS customer_address,
  s.quotation_id, s.sale_date, s.due_date, s.subtotal_cents, s.discount_cents, s.tax_rate_bp, s.tax_cents,
  s.total_cents, s.returned_cents, s.paid_cents, s.note, s.user_name, s.created_at,
  (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) AS item_count,
  EXISTS (SELECT 1 FROM sale_items WHERE sale_id = s.id AND returned_quantity > 0) AS has_returns,
  NOT EXISTS (SELECT 1 FROM sale_items WHERE sale_id = s.id AND returned_quantity < quantity) AS fully_returned`
const SALE_FROM = 'FROM sales s LEFT JOIN customers c ON c.id = s.customer_id'
const DUE_SQL = '(s.total_cents - s.returned_cents - s.paid_cents)'

export const saleReference = (id: number) => formatReference('INV', id)
export const returnReference = (id: number) => formatReference('SR', id)

function paymentStatus(dueCents: number, paidCents: number): 'paid' | 'partial' | 'unpaid' {
  if (dueCents <= 0) return 'paid'
  return paidCents > 0 ? 'partial' : 'unpaid'
}

function publicSale(row: SaleRow) {
  const dueCents = row.total_cents - row.returned_cents - row.paid_cents
  return {
    id: row.id,
    reference: saleReference(row.id),
    source: row.source,
    // id is null for walk-in or deleted customers
    customer: { id: row.customer_id, name: row.customer_name, phone: row.customer_phone, address: row.customer_address },
    quotation: row.quotation_id === null ? null : { id: row.quotation_id, reference: formatReference('QT', row.quotation_id) },
    saleDate: row.sale_date,
    dueDate: row.due_date,
    subtotalCents: row.subtotal_cents,
    discountCents: row.discount_cents,
    taxRateBp: row.tax_rate_bp,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    returnedCents: row.returned_cents,
    paidCents: row.paid_cents,
    dueCents,
    paymentStatus: paymentStatus(dueCents, row.paid_cents),
    returnStatus: !row.has_returns ? 'none' : row.fully_returned ? 'full' : 'partial',
    itemCount: row.item_count,
    note: row.note,
    userName: row.user_name,
    createdAt: row.created_at,
  }
}

function publicItem(row: SaleItemRow) {
  return {
    id: row.id,
    productId: row.product_id, // null once the product has been deleted
    name: row.product_name,
    sku: row.product_sku,
    unitShortName: row.unit_short_name,
    allowDecimal: row.allow_decimal === 1,
    quantity: row.quantity,
    priceCents: row.price_cents,
    totalCents: row.total_cents,
    returnedQuantity: row.returned_quantity,
    imageUrl:
      row.product_id !== null && row.image_updated_at
        ? `/api/products/${row.product_id}/image?v=${encodeURIComponent(row.image_updated_at)}`
        : null,
  }
}

function publicPayment(row: PaymentRow) {
  return {
    id: row.id,
    amountCents: row.amount_cents, // negative for a refund
    tenderedCents: row.tendered_cents,
    changeCents: row.tendered_cents === null ? null : row.tendered_cents - row.amount_cents,
    method: row.method,
    reference: row.reference,
    note: row.note,
    paidDate: row.paid_date,
    return: row.return_id === null ? null : { id: row.return_id, reference: returnReference(row.return_id) },
    userName: row.user_name,
    createdAt: row.created_at,
  }
}

/** A sale with its items, payments and returns, or null if it isn't in this store. */
export async function getSaleDetail(db: D1Database, storeId: number, id: number) {
  const [sale, items, payments, returns] = await db.batch<unknown>([
    db.prepare(`SELECT ${SALE_COLUMNS} ${SALE_FROM} WHERE s.id = ? AND s.store_id = ?`).bind(id, storeId),
    db
      .prepare(
        `SELECT si.id, si.product_id, si.product_name, si.product_sku, si.unit_short_name, si.quantity,
           si.price_cents, si.total_cents, si.returned_quantity, u.allow_decimal, i.updated_at AS image_updated_at
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN products p ON p.id = si.product_id
         LEFT JOIN units u ON u.id = p.unit_id
         LEFT JOIN product_images i ON i.product_id = si.product_id
         WHERE si.sale_id = ? AND s.store_id = ?
         ORDER BY si.position, si.id`,
      )
      .bind(id, storeId),
    db
      .prepare(
        `SELECT id, return_id, amount_cents, tendered_cents, method, reference, note, paid_date, user_name, created_at
         FROM sale_payments WHERE sale_id = ? AND store_id = ? ORDER BY id`,
      )
      .bind(id, storeId),
    db
      .prepare(
        `SELECT id, return_date, reason, total_cents, refund_cents FROM sales_returns
         WHERE sale_id = ? AND store_id = ? ORDER BY id`,
      )
      .bind(id, storeId),
  ])
  const row = sale!.results[0] as SaleRow | undefined
  if (!row) return null

  return {
    ...publicSale(row),
    onlineCheckout: await pendingCheckout(db, storeId, id), // an online payment waiting to be paid
    items: (items!.results as SaleItemRow[]).map(publicItem),
    payments: (payments!.results as PaymentRow[]).map(publicPayment),
    returns: (returns!.results as ReturnSummaryRow[]).map((r) => ({
      id: r.id,
      reference: returnReference(r.id),
      returnDate: r.return_date,
      reason: r.reason,
      totalCents: r.total_cents,
      refundCents: r.refund_cents,
    })),
  }
}

async function listSales(db: D1Database, storeId: number, url: URL): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const payment = url.searchParams.get('payment')
  const source = url.searchParams.get('source')
  const customerId = Number(url.searchParams.get('customerId'))
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const todayParam = url.searchParams.get('today')
  const today = isDate(todayParam) ? todayParam : utcToday()
  const { pageSize, offset } = readPaging(url)

  const where: string[] = ['s.store_id = ?']
  const params: unknown[] = [storeId]
  if (search) {
    const pattern = likePattern(search)
    const conditions = [
      "COALESCE(c.name, s.customer_name) LIKE ? ESCAPE '\\'",
      "s.note LIKE ? ESCAPE '\\'",
      "c.phone LIKE ? ESCAPE '\\'",
    ]
    params.push(pattern, pattern, pattern)
    const id = referenceId(search, 'INV')
    if (id !== null) {
      conditions.push('s.id = ?')
      params.push(id)
    }
    where.push(`(${conditions.join(' OR ')})`)
  }
  if (payment === 'paid') where.push(`${DUE_SQL} <= 0`)
  else if (payment === 'unpaid') where.push(`${DUE_SQL} > 0 AND s.paid_cents = 0`)
  else if (payment === 'partial') where.push(`${DUE_SQL} > 0 AND s.paid_cents > 0`)
  else if (payment === 'due') where.push(`${DUE_SQL} > 0`)
  else if (payment === 'overdue') {
    where.push(`${DUE_SQL} > 0 AND s.due_date IS NOT NULL AND s.due_date < ?`)
    params.push(today)
  }
  if (source === 'pos' || source === 'manual') {
    where.push('s.source = ?')
    params.push(source)
  }
  if (Number.isSafeInteger(customerId) && customerId > 0) {
    where.push('s.customer_id = ?')
    params.push(customerId)
  }
  if (isDate(from)) {
    where.push('s.sale_date >= ?')
    params.push(from)
  }
  if (isDate(to)) {
    where.push('s.sale_date <= ?')
    params.push(to)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [items, sums] = await db.batch<SaleRow | Record<string, number>>([
    db
      .prepare(`SELECT ${SALE_COLUMNS} ${SALE_FROM} ${whereSql} ORDER BY s.sale_date DESC, s.id DESC LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, offset),
    db
      .prepare(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(s.total_cents - s.returned_cents), 0) AS total_cents,
           COALESCE(SUM(s.paid_cents), 0) AS paid_cents,
           COALESCE(SUM(MAX(${DUE_SQL}, 0)), 0) AS due_cents
         ${SALE_FROM} ${whereSql}`,
      )
      .bind(...params),
  ])
  const totals = sums!.results[0] as Record<string, number>

  return Response.json({
    items: (items!.results as SaleRow[]).map(publicSale),
    total: totals.total ?? 0,
    sums: { totalCents: totals.total_cents ?? 0, paidCents: totals.paid_cents ?? 0, dueCents: totals.due_cents ?? 0 },
  })
}

interface PaymentInput {
  amountCents: number
  tenderedCents: number | null
  method: PaymentMethod
  reference: string | null
  note: string | null
}

/** Validates one payment; returns it or an error message. */
function readPayment(value: unknown): PaymentInput | string {
  const body = value as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return 'Invalid payment'
  if (!isCents(body.amountCents) || body.amountCents <= 0) return 'Payment amount must be more than zero'

  const method = body.method as PaymentMethod
  if (!PAYMENT_METHODS.includes(method)) return 'Choose a payment method'

  const tendered = body.tenderedCents ?? null
  if (tendered !== null) {
    if (method !== 'cash') return 'Only cash payments can have change'
    if (!isCents(tendered) || tendered < body.amountCents) return 'Cash received must cover the amount paid'
  }

  const reference = cleanText(body.reference) || null
  if (reference && reference.length > MAX_REFERENCE_LENGTH) {
    return `Payment reference must be ${MAX_REFERENCE_LENGTH} characters or less`
  }
  const note = cleanNote(body.note)
  if (note === undefined) return 'Payment note is too long'

  return { amountCents: body.amountCents, tenderedCents: tendered as number | null, method, reference, note }
}

async function findSaleByUid(db: D1Database, storeId: number, uid: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT id FROM sales WHERE store_id = ? AND uid = ?')
    .bind(storeId, uid)
    .first<{ id: number }>()
  return row?.id ?? null
}

async function createSale(db: D1Database, env: PaymongoEnv, request: Request, user: SessionUser): Promise<Response> {
  const storeId = user.store_id
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)

  const uid = readUid(body.uid)
  if (!uid) return error('Invalid request id', 400)
  // A retried checkout gets the sale its first attempt saved
  const existingId = await findSaleByUid(db, storeId, uid)
  if (existingId !== null) return Response.json(await getSaleDetail(db, storeId, existingId))

  const source = body.source ?? 'manual'
  if (source !== 'pos' && source !== 'manual') return error('Invalid sale source', 400)

  const customer = await readCustomer(db, storeId, body.customerId)
  if (!customer) return error('Customer not found', 400)

  const saleDate = documentDate(body.saleDate)
  if (!saleDate) return error('Sale date must be a valid date, not in the future', 400)
  const dueDate = optionalDate(body.dueDate)
  if (dueDate === undefined) return error('Due date must be a valid date', 400)
  if (dueDate && dueDate < saleDate) return error('Due date cannot be before the sale date', 400)

  const note = cleanNote(body.note)
  if (note === undefined) return error('Note is too long', 400)

  // A quotation being converted: it must be this store's and not converted already
  let quotationId: number | null = null
  const quotedPrices = new Map<number, number>()
  if (body.quotationId !== null && body.quotationId !== undefined) {
    quotationId = positiveId(body.quotationId)
    if (!quotationId) return error('Invalid quotation', 400)
    const [quotation, quotedItems] = await db.batch<unknown>([
      db.prepare('SELECT status FROM quotations WHERE id = ? AND store_id = ?').bind(quotationId, storeId),
      db
        .prepare(
          `SELECT qi.product_id, qi.price_cents FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id
           WHERE qi.quotation_id = ? AND q.store_id = ? AND qi.product_id IS NOT NULL`,
        )
        .bind(quotationId, storeId),
    ])
    const status = (quotation!.results[0] as { status: string } | undefined)?.status
    if (!status) return error('Quotation not found', 404)
    if (status === 'converted') return error('This quotation has already been converted to a sale', 409)
    for (const q of quotedItems!.results as { product_id: number; price_cents: number }[]) {
      quotedPrices.set(q.product_id, q.price_cents)
    }
  }

  const lines = await readLines(db, storeId, body.items)
  if (lines instanceof Response) return lines
  const canSetPrice = can(user, 'sales.price')
  for (const line of lines) {
    if (line.status !== 'active') return error(`${line.name} is inactive and can't be sold`, 400)
    const allowedPrice = quotedPrices.get(line.productId) ?? line.catalogPriceCents
    if (!canSetPrice && line.priceCents !== allowedPrice && line.priceCents !== line.catalogPriceCents) {
      const price = (line.catalogPriceCents / 100).toFixed(2)
      return error(`${line.name} sells for ₱${price}. You don't have permission to sell at a different price.`, 409)
    }
    if (line.quantity > line.stock) {
      return error(`Only ${Math.max(line.stock, 0)} ${line.unitShortName} of ${line.name} left in stock`, 409)
    }
  }

  const adjustments = readAdjustments(body)
  if (adjustments instanceof Response) return adjustments
  const totals = computeTotals(
    lines.map((l) => l.totalCents),
    adjustments.discountCents,
    adjustments.taxRateBp,
  )
  if (totals.discountCents > totals.subtotalCents) return error('Discount cannot be more than the subtotal', 400)
  if (totals.totalCents > MAX_CENTS) return error('The sale total is too large', 400)

  const rawPayments = body.payments ?? []
  if (!Array.isArray(rawPayments) || rawPayments.length > MAX_PAYMENTS) return error('Invalid payments', 400)
  const payments: PaymentInput[] = []
  for (const raw of rawPayments) {
    const payment = readPayment(raw)
    if (typeof payment === 'string') return error(payment, 400)
    payments.push(payment)
  }
  let online: Exclude<ReturnType<typeof readOnlinePayment>, string> | null = null
  if (body.onlinePayment !== null && body.onlinePayment !== undefined) {
    if (!checkoutAvailable(env, user)) return error('Online payment is not available', 400)
    const input = readOnlinePayment(body.onlinePayment)
    if (typeof input === 'string') return error(input, 400)
    // Checked before saving, so the sale isn't saved with a payment PayMongo would refuse
    const chargeCents = saleChargeCents(await getServiceCharge(db, 'sale'), input.method, input.amountCents)
    if (input.amountCents + chargeCents < MIN_CHECKOUT_CENTS) {
      return error(`Online payments must be at least ₱${(MIN_CHECKOUT_CENTS / 100).toFixed(2)}`, 400)
    }
    online = input
  }
  const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0)
  if (paidCents + (online?.amountCents ?? 0) > totals.totalCents) return error('Payments are more than the sale total', 400)
  if (customer.id === null && paidCents + (online?.amountCents ?? 0) < totals.totalCents) {
    return error(`${WALK_IN_CUSTOMER} sales must be paid in full. Choose a customer to sell on credit.`, 400)
  }

  const saleSql = 'FROM sales s WHERE s.store_id = ? AND s.uid = ?'
  const statements = [
    db
      .prepare(
        `INSERT INTO sales (store_id, uid, source, customer_id, customer_name, quotation_id, sale_date, due_date,
           subtotal_cents, discount_cents, tax_rate_bp, tax_cents, total_cents, note, user_id, user_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        storeId,
        uid,
        source,
        customer.id,
        customer.name,
        quotationId,
        saleDate,
        dueDate,
        totals.subtotalCents,
        totals.discountCents,
        totals.taxRateBp,
        totals.taxCents,
        totals.totalCents,
        note,
        user.id,
        user.full_name,
      ),
    db
      .prepare(
        `INSERT INTO sale_items (sale_id, product_id, product_name, product_sku, unit_short_name, quantity,
           price_cents, cost_cents, total_cents, position)
         SELECT s.id, json_extract(j.value, '$.productId'), json_extract(j.value, '$.name'),
           json_extract(j.value, '$.sku'), json_extract(j.value, '$.unit'), json_extract(j.value, '$.quantity'),
           json_extract(j.value, '$.price'), json_extract(j.value, '$.cost'), json_extract(j.value, '$.total'),
           json_extract(j.value, '$.position')
         FROM json_each(?) j, sales s WHERE s.store_id = ? AND s.uid = ?`,
      )
      .bind(linesJson(lines), storeId, uid),
    // Log the stock leaving, then take it off the products. Both read the same starting stock.
    db
      .prepare(
        `INSERT INTO stock_adjustments (store_id, product_id, product_name, product_sku, unit_short_name, reason,
           quantity_before, quantity_change, quantity_after, note, user_id, user_name)
         SELECT p.store_id, p.id, p.name, p.sku, u.short_name, 'sale', p.quantity,
           -json_extract(j.value, '$.quantity'), ROUND(p.quantity - json_extract(j.value, '$.quantity'), 3),
           'INV-' || printf('%05d', s.id), ?, ?
         FROM json_each(?) j
         JOIN products p ON p.id = json_extract(j.value, '$.productId') AND p.store_id = ?
         JOIN units u ON u.id = p.unit_id
         JOIN sales s ON s.store_id = ? AND s.uid = ?`,
      )
      .bind(user.id, user.full_name, linesJson(lines), storeId, storeId, uid),
    db
      .prepare(
        `UPDATE products SET
           quantity = ROUND(quantity - (SELECT json_extract(j.value, '$.quantity') FROM json_each(?1) j
                                        WHERE json_extract(j.value, '$.productId') = products.id), 3),
           updated_at = datetime('now')
         WHERE store_id = ?2 AND id IN (SELECT json_extract(value, '$.productId') FROM json_each(?1))`,
      )
      .bind(linesJson(lines), storeId),
  ]
  if (payments.length > 0) {
    const charge = await getServiceCharge(db, 'sale')
    const charged = payments.map((p) => ({ ...p, serviceChargeCents: saleChargeCents(charge, p.method, p.amountCents) }))
    statements.push(
      db
        .prepare(
          `INSERT INTO sale_payments (store_id, sale_id, amount_cents, tendered_cents, method, reference, note,
             service_charge_cents, paid_date, user_id, user_name)
           SELECT s.store_id, s.id, json_extract(j.value, '$.amountCents'), json_extract(j.value, '$.tenderedCents'),
             json_extract(j.value, '$.method'), json_extract(j.value, '$.reference'), json_extract(j.value, '$.note'),
             json_extract(j.value, '$.serviceChargeCents'), ?, ?, ?
           FROM json_each(?) j, sales s WHERE s.store_id = ? AND s.uid = ?`,
        )
        .bind(saleDate, user.id, user.full_name, JSON.stringify(charged), storeId, uid),
      db
        .prepare(
          `UPDATE sales SET paid_cents = (SELECT COALESCE(SUM(amount_cents), 0) FROM sale_payments
                                          WHERE sale_id = sales.id)
           WHERE store_id = ? AND uid = ?`,
        )
        .bind(storeId, uid),
    )
  }
  if (quotationId !== null) {
    statements.push(
      db
        .prepare("UPDATE quotations SET status = 'converted', updated_at = datetime('now') WHERE id = ? AND store_id = ?")
        .bind(quotationId, storeId),
    )
  }
  statements.push(db.prepare(`SELECT s.id ${saleSql}`).bind(storeId, uid))

  let id: number
  try {
    const results = await db.batch(statements)
    id = (results[results.length - 1]!.results[0] as { id: number }).id
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('UNIQUE') && message.includes('sales.store_id')) {
      // The same checkout was saved by a request that ran at the same time
      const sameId = await findSaleByUid(db, storeId, uid)
      if (sameId !== null) return Response.json(await getSaleDetail(db, storeId, sameId))
    }
    if (message.includes('UNIQUE') && message.includes('sales.quotation_id')) {
      return error('This quotation has already been converted to a sale', 409)
    }
    if (constraintMessage(e)) {
      // The stock or products changed between the checks above and saving
      return error('Stock changed while saving, so nothing was sold. Refresh and try again.', 409)
    }
    throw e
  }

  if (online) {
    const checkout = await openSaleCheckout(db, env, user, id, online, new URL(request.url).origin)
    const sale = await getSaleDetail(db, storeId, id)
    if (!sale) return error('Sale not found', 404)
    if (checkout instanceof Response) {
      const { error: message } = await checkout.json<{ error: string }>()
      return Response.json({ ...sale, checkoutError: message }, { status: 201 })
    }
    return Response.json({ ...sale, onlineCheckout: checkout }, { status: 201 })
  }

  const sale = await getSaleDetail(db, storeId, id)
  return sale ? Response.json(sale, { status: 201 }) : error('Sale not found', 404)
}

async function addPayment(
  db: D1Database,
  env: PaymongoEnv,
  request: Request,
  user: SessionUser,
  saleId: number,
): Promise<Response> {
  const storeId = user.store_id
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)

  const payment = readPayment(body)
  if (typeof payment === 'string') return error(payment, 400)
  const paidDate = body.paidDate === undefined ? utcToday() : documentDate(body.paidDate)
  if (!paidDate) return error('Payment date must be a valid date, not in the future', 400)

  const sale = await db
    .prepare(`SELECT ${DUE_SQL} AS due_cents FROM sales s WHERE s.id = ? AND s.store_id = ?`)
    .bind(saleId, storeId)
    .first<{ due_cents: number }>()
  if (!sale) return error('Sale not found', 404)
  if (sale.due_cents <= 0) return error('This invoice is already fully paid', 409)
  if (payment.amountCents > sale.due_cents) return error('The payment is more than the balance due', 400)
  const charge = await getServiceCharge(db, 'sale')

  try {
    // Recalculating paid_cents runs the sales CHECK, so two payments at once can't overpay
    await db.batch([
      db
        .prepare(
          `INSERT INTO sale_payments (store_id, sale_id, amount_cents, tendered_cents, method, reference, note,
             service_charge_cents, paid_date, user_id, user_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          storeId,
          saleId,
          payment.amountCents,
          payment.tenderedCents,
          payment.method,
          payment.reference,
          payment.note,
          saleChargeCents(charge, payment.method, payment.amountCents),
          paidDate,
          user.id,
          user.full_name,
        ),
      db
        .prepare(
          `UPDATE sales SET paid_cents = (SELECT COALESCE(SUM(amount_cents), 0) FROM sale_payments
                                          WHERE sale_id = sales.id)
           WHERE id = ? AND store_id = ?`,
        )
        .bind(saleId, storeId),
    ])
  } catch (e) {
    if (constraintMessage(e)) return error('The payment is more than the balance due. Refresh and try again.', 409)
    throw e
  }
  // An online payment still waiting for more than is now due can't be paid any more
  await closeOutdatedCheckout(db, env, saleId)

  const detail = await getSaleDetail(db, storeId, saleId)
  return detail ? Response.json(detail, { status: 201 }) : error('Sale not found', 404)
}

/** Handles /api/sales routes, or returns null if the path isn't one of them. */
export async function handleSales(
  db: D1Database,
  env: PaymongoEnv,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const isCollection = url.pathname === '/api/sales'
  const itemMatch = url.pathname.match(/^\/api\/sales\/(\d+)$/)
  const paymentsMatch = url.pathname.match(/^\/api\/sales\/(\d+)\/payments$/)
  const checkoutsMatch = /^\/api\/sales\/\d+\/checkouts(\/\d+)?$/.test(url.pathname)
  if (!isCollection && !itemMatch && !paymentsMatch && !checkoutsMatch) return null

  if (request.method !== 'GET' && !can(user, 'sales.create')) {
    return error("You don't have permission to make sales or record payments", 403)
  }

  if (checkoutsMatch) return handleSaleCheckouts(db, env, request, url, user)
  if (isCollection && request.method === 'GET') return listSales(db, user.store_id, url)
  if (isCollection && request.method === 'POST') return createSale(db, env, request, user)
  if (itemMatch && request.method === 'GET') {
    const sale = await getSaleDetail(db, user.store_id, Number(itemMatch[1]))
    return sale ? Response.json(sale) : error('Sale not found', 404)
  }
  if (paymentsMatch && request.method === 'POST') return addPayment(db, env, request, user, Number(paymentsMatch[1]))

  return error('Method not allowed', 405)
}
