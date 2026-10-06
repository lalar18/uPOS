// Customer endpoints used by the sales screens. Any logged-in user can search and add
// customers (cashiers add them at the till). Every query is limited to the user's own store.
//
//   GET  /api/customers?search=&status=&page=&pageSize=   -> { items, total }
//   GET  /api/customers/:id                               -> customer
//   POST /api/customers  { name, phone, email, address }  -> customer

import { cleanText, error, likePattern, readPaging } from './documents'
import type { SessionUser } from './session'

interface CustomerRow {
  id: number
  name: string
  phone: string | null
  email: string | null
  address: string | null
  status: 'active' | 'inactive'
  created_at: string
}

const MAX_NAME_LENGTH = 100
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_PATTERN = /^[0-9+()\-\s]+$/

function publicCustomer(row: CustomerRow) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    status: row.status,
    createdAt: row.created_at,
  }
}

async function listCustomers(db: D1Database, storeId: number, url: URL): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const status = url.searchParams.get('status')
  const { pageSize, offset } = readPaging(url)

  const where: string[] = ['store_id = ?']
  const params: unknown[] = [storeId]
  if (search) {
    const pattern = likePattern(search)
    where.push("(name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')")
    params.push(pattern, pattern, pattern)
  }
  if (status === 'active' || status === 'inactive') {
    where.push('status = ?')
    params.push(status)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [items, count] = await db.batch<CustomerRow | { total: number }>([
    db
      .prepare(
        `SELECT id, name, phone, email, address, status, created_at FROM customers ${whereSql}
         ORDER BY name, id LIMIT ? OFFSET ?`,
      )
      .bind(...params, pageSize, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM customers ${whereSql}`).bind(...params),
  ])

  return Response.json({
    items: (items!.results as CustomerRow[]).map(publicCustomer),
    total: (count!.results[0] as { total: number }).total,
  })
}

async function createCustomer(db: D1Database, storeId: number, request: Request): Promise<Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)

  const name = cleanText(body.name)
  if (!name) return error('Customer name is required', 400)
  if (name.length > MAX_NAME_LENGTH) return error(`Customer name must be ${MAX_NAME_LENGTH} characters or less`, 400)

  const phone = cleanText(body.phone) || null
  if (phone && (phone.length > 30 || !PHONE_PATTERN.test(phone))) {
    return error('Phone can only contain numbers, spaces and + ( ) -', 400)
  }
  const email = cleanText(body.email) || null
  if (email && (email.length > 254 || !EMAIL_PATTERN.test(email))) return error('Enter a valid email address', 400)
  const address = cleanText(body.address) || null
  if (address && address.length > 255) return error('Address must be 255 characters or less', 400)

  const row = await db
    .prepare(
      `INSERT INTO customers (store_id, name, phone, email, address) VALUES (?, ?, ?, ?, ?)
       RETURNING id, name, phone, email, address, status, created_at`,
    )
    .bind(storeId, name, phone, email, address)
    .first<CustomerRow>()
  return row ? Response.json(publicCustomer(row), { status: 201 }) : error('Could not add the customer', 500)
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

  if (isCollection && request.method === 'GET') return listCustomers(db, user.store_id, url)
  if (isCollection && request.method === 'POST') return createCustomer(db, user.store_id, request)
  if (itemMatch && request.method === 'GET') {
    const row = await db
      .prepare('SELECT id, name, phone, email, address, status, created_at FROM customers WHERE id = ? AND store_id = ?')
      .bind(Number(itemMatch[1]), user.store_id)
      .first<CustomerRow>()
    return row ? Response.json(publicCustomer(row)) : error('Customer not found', 404)
  }

  return error('Method not allowed', 405)
}
