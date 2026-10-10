// Sending stores their withdrawals through PayMongo (see migration 0030). Sales paid online are paid
// into the platform's PayMongo account (saleCheckouts.ts) and held in each store's wallet
// (storePayouts.ts). When a super admin sends a withdrawal, the money goes from the platform's
// PayMongo Wallet to the store's GCash or bank account: InstaPay up to ₱50,000, PESONet above.
//
// Every transfer is kept in payout_transfers with its references: ours (WD00012T1, the
// withdrawal and the attempt), PayMongo's transfer id (tr_…) and the InstaPay/PESONet reference on
// the bank statement. While it's pending the withdrawal can't be cancelled, rejected or marked
// sent. Once PayMongo says it succeeded, it's recorded as the withdrawal's payout; if it failed, the
// withdrawal waits to be sent again (or rejected).
//
// A transfer sends the withdrawal less its service charge (migration 0031); the payout it records
// is the whole withdrawal, out of the wallet, with the charge the platform kept.
//
// PayMongo tells us a transfer's status changed by calling the transfer's callback URL and our
// webhook. Neither is trusted for the status itself: each only names transfers, which are then
// looked up from PayMongo. Pending transfers are also checked every 10 minutes (the Worker's cron)
// and whenever a wallet is opened.
//
//   POST /api/webhooks/paymongo/transfers   (PayMongo's transfer callback)

import { cleanText, error } from './documents'
import {
  createTransfer,
  findTransfer,
  GCASH_BIC,
  INSTAPAY_MAX_CENTS,
  onlinePaymentEnabled,
  PaymongoError,
  receivingInstitutions,
  retrieveTransfer,
  type PaymongoEnv,
  type Transfer,
  type TransferProvider,
} from './paymongo'
import { WALLET_BALANCE_SQL } from './storePayouts'

export const TRANSFER_CALLBACK_PATH = '/api/webhooks/paymongo/transfers'

/** PayMongo keeps an idempotency key's answer for about a day; a create isn't resent after this */
const IDEMPOTENCY_WINDOW_MS = 23 * 3_600_000

/** A withdrawal with a transfer on its way (SQL, ?1 = withdrawal id) */
export const TRANSFER_IN_FLIGHT_SQL = `EXISTS (SELECT 1 FROM payout_transfers WHERE withdrawal_id = ?1 AND status = 'pending')`

export interface TransferRow {
  id: number
  store_id: number
  withdrawal_id: number
  amount_cents: number
  provider: TransferProvider
  bank_code: string
  bank_name: string
  account_name: string
  account_number: string
  callback_url: string | null
  reference_number: string
  transfer_id: string | null
  batch_transfer_id: string | null
  provider_reference_number: string | null
  fee_cents: number | null
  status: 'pending' | 'succeeded' | 'failed'
  failure_code: string | null
  failure_message: string | null
  created_by_name: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

export const TRANSFER_COLUMNS = `id, store_id, withdrawal_id, amount_cents, provider, bank_code, bank_name, account_name,
  account_number, callback_url, reference_number, transfer_id, batch_transfer_id, provider_reference_number, fee_cents,
  status, failure_code, failure_message, created_by_name, created_at, updated_at, completed_at`

export const publicTransfer = (row: TransferRow) => ({
  id: row.id,
  withdrawalId: row.withdrawal_id,
  reference: row.reference_number, // ours, also on the PayMongo dashboard
  transferId: row.transfer_id, // PayMongo's
  providerReference: row.provider_reference_number, // InstaPay's or PESONet's, on the bank statement
  provider: row.provider,
  amountCents: row.amount_cents,
  feeCents: row.fee_cents,
  bankName: row.bank_name,
  accountName: row.account_name,
  accountNumber: row.account_number,
  status: row.status,
  failureMessage: row.failure_message,
  sentBy: row.created_by_name,
  createdAt: row.created_at,
  completedAt: row.completed_at,
})

export type PublicTransfer = ReturnType<typeof publicTransfer>

export const transfersEnabled = (env: PaymongoEnv) => onlinePaymentEnabled(env)

/** The banks and e-wallets a store can withdraw to, or null when PayMongo isn't set up */
export async function withdrawalBanks(env: PaymongoEnv) {
  if (!transfersEnabled(env)) return null
  return receivingInstitutions(env, 'instapay')
}

/** What a failed transfer means for the super admin sending it */
function failureMessage(code: string | null, detail: string | null): string {
  switch (code) {
    case 'invalid_destination_account':
    case 'account_not_found':
    case 'resource_not_found':
    case 'AC01':
    case 'AC03':
    case 'RC04':
      return "The account name or number doesn't match the bank's records. Ask the store to check it."
    case 'account_not_active':
    case 'resource_closed_state':
    case 'resource_frozen_state':
    case 'AC04':
    case 'AC06':
      return "The store's account is closed or blocked and can't receive money."
    case 'insufficient_wallet_balance':
    case 'AM04':
      return "The platform's PayMongo Wallet doesn't have enough balance. Top it up, then send again."
    case 'account_limit_reached':
    case 'AM14':
      return "The store's account has reached its receiving limit. Try again later or ask for another account."
    case 'transaction_limit_exceeded':
    case 'parameter_above_maximum':
      return 'The amount is over the transfer limit (₱50,000 by InstaPay).'
    case 'no_activated_wallet':
      return 'The PayMongo Wallet is not activated. Activate it in the PayMongo dashboard (Wallet), then send again.'
    case 'receiving_institution_unavailable':
    case '9910':
    case '9912':
    case 'DS24':
      return "The store's bank is offline right now. Send again later."
    default:
      return detail ? `PayMongo couldn't send it: ${detail}` : "PayMongo couldn't send it."
  }
}

async function markFailed(db: D1Database, row: TransferRow, code: string | null, message: string): Promise<void> {
  await db
    .prepare(
      `UPDATE payout_transfers SET status = 'failed', failure_code = ?, failure_message = ?, completed_at = datetime('now'),
         updated_at = datetime('now')
       WHERE id = ? AND status = 'pending'`,
    )
    .bind(code, message, row.id)
    .run()
}

/** Records what PayMongo says about a transfer: its ids, and the payout once it succeeded. */
async function applyTransfer(db: D1Database, row: TransferRow, transfer: Transfer): Promise<void> {
  const details = db
    .prepare(
      `UPDATE payout_transfers SET transfer_id = COALESCE(transfer_id, ?2), batch_transfer_id = COALESCE(?3, batch_transfer_id),
         provider_reference_number = COALESCE(?4, provider_reference_number), fee_cents = COALESCE(?5, fee_cents),
         updated_at = datetime('now')
       WHERE id = ?1`,
    )
    .bind(row.id, transfer.id || null, transfer.batchTransferId, transfer.providerReferenceNumber, transfer.feeCents)

  if (transfer.status === 'failed') {
    await details.run()
    await markFailed(db, row, transfer.failureCode, failureMessage(transfer.failureCode, transfer.failureMessage))
    return
  }
  if (transfer.status !== 'succeeded') {
    await details.run()
    return
  }

  // The money arrived: record it as the withdrawal's payout, with the reference the store sees
  // on its statement (or PayMongo's transfer id until the rail gives one)
  await db.batch([
    details,
    db
      .prepare(
        `UPDATE payout_transfers SET status = 'succeeded', completed_at = datetime('now') WHERE id = ? AND status = 'pending'`,
      )
      .bind(row.id),
    db
      .prepare(
        `INSERT INTO store_payouts (store_id, amount_cents, service_charge_cents, method, reference, note, paid_date,
           created_by, withdrawal_id, transfer_id)
         SELECT t.store_id, w.amount_cents, w.service_charge_cents, CASE t.bank_code WHEN ?2 THEN 'gcash' ELSE 'bank_transfer' END,
           COALESCE(t.provider_reference_number, t.transfer_id, t.reference_number),
           'Sent through PayMongo (' || CASE t.provider WHEN 'instapay' THEN 'InstaPay' ELSE 'PESONet' END || '), ref '
             || t.reference_number,
           date('now', '+8 hours'), t.created_by, t.withdrawal_id, t.id
         FROM payout_transfers t JOIN wallet_withdrawals w ON w.id = t.withdrawal_id
         WHERE t.id = ?1 AND t.status = 'succeeded'
         ON CONFLICT DO NOTHING`,
      )
      .bind(row.id, GCASH_BIC),
    db
      .prepare(
        `UPDATE wallet_withdrawals SET status = 'sent', reviewed_at = datetime('now'),
           reviewed_by = (SELECT created_by FROM payout_transfers WHERE id = ?1)
         WHERE id = ?2 AND status = 'pending' AND EXISTS (SELECT 1 FROM store_payouts WHERE transfer_id = ?1)`,
      )
      .bind(row.id, row.withdrawal_id),
  ])
}

/** Sends a pending transfer row to PayMongo (again, after a lost answer: the same key sends it at most once). */
async function submitTransfer(db: D1Database, env: PaymongoEnv, row: TransferRow): Promise<void> {
  let transfer: Transfer
  try {
    transfer = await createTransfer(env, {
      provider: row.provider,
      amountCents: row.amount_cents,
      destination: { bic: row.bank_code, name: row.account_name, number: row.account_number },
      referenceNumber: row.reference_number,
      description: `Withdrawal ${row.reference_number.replace(/T\d+$/, '')} to ${row.bank_name}`.slice(0, 100),
      callbackUrl: row.callback_url,
      metadata: {
        kind: 'withdrawal',
        payout_transfer_id: String(row.id),
        withdrawal_id: String(row.withdrawal_id),
        store_id: String(row.store_id),
      },
      idempotencyKey: `payout-${row.reference_number}-${row.created_at.replace(/\D/g, '')}`,
    })
  } catch (err) {
    if (err instanceof PaymongoError && err.rejected) {
      // Turned down, so nothing was sent
      console.warn(err)
      await markFailed(db, row, err.code, failureMessage(err.code, err.detail))
      return
    }
    // Not known whether it went: it's checked again (refreshTransfer) with the same key
    console.error('PayMongo: transfer not confirmed, to check again', row.reference_number, err)
    await db.prepare(`UPDATE payout_transfers SET updated_at = datetime('now') WHERE id = ?`).bind(row.id).run()
    return
  }
  await applyTransfer(db, row, transfer)
}

/** Asks PayMongo about a pending transfer and records what it says. */
export async function refreshTransfer(db: D1Database, env: PaymongoEnv, row: TransferRow): Promise<void> {
  if (row.status !== 'pending' || !transfersEnabled(env)) return
  try {
    if (row.transfer_id) {
      await applyTransfer(db, row, await retrieveTransfer(env, row.transfer_id))
      return
    }
    // PayMongo's answer to the create was lost: find the transfer, or send it again with the same key
    const found = await findTransfer(env, row.reference_number).catch((err) => {
      console.warn(err)
      return null
    })
    if (found) await applyTransfer(db, row, found)
    else if (Date.now() - Date.parse(`${row.created_at.replace(' ', 'T')}Z`) < IDEMPOTENCY_WINDOW_MS) {
      await submitTransfer(db, env, row)
    } else {
      console.error('PayMongo: transfer never confirmed; check the PayMongo dashboard for', row.reference_number)
    }
  } catch (err) {
    console.warn('PayMongo: could not check transfer', row.reference_number, err)
  }
}

/** Checks the pending transfers (of one store, or all) not checked in the last half minute. */
export async function refreshPendingTransfers(
  db: D1Database,
  env: PaymongoEnv,
  storeId: number | null,
  limit = 10,
): Promise<void> {
  if (!transfersEnabled(env)) return
  const { results } = await db
    .prepare(
      `SELECT ${TRANSFER_COLUMNS} FROM payout_transfers
       WHERE status = 'pending' AND (?1 IS NULL OR store_id = ?1) AND updated_at <= datetime('now', '-30 seconds')
       ORDER BY id LIMIT ?2`,
    )
    .bind(storeId, limit)
    .all<TransferRow>()
  for (const row of results) await refreshTransfer(db, env, row)
}

/**
 * Checks the pending transfers a PayMongo callback or webhook names, by PayMongo's id (tr_…) or
 * our reference number. The body only says which ones to look up, so it needn't be trusted.
 */
export async function refreshTransfersNamedIn(db: D1Database, env: PaymongoEnv, body: string): Promise<void> {
  const ids = [...new Set(body.match(/\btr_[A-Za-z0-9]{8,64}\b/g) ?? [])].slice(0, 10)
  const references = [...new Set(body.match(/\bWD\d{5,}T\d{1,4}\b/g) ?? [])].slice(0, 10)
  if (!ids.length && !references.length) return
  const placeholders = (values: string[]) => (values.length ? values.map(() => '?').join(', ') : 'NULL')
  const { results } = await db
    .prepare(
      `SELECT ${TRANSFER_COLUMNS} FROM payout_transfers
       WHERE status = 'pending' AND (transfer_id IN (${placeholders(ids)}) OR reference_number IN (${placeholders(references)}))`,
    )
    .bind(...ids, ...references)
    .all<TransferRow>()
  for (const row of results) await refreshTransfer(db, env, row)
}

/** POST /api/webhooks/paymongo/transfers: PayMongo's callback when a transfer's status changes */
export async function handleTransferCallback(db: D1Database, env: PaymongoEnv, request: Request): Promise<Response> {
  const body = await request.text()
  if (body.length <= 64_000) await refreshTransfersNamedIn(db, env, body)
  return Response.json({ ok: true })
}

interface WithdrawalToSend {
  id: number
  store_id: number
  amount_cents: number
  service_charge_cents: number
  destination: 'gcash' | 'bank'
  bank_code: string | null
  status: string
}

/**
 * Sends a pending withdrawal through PayMongo. `bankCode` picks the store's bank when the request
 * didn't name one from PayMongo's list (requests made before transfers). Returns the store's id
 * once the transfer is recorded (whatever PayMongo said), or an error response.
 */
export async function sendWithdrawalTransfer(
  db: D1Database,
  env: PaymongoEnv,
  id: number,
  admin: { id: number; full_name: string },
  bankCode: unknown,
  origin: string,
): Promise<number | Response> {
  if (!transfersEnabled(env)) return error('PayMongo is not set up, so withdrawals can only be marked as sent', 400)
  const w = await db
    .prepare(
      'SELECT id, store_id, amount_cents, service_charge_cents, destination, bank_code, status FROM wallet_withdrawals WHERE id = ?',
    )
    .bind(id)
    .first<WithdrawalToSend>()
  if (!w) return error('Withdrawal not found', 404)
  if (w.status !== 'pending') return error('This withdrawal is no longer pending', 409)

  // What's sent: the withdrawal less its service charge
  const sendCents = w.amount_cents - w.service_charge_cents
  const provider: TransferProvider = sendCents <= INSTAPAY_MAX_CENTS ? 'instapay' : 'pesonet'
  const code = w.destination === 'gcash' ? GCASH_BIC : cleanText(bankCode) || w.bank_code
  if (!code) return error("Choose the store's bank", 400)
  let bank
  try {
    bank = (await receivingInstitutions(env, provider)).find((i) => i.code === code)
  } catch (err) {
    console.error(err)
    return error("Could not reach PayMongo. Please try again in a moment.", 502)
  }
  if (!bank) {
    return error(
      provider === 'pesonet'
        ? 'This bank or e-wallet can only receive up to ₱50,000 at once through PayMongo. Ask the store for a smaller amount.'
        : "PayMongo can't send to this bank. Choose another, or mark it as sent by hand.",
      400,
    )
  }

  // Only while the request is pending, fits the balance and has no transfer on its way, so a
  // withdrawal is never sent twice
  const row = await db
    .prepare(
      `INSERT INTO payout_transfers (store_id, withdrawal_id, amount_cents, provider, bank_code, bank_name, account_name,
         account_number, callback_url, reference_number, created_by, created_by_name)
       SELECT w.store_id, w.id, w.amount_cents - w.service_charge_cents, ?2, ?3, ?4, w.account_name, w.account_number, ?5,
         'WD' || printf('%05d', w.id) || 'T' || ((SELECT COUNT(*) FROM payout_transfers WHERE withdrawal_id = w.id) + 1),
         ?6, ?7
       FROM wallet_withdrawals w
       WHERE w.id = ?1 AND w.status = 'pending' AND w.amount_cents <= ${WALLET_BALANCE_SQL.replaceAll('?1', 'w.store_id')}
       ON CONFLICT DO NOTHING
       RETURNING ${TRANSFER_COLUMNS}`,
    )
    .bind(
      id,
      provider,
      bank.code,
      bank.name,
      origin.startsWith('https://') ? `${origin}${TRANSFER_CALLBACK_PATH}` : null, // PayMongo calls HTTPS only
      admin.id,
      admin.full_name,
    )
    .first<TransferRow>()
  if (!row) {
    const sending = await db.prepare(`SELECT ${TRANSFER_IN_FLIGHT_SQL} AS yes`).bind(id).first<{ yes: number }>()
    return sending?.yes
      ? error('This withdrawal is already being sent. Wait for PayMongo to finish.', 409)
      : error('This withdrawal is no longer pending, or is more than the store is owed', 409)
  }
  if (w.destination === 'bank' && w.bank_code !== bank.code) {
    await db.prepare('UPDATE wallet_withdrawals SET bank_code = ? WHERE id = ?').bind(bank.code, id).run()
  }

  await submitTransfer(db, env, row)
  return w.store_id
}
