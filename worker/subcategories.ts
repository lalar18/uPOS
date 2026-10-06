// Sub category endpoints. Any logged-in user can list; only admins can change.
// Every query is limited to the user's own store.
//
//   GET    /api/subcategories?search=&status=&categoryId=&page=&pageSize=   -> { items, total }
//   POST   /api/subcategories        { categoryId, name, description?, status? } -> sub category
//   PUT    /api/subcategories/:id    { categoryId, name, description?, status? } -> sub category
//   DELETE /api/subcategories/:id                                            -> { ok }

import type { SessionUser } from './session'

type Status = 'active' | 'inactive'

interface SubcategoryRow {
  id: number
  category_id: number
  category_name: string
  name: string
  description: string | null
  status: Status
  created_at: string
  updated_at: string
}

interface SubcategoryInput {
  categoryId: number
  name: string
  description: string | null
  status: Status
}

const MAX_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 500
const MAX_PAGE_SIZE = 100

const SUBCATEGORY_SELECT = `SELECT s.id, s.category_id, c.name AS category_name, s.name, s.description,
  s.status, s.created_at, s.updated_at
  FROM subcategories s JOIN categories c ON c.id = s.category_id`

function publicSubcategory(row: SubcategoryRow) {
  return {
    id: row.id,
    category: { id: row.category_id, name: row.category_name },
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const error = (message: string, status: number) => Response.json({ error: message }, { status })

/** Validates a create/update body. Returns the clean values or an error Response. */
async function readSubcategoryInput(
  db: D1Database,
  storeId: number,
  request: Request,
): Promise<SubcategoryInput | Response> {
  const body = await request
    .json<{ categoryId?: unknown; name?: unknown; description?: unknown; status?: unknown }>()
    .catch(() => null)

  const categoryId = body?.categoryId
  if (!Number.isSafeInteger(categoryId) || (categoryId as number) <= 0) return error('Category is required', 400)

  const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
  if (!name) return error('Sub category name is required', 400)
  if (name.length > MAX_NAME_LENGTH) return error(`Sub category name must be ${MAX_NAME_LENGTH} characters or less`, 400)

  const description = typeof body?.description === 'string' ? body.description.trim() || null : null
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    return error(`Description must be ${MAX_DESCRIPTION_LENGTH} characters or less`, 400)
  }

  const status = body?.status ?? 'active'
  if (status !== 'active' && status !== 'inactive') return error('Status must be active or inactive', 400)

  const category = await db
    .prepare('SELECT 1 FROM categories WHERE id = ? AND store_id = ?')
    .bind(categoryId, storeId)
    .first()
  if (!category) return error('Category not found', 400)

  return { categoryId: categoryId as number, name, description, status }
}

const duplicateName = () => error('This category already has a sub category with this name', 409)

async function findConflict(db: D1Database, input: SubcategoryInput, excludeId = 0): Promise<Response | null> {
  const clash = await db
    .prepare('SELECT 1 FROM subcategories WHERE category_id = ? AND name = ? AND id != ?')
    .bind(input.categoryId, input.name, excludeId)
    .first()
  return clash ? duplicateName() : null
}

/** Turns a UNIQUE constraint failure (e.g. two saves racing) into a friendly 409, or rethrows. */
function uniqueConflict(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e)
  if (message.includes('UNIQUE') && message.includes('subcategories.')) return duplicateName()
  throw e
}

async function getSubcategory(db: D1Database, storeId: number, id: number): Promise<SubcategoryRow | null> {
  return db.prepare(`${SUBCATEGORY_SELECT} WHERE s.id = ? AND s.store_id = ?`).bind(id, storeId).first<SubcategoryRow>()
}

async function listSubcategories(db: D1Database, storeId: number, url: URL): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const status = url.searchParams.get('status')
  const categoryId = Number(url.searchParams.get('categoryId'))
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), MAX_PAGE_SIZE)
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)

  const where: string[] = ['s.store_id = ?']
  const params: unknown[] = [storeId]
  if (search) {
    // Escape LIKE wildcards so "%" and "_" are matched literally
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    where.push("(s.name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')")
    params.push(pattern, pattern)
  }
  if (status === 'active' || status === 'inactive') {
    where.push('s.status = ?')
    params.push(status)
  }
  if (Number.isSafeInteger(categoryId) && categoryId > 0) {
    where.push('s.category_id = ?')
    params.push(categoryId)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [items, count] = await db.batch<SubcategoryRow | { total: number }>([
    db
      .prepare(`${SUBCATEGORY_SELECT} ${whereSql} ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, (page - 1) * pageSize),
    db
      .prepare(
        `SELECT COUNT(*) AS total FROM subcategories s JOIN categories c ON c.id = s.category_id ${whereSql}`,
      )
      .bind(...params),
  ])

  return Response.json({
    items: (items!.results as SubcategoryRow[]).map(publicSubcategory),
    total: (count!.results[0] as { total: number }).total,
  })
}

async function createSubcategory(db: D1Database, storeId: number, request: Request): Promise<Response> {
  const input = await readSubcategoryInput(db, storeId, request)
  if (input instanceof Response) return input
  const conflict = await findConflict(db, input)
  if (conflict) return conflict

  let id: number
  try {
    const row = await db
      .prepare(
        `INSERT INTO subcategories (store_id, category_id, name, description, status)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(storeId, input.categoryId, input.name, input.description, input.status)
      .first<{ id: number }>()
    id = row!.id
  } catch (e) {
    return uniqueConflict(e)
  }
  const row = await getSubcategory(db, storeId, id)
  return row ? Response.json(publicSubcategory(row), { status: 201 }) : error('Sub category not found', 404)
}

async function updateSubcategory(db: D1Database, storeId: number, request: Request, id: number): Promise<Response> {
  const input = await readSubcategoryInput(db, storeId, request)
  if (input instanceof Response) return input
  const conflict = await findConflict(db, input, id)
  if (conflict) return conflict

  try {
    const [result] = await db.batch([
      db
        .prepare(
          `UPDATE subcategories SET category_id = ?, name = ?, description = ?, status = ?, updated_at = datetime('now')
           WHERE id = ? AND store_id = ?`,
        )
        .bind(input.categoryId, input.name, input.description, input.status, id, storeId),
      // Products follow their sub category into its new category
      db
        .prepare('UPDATE products SET category_id = ? WHERE subcategory_id = ? AND store_id = ?')
        .bind(input.categoryId, id, storeId),
    ])
    if (!result!.meta.changes) return error('Sub category not found', 404)
  } catch (e) {
    return uniqueConflict(e)
  }
  const row = await getSubcategory(db, storeId, id)
  return row ? Response.json(publicSubcategory(row)) : error('Sub category not found', 404)
}

async function deleteSubcategory(db: D1Database, storeId: number, id: number): Promise<Response> {
  // Its products keep their category and lose the sub category (ON DELETE SET NULL)
  const result = await db.prepare('DELETE FROM subcategories WHERE id = ? AND store_id = ?').bind(id, storeId).run()
  return result.meta.changes ? Response.json({ ok: true }) : error('Sub category not found', 404)
}

/** Handles /api/subcategories routes, or returns null if the path isn't one of them. */
export async function handleSubcategories(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const isCollection = url.pathname === '/api/subcategories'
  const itemMatch = url.pathname.match(/^\/api\/subcategories\/(\d+)$/)
  if (!isCollection && !itemMatch) return null

  const isWrite = request.method !== 'GET'
  if (isWrite && user.role !== 'admin') return error('Only admins can change sub categories', 403)

  const storeId = user.store_id
  if (isCollection && request.method === 'GET') return listSubcategories(db, storeId, url)
  if (isCollection && request.method === 'POST') return createSubcategory(db, storeId, request)
  if (itemMatch && request.method === 'PUT') return updateSubcategory(db, storeId, request, Number(itemMatch[1]))
  if (itemMatch && request.method === 'DELETE') return deleteSubcategory(db, storeId, Number(itemMatch[1]))

  return error('Method not allowed', 405)
}
