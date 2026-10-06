// Variant attribute endpoints ("Size": S, M, L). Any logged-in user can list; only admins can change.
// Every query is limited to the user's own store.
//
//   GET    /api/variant-attributes?search=&status=&page=&pageSize=       -> { items, total }
//   POST   /api/variant-attributes       { name, values: string[], status? } -> attribute
//   PUT    /api/variant-attributes/:id   { name, values: string[], status? } -> attribute
//   DELETE /api/variant-attributes/:id                                     -> { ok }

import type { SessionUser } from './session'

type Status = 'active' | 'inactive'

interface AttributeRow {
  id: number
  name: string
  status: Status
  created_at: string
  updated_at: string
  values_json: string // JSON array of the values, in order
}

interface AttributeInput {
  name: string
  values: string[]
  status: Status
}

const MAX_NAME_LENGTH = 50
const MAX_VALUE_LENGTH = 50
const MAX_VALUES = 100
const MAX_PAGE_SIZE = 100

const ATTRIBUTE_COLUMNS = `a.id, a.name, a.status, a.created_at, a.updated_at,
  (SELECT json_group_array(value) FROM
    (SELECT value FROM variant_attribute_values WHERE attribute_id = a.id ORDER BY position, id)) AS values_json`

function publicAttribute(row: AttributeRow) {
  return {
    id: row.id,
    name: row.name,
    values: JSON.parse(row.values_json) as string[],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const error = (message: string, status: number) => Response.json({ error: message }, { status })

async function getAttribute(db: D1Database, storeId: number, id: number): Promise<AttributeRow | null> {
  return db
    .prepare(`SELECT ${ATTRIBUTE_COLUMNS} FROM variant_attributes a WHERE a.id = ? AND a.store_id = ?`)
    .bind(id, storeId)
    .first<AttributeRow>()
}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '')

/** Validates a create/update body. Returns the clean values or an error Response. */
async function readAttributeInput(request: Request): Promise<AttributeInput | Response> {
  const body = await request.json<{ name?: unknown; values?: unknown; status?: unknown }>().catch(() => null)

  const name = cleanText(body?.name)
  if (!name) return error('Variant name is required', 400)
  if (name.length > MAX_NAME_LENGTH) return error(`Variant name must be ${MAX_NAME_LENGTH} characters or less`, 400)

  if (!Array.isArray(body?.values)) return error('Values must be a list', 400)
  // Drop blanks and repeats ("red" and "Red" count as the same value)
  const seen = new Set<string>()
  const values: string[] = []
  for (const raw of body.values) {
    const value = cleanText(raw)
    if (!value || seen.has(value.toLowerCase())) continue
    if (value.length > MAX_VALUE_LENGTH) return error(`Each value must be ${MAX_VALUE_LENGTH} characters or less`, 400)
    seen.add(value.toLowerCase())
    values.push(value)
  }
  if (values.length === 0) return error('Add at least one value', 400)
  if (values.length > MAX_VALUES) return error(`A variant can have up to ${MAX_VALUES} values`, 400)

  const status = body?.status ?? 'active'
  if (status !== 'active' && status !== 'inactive') return error('Status must be active or inactive', 400)

  return { name, values, status }
}

const duplicateName = () => error('A variant attribute with this name already exists', 409)

/** Turns a UNIQUE constraint failure (e.g. two saves racing) into a friendly 409, or rethrows. */
function uniqueConflict(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e)
  if (message.includes('UNIQUE') && message.includes('variant_attributes.name')) return duplicateName()
  throw e
}

async function nameTaken(db: D1Database, storeId: number, name: string, excludeId = 0): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM variant_attributes WHERE store_id = ? AND name = ? AND id != ?')
    .bind(storeId, name, excludeId)
    .first()
  return row !== null
}

/** Inserts the values for the store's attribute with this name (looked up by name, so it works in the create batch). */
function insertValues(db: D1Database, storeId: number, name: string, values: string[]): D1PreparedStatement[] {
  return values.map((value, position) =>
    db
      .prepare(
        `INSERT INTO variant_attribute_values (attribute_id, value, position)
         SELECT id, ?, ? FROM variant_attributes WHERE store_id = ? AND name = ?`,
      )
      .bind(value, position, storeId, name),
  )
}

async function listAttributes(db: D1Database, storeId: number, url: URL): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const status = url.searchParams.get('status')
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), MAX_PAGE_SIZE)
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)

  const where: string[] = ['a.store_id = ?']
  const params: unknown[] = [storeId]
  if (search) {
    // Matches the name or any value. LIKE wildcards are escaped so "%" and "_" match literally.
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    where.push(`(a.name LIKE ? ESCAPE '\\' OR EXISTS (
      SELECT 1 FROM variant_attribute_values v WHERE v.attribute_id = a.id AND v.value LIKE ? ESCAPE '\\'))`)
    params.push(pattern, pattern)
  }
  if (status === 'active' || status === 'inactive') {
    where.push('a.status = ?')
    params.push(status)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [items, count] = await db.batch<AttributeRow | { total: number }>([
    db
      .prepare(
        `SELECT ${ATTRIBUTE_COLUMNS} FROM variant_attributes a ${whereSql}
         ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, pageSize, (page - 1) * pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM variant_attributes a ${whereSql}`).bind(...params),
  ])

  return Response.json({
    items: (items!.results as AttributeRow[]).map(publicAttribute),
    total: (count!.results[0] as { total: number }).total,
  })
}

async function createAttribute(db: D1Database, storeId: number, request: Request): Promise<Response> {
  const input = await readAttributeInput(request)
  if (input instanceof Response) return input
  if (await nameTaken(db, storeId, input.name)) return duplicateName()

  let id: number
  try {
    // One batch = one transaction, so an attribute is never saved without its values
    const [inserted] = await db.batch<{ id: number }>([
      db
        .prepare('INSERT INTO variant_attributes (store_id, name, status) VALUES (?, ?, ?) RETURNING id')
        .bind(storeId, input.name, input.status),
      ...insertValues(db, storeId, input.name, input.values),
    ])
    id = inserted!.results[0]!.id
  } catch (e) {
    return uniqueConflict(e)
  }
  const row = await getAttribute(db, storeId, id)
  return row ? Response.json(publicAttribute(row), { status: 201 }) : error('Variant attribute not found', 404)
}

async function updateAttribute(db: D1Database, storeId: number, request: Request, id: number): Promise<Response> {
  const input = await readAttributeInput(request)
  if (input instanceof Response) return input
  if (!(await getAttribute(db, storeId, id))) return error('Variant attribute not found', 404)
  if (await nameTaken(db, storeId, input.name, id)) return duplicateName()

  try {
    // Replace the values wholesale; nothing references individual value rows yet
    await db.batch([
      db
        .prepare(
          `UPDATE variant_attributes SET name = ?, status = ?, updated_at = datetime('now') WHERE id = ? AND store_id = ?`,
        )
        .bind(input.name, input.status, id, storeId),
      db
        .prepare(
          `DELETE FROM variant_attribute_values
           WHERE attribute_id = (SELECT id FROM variant_attributes WHERE id = ? AND store_id = ?)`,
        )
        .bind(id, storeId),
      ...insertValues(db, storeId, input.name, input.values),
    ])
  } catch (e) {
    return uniqueConflict(e)
  }
  const row = await getAttribute(db, storeId, id)
  return row ? Response.json(publicAttribute(row)) : error('Variant attribute not found', 404)
}

async function deleteAttribute(db: D1Database, storeId: number, id: number): Promise<Response> {
  // Its values go with it (ON DELETE CASCADE)
  const result = await db.prepare('DELETE FROM variant_attributes WHERE id = ? AND store_id = ?').bind(id, storeId).run()
  return result.meta.changes ? Response.json({ ok: true }) : error('Variant attribute not found', 404)
}

/** Handles /api/variant-attributes routes, or returns null if the path isn't one of them. */
export async function handleVariantAttributes(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const isCollection = url.pathname === '/api/variant-attributes'
  const itemMatch = url.pathname.match(/^\/api\/variant-attributes\/(\d+)$/)
  if (!isCollection && !itemMatch) return null

  const isWrite = request.method !== 'GET'
  if (isWrite && user.role !== 'admin') return error('Only admins can change variant attributes', 403)

  const storeId = user.store_id
  if (isCollection && request.method === 'GET') return listAttributes(db, storeId, url)
  if (isCollection && request.method === 'POST') return createAttribute(db, storeId, request)
  if (itemMatch && request.method === 'PUT') return updateAttribute(db, storeId, request, Number(itemMatch[1]))
  if (itemMatch && request.method === 'DELETE') return deleteAttribute(db, storeId, Number(itemMatch[1]))

  return error('Method not allowed', 405)
}
