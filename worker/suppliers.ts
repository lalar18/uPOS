// Supplier endpoints. Any logged-in user can list; only admins can change.
// Every query is limited to the user's own store.
//
//   GET    /api/suppliers?search=&status=&page=&pageSize=                                  -> { items, total }
//   GET    /api/suppliers/:id                                                              -> supplier
//   POST   /api/suppliers      { name, contactPerson, phone, email, address, note, status? } -> supplier
//   PUT    /api/suppliers/:id  { name, contactPerson, phone, email, address, note, status? } -> supplier
//   DELETE /api/suppliers/:id                                                              -> { ok }

import { readContactFields, readPersonName, type ContactFields, type Status } from './contacts'
import { cleanNote, cleanText, constraintMessage, error, likePattern, MAX_NOTE_LENGTH, readPaging } from './documents'
import type { SessionUser } from './session'

interface SupplierRow {
  id: number
  name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  address: string | null
  note: string | null
  status: Status
  created_at: string
  updated_at: string
}

interface SupplierInput extends ContactFields {
  name: string
  contactPerson: string | null
  note: string | null
}

const MAX_CONTACT_PERSON_LENGTH = 100

const SUPPLIER_COLUMNS = 'id, name, contact_person, phone, email, address, note, status, created_at, updated_at'

function publicSupplier(row: SupplierRow) {
  return {
    id: row.id,
    name: row.name,
    contactPerson: row.contact_person,
    phone: row.phone,
    email: row.email,
    address: row.address,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const duplicateName = () => error('A supplier with this name already exists', 409)

async function getSupplier(db: D1Database, storeId: number, id: number): Promise<SupplierRow | null> {
  return db
    .prepare(`SELECT ${SUPPLIER_COLUMNS} FROM suppliers WHERE id = ? AND store_id = ?`)
    .bind(id, storeId)
    .first<SupplierRow>()
}

async function readSupplierInput(request: Request): Promise<SupplierInput | Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)

  const name = readPersonName(body.name, 'Supplier name')
  if (name instanceof Response) return name
  const contactPerson = cleanText(body.contactPerson) || null
  if (contactPerson && contactPerson.length > MAX_CONTACT_PERSON_LENGTH) {
    return error(`Contact person must be ${MAX_CONTACT_PERSON_LENGTH} characters or less`, 400)
  }
  const contact = readContactFields(body)
  if (contact instanceof Response) return contact
  const note = cleanNote(body.note)
  if (note === undefined) return error(`Note must be ${MAX_NOTE_LENGTH} characters or less`, 400)

  return { name, contactPerson, note, ...contact }
}

/** Returns a 409 Response if another supplier in the store already has this name, else null. */
async function findClash(db: D1Database, storeId: number, name: string, excludeId = 0): Promise<Response | null> {
  const clash = await db
    .prepare('SELECT 1 FROM suppliers WHERE store_id = ? AND name = ? AND id != ?')
    .bind(storeId, name, excludeId)
    .first()
  return clash ? duplicateName() : null
}

/** Turns a UNIQUE failure (two saves racing past findClash) into a friendly 409, or rethrows. */
function uniqueConflict(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e)
  if (message.includes('UNIQUE')) return duplicateName()
  throw e
}

async function listSuppliers(db: D1Database, storeId: number, url: URL): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const status = url.searchParams.get('status')
  const { pageSize, offset } = readPaging(url)

  const where: string[] = ['store_id = ?']
  const params: unknown[] = [storeId]
  if (search) {
    const pattern = likePattern(search)
    where.push(
      "(name LIKE ? ESCAPE '\\' OR contact_person LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')",
    )
    params.push(pattern, pattern, pattern, pattern)
  }
  if (status === 'active' || status === 'inactive') {
    where.push('status = ?')
    params.push(status)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [items, count] = await db.batch<SupplierRow | { total: number }>([
    db
      .prepare(`SELECT ${SUPPLIER_COLUMNS} FROM suppliers ${whereSql} ORDER BY name, id LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM suppliers ${whereSql}`).bind(...params),
  ])

  return Response.json({
    items: (items!.results as SupplierRow[]).map(publicSupplier),
    total: (count!.results[0] as { total: number }).total,
  })
}

async function createSupplier(db: D1Database, storeId: number, request: Request): Promise<Response> {
  const input = await readSupplierInput(request)
  if (input instanceof Response) return input
  const clash = await findClash(db, storeId, input.name)
  if (clash) return clash

  try {
    const row = await db
      .prepare(
        `INSERT INTO suppliers (store_id, name, contact_person, phone, email, address, note, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${SUPPLIER_COLUMNS}`,
      )
      .bind(storeId, input.name, input.contactPerson, input.phone, input.email, input.address, input.note, input.status)
      .first<SupplierRow>()
    return row ? Response.json(publicSupplier(row), { status: 201 }) : error('Could not add the supplier', 500)
  } catch (e) {
    return uniqueConflict(e)
  }
}

async function updateSupplier(db: D1Database, storeId: number, request: Request, id: number): Promise<Response> {
  const input = await readSupplierInput(request)
  if (input instanceof Response) return input
  const clash = await findClash(db, storeId, input.name, id)
  if (clash) return clash

  try {
    const result = await db
      .prepare(
        `UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, note = ?, status = ?,
           updated_at = datetime('now')
         WHERE id = ? AND store_id = ?`,
      )
      .bind(input.name, input.contactPerson, input.phone, input.email, input.address, input.note, input.status, id, storeId)
      .run()
    if (!result.meta.changes) return error('Supplier not found', 404)
  } catch (e) {
    return uniqueConflict(e)
  }
  const row = await getSupplier(db, storeId, id)
  return row ? Response.json(publicSupplier(row)) : error('Supplier not found', 404)
}

async function deleteSupplier(db: D1Database, storeId: number, id: number): Promise<Response> {
  try {
    const result = await db.prepare('DELETE FROM suppliers WHERE id = ? AND store_id = ?').bind(id, storeId).run()
    if (!result.meta.changes) return error('Supplier not found', 404)
  } catch (e) {
    // Records that reference the supplier (e.g. purchases, once added) block the delete
    if (constraintMessage(e)) return error('This supplier is in use. Set them to inactive instead.', 409)
    throw e
  }
  return Response.json({ ok: true })
}

/** Handles /api/suppliers routes, or returns null if the path isn't one of them. */
export async function handleSuppliers(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const isCollection = url.pathname === '/api/suppliers'
  const itemMatch = url.pathname.match(/^\/api\/suppliers\/(\d+)$/)
  if (!isCollection && !itemMatch) return null

  const isWrite = request.method !== 'GET'
  if (isWrite && user.role !== 'admin') return error('Only admins can change suppliers', 403)

  const storeId = user.store_id
  if (isCollection && request.method === 'GET') return listSuppliers(db, storeId, url)
  if (isCollection && request.method === 'POST') return createSupplier(db, storeId, request)
  if (itemMatch && request.method === 'GET') {
    const row = await getSupplier(db, storeId, Number(itemMatch[1]))
    return row ? Response.json(publicSupplier(row)) : error('Supplier not found', 404)
  }
  if (itemMatch && request.method === 'PUT') return updateSupplier(db, storeId, request, Number(itemMatch[1]))
  if (itemMatch && request.method === 'DELETE') return deleteSupplier(db, storeId, Number(itemMatch[1]))

  return error('Method not allowed', 405)
}
