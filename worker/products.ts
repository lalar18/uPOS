// Product endpoints. Any logged-in user can list and view; only admins can change.
// Cashiers never see cost prices. Every query is limited to the user's own store.
// Prices are whole centavos (₱12.50 -> 1250).
//
//   GET    /api/products?search=&status=&categoryId=&subcategoryId=&brandId=&page=&pageSize=  -> { items, total }
//            &stock=low|out                     low: 0 < quantity <= alert quantity; out: quantity <= 0
//            &expiresFrom=&expiresBefore=       YYYY-MM-DD; from is inclusive, before is exclusive
//   GET    /api/products/options                -> { categories, subcategories, brands, units, warranties } for the product form
//   GET    /api/products/:id                    -> product
//   POST   /api/products          (ProductInput) -> product
//   PUT    /api/products/:id      (ProductInput) -> product
//   DELETE /api/products/:id                    -> { ok }
//   GET    /api/products/:id/image              -> image
//   PUT    /api/products/:id/image (raw image)  -> product
//   DELETE /api/products/:id/image              -> product

import { sniffImageType } from './profile'
import type { SessionUser } from './session'

type Status = 'active' | 'inactive'

interface ProductRow {
  id: number
  name: string
  sku: string
  barcode: string | null
  category_id: number | null
  category_name: string | null
  subcategory_id: number | null
  subcategory_name: string | null
  brand_id: number | null
  brand_name: string | null
  unit_id: number
  unit_name: string
  unit_short_name: string
  unit_allow_decimal: number
  price_cents: number
  cost_cents: number | null
  quantity: number
  alert_quantity: number
  description: string | null
  manufactured_date: string | null
  expiry_date: string | null
  warranty_id: number | null
  warranty_name: string | null
  status: Status
  created_at: string
  updated_at: string
  image_updated_at: string | null
}

interface ProductInput {
  name: string
  sku: string
  barcode: string | null
  categoryId: number | null
  subcategoryId: number | null
  brandId: number | null
  unitId: number
  priceCents: number
  costCents: number | null
  quantity: number
  alertQuantity: number
  description: string | null
  manufacturedDate: string | null
  expiryDate: string | null
  warrantyId: number | null
  status: Status
}

const MAX_NAME_LENGTH = 150
const MAX_CODE_LENGTH = 50 // SKU and barcode
const MAX_DESCRIPTION_LENGTH = 2000
const MAX_CENTS = 100_000_000_00 // ₱100 million
const MAX_QUANTITY = 1_000_000_000
const MAX_PAGE_SIZE = 100
// The browser sends a resized image (~50 KB). This cap is a backstop under D1's 2 MB per value.
const MAX_IMAGE_BYTES = 1_000_000
// Letters, digits and - _ . / with no spaces, e.g. "COKE-1.5L" or "4800016644603"
const CODE_PATTERN = /^[A-Za-z0-9._/-]+$/

const PRODUCT_COLUMNS = `p.id, p.name, p.sku, p.barcode, p.category_id, c.name AS category_name,
  p.subcategory_id, sc.name AS subcategory_name, p.brand_id, b.name AS brand_name,
  p.unit_id, u.name AS unit_name, u.short_name AS unit_short_name,
  u.allow_decimal AS unit_allow_decimal, p.price_cents, p.cost_cents, p.quantity, p.alert_quantity,
  p.description, p.manufactured_date, p.expiry_date, p.warranty_id, w.name AS warranty_name,
  p.status, p.created_at, p.updated_at, i.updated_at AS image_updated_at`
const PRODUCT_FROM = `FROM products p
  JOIN units u ON u.id = p.unit_id
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN subcategories sc ON sc.id = p.subcategory_id
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN warranties w ON w.id = p.warranty_id
  LEFT JOIN product_images i ON i.product_id = p.id`

function publicProduct(row: ProductRow, showCost: boolean) {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    category: row.category_id === null ? null : { id: row.category_id, name: row.category_name! },
    subcategory: row.subcategory_id === null ? null : { id: row.subcategory_id, name: row.subcategory_name! },
    brand: row.brand_id === null ? null : { id: row.brand_id, name: row.brand_name! },
    unit: {
      id: row.unit_id,
      name: row.unit_name,
      shortName: row.unit_short_name,
      allowDecimal: row.unit_allow_decimal === 1,
    },
    priceCents: row.price_cents,
    costCents: showCost ? row.cost_cents : null,
    quantity: row.quantity,
    alertQuantity: row.alert_quantity,
    description: row.description,
    manufacturedDate: row.manufactured_date,
    expiryDate: row.expiry_date,
    warranty: row.warranty_id === null ? null : { id: row.warranty_id, name: row.warranty_name! },
    status: row.status,
    // The version param changes on every upload, so browsers never show a stale image
    imageUrl: row.image_updated_at
      ? `/api/products/${row.id}/image?v=${encodeURIComponent(row.image_updated_at)}`
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const error = (message: string, status: number) => Response.json({ error: message }, { status })

async function getProduct(db: D1Database, storeId: number, id: number): Promise<ProductRow | null> {
  return db
    .prepare(`SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM} WHERE p.id = ? AND p.store_id = ?`)
    .bind(id, storeId)
    .first<ProductRow>()
}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '')

/** null/undefined -> null, a positive whole number -> itself, anything else -> undefined (invalid). */
function optionalId(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined
}

const isCents = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_CENTS

const isQuantity = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_QUANTITY

/** Stock is kept to 3 decimals (grams of a kilo), which also hides float noise like 0.30000000000000004 */
const roundQuantity = (value: number) => Math.round(value * 1000) / 1000

/** True for a real calendar date written as YYYY-MM-DD (so 2026-02-30 is rejected) */
function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

/** null/undefined/'' -> null, a valid date -> itself, anything else -> undefined (invalid). */
function optionalDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null
  return isDate(value) ? value : undefined
}

/** Validates a create/update body against the store's categories, brands and units. */
async function readProductInput(db: D1Database, storeId: number, request: Request): Promise<ProductInput | Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)

  const name = cleanText(body.name)
  if (!name) return error('Product name is required', 400)
  if (name.length > MAX_NAME_LENGTH) return error(`Product name must be ${MAX_NAME_LENGTH} characters or less`, 400)

  const sku = cleanText(body.sku)
  if (!sku) return error('SKU is required', 400)
  if (sku.length > MAX_CODE_LENGTH || !CODE_PATTERN.test(sku)) {
    return error(`SKU can only use letters, numbers and - _ . / (up to ${MAX_CODE_LENGTH}, no spaces)`, 400)
  }

  const barcode = cleanText(body.barcode) || null
  if (barcode && (barcode.length > MAX_CODE_LENGTH || !CODE_PATTERN.test(barcode))) {
    return error(`Barcode can only use letters, numbers and - _ . / (up to ${MAX_CODE_LENGTH}, no spaces)`, 400)
  }

  const categoryId = optionalId(body.categoryId)
  if (categoryId === undefined) return error('Invalid category', 400)
  const subcategoryId = optionalId(body.subcategoryId)
  if (subcategoryId === undefined) return error('Invalid sub category', 400)
  if (subcategoryId !== null && categoryId === null) return error('Choose a category for the sub category', 400)
  const brandId = optionalId(body.brandId)
  if (brandId === undefined) return error('Invalid brand', 400)
  const unitId = optionalId(body.unitId)
  if (!unitId) return error('Unit is required', 400)

  if (!isCents(body.priceCents)) return error('Selling price must be a valid amount', 400)
  const costCents = body.costCents ?? null
  if (costCents !== null && !isCents(costCents)) return error('Cost price must be a valid amount', 400)

  const quantity = body.quantity ?? 0
  if (!isQuantity(quantity)) return error('Quantity must be zero or more', 400)
  const alertQuantity = body.alertQuantity ?? 0
  if (!isQuantity(alertQuantity)) return error('Low stock alert must be zero or more', 400)

  const description = typeof body.description === 'string' ? body.description.trim() || null : null
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    return error(`Description must be ${MAX_DESCRIPTION_LENGTH} characters or less`, 400)
  }

  const manufacturedDate = optionalDate(body.manufacturedDate)
  if (manufacturedDate === undefined) return error('Manufactured date must be a valid date', 400)
  const expiryDate = optionalDate(body.expiryDate)
  if (expiryDate === undefined) return error('Expiry date must be a valid date', 400)
  // YYYY-MM-DD strings compare in date order
  if (manufacturedDate && expiryDate && expiryDate < manufacturedDate) {
    return error('Expiry date cannot be before the manufactured date', 400)
  }

  const warrantyId = optionalId(body.warrantyId)
  if (warrantyId === undefined) return error('Invalid warranty', 400)

  const status = body.status ?? 'active'
  if (status !== 'active' && status !== 'inactive') return error('Status must be active or inactive', 400)

  // The category, brand, warranty and unit must belong to this store, and the sub category to the category
  const refs = await db
    .prepare(
      `SELECT
         (SELECT 1 FROM categories WHERE id = ? AND store_id = ?) AS category_ok,
         (SELECT 1 FROM subcategories WHERE id = ? AND category_id = ? AND store_id = ?) AS subcategory_ok,
         (SELECT 1 FROM brands WHERE id = ? AND store_id = ?) AS brand_ok,
         (SELECT 1 FROM warranties WHERE id = ? AND store_id = ?) AS warranty_ok,
         (SELECT allow_decimal FROM units WHERE id = ? AND store_id = ?) AS unit_allow_decimal`,
    )
    .bind(
      categoryId ?? 0,
      storeId,
      subcategoryId ?? 0,
      categoryId ?? 0,
      storeId,
      brandId ?? 0,
      storeId,
      warrantyId ?? 0,
      storeId,
      unitId,
      storeId,
    )
    .first<{
      category_ok: number | null
      subcategory_ok: number | null
      brand_ok: number | null
      warranty_ok: number | null
      unit_allow_decimal: number | null
    }>()
  if (categoryId !== null && !refs?.category_ok) return error('Category not found', 400)
  if (subcategoryId !== null && !refs?.subcategory_ok) return error('Sub category not found in this category', 400)
  if (brandId !== null && !refs?.brand_ok) return error('Brand not found', 400)
  if (warrantyId !== null && !refs?.warranty_ok) return error('Warranty not found', 400)
  if (refs?.unit_allow_decimal == null) return error('Unit not found', 400)

  const cleanQuantity = roundQuantity(quantity)
  const cleanAlert = roundQuantity(alertQuantity)
  if (!refs.unit_allow_decimal && (!Number.isInteger(cleanQuantity) || !Number.isInteger(cleanAlert))) {
    return error('This unit only allows whole numbers', 400)
  }

  return {
    name,
    sku,
    barcode,
    categoryId,
    subcategoryId,
    brandId,
    unitId,
    priceCents: body.priceCents,
    costCents: costCents as number | null,
    quantity: cleanQuantity,
    alertQuantity: cleanAlert,
    description,
    manufacturedDate,
    expiryDate,
    warrantyId,
    status,
  }
}

/** Returns a 409 Response if another product already uses this SKU or barcode, else null. */
async function findClash(db: D1Database, storeId: number, input: ProductInput, excludeId = 0): Promise<Response | null> {
  const clash = await db
    .prepare(
      `SELECT sku = ? AS same_sku FROM products
       WHERE store_id = ? AND (sku = ? OR barcode = ?) AND id != ? LIMIT 1`,
    )
    .bind(input.sku, storeId, input.sku, input.barcode, excludeId)
    .first<{ same_sku: number }>()
  if (!clash) return null
  return clash.same_sku ? duplicateSku() : duplicateBarcode()
}

const duplicateSku = () => error('Another product already uses this SKU', 409)
const duplicateBarcode = () => error('Another product already uses this barcode', 409)

/** Turns a UNIQUE constraint failure (e.g. two saves racing) into a friendly 409, or rethrows. */
function uniqueConflict(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e)
  if (message.includes('UNIQUE') && message.includes('products.sku')) return duplicateSku()
  if (message.includes('UNIQUE') && message.includes('products.barcode')) return duplicateBarcode()
  throw e
}

async function listProducts(db: D1Database, storeId: number, url: URL, showCost: boolean): Promise<Response> {
  const search = url.searchParams.get('search')?.trim() ?? ''
  const status = url.searchParams.get('status')
  const categoryId = Number(url.searchParams.get('categoryId'))
  const subcategoryId = Number(url.searchParams.get('subcategoryId'))
  const brandId = Number(url.searchParams.get('brandId'))
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize')) || 10, 1), MAX_PAGE_SIZE)
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)

  const where: string[] = ['p.store_id = ?']
  const params: unknown[] = [storeId]
  if (search) {
    // Escape LIKE wildcards so "%" and "_" are matched literally
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.barcode LIKE ? ESCAPE '\\')")
    params.push(pattern, pattern, pattern)
  }
  if (status === 'active' || status === 'inactive') {
    where.push('p.status = ?')
    params.push(status)
  }
  if (Number.isSafeInteger(categoryId) && categoryId > 0) {
    where.push('p.category_id = ?')
    params.push(categoryId)
  }
  if (Number.isSafeInteger(subcategoryId) && subcategoryId > 0) {
    where.push('p.subcategory_id = ?')
    params.push(subcategoryId)
  }
  if (Number.isSafeInteger(brandId) && brandId > 0) {
    where.push('p.brand_id = ?')
    params.push(brandId)
  }

  let orderSql = 'p.created_at DESC, p.id DESC'
  const stock = url.searchParams.get('stock')
  if (stock === 'low') {
    where.push('p.quantity > 0 AND p.quantity <= p.alert_quantity')
    orderSql = 'p.quantity - p.alert_quantity, p.name' // furthest below the alert level first
  } else if (stock === 'out') {
    where.push('p.quantity <= 0')
    orderSql = 'p.name'
  }

  const expiresFrom = url.searchParams.get('expiresFrom')
  const expiresBefore = url.searchParams.get('expiresBefore')
  if (isDate(expiresFrom) || isDate(expiresBefore)) {
    where.push('p.expiry_date IS NOT NULL')
    orderSql = 'p.expiry_date, p.name' // soonest first
  }
  if (isDate(expiresFrom)) {
    where.push('p.expiry_date >= ?')
    params.push(expiresFrom)
  }
  if (isDate(expiresBefore)) {
    where.push('p.expiry_date < ?')
    params.push(expiresBefore)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [items, count] = await db.batch<ProductRow | { total: number }>([
    db
      .prepare(`SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM} ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, (page - 1) * pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM products p ${whereSql}`).bind(...params),
  ])

  return Response.json({
    items: (items!.results as ProductRow[]).map((row) => publicProduct(row, showCost)),
    total: (count!.results[0] as { total: number }).total,
  })
}

/** Everything the product form's dropdowns need, inactive ones included so a product's current pick still shows. */
async function listOptions(db: D1Database, storeId: number): Promise<Response> {
  const [categories, subcategories, brands, units, warranties] = await db.batch([
    db.prepare('SELECT id, name, status FROM categories WHERE store_id = ? ORDER BY name').bind(storeId),
    db
      .prepare(
        'SELECT id, category_id AS categoryId, name, status FROM subcategories WHERE store_id = ? ORDER BY name',
      )
      .bind(storeId),
    db.prepare('SELECT id, name, status FROM brands WHERE store_id = ? ORDER BY name').bind(storeId),
    db
      .prepare('SELECT id, name, short_name, allow_decimal, status FROM units WHERE store_id = ? ORDER BY name')
      .bind(storeId),
    db
      .prepare(
        `SELECT id, name, duration, duration_unit AS durationUnit, status FROM warranties
         WHERE store_id = ? ORDER BY name`,
      )
      .bind(storeId),
  ])
  type UnitOption = { id: number; name: string; short_name: string; allow_decimal: number; status: Status }

  return Response.json({
    categories: categories!.results,
    subcategories: subcategories!.results,
    brands: brands!.results,
    units: (units!.results as UnitOption[]).map((u) => ({
      id: u.id,
      name: u.name,
      shortName: u.short_name,
      allowDecimal: u.allow_decimal === 1,
      status: u.status,
    })),
    warranties: warranties!.results,
  })
}

async function createProduct(db: D1Database, storeId: number, request: Request): Promise<Response> {
  const input = await readProductInput(db, storeId, request)
  if (input instanceof Response) return input
  const clash = await findClash(db, storeId, input)
  if (clash) return clash

  let id: number
  try {
    const row = await db
      .prepare(
        `INSERT INTO products (store_id, name, sku, barcode, category_id, subcategory_id, brand_id, unit_id,
           price_cents, cost_cents, quantity, alert_quantity, description, manufactured_date, expiry_date,
           warranty_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .bind(
        storeId,
        input.name,
        input.sku,
        input.barcode,
        input.categoryId,
        input.subcategoryId,
        input.brandId,
        input.unitId,
        input.priceCents,
        input.costCents,
        input.quantity,
        input.alertQuantity,
        input.description,
        input.manufacturedDate,
        input.expiryDate,
        input.warrantyId,
        input.status,
      )
      .first<{ id: number }>()
    id = row!.id
  } catch (e) {
    return uniqueConflict(e)
  }
  const row = await getProduct(db, storeId, id)
  return row ? Response.json(publicProduct(row, true), { status: 201 }) : error('Product not found', 404)
}

async function updateProduct(db: D1Database, storeId: number, request: Request, id: number): Promise<Response> {
  const input = await readProductInput(db, storeId, request)
  if (input instanceof Response) return input
  const clash = await findClash(db, storeId, input, id)
  if (clash) return clash

  try {
    const result = await db
      .prepare(
        `UPDATE products SET name = ?, sku = ?, barcode = ?, category_id = ?, subcategory_id = ?,
           brand_id = ?, unit_id = ?, price_cents = ?, cost_cents = ?, quantity = ?, alert_quantity = ?,
           description = ?, manufactured_date = ?, expiry_date = ?, warranty_id = ?, status = ?,
           updated_at = datetime('now')
         WHERE id = ? AND store_id = ?`,
      )
      .bind(
        input.name,
        input.sku,
        input.barcode,
        input.categoryId,
        input.subcategoryId,
        input.brandId,
        input.unitId,
        input.priceCents,
        input.costCents,
        input.quantity,
        input.alertQuantity,
        input.description,
        input.manufacturedDate,
        input.expiryDate,
        input.warrantyId,
        input.status,
        id,
        storeId,
      )
      .run()
    if (!result.meta.changes) return error('Product not found', 404)
  } catch (e) {
    return uniqueConflict(e)
  }
  const row = await getProduct(db, storeId, id)
  return row ? Response.json(publicProduct(row, true)) : error('Product not found', 404)
}

async function deleteProduct(db: D1Database, storeId: number, id: number): Promise<Response> {
  // product_images rows go with it (ON DELETE CASCADE)
  const result = await db.prepare('DELETE FROM products WHERE id = ? AND store_id = ?').bind(id, storeId).run()
  return result.meta.changes ? Response.json({ ok: true }) : error('Product not found', 404)
}

async function uploadImage(db: D1Database, storeId: number, request: Request, id: number): Promise<Response> {
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_IMAGE_BYTES) return error('Image is too large', 413)

  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength === 0) return error('No image received', 400)
  if (bytes.byteLength > MAX_IMAGE_BYTES) return error('Image is too large', 413)

  const contentType = sniffImageType(bytes)
  if (!contentType) return error('Only JPG, PNG or WebP images are allowed', 415)

  if (!(await getProduct(db, storeId, id))) return error('Product not found', 404)
  await db
    .prepare(
      `INSERT INTO product_images (product_id, content_type, data) VALUES (?, ?, ?)
       ON CONFLICT (product_id) DO UPDATE SET
         content_type = excluded.content_type, data = excluded.data, updated_at = datetime('now')`,
    )
    .bind(id, contentType, bytes)
    .run()

  const row = await getProduct(db, storeId, id)
  return row ? Response.json(publicProduct(row, true)) : error('Product not found', 404)
}

async function deleteImage(db: D1Database, storeId: number, id: number): Promise<Response> {
  await db
    .prepare(
      'DELETE FROM product_images WHERE product_id = (SELECT id FROM products WHERE id = ? AND store_id = ?)',
    )
    .bind(id, storeId)
    .run()
  const row = await getProduct(db, storeId, id)
  return row ? Response.json(publicProduct(row, true)) : error('Product not found', 404)
}

async function serveImage(db: D1Database, storeId: number, id: number): Promise<Response> {
  const row = await db
    .prepare(
      `SELECT i.content_type, i.data FROM product_images i JOIN products p ON p.id = i.product_id
       WHERE i.product_id = ? AND p.store_id = ?`,
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

/** Handles /api/products routes, or returns null if the path isn't one of them. */
export async function handleProducts(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  const isCollection = url.pathname === '/api/products'
  const isOptions = url.pathname === '/api/products/options'
  const itemMatch = url.pathname.match(/^\/api\/products\/(\d+)$/)
  const imageMatch = url.pathname.match(/^\/api\/products\/(\d+)\/image$/)
  if (!isCollection && !isOptions && !itemMatch && !imageMatch) return null

  const isAdmin = user.role === 'admin'
  const isWrite = request.method !== 'GET'
  if (isWrite && !isAdmin) return error('Only admins can change products', 403)

  const storeId = user.store_id
  if (isCollection && request.method === 'GET') return listProducts(db, storeId, url, isAdmin)
  if (isCollection && request.method === 'POST') return createProduct(db, storeId, request)
  if (isOptions && request.method === 'GET') return listOptions(db, storeId)
  if (itemMatch && request.method === 'GET') {
    const row = await getProduct(db, storeId, Number(itemMatch[1]))
    return row ? Response.json(publicProduct(row, isAdmin)) : error('Product not found', 404)
  }
  if (itemMatch && request.method === 'PUT') return updateProduct(db, storeId, request, Number(itemMatch[1]))
  if (itemMatch && request.method === 'DELETE') return deleteProduct(db, storeId, Number(itemMatch[1]))
  if (imageMatch && request.method === 'GET') return serveImage(db, storeId, Number(imageMatch[1]))
  if (imageMatch && request.method === 'PUT') return uploadImage(db, storeId, request, Number(imageMatch[1]))
  if (imageMatch && request.method === 'DELETE') return deleteImage(db, storeId, Number(imageMatch[1]))

  return error('Method not allowed', 405)
}
