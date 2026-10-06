// Quotation endpoints. Any logged-in user can create, edit and update the status of
// quotations; only admins can delete them. Quotations don't touch stock. Converting one
// is done by creating a sale with its quotationId (see sales.ts), which marks it converted;
// a converted quotation can't be edited or deleted. Every query is limited to the user's own store.
//
//   GET    /api/quotations?search=&status=&from=&to=&today=&page=&pageSize=  -> { items, total }
//            status: draft | sent | accepted | declined | converted | expired (draft or sent, past valid_until)
//            from/to/today: YYYY-MM-DD, from and to inclusive
//   GET    /api/quotations/:id                    -> quotation with items
//   POST   /api/quotations        (QuotationInput) -> quotation (201; 200 when `uid` was already saved)
//   PUT    /api/quotations/:id    (QuotationInput) -> quotation
//   PATCH  /api/quotations/:id    { status }       -> quotation
//   DELETE /api/quotations/:id                     -> { ok }

import {
  cleanNote,
  computeTotals,
  documentDate,
  error,
  formatReference,
  isDate,
  likePattern,
  linesJson,
  MAX_CENTS,
  optionalDate,
  readAdjustments,
  readCustomer,
  readLines,
  readPaging,
  readUid,
  referenceId,
  utcToday,
  type Line,
  type Totals,
} from './documents'
import type { SessionUser } from './session'

const EDITABLE_STATUSES = ['draft', 'sent', 'accepted', 'declined'] as const
type EditableStatus = (typeof EDITABLE_STATUSES)[number]

interface QuotationRow {
  id: number
  customer_id: number | null
  customer_name: string
  customer_phone: string | null
  customer_address: string | null
  quote_date: string
  valid_until: string | null
  status: EditableStatus | 'converted'
  subtotal_cents: number
  discount_cents: number
  tax_rate_bp: number
  tax_cents: number
  total_cents: number
  note: string | null
  user_name: string
  created_at: string
  updated_at: string
  item_count: number
  sale_id: number | null
}

interface QuotationItemRow {
  id: number
  product_id: number | null
  product_name: string
  product_sku: string
  unit_short_name: string
  quantity: number
  price_cents: number
  total_cents: number
  current_price_cents: number | null
  current_quantity: number | null
  current_status: 'active' | 'inactive' | null
  allow_decimal: number | null
  image_updated_at: string | null
}

const QUOTATION_COLUMNS = `q.id, q.customer_id, COALESCE(c.name, q.customer_name) AS customer_name,
  c.phone AS customer_phone, c.address AS customer_address, q.quote_date,
  q.valid_until, q.status, q.subtotal_cents, q.discount_cents, q.tax_rate_bp, q.tax_cents, q.total_cents, q.note,
  q.user_name, q.created_at, q.updated_at,
  (SELECT COUNT(*) FROM quotation_items WHERE quotation_id = q.id) AS item_count,
  (SELECT id FROM sales WHERE quotation_id = q.id) AS sale_id`
const QUOTATION_FROM = 'FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id'

const quotationReference = (id: number) => formatReference('QT', id)

function publicQuotation(row: QuotationRow) {
  return {
    id: row.id,
    reference: quotationReference(row.id),
    customer: { id: row.customer_id, name: row.customer_name, phone: row.customer_phone, address: row.customer_address },
    quoteDate: row.quote_date,
    validUntil: row.valid_until,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    discountCents: row.discount_cents,
    taxRateBp: row.tax_rate_bp,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    note: row.note,
    itemCount: row.item_count,
    sale: row.sale_id === null ? null : { id: row.sale_id, reference: formatReference('INV', row.sale_id) },
    userName: row.user_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function getQuotationDetail(db: D1Database, storeId: number, id: number) {
  const [header, items] = await db.batch<unknown>([
    db.prepare(`SELECT ${QUOTATION_COLUMNS} ${QUOTATION_FROM} WHERE q.id = ? AND q.store_id = ?`).bind(id, storeId),
    db
      .prepare(
        `SELECT qi.id, qi.product_id, qi.product_name, qi.product_sku, qi.unit_short_name, qi.quantity,
           qi.price_cents, qi.total_cents, p.price_cents AS current_price_cents, p.quantity AS current_quantity,
           p.status AS current_status, u.allow_decimal, i.updated_at AS image_updated_at
         FROM quotation_items qi
         JOIN quotations q ON q.id = qi.quotation_id
         LEFT JOIN products p ON p.id = qi.product_id
         LEFT JOIN units u ON u.id = p.unit_id
         LEFT JOIN product_images i ON i.product_id = qi.product_id
         WHERE qi.quotation_id = ? AND q.store_id = ?
         ORDER BY qi.position, qi.id`,
      )
      .bind(id, storeId),
  ])
  const row = header!.results[0] as QuotationRow | undefined
  if (!row) return null

  return {
    ...publicQuotation(row),
    items: (items!.results as QuotationItemRow[]).map((item) => ({
      id: item.id,
      productId: item.product_id, // null once the product has been deleted
      name: item.product_name,
      sku: item.product_sku,
      unitShortName: item.unit_short_name,
      quantity: item.quantity,
      priceCents: item.price_cents,
      totalCents: item.total_cents,
      // The product as it is now, for converting to a sale (null once deleted)
      product:
        item.product_id === null || item.current_status === null
          ? null
          : {
              priceCents: item.current_price_cents!,
              quantity: item.current_quantity!,
              status: item.current_status,
              allowDecimal: item.allow_decimal === 1,
            },
      imageUrl:
        item.product_id !== null && item.image_updated_at
          ? `/api/products/${item.product_id}/image?v=${encodeURIComponent(item.image_updated_at)}`
          : null,
    })),
  }
}

async function listQuotations(db: D1Database, storeId: number, url: URL): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const status = url.searchParams.get('status')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const todayParam = url.searchParams.get('today')
  const today = isDate(todayParam) ? todayParam : utcToday()
  const { pageSize, offset } = readPaging(url)

  const where: string[] = ['q.store_id = ?']
  const params: unknown[] = [storeId]
  if (search) {
    const pattern = likePattern(search)
    const conditions = ["COALESCE(c.name, q.customer_name) LIKE ? ESCAPE '\\'", "q.note LIKE ? ESCAPE '\\'"]
    params.push(pattern, pattern)
    const id = referenceId(search, 'QT')
    if (id !== null) {
      conditions.push('q.id = ?')
      params.push(id)
    }
    where.push(`(${conditions.join(' OR ')})`)
  }
  if (status === 'expired') {
    where.push("q.status IN ('draft', 'sent') AND q.valid_until IS NOT NULL AND q.valid_until < ?")
    params.push(today)
  } else if (status && [...EDITABLE_STATUSES, 'converted'].includes(status)) {
    where.push('q.status = ?')
    params.push(status)
  }
  if (isDate(from)) {
    where.push('q.quote_date >= ?')
    params.push(from)
  }
  if (isDate(to)) {
    where.push('q.quote_date <= ?')
    params.push(to)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [items, count] = await db.batch<QuotationRow | { total: number }>([
    db
      .prepare(
        `SELECT ${QUOTATION_COLUMNS} ${QUOTATION_FROM} ${whereSql}
         ORDER BY q.quote_date DESC, q.id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, pageSize, offset),
    db.prepare(`SELECT COUNT(*) AS total ${QUOTATION_FROM} ${whereSql}`).bind(...params),
  ])

  return Response.json({
    items: (items!.results as QuotationRow[]).map(publicQuotation),
    total: (count!.results[0] as { total: number }).total,
  })
}

interface QuotationInput {
  uid: string
  customer: { id: number | null; name: string }
  quoteDate: string
  validUntil: string | null
  status: EditableStatus
  note: string | null
  lines: Line[]
  totals: Totals
}

async function readQuotationInput(
  db: D1Database,
  storeId: number,
  body: Record<string, unknown> | null,
): Promise<QuotationInput | Response> {
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)

  const uid = readUid(body.uid)
  if (!uid) return error('Invalid request id', 400)
  const customer = await readCustomer(db, storeId, body.customerId)
  if (!customer) return error('Customer not found', 400)

  const quoteDate = documentDate(body.quoteDate)
  if (!quoteDate) return error('Quotation date must be a valid date, not in the future', 400)
  const validUntil = optionalDate(body.validUntil)
  if (validUntil === undefined) return error('Valid until must be a valid date', 400)
  if (validUntil && validUntil < quoteDate) return error('Valid until cannot be before the quotation date', 400)

  const status = (body.status ?? 'draft') as EditableStatus
  if (!EDITABLE_STATUSES.includes(status)) return error('Invalid status', 400)
  const note = cleanNote(body.note)
  if (note === undefined) return error('Note is too long', 400)

  const lines = await readLines(db, storeId, body.items)
  if (lines instanceof Response) return lines
  const adjustments = readAdjustments(body)
  if (adjustments instanceof Response) return adjustments
  const totals = computeTotals(
    lines.map((l) => l.totalCents),
    adjustments.discountCents,
    adjustments.taxRateBp,
  )
  if (totals.discountCents > totals.subtotalCents) return error('Discount cannot be more than the subtotal', 400)
  if (totals.totalCents > MAX_CENTS) return error('The quotation total is too large', 400)

  return { uid, customer, quoteDate, validUntil, status, note, lines, totals }
}

/** Inserts the lines of the quotation matched by `quotationSql` (which binds `quotationParams`). */
function insertItems(db: D1Database, input: QuotationInput, quotationSql: string, quotationParams: unknown[]) {
  return db
    .prepare(
      `INSERT INTO quotation_items (quotation_id, product_id, product_name, product_sku, unit_short_name, quantity,
         price_cents, total_cents, position)
       SELECT q.id, json_extract(j.value, '$.productId'), json_extract(j.value, '$.name'),
         json_extract(j.value, '$.sku'), json_extract(j.value, '$.unit'), json_extract(j.value, '$.quantity'),
         json_extract(j.value, '$.price'), json_extract(j.value, '$.total'), json_extract(j.value, '$.position')
       FROM json_each(?) j, quotations q WHERE ${quotationSql}`,
    )
    .bind(linesJson(input.lines), ...quotationParams)
}

async function findQuotationByUid(db: D1Database, storeId: number, uid: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT id FROM quotations WHERE store_id = ? AND uid = ?')
    .bind(storeId, uid)
    .first<{ id: number }>()
  return row?.id ?? null
}

async function createQuotation(db: D1Database, request: Request, user: SessionUser): Promise<Response> {
  const storeId = user.store_id
  const input = await readQuotationInput(db, storeId, await request.json<Record<string, unknown>>().catch(() => null))
  if (input instanceof Response) return input

  const existingId = await findQuotationByUid(db, storeId, input.uid)
  if (existingId !== null) return Response.json(await getQuotationDetail(db, storeId, existingId))

  let id: number
  try {
    const [inserted] = await db.batch([
      db
        .prepare(
          `INSERT INTO quotations (store_id, uid, customer_id, customer_name, quote_date, valid_until, status,
             subtotal_cents, discount_cents, tax_rate_bp, tax_cents, total_cents, note, user_id, user_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id`,
        )
        .bind(
          storeId,
          input.uid,
          input.customer.id,
          input.customer.name,
          input.quoteDate,
          input.validUntil,
          input.status,
          input.totals.subtotalCents,
          input.totals.discountCents,
          input.totals.taxRateBp,
          input.totals.taxCents,
          input.totals.totalCents,
          input.note,
          user.id,
          user.full_name,
        ),
      insertItems(db, input, 'q.store_id = ? AND q.uid = ?', [storeId, input.uid]),
    ])
    id = (inserted!.results[0] as { id: number }).id
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('UNIQUE') && message.includes('quotations.store_id')) {
      const sameId = await findQuotationByUid(db, storeId, input.uid)
      if (sameId !== null) return Response.json(await getQuotationDetail(db, storeId, sameId))
    }
    if (message.includes('FOREIGN KEY')) return error('A product in the list no longer exists. Remove it and try again.', 409)
    throw e
  }

  const detail = await getQuotationDetail(db, storeId, id)
  return detail ? Response.json(detail, { status: 201 }) : error('Quotation not found', 404)
}

const convertedError = () => error("A converted quotation can't be changed", 409)

async function currentStatus(db: D1Database, storeId: number, id: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT status FROM quotations WHERE id = ? AND store_id = ?')
    .bind(id, storeId)
    .first<{ status: string }>()
  return row?.status ?? null
}

async function updateQuotation(db: D1Database, request: Request, storeId: number, id: number): Promise<Response> {
  const input = await readQuotationInput(db, storeId, await request.json<Record<string, unknown>>().catch(() => null))
  if (input instanceof Response) return input

  const status = await currentStatus(db, storeId, id)
  if (!status) return error('Quotation not found', 404)
  if (status === 'converted') return convertedError()

  // Every statement re-checks that the quotation isn't converted, so a conversion that
  // lands mid-save leaves it untouched
  const editable = "q.id = ? AND q.store_id = ? AND q.status != 'converted'"
  try {
    const [, , updated] = await db.batch([
      db
        .prepare(
          `DELETE FROM quotation_items WHERE quotation_id =
             (SELECT q.id FROM quotations q WHERE ${editable})`,
        )
        .bind(id, storeId),
      insertItems(db, input, editable, [id, storeId]),
      db
        .prepare(
          `UPDATE quotations SET customer_id = ?, customer_name = ?, quote_date = ?, valid_until = ?, status = ?,
             subtotal_cents = ?, discount_cents = ?, tax_rate_bp = ?, tax_cents = ?, total_cents = ?, note = ?,
             updated_at = datetime('now')
           WHERE id = ? AND store_id = ? AND status != 'converted'`,
        )
        .bind(
          input.customer.id,
          input.customer.name,
          input.quoteDate,
          input.validUntil,
          input.status,
          input.totals.subtotalCents,
          input.totals.discountCents,
          input.totals.taxRateBp,
          input.totals.taxCents,
          input.totals.totalCents,
          input.note,
          id,
          storeId,
        ),
    ])
    if (!updated!.meta.changes) return convertedError()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('FOREIGN KEY')) return error('A product in the list no longer exists. Remove it and try again.', 409)
    throw e
  }

  const detail = await getQuotationDetail(db, storeId, id)
  return detail ? Response.json(detail) : error('Quotation not found', 404)
}

async function setStatus(db: D1Database, request: Request, storeId: number, id: number): Promise<Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  const status = body?.status as EditableStatus
  if (!EDITABLE_STATUSES.includes(status)) return error('Invalid status', 400)

  const result = await db
    .prepare(
      `UPDATE quotations SET status = ?, updated_at = datetime('now')
       WHERE id = ? AND store_id = ? AND status != 'converted'`,
    )
    .bind(status, id, storeId)
    .run()
  if (!result.meta.changes) {
    return (await currentStatus(db, storeId, id)) ? convertedError() : error('Quotation not found', 404)
  }
  const detail = await getQuotationDetail(db, storeId, id)
  return detail ? Response.json(detail) : error('Quotation not found', 404)
}

async function deleteQuotation(db: D1Database, storeId: number, id: number): Promise<Response> {
  // quotation_items rows go with it (ON DELETE CASCADE)
  const result = await db
    .prepare("DELETE FROM quotations WHERE id = ? AND store_id = ? AND status != 'converted'")
    .bind(id, storeId)
    .run()
  if (result.meta.changes) return Response.json({ ok: true })
  return (await currentStatus(db, storeId, id))
    ? error("A converted quotation can't be deleted", 409)
    : error('Quotation not found', 404)
}

/** Handles /api/quotations routes, or returns null if the path isn't one of them. */
export async function handleQuotations(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const isCollection = url.pathname === '/api/quotations'
  const itemMatch = url.pathname.match(/^\/api\/quotations\/(\d+)$/)
  if (!isCollection && !itemMatch) return null

  const storeId = user.store_id
  if (isCollection && request.method === 'GET') return listQuotations(db, storeId, url)
  if (isCollection && request.method === 'POST') return createQuotation(db, request, user)
  if (!itemMatch) return error('Method not allowed', 405)

  const id = Number(itemMatch[1])
  if (request.method === 'GET') {
    const detail = await getQuotationDetail(db, storeId, id)
    return detail ? Response.json(detail) : error('Quotation not found', 404)
  }
  if (request.method === 'PUT') return updateQuotation(db, request, storeId, id)
  if (request.method === 'PATCH') return setStatus(db, request, storeId, id)
  if (request.method === 'DELETE') {
    if (user.role !== 'admin') return error('Only admins can delete quotations', 403)
    return deleteQuotation(db, storeId, id)
  }

  return error('Method not allowed', 405)
}
