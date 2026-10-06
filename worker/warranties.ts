// Warranty endpoints. Any logged-in user can list; only admins can change.
// Every query is limited to the user's own store.
//
//   GET    /api/warranties?search=&status=&page=&pageSize=                              -> { items, total }
//   POST   /api/warranties       { name, description?, duration, durationUnit, status? } -> warranty
//   PUT    /api/warranties/:id   { name, description?, duration, durationUnit, status? } -> warranty
//   DELETE /api/warranties/:id                                                          -> { ok }

import type { SessionUser } from './session'

type Status = 'active' | 'inactive'
type DurationUnit = 'day' | 'month' | 'year'

interface WarrantyRow {
  id: number
  name: string
  description: string | null
  duration: number
  duration_unit: DurationUnit
  status: Status
  created_at: string
  updated_at: string
  product_count: number
}

interface WarrantyInput {
  name: string
  description: string | null
  duration: number
  durationUnit: DurationUnit
  status: Status
}

const MAX_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 500
const MAX_DURATION = 1000
const MAX_PAGE_SIZE = 100
const DURATION_UNITS: DurationUnit[] = ['day', 'month', 'year']

const WARRANTY_COLUMNS = `w.id, w.name, w.description, w.duration, w.duration_unit, w.status, w.created_at, w.updated_at,
  (SELECT COUNT(*) FROM products p WHERE p.warranty_id = w.id) AS product_count`

function publicWarranty(row: WarrantyRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    duration: row.duration,
    durationUnit: row.duration_unit,
    status: row.status,
    productCount: row.product_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const error = (message: string, status: number) => Response.json({ error: message }, { status })

async function getWarranty(db: D1Database, storeId: number, id: number): Promise<WarrantyRow | null> {
  return db
    .prepare(`SELECT ${WARRANTY_COLUMNS} FROM warranties w WHERE w.id = ? AND w.store_id = ?`)
    .bind(id, storeId)
    .first<WarrantyRow>()
}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '')

/** Validates a create/update body. Returns the clean values or an error Response. */
async function readWarrantyInput(request: Request): Promise<WarrantyInput | Response> {
  const body = await request
    .json<{ name?: unknown; description?: unknown; duration?: unknown; durationUnit?: unknown; status?: unknown }>()
    .catch(() => null)

  const name = cleanText(body?.name)
  if (!name) return error('Warranty name is required', 400)
  if (name.length > MAX_NAME_LENGTH) return error(`Warranty name must be ${MAX_NAME_LENGTH} characters or less`, 400)

  const description = typeof body?.description === 'string' ? body.description.trim() || null : null
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    return error(`Description must be ${MAX_DESCRIPTION_LENGTH} characters or less`, 400)
  }

  const duration = body?.duration
  if (!Number.isSafeInteger(duration) || (duration as number) < 1 || (duration as number) > MAX_DURATION) {
    return error(`Duration must be a whole number from 1 to ${MAX_DURATION}`, 400)
  }

  const durationUnit = body?.durationUnit
  if (!DURATION_UNITS.includes(durationUnit as DurationUnit)) return error('Duration must be in days, months or years', 400)

  const status = body?.status ?? 'active'
  if (status !== 'active' && status !== 'inactive') return error('Status must be active or inactive', 400)

  return { name, description, duration: duration as number, durationUnit: durationUnit as DurationUnit, status }
}

const duplicateName = () => error('A warranty with this name already exists', 409)

/** Turns a UNIQUE constraint failure (e.g. two saves racing) into a friendly 409, or rethrows. */
function uniqueConflict(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e)
  if (message.includes('UNIQUE') && message.includes('warranties.name')) return duplicateName()
  throw e
}

async function nameTaken(db: D1Database, storeId: number, name: string, excludeId = 0): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM warranties WHERE store_id = ? AND name = ? AND id != ?')
    .bind(storeId, name, excludeId)
    .first()
  return row !== null
}

async function listWarranties(db: D1Database, storeId: number, url: URL): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const status = url.searchParams.get('status')
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), MAX_PAGE_SIZE)
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)

  const where: string[] = ['w.store_id = ?']
  const params: unknown[] = [storeId]
  if (search) {
    // Escape LIKE wildcards so "%" and "_" are matched literally
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    where.push("(w.name LIKE ? ESCAPE '\\' OR w.description LIKE ? ESCAPE '\\')")
    params.push(pattern, pattern)
  }
  if (status === 'active' || status === 'inactive') {
    where.push('w.status = ?')
    params.push(status)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [items, count] = await db.batch<WarrantyRow | { total: number }>([
    db
      .prepare(
        `SELECT ${WARRANTY_COLUMNS} FROM warranties w ${whereSql} ORDER BY w.created_at DESC, w.id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, pageSize, (page - 1) * pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM warranties w ${whereSql}`).bind(...params),
  ])

  return Response.json({
    items: (items!.results as WarrantyRow[]).map(publicWarranty),
    total: (count!.results[0] as { total: number }).total,
  })
}

async function createWarranty(db: D1Database, storeId: number, request: Request): Promise<Response> {
  const input = await readWarrantyInput(request)
  if (input instanceof Response) return input
  if (await nameTaken(db, storeId, input.name)) return duplicateName()

  try {
    const row = await db
      .prepare(
        `INSERT INTO warranties (store_id, name, description, duration, duration_unit, status) VALUES (?, ?, ?, ?, ?, ?)
         RETURNING id, name, description, duration, duration_unit, status, created_at, updated_at, 0 AS product_count`,
      )
      .bind(storeId, input.name, input.description, input.duration, input.durationUnit, input.status)
      .first<WarrantyRow>()
    return Response.json(publicWarranty(row!), { status: 201 })
  } catch (e) {
    return uniqueConflict(e)
  }
}

async function updateWarranty(db: D1Database, storeId: number, request: Request, id: number): Promise<Response> {
  const input = await readWarrantyInput(request)
  if (input instanceof Response) return input
  if (await nameTaken(db, storeId, input.name, id)) return duplicateName()

  try {
    const result = await db
      .prepare(
        `UPDATE warranties SET name = ?, description = ?, duration = ?, duration_unit = ?, status = ?,
           updated_at = datetime('now')
         WHERE id = ? AND store_id = ?`,
      )
      .bind(input.name, input.description, input.duration, input.durationUnit, input.status, id, storeId)
      .run()
    if (!result.meta.changes) return error('Warranty not found', 404)
  } catch (e) {
    return uniqueConflict(e)
  }
  const row = await getWarranty(db, storeId, id)
  return row ? Response.json(publicWarranty(row)) : error('Warranty not found', 404)
}

async function deleteWarranty(db: D1Database, storeId: number, id: number): Promise<Response> {
  // Products with this warranty are left without one (ON DELETE SET NULL)
  const result = await db.prepare('DELETE FROM warranties WHERE id = ? AND store_id = ?').bind(id, storeId).run()
  return result.meta.changes ? Response.json({ ok: true }) : error('Warranty not found', 404)
}

/** Handles /api/warranties routes, or returns null if the path isn't one of them. */
export async function handleWarranties(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const isCollection = url.pathname === '/api/warranties'
  const itemMatch = url.pathname.match(/^\/api\/warranties\/(\d+)$/)
  if (!isCollection && !itemMatch) return null

  const isWrite = request.method !== 'GET'
  if (isWrite && user.role !== 'admin') return error('Only admins can change warranties', 403)

  const storeId = user.store_id
  if (isCollection && request.method === 'GET') return listWarranties(db, storeId, url)
  if (isCollection && request.method === 'POST') return createWarranty(db, storeId, request)
  if (itemMatch && request.method === 'PUT') return updateWarranty(db, storeId, request, Number(itemMatch[1]))
  if (itemMatch && request.method === 'DELETE') return deleteWarranty(db, storeId, Number(itemMatch[1]))

  return error('Method not allowed', 405)
}
