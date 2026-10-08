// Brand endpoints. Any logged-in user can list and view logos; only roles with catalog.manage can change.
// Every query is limited to the user's own store.
//
//   GET    /api/brands?search=&status=&page=&pageSize=   -> { items, total }
//   POST   /api/brands            { name, status? }      -> brand
//   PUT    /api/brands/:id        { name, status? }      -> brand
//   DELETE /api/brands/:id                               -> { ok }
//   GET    /api/brands/:id/logo                          -> image
//   PUT    /api/brands/:id/logo   (raw image body)       -> brand
//   DELETE /api/brands/:id/logo                          -> brand

import { can } from './permissions'
import { sniffImageType } from './profile'
import type { SessionUser } from './session'

type Status = 'active' | 'inactive'

interface BrandRow {
  id: number
  name: string
  status: Status
  created_at: string
  updated_at: string
  logo_updated_at: string | null
}

const MAX_NAME_LENGTH = 100
const MAX_PAGE_SIZE = 100
// The browser sends a resized logo (~20 KB). This cap is a backstop under D1's 2 MB per value.
const MAX_LOGO_BYTES = 1_000_000

const BRAND_COLUMNS = `b.id, b.name, b.status, b.created_at, b.updated_at, l.updated_at AS logo_updated_at`
const BRAND_FROM = `FROM brands b LEFT JOIN brand_logos l ON l.brand_id = b.id`

function publicBrand(row: BrandRow) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    // The version param changes on every upload, so browsers never show a stale logo
    logoUrl: row.logo_updated_at
      ? `/api/brands/${row.id}/logo?v=${encodeURIComponent(row.logo_updated_at)}`
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const error = (message: string, status: number) => Response.json({ error: message }, { status })

async function getBrand(db: D1Database, storeId: number, id: number): Promise<BrandRow | null> {
  return db
    .prepare(`SELECT ${BRAND_COLUMNS} ${BRAND_FROM} WHERE b.id = ? AND b.store_id = ?`)
    .bind(id, storeId)
    .first<BrandRow>()
}

/** Validates a create/update body. Returns the clean values or an error Response. */
async function readBrandInput(request: Request): Promise<{ name: string; status: Status } | Response> {
  const body = await request.json<{ name?: unknown; status?: unknown }>().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
  if (!name) return error('Brand name is required', 400)
  if (name.length > MAX_NAME_LENGTH) return error(`Brand name must be ${MAX_NAME_LENGTH} characters or less`, 400)

  const status = body?.status ?? 'active'
  if (status !== 'active' && status !== 'inactive') return error('Status must be active or inactive', 400)

  return { name, status }
}

async function nameTaken(db: D1Database, storeId: number, name: string, excludeId = 0): Promise<boolean> {
  const clash = await db
    .prepare('SELECT 1 FROM brands WHERE store_id = ? AND name = ? AND id != ?')
    .bind(storeId, name, excludeId)
    .first()
  return clash !== null
}

const duplicateName = () => error('A brand with this name already exists', 409)

/** Turns a UNIQUE constraint failure (e.g. two saves racing) into a friendly 409, or rethrows. */
function uniqueConflict(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e)
  if (message.includes('UNIQUE') && message.includes('brands.name')) return duplicateName()
  throw e
}

async function listBrands(db: D1Database, storeId: number, url: URL): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const status = url.searchParams.get('status')
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), MAX_PAGE_SIZE)
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)

  const where: string[] = ['b.store_id = ?']
  const params: unknown[] = [storeId]
  if (search) {
    // Escape LIKE wildcards so "%" and "_" are matched literally
    where.push("b.name LIKE ? ESCAPE '\\'")
    params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
  }
  if (status === 'active' || status === 'inactive') {
    where.push('b.status = ?')
    params.push(status)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [items, count] = await db.batch<BrandRow | { total: number }>([
    db
      .prepare(
        `SELECT ${BRAND_COLUMNS} ${BRAND_FROM} ${whereSql} ORDER BY b.created_at DESC, b.id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, pageSize, (page - 1) * pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM brands b ${whereSql}`).bind(...params),
  ])

  return Response.json({
    items: (items!.results as BrandRow[]).map(publicBrand),
    total: (count!.results[0] as { total: number }).total,
  })
}

async function createBrand(db: D1Database, storeId: number, request: Request): Promise<Response> {
  const input = await readBrandInput(request)
  if (input instanceof Response) return input
  if (await nameTaken(db, storeId, input.name)) return duplicateName()

  try {
    const row = await db
      .prepare(
        `INSERT INTO brands (store_id, name, status) VALUES (?, ?, ?)
         RETURNING id, name, status, created_at, updated_at, NULL AS logo_updated_at`,
      )
      .bind(storeId, input.name, input.status)
      .first<BrandRow>()
    return Response.json(publicBrand(row!), { status: 201 })
  } catch (e) {
    return uniqueConflict(e)
  }
}

async function updateBrand(db: D1Database, storeId: number, request: Request, id: number): Promise<Response> {
  const input = await readBrandInput(request)
  if (input instanceof Response) return input
  if (await nameTaken(db, storeId, input.name, id)) return duplicateName()

  try {
    const result = await db
      .prepare(
        `UPDATE brands SET name = ?, status = ?, updated_at = datetime('now') WHERE id = ? AND store_id = ?`,
      )
      .bind(input.name, input.status, id, storeId)
      .run()
    if (!result.meta.changes) return error('Brand not found', 404)
  } catch (e) {
    return uniqueConflict(e)
  }
  const row = await getBrand(db, storeId, id)
  return row ? Response.json(publicBrand(row)) : error('Brand not found', 404)
}

async function deleteBrand(db: D1Database, storeId: number, id: number): Promise<Response> {
  // brand_logos rows go with it (ON DELETE CASCADE)
  const result = await db.prepare('DELETE FROM brands WHERE id = ? AND store_id = ?').bind(id, storeId).run()
  return result.meta.changes ? Response.json({ ok: true }) : error('Brand not found', 404)
}

async function uploadLogo(db: D1Database, storeId: number, request: Request, id: number): Promise<Response> {
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_LOGO_BYTES) return error('Image is too large', 413)

  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength === 0) return error('No image received', 400)
  if (bytes.byteLength > MAX_LOGO_BYTES) return error('Image is too large', 413)

  const contentType = sniffImageType(bytes)
  if (!contentType) return error('Only JPG, PNG or WebP images are allowed', 415)

  if (!(await getBrand(db, storeId, id))) return error('Brand not found', 404)
  await db
    .prepare(
      `INSERT INTO brand_logos (brand_id, content_type, data) VALUES (?, ?, ?)
       ON CONFLICT (brand_id) DO UPDATE SET
         content_type = excluded.content_type, data = excluded.data, updated_at = datetime('now')`,
    )
    .bind(id, contentType, bytes)
    .run()

  const row = await getBrand(db, storeId, id)
  return row ? Response.json(publicBrand(row)) : error('Brand not found', 404)
}

async function deleteLogo(db: D1Database, storeId: number, id: number): Promise<Response> {
  await db
    .prepare('DELETE FROM brand_logos WHERE brand_id = (SELECT id FROM brands WHERE id = ? AND store_id = ?)')
    .bind(id, storeId)
    .run()
  const row = await getBrand(db, storeId, id)
  return row ? Response.json(publicBrand(row)) : error('Brand not found', 404)
}

async function serveLogo(db: D1Database, storeId: number, id: number): Promise<Response> {
  const row = await db
    .prepare(
      `SELECT l.content_type, l.data FROM brand_logos l JOIN brands b ON b.id = l.brand_id
       WHERE l.brand_id = ? AND b.store_id = ?`,
    )
    .bind(id, storeId)
    .first<{ content_type: string; data: ArrayBuffer | number[] }>()
  if (!row) return error('Not found', 404)

  return new Response(new Uint8Array(row.data), {
    headers: {
      'Content-Type': row.content_type,
      'X-Content-Type-Options': 'nosniff',
      // URLs carry ?v=<updated_at>, so a new upload gets a new URL
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}

/** Handles /api/brands routes, or returns null if the path isn't one of them. */
export async function handleBrands(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const isCollection = url.pathname === '/api/brands'
  const itemMatch = url.pathname.match(/^\/api\/brands\/(\d+)$/)
  const logoMatch = url.pathname.match(/^\/api\/brands\/(\d+)\/logo$/)
  if (!isCollection && !itemMatch && !logoMatch) return null

  const isWrite = request.method !== 'GET'
  if (isWrite && !can(user, 'catalog.manage')) return error("You don't have permission to change brands", 403)

  const storeId = user.store_id
  if (isCollection && request.method === 'GET') return listBrands(db, storeId, url)
  if (isCollection && request.method === 'POST') return createBrand(db, storeId, request)
  if (itemMatch && request.method === 'PUT') return updateBrand(db, storeId, request, Number(itemMatch[1]))
  if (itemMatch && request.method === 'DELETE') return deleteBrand(db, storeId, Number(itemMatch[1]))
  if (logoMatch && request.method === 'GET') return serveLogo(db, storeId, Number(logoMatch[1]))
  if (logoMatch && request.method === 'PUT') return uploadLogo(db, storeId, request, Number(logoMatch[1]))
  if (logoMatch && request.method === 'DELETE') return deleteLogo(db, storeId, Number(logoMatch[1]))

  return error('Method not allowed', 405)
}
