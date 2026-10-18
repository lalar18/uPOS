// The store's own GCash account (see migrations/0034_create_store_gcash_accounts.sql). Any user of
// the store can read it (the POS shows the QR code); only roles with settings.manage can change it.
//
//   GET    /api/settings/gcash      -> account | null
//   PUT    /api/settings/gcash      multipart { accountName, accountNumber, qr? (image, needed the first time) } -> account
//   DELETE /api/settings/gcash      -> null
//   GET    /api/settings/gcash/qr   -> the QR image

import { error } from './documents'
import { can } from './permissions'
import { sniffImageType } from './profile'
import type { SessionUser } from './session'

// The browser resizes the QR before upload; this is a backstop under D1's 2,000,000-byte value limit
const MAX_QR_BYTES = 1_500_000
const MAX_NAME_LENGTH = 100

interface AccountRow {
  account_name: string
  account_number: string
  updated_at: string
}

const publicAccount = (row: AccountRow) => ({
  accountName: row.account_name,
  accountNumber: row.account_number,
  // A new upload gets a new URL, so the image can be cached
  qrUrl: `/api/settings/gcash/qr?v=${encodeURIComponent(row.updated_at)}`,
})

const ACCOUNT_COLUMNS = 'account_name, account_number, updated_at'

async function getAccount(db: D1Database, storeId: number): Promise<Response> {
  const row = await db
    .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM store_gcash_accounts WHERE store_id = ?`)
    .bind(storeId)
    .first<AccountRow>()
  return Response.json(row ? publicAccount(row) : null)
}

async function saveAccount(db: D1Database, request: Request, storeId: number): Promise<Response> {
  const declaredLength = Number(request.headers.get('Content-Length') ?? 0)
  if (declaredLength > MAX_QR_BYTES + 10_000) return error('The QR image is too large', 413)
  const form = await request.formData().catch(() => null)
  if (!form) return error('Invalid request body', 400)

  const field = (name: string) => {
    const value = form.get(name)
    return typeof value === 'string' ? value.trim() : ''
  }
  const accountName = field('accountName')
  if (!accountName) return error('Enter the GCash account name', 400)
  if (accountName.length > MAX_NAME_LENGTH) return error(`Account name must be ${MAX_NAME_LENGTH} characters or less`, 400)
  const accountNumber = field('accountNumber').replace(/[\s-]/g, '')
  if (accountNumber && !/^(09\d{9}|\+639\d{9})$/.test(accountNumber)) {
    return error('Enter the GCash number like 0917 123 4567', 400)
  }

  const qr = form.get('qr')
  if (qr !== null && typeof qr !== 'string') {
    const bytes = new Uint8Array(await qr.arrayBuffer())
    if (bytes.byteLength === 0) return error('No QR image received', 400)
    if (bytes.byteLength > MAX_QR_BYTES) return error('The QR image is too large', 413)
    const contentType = sniffImageType(bytes)
    if (!contentType) return error('The QR must be a JPG, PNG or WebP image', 415)
    const row = await db
      .prepare(
        `INSERT INTO store_gcash_accounts (store_id, account_name, account_number, qr_content_type, qr_data)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (store_id) DO UPDATE SET account_name = excluded.account_name,
           account_number = excluded.account_number, qr_content_type = excluded.qr_content_type,
           qr_data = excluded.qr_data, updated_at = datetime('now')
         RETURNING ${ACCOUNT_COLUMNS}`,
      )
      .bind(storeId, accountName, accountNumber, contentType, bytes)
      .first<AccountRow>()
    return Response.json(publicAccount(row!))
  }

  // No new QR: only the name and number change, which needs a QR uploaded before
  const row = await db
    .prepare(
      `UPDATE store_gcash_accounts SET account_name = ?, account_number = ? WHERE store_id = ?
       RETURNING ${ACCOUNT_COLUMNS}`,
    )
    .bind(accountName, accountNumber, storeId)
    .first<AccountRow>()
  return row ? Response.json(publicAccount(row)) : error('Upload your GCash QR code', 400)
}

async function serveQr(db: D1Database, storeId: number): Promise<Response> {
  const row = await db
    .prepare('SELECT qr_content_type, qr_data FROM store_gcash_accounts WHERE store_id = ?')
    .bind(storeId)
    .first<{ qr_content_type: string; qr_data: ArrayBuffer | number[] }>()
  if (!row) return error('Not found', 404)
  return new Response(new Uint8Array(row.qr_data), {
    headers: {
      'Content-Type': row.qr_content_type,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}

/** Handles /api/settings/gcash and /api/settings/gcash/qr. */
export async function handleGcash(db: D1Database, request: Request, url: URL, user: SessionUser): Promise<Response> {
  if (url.pathname === '/api/settings/gcash/qr') {
    return request.method === 'GET' ? serveQr(db, user.store_id) : error('Method not allowed', 405)
  }
  if (request.method === 'GET') return getAccount(db, user.store_id)
  if (request.method !== 'PUT' && request.method !== 'DELETE') return error('Method not allowed', 405)
  if (!can(user, 'settings.manage')) return error("You don't have permission to change settings", 403)
  if (request.method === 'PUT') return saveAccount(db, request, user.store_id)
  await db.prepare('DELETE FROM store_gcash_accounts WHERE store_id = ?').bind(user.store_id).run()
  return Response.json(null)
}
