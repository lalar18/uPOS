// Customer endpoints. Any logged-in user can search and add customers (cashiers add them
// at the till); only admins can edit or delete. Every query is limited to the user's own store.
//
//   GET    /api/customers?search=&status=&page=&pageSize=           -> { items, total }
//   GET    /api/customers/:id                                       -> customer
//   POST   /api/customers      { name, phone, email, address, status? } -> customer
//   PUT    /api/customers/:id  { name, phone, email, address, status? } -> customer
//   DELETE /api/customers/:id                                       -> { ok }

import { readContactFields, readPersonName, type ContactFields, type Status } from './contacts'
import { constraintMessage, error, likePattern, readPaging } from './documents'
import type { SessionUser } from './session'

interface CustomerRow {
  id: number
  name: string
  phone: string | null
  email: string | null
  address: string | null
  status: Status
  created_at: string
  sale_count: number
  quotation_count: number
  balance_cents: number
}

interface CustomerInput extends ContactFields {
  name: string
}

// Sales and quotations keep their own copy of the customer's name, so editing a
// customer never changes past documents.
const CUSTOMER_COLUMNS = `c.id, c.name, c.phone, c.email, c.address, c.status, c.created_at,
  (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) AS sale_count,
  (SELECT COUNT(*) FROM quotations q WHERE q.customer_id = c.id) AS quotation_count,
  (SELECT COALESCE(SUM(s.total_cents - s.returned_cents - s.paid_cents), 0)
     FROM sales s WHERE s.customer_id = c.id) AS balance_cents`

function publicCustomer(row: CustomerRow) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    status: row.status,
    saleCount: row.sale_count,
    quotationCount: row.quotation_count,
    balanceCents: row.balance_cents,
    createdAt: row.created_at,
  }
}

async function getCustomer(db: D1Database, storeId: number, id: number): Promise<CustomerRow | null> {
  return db
    .prepare(`SELECT ${CUSTOMER_COLUMNS} FROM customers c WHERE c.id = ? AND c.store_id = ?`)
    .bind(id, storeId)
    .first<CustomerRow>()
}

async function readCustomerInput(request: Request): Promise<CustomerInput | Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)

  const name = readPersonName(body.name, 'Customer name')
  if (name instanceof Response) return name
  const contact = readContactFields(body)
  if (contact instanceof Response) return contact
  return { name, ...contact }
}

async function listCustomers(db: D1Database, storeId: number, url: URL): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const status = url.searchParams.get('status')
  const { pageSize, offset } = readPaging(url)

  const where: string[] = ['c.store_id = ?']
  const params: unknown[] = [storeId]
  if (search) {
    const pattern = likePattern(search)
    where.push("(c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\')")
    params.push(pattern, pattern, pattern)
  }
  if (status === 'active' || status === 'inactive') {
    where.push('c.status = ?')
    params.push(status)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [items, count] = await db.batch<CustomerRow | { total: number }>([
    db
      .prepare(`SELECT ${CUSTOMER_COLUMNS} FROM customers c ${whereSql} ORDER BY c.name, c.id LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM customers c ${whereSql}`).bind(...params),
  ])

  return Response.json({
    items: (items!.results as CustomerRow[]).map(publicCustomer),
    total: (count!.results[0] as { total: number }).total,
  })
}

async function createCustomer(db: D1Database, storeId: number, request: Request): Promise<Response> {
  const input = await readCustomerInput(request)
  if (input instanceof Response) return input

  const row = await db
    .prepare(
      `INSERT INTO customers (store_id, name, phone, email, address, status) VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id, name, phone, email, address, status, created_at,
                 0 AS sale_count, 0 AS quotation_count, 0 AS balance_cents`,
    )
    .bind(storeId, input.name, input.phone, input.email, input.address, input.status)
    .first<CustomerRow>()
  return row ? Response.json(publicCustomer(row), { status: 201 }) : error('Could not add the customer', 500)
}

async function updateCustomer(db: D1Database, storeId: number, request: Request, id: number): Promise<Response> {
  const input = await readCustomerInput(request)
  if (input instanceof Response) return input

  const result = await db
    .prepare(
      `UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, status = ?, updated_at = datetime('now')
       WHERE id = ? AND store_id = ?`,
    )
    .bind(input.name, input.phone, input.email, input.address, input.status, id, storeId)
    .run()
  if (!result.meta.changes) return error('Customer not found', 404)

  const row = await getCustomer(db, storeId, id)
  return row ? Response.json(publicCustomer(row)) : error('Customer not found', 404)
}

async function deleteCustomer(db: D1Database, storeId: number, id: number): Promise<Response> {
  const customer = await getCustomer(db, storeId, id)
  if (!customer) return error('Customer not found', 404)
  // Deleting would unlink their sales and quotations, losing the customer's history
  if (customer.sale_count > 0 || customer.quotation_count > 0) {
    return error('This customer has sales or quotations. Set them to inactive instead.', 409)
  }

  try {
    await db.prepare('DELETE FROM customers WHERE id = ? AND store_id = ?').bind(id, storeId).run()
  } catch (e) {
    if (constraintMessage(e)) return error('This customer is in use, so they cannot be deleted', 409)
    throw e
  }
  return Response.json({ ok: true })
}

/** Handles /api/customers routes, or returns null if the path isn't one of them. */
export async function handleCustomers(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const isCollection = url.pathname === '/api/customers'
  const itemMatch = url.pathname.match(/^\/api\/customers\/(\d+)$/)
  if (!isCollection && !itemMatch) return null

  const storeId = user.store_id
  if (isCollection && request.method === 'GET') return listCustomers(db, storeId, url)
  if (isCollection && request.method === 'POST') return createCustomer(db, storeId, request)
  if (itemMatch && request.method === 'GET') {
    const row = await getCustomer(db, storeId, Number(itemMatch[1]))
    return row ? Response.json(publicCustomer(row)) : error('Customer not found', 404)
  }

  if (itemMatch && (request.method === 'PUT' || request.method === 'DELETE')) {
    if (user.role !== 'admin') return error('Only admins can change customers', 403)
    const id = Number(itemMatch[1])
    return request.method === 'PUT' ? updateCustomer(db, storeId, request, id) : deleteCustomer(db, storeId, id)
  }

  return error('Method not allowed', 405)
}
