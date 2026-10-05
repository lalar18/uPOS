// Category endpoints. Any logged-in user can list; only admins can change.
// Every query is limited to the user's own store.
//
//   GET    /api/categories?search=&status=&page=&pageSize=   -> { items, total }
//   POST   /api/categories        { name, slug?, status? }   -> category
//   PUT    /api/categories/:id    { name, slug?, status? }   -> category
//   DELETE /api/categories/:id                               -> { ok }

import type { SessionUser } from './session'

type Status = 'active' | 'inactive'

interface CategoryRow {
  id: number
  name: string
  slug: string
  status: Status
  created_at: string
  updated_at: string
}

const MAX_NAME_LENGTH = 100
const MAX_PAGE_SIZE = 100
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function publicCategory(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** "Fresh Fruits & Veg" -> "fresh-fruits-veg" */
function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const error = (message: string, status: number) => Response.json({ error: message }, { status })

/** Validates a create/update body. Returns the clean values or an error Response. */
async function readCategoryInput(request: Request): Promise<{ name: string; slug: string; status: Status } | Response> {
  const body = await request.json<{ name?: unknown; slug?: unknown; status?: unknown }>().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
  if (!name) return error('Category name is required', 400)
  if (name.length > MAX_NAME_LENGTH) return error(`Category name must be ${MAX_NAME_LENGTH} characters or less`, 400)

  const slug = typeof body?.slug === 'string' && body.slug.trim() ? body.slug.trim() : slugify(name)
  if (!SLUG_PATTERN.test(slug)) {
    return error('Slug can only contain lowercase letters, numbers and single dashes', 400)
  }

  const status = body?.status ?? 'active'
  if (status !== 'active' && status !== 'inactive') return error('Status must be active or inactive', 400)

  return { name, slug, status }
}

/** Reports a name clash before a slug clash (the slug is usually derived from the name). */
async function findConflict(
  db: D1Database,
  storeId: number,
  name: string,
  slug: string,
  excludeId = 0,
): Promise<Response | null> {
  const clash = await db
    .prepare(
      `SELECT name = ? COLLATE NOCASE AS same_name FROM categories
       WHERE store_id = ? AND (name = ? OR slug = ?) AND id != ? ORDER BY same_name DESC`,
    )
    .bind(name, storeId, name, slug, excludeId)
    .first<{ same_name: number }>()
  if (!clash) return null
  return clash.same_name
    ? error('A category with this name already exists', 409)
    : error('A category with this slug already exists', 409)
}

/** Turns a UNIQUE constraint failure (e.g. two saves racing) into a friendly 409, or rethrows. */
function uniqueConflict(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e)
  if (message.includes('UNIQUE') && message.includes('categories.name')) {
    return error('A category with this name already exists', 409)
  }
  if (message.includes('UNIQUE') && message.includes('categories.slug')) {
    return error('A category with this slug already exists', 409)
  }
  throw e
}

async function listCategories(db: D1Database, storeId: number, url: URL): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const status = url.searchParams.get('status')
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), MAX_PAGE_SIZE)
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)

  const where: string[] = ['store_id = ?']
  const params: unknown[] = [storeId]
  if (search) {
    // Escape LIKE wildcards so "%" and "_" are matched literally
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    where.push("(name LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\')")
    params.push(pattern, pattern)
  }
  if (status === 'active' || status === 'inactive') {
    where.push('status = ?')
    params.push(status)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [items, count] = await db.batch<CategoryRow | { total: number }>([
    db
      .prepare(`SELECT * FROM categories ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, (page - 1) * pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM categories ${whereSql}`).bind(...params),
  ])

  return Response.json({
    items: (items!.results as CategoryRow[]).map(publicCategory),
    total: (count!.results[0] as { total: number }).total,
  })
}

async function createCategory(db: D1Database, storeId: number, request: Request): Promise<Response> {
  const input = await readCategoryInput(request)
  if (input instanceof Response) return input
  const conflict = await findConflict(db, storeId, input.name, input.slug)
  if (conflict) return conflict

  try {
    const row = await db
      .prepare('INSERT INTO categories (store_id, name, slug, status) VALUES (?, ?, ?, ?) RETURNING *')
      .bind(storeId, input.name, input.slug, input.status)
      .first<CategoryRow>()
    return Response.json(publicCategory(row!), { status: 201 })
  } catch (e) {
    return uniqueConflict(e)
  }
}

async function updateCategory(db: D1Database, storeId: number, request: Request, id: number): Promise<Response> {
  const input = await readCategoryInput(request)
  if (input instanceof Response) return input
  const conflict = await findConflict(db, storeId, input.name, input.slug, id)
  if (conflict) return conflict

  try {
    const row = await db
      .prepare(
        `UPDATE categories SET name = ?, slug = ?, status = ?, updated_at = datetime('now')
         WHERE id = ? AND store_id = ? RETURNING *`,
      )
      .bind(input.name, input.slug, input.status, id, storeId)
      .first<CategoryRow>()
    return row ? Response.json(publicCategory(row)) : error('Category not found', 404)
  } catch (e) {
    return uniqueConflict(e)
  }
}

async function deleteCategory(db: D1Database, storeId: number, id: number): Promise<Response> {
  const result = await db.prepare('DELETE FROM categories WHERE id = ? AND store_id = ?').bind(id, storeId).run()
  return result.meta.changes ? Response.json({ ok: true }) : error('Category not found', 404)
}

/** Handles /api/categories routes, or returns null if the path isn't one of them. */
export async function handleCategories(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const isCollection = url.pathname === '/api/categories'
  const itemMatch = url.pathname.match(/^\/api\/categories\/(\d+)$/)
  if (!isCollection && !itemMatch) return null

  const isWrite = request.method !== 'GET'
  if (isWrite && user.role !== 'admin') return error('Only admins can change categories', 403)

  const storeId = user.store_id
  if (isCollection && request.method === 'GET') return listCategories(db, storeId, url)
  if (isCollection && request.method === 'POST') return createCategory(db, storeId, request)
  if (itemMatch && request.method === 'PUT') return updateCategory(db, storeId, request, Number(itemMatch[1]))
  if (itemMatch && request.method === 'DELETE') return deleteCategory(db, storeId, Number(itemMatch[1]))

  return error('Method not allowed', 405)
}
