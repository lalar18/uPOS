// Store information for the logged-in user's store. Any user can read it
// (e.g. for receipts); only roles with store.manage can change it.
//
//   GET /api/store                                                        -> store
//   PUT /api/store   { name, email, phone, address, city, province, postalCode, tin }  -> store

import { can } from './permissions'
import type { SessionUser } from './session'

interface StoreRow {
  id: number
  name: string
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  tin: string | null
  receipt_footer: string // edited on the General Settings page (see settings.ts)
  created_at: string
  updated_at: string
}

// Label and max length of each optional field, keyed by its JSON name
const OPTIONAL_FIELDS = {
  email: ['Email', 254],
  phone: ['Phone', 30],
  address: ['Address', 255],
  city: ['City', 100],
  province: ['Province', 100],
  postalCode: ['Postal code', 10],
  tin: ['TIN', 20],
} as const

type OptionalField = keyof typeof OPTIONAL_FIELDS

const MAX_NAME_LENGTH = 100
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_PATTERN = /^[0-9+()\-\s]+$/
const TIN_PATTERN = /^[0-9-]+$/

function publicStore(row: StoreRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    province: row.province,
    postalCode: row.postal_code,
    tin: row.tin,
    receiptFooter: row.receipt_footer,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const error = (message: string, status: number) => Response.json({ error: message }, { status })

/** Validates an update body. Blank optional fields become null. Returns the clean values or an error Response. */
export async function readStoreInput(
  request: Request,
): Promise<({ name: string } & Record<OptionalField, string | null>) | Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  const clean = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '')

  const name = clean(body?.name)
  if (!name) return error('Store name is required', 400)
  if (name.length > MAX_NAME_LENGTH) return error(`Store name must be ${MAX_NAME_LENGTH} characters or less`, 400)

  const values = {} as Record<OptionalField, string | null>
  for (const [field, [label, maxLength]] of Object.entries(OPTIONAL_FIELDS) as [
    OptionalField,
    readonly [string, number],
  ][]) {
    const value = clean(body?.[field])
    if (value.length > maxLength) return error(`${label} must be ${maxLength} characters or less`, 400)
    values[field] = value || null
  }

  if (values.email && !EMAIL_PATTERN.test(values.email)) return error('Enter a valid email address', 400)
  if (values.phone && !PHONE_PATTERN.test(values.phone)) {
    return error('Phone can only contain numbers, spaces and + ( ) -', 400)
  }
  if (values.tin && !TIN_PATTERN.test(values.tin)) return error('TIN can only contain numbers and dashes', 400)

  return { name, ...values }
}

async function getStore(db: D1Database, user: SessionUser): Promise<Response> {
  const row = await db.prepare('SELECT * FROM stores WHERE id = ?').bind(user.store_id).first<StoreRow>()
  return row ? Response.json(publicStore(row)) : error('Store not found', 404)
}

async function updateStore(db: D1Database, request: Request, user: SessionUser): Promise<Response> {
  const input = await readStoreInput(request)
  if (input instanceof Response) return input

  const row = await db
    .prepare(
      `UPDATE stores SET name = ?, email = ?, phone = ?, address = ?, city = ?, province = ?,
         postal_code = ?, tin = ?, updated_at = datetime('now')
       WHERE id = ? RETURNING *`,
    )
    .bind(
      input.name,
      input.email,
      input.phone,
      input.address,
      input.city,
      input.province,
      input.postalCode,
      input.tin,
      user.store_id,
    )
    .first<StoreRow>()
  return row ? Response.json(publicStore(row)) : error('Store not found', 404)
}

/** Handles /api/store. */
export async function handleStore(db: D1Database, request: Request, user: SessionUser): Promise<Response> {
  if (request.method === 'GET') return getStore(db, user)
  if (request.method === 'PUT') {
    if (!can(user, 'store.manage')) return error("You don't have permission to change store information", 403)
    return updateStore(db, request, user)
  }
  return error('Method not allowed', 405)
}
