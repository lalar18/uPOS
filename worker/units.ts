// Unit endpoints. Any logged-in user can list; only admins can change.
// Every query is limited to the user's own store.
//
//   GET    /api/units?search=&status=&page=&pageSize=                -> { items, total }
//   POST   /api/units       { name, shortName, allowDecimal?, status? } -> unit
//   PUT    /api/units/:id   { name, shortName, allowDecimal?, status? } -> unit
//   DELETE /api/units/:id                                              -> { ok }

import type { SessionUser } from './session'

type Status = 'active' | 'inactive'

interface UnitRow {
  id: number
  name: string
  short_name: string
  allow_decimal: number
  status: Status
  created_at: string
  updated_at: string
  product_count: number
}

interface UnitInput {
  name: string
  shortName: string
  allowDecimal: boolean
  status: Status
}

const MAX_NAME_LENGTH = 50
const MAX_SHORT_NAME_LENGTH = 10
const MAX_PAGE_SIZE = 100

const UNIT_COLUMNS = `u.id, u.name, u.short_name, u.allow_decimal, u.status, u.created_at, u.updated_at,
  (SELECT COUNT(*) FROM products p WHERE p.unit_id = u.id) AS product_count`

function publicUnit(row: UnitRow) {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    allowDecimal: row.allow_decimal === 1,
    status: row.status,
    productCount: row.product_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const error = (message: string, status: number) => Response.json({ error: message }, { status })

async function getUnit(db: D1Database, storeId: number, id: number): Promise<UnitRow | null> {
  return db
    .prepare(`SELECT ${UNIT_COLUMNS} FROM units u WHERE u.id = ? AND u.store_id = ?`)
    .bind(id, storeId)
    .first<UnitRow>()
}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '')

/** Validates a create/update body. Returns the clean values or an error Response. */
async function readUnitInput(request: Request): Promise<UnitInput | Response> {
  const body = await request
    .json<{ name?: unknown; shortName?: unknown; allowDecimal?: unknown; status?: unknown }>()
    .catch(() => null)

  const name = cleanText(body?.name)
  if (!name) return error('Unit name is required', 400)
  if (name.length > MAX_NAME_LENGTH) return error(`Unit name must be ${MAX_NAME_LENGTH} characters or less`, 400)

  const shortName = cleanText(body?.shortName)
  if (!shortName) return error('Short name is required', 400)
  if (shortName.length > MAX_SHORT_NAME_LENGTH) {
    return error(`Short name must be ${MAX_SHORT_NAME_LENGTH} characters or less`, 400)
  }

  const allowDecimal = body?.allowDecimal ?? false
  if (typeof allowDecimal !== 'boolean') return error('allowDecimal must be true or false', 400)

  const status = body?.status ?? 'active'
  if (status !== 'active' && status !== 'inactive') return error('Status must be active or inactive', 400)

  return { name, shortName, allowDecimal, status }
}

/** Returns a 409 Response if another unit already uses this name or short name, else null. */
async function findClash(db: D1Database, storeId: number, input: UnitInput, excludeId = 0): Promise<Response | null> {
  const clash = await db
    .prepare('SELECT name = ? AS same_name FROM units WHERE store_id = ? AND (name = ? OR short_name = ?) AND id != ?')
    .bind(input.name, storeId, input.name, input.shortName, excludeId)
    .first<{ same_name: number }>()
  if (!clash) return null
  return clash.same_name ? duplicateName() : duplicateShortName()
}

const duplicateName = () => error('A unit with this name already exists', 409)
const duplicateShortName = () => error('A unit with this short name already exists', 409)

/** Turns a UNIQUE constraint failure (e.g. two saves racing) into a friendly 409, or rethrows. */
function uniqueConflict(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e)
  if (message.includes('UNIQUE') && message.includes('units.short_name')) return duplicateShortName()
  if (message.includes('UNIQUE') && message.includes('units.name')) return duplicateName()
  throw e
}

async function listUnits(db: D1Database, storeId: number, url: URL): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const status = url.searchParams.get('status')
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), MAX_PAGE_SIZE)
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)

  const where: string[] = ['u.store_id = ?']
  const params: unknown[] = [storeId]
  if (search) {
    // Escape LIKE wildcards so "%" and "_" are matched literally
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    where.push("(u.name LIKE ? ESCAPE '\\' OR u.short_name LIKE ? ESCAPE '\\')")
    params.push(pattern, pattern)
  }
  if (status === 'active' || status === 'inactive') {
    where.push('u.status = ?')
    params.push(status)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [items, count] = await db.batch<UnitRow | { total: number }>([
    db
      .prepare(`SELECT ${UNIT_COLUMNS} FROM units u ${whereSql} ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, (page - 1) * pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM units u ${whereSql}`).bind(...params),
  ])

  return Response.json({
    items: (items!.results as UnitRow[]).map(publicUnit),
    total: (count!.results[0] as { total: number }).total,
  })
}

async function createUnit(db: D1Database, storeId: number, request: Request): Promise<Response> {
  const input = await readUnitInput(request)
  if (input instanceof Response) return input
  const clash = await findClash(db, storeId, input)
  if (clash) return clash

  try {
    const row = await db
      .prepare(
        `INSERT INTO units (store_id, name, short_name, allow_decimal, status) VALUES (?, ?, ?, ?, ?)
         RETURNING id, name, short_name, allow_decimal, status, created_at, updated_at, 0 AS product_count`,
      )
      .bind(storeId, input.name, input.shortName, input.allowDecimal ? 1 : 0, input.status)
      .first<UnitRow>()
    return Response.json(publicUnit(row!), { status: 201 })
  } catch (e) {
    return uniqueConflict(e)
  }
}

async function updateUnit(db: D1Database, storeId: number, request: Request, id: number): Promise<Response> {
  const input = await readUnitInput(request)
  if (input instanceof Response) return input
  const clash = await findClash(db, storeId, input, id)
  if (clash) return clash

  if (!input.allowDecimal) {
    // Products already counted in fractions (1.5 kg) would no longer make sense
    const fractional = await db
      .prepare(
        'SELECT 1 FROM products WHERE unit_id = ? AND store_id = ? AND (quantity != CAST(quantity AS INTEGER) OR alert_quantity != CAST(alert_quantity AS INTEGER)) LIMIT 1',
      )
      .bind(id, storeId)
      .first()
    if (fractional) return error('Some products using this unit have decimal quantities, so decimals must stay allowed', 409)
  }

  try {
    const result = await db
      .prepare(
        `UPDATE units SET name = ?, short_name = ?, allow_decimal = ?, status = ?, updated_at = datetime('now')
         WHERE id = ? AND store_id = ?`,
      )
      .bind(input.name, input.shortName, input.allowDecimal ? 1 : 0, input.status, id, storeId)
      .run()
    if (!result.meta.changes) return error('Unit not found', 404)
  } catch (e) {
    return uniqueConflict(e)
  }
  const row = await getUnit(db, storeId, id)
  return row ? Response.json(publicUnit(row)) : error('Unit not found', 404)
}

async function deleteUnit(db: D1Database, storeId: number, id: number): Promise<Response> {
  const unit = await getUnit(db, storeId, id)
  if (!unit) return error('Unit not found', 404)
  if (unit.product_count > 0) {
    const products = unit.product_count === 1 ? '1 product uses' : `${unit.product_count} products use`
    return error(`${products} this unit. Change their unit or set this unit to inactive instead.`, 409)
  }

  try {
    await db.prepare('DELETE FROM units WHERE id = ? AND store_id = ?').bind(id, storeId).run()
  } catch (e) {
    // A product was given this unit after the check above
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('FOREIGN KEY')) return error('Products use this unit, so it cannot be deleted', 409)
    throw e
  }
  return Response.json({ ok: true })
}

/** Handles /api/units routes, or returns null if the path isn't one of them. */
export async function handleUnits(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const isCollection = url.pathname === '/api/units'
  const itemMatch = url.pathname.match(/^\/api\/units\/(\d+)$/)
  if (!isCollection && !itemMatch) return null

  const isWrite = request.method !== 'GET'
  if (isWrite && user.role !== 'admin') return error('Only admins can change units', 403)

  const storeId = user.store_id
  if (isCollection && request.method === 'GET') return listUnits(db, storeId, url)
  if (isCollection && request.method === 'POST') return createUnit(db, storeId, request)
  if (itemMatch && request.method === 'PUT') return updateUnit(db, storeId, request, Number(itemMatch[1]))
  if (itemMatch && request.method === 'DELETE') return deleteUnit(db, storeId, Number(itemMatch[1]))

  return error('Method not allowed', 405)
}
