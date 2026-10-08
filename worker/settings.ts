// General settings for the logged-in user's store. Any user can read them (the sales
// screens use them as defaults); only roles with settings.manage can change them.
//
//   GET /api/settings                                                    -> settings
//   PUT /api/settings   { defaultTaxRateBp, quotationValidDays, receiptFooter } -> settings

import { error } from './documents'
import { can } from './permissions'
import type { SessionUser } from './session'

interface SettingsRow {
  default_tax_rate_bp: number
  quotation_valid_days: number
  receipt_footer: string
}

const MAX_QUOTATION_VALID_DAYS = 365
const MAX_RECEIPT_FOOTER_LENGTH = 200

function publicSettings(row: SettingsRow) {
  return {
    defaultTaxRateBp: row.default_tax_rate_bp,
    quotationValidDays: row.quotation_valid_days,
    receiptFooter: row.receipt_footer,
  }
}

const SETTINGS_COLUMNS = 'default_tax_rate_bp, quotation_valid_days, receipt_footer'

const isWholeNumber = (value: unknown, max: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max

async function updateSettings(db: D1Database, request: Request, user: SessionUser): Promise<Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return error('Invalid request body', 400)

  if (!isWholeNumber(body.defaultTaxRateBp, 10_000)) return error('Default tax rate must be from 0% to 100%', 400)
  if (!isWholeNumber(body.quotationValidDays, MAX_QUOTATION_VALID_DAYS)) {
    return error(`Quotation validity must be 0 to ${MAX_QUOTATION_VALID_DAYS} days`, 400)
  }
  // Line breaks are kept so the footer can be a few short lines
  const receiptFooter = typeof body.receiptFooter === 'string' ? body.receiptFooter.trim() : ''
  if (receiptFooter.length > MAX_RECEIPT_FOOTER_LENGTH) {
    return error(`Receipt message must be ${MAX_RECEIPT_FOOTER_LENGTH} characters or less`, 400)
  }

  const row = await db
    .prepare(
      `UPDATE stores SET default_tax_rate_bp = ?, quotation_valid_days = ?, receipt_footer = ?, updated_at = datetime('now')
       WHERE id = ? RETURNING ${SETTINGS_COLUMNS}`,
    )
    .bind(body.defaultTaxRateBp, body.quotationValidDays, receiptFooter, user.store_id)
    .first<SettingsRow>()
  return row ? Response.json(publicSettings(row)) : error('Store not found', 404)
}

/** Handles /api/settings. */
export async function handleSettings(db: D1Database, request: Request, user: SessionUser): Promise<Response> {
  if (request.method === 'GET') {
    const row = await db
      .prepare(`SELECT ${SETTINGS_COLUMNS} FROM stores WHERE id = ?`)
      .bind(user.store_id)
      .first<SettingsRow>()
    return row ? Response.json(publicSettings(row)) : error('Store not found', 404)
  }
  if (request.method === 'PUT') {
    if (!can(user, 'settings.manage')) return error("You don't have permission to change settings", 403)
    return updateSettings(db, request, user)
  }
  return error('Method not allowed', 405)
}
