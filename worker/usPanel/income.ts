// The platform owner's income, for super admins (US Panel): subscription payments, the service
// charges added to online payments and kept out of payouts, less what PayMongo kept. Also where
// the charges are set.
//
//   GET /api/us-panel/income?year=YYYY  -> { year, firstYear, months, stores, sources, totals }   (months in Philippine time)
//   GET /api/us-panel/income/entries?year=YYYY[&month=M][&store=ID][&source=subscription|sale|payout][&offset=N]
//                                       -> { entries, count, totals, hasMore }   (each payment the income came from)
//   GET /api/us-panel/service-charges   -> { renewal, sale, payout }
//   PUT /api/us-panel/service-charges   { renewal: { kind, value }, sale: { kind, value, methods }, payout: { kind, value } }
//                                       -> { renewal, sale, payout }
//
// Money is in centavos. The platform's income is only:
//   - subscriptions: renewals paid, online or recorded by a super admin, less their service charge
//   - service charges on payments made online through PayMongo: renewals, and sales paid by a
//     checkout (saleCheckouts.ts), whose money goes to the platform's PayMongo account
//   - service charges kept out of the payouts of store withdrawals (storePayouts.ts), counted
//     when the payout is recorded
// less what PayMongo kept. A charge on a sale payment the store recorded by hand was collected by
// the store, not the platform, so it isn't income. The sale amount itself is the store's (its wallet).

import { error } from '../documents'
import { getServiceCharges, ONLINE_METHODS, type ServiceCharge } from '../serviceCharges'
import type { SuperAdmin } from './session'

const MAX_FIXED_CENTS = 1_000_000 // PHP 10,000
const MAX_PERCENT_BP = 10_000 // 100%

// Paid times are stored in UTC; months and years are counted in Philippine time (UTC+8)
const LOCAL = "'+8 hours'"

const ENTRIES_PAGE = 50

/** A renewal paid online through PayMongo (the webhook records it without a super admin) */
const RENEWAL_ONLINE = '(sr.processing_fee_cents IS NOT NULL OR (sr.confirmed_by IS NULL AND sr.checkout_session_id IS NOT NULL))'
/** Its service charge, which only a renewal paid online has */
const RENEWAL_CHARGE = `CASE WHEN ${RENEWAL_ONLINE} THEN sr.service_charge_cents ELSE 0 END`
/** What a renewal brought in for the subscription itself */
const RENEWAL_SUBSCRIPTION = `COALESCE(sr.amount, 0) * 100 - ${RENEWAL_CHARGE}`

const between = (column: string) => `${column} >= datetime(?, '-8 hours') AND ${column} < datetime(?, '-8 hours')`

/** The year asked for (this year if it's missing or odd), in Philippine time */
function readYear(url: URL) {
  const thisYear = new Date(Date.now() + 8 * 3_600_000).getUTCFullYear()
  const requested = Number(url.searchParams.get('year') ?? thisYear)
  return Number.isSafeInteger(requested) && requested >= 2000 && requested <= thisYear + 1 ? requested : thisYear
}

interface IncomeRow {
  key: string | number // month ('01'..'12') or store id
  subscriptions: number
  renewal_charges: number
  processing_fees: number
  renewals: number
  sale_charges: number
  sale_processing_fees: number
  sale_payments: number
  payout_charges: number
  payouts: number
}

function incomeTotals(rows: Partial<IncomeRow>[]) {
  const sum = (field: keyof IncomeRow) => rows.reduce((total, row) => total + Number(row[field] ?? 0), 0)
  const subscriptionsCents = sum('subscriptions')
  const renewalChargesCents = sum('renewal_charges')
  const saleChargesCents = sum('sale_charges')
  const payoutChargesCents = sum('payout_charges')
  const processingFeesCents = sum('processing_fees') + sum('sale_processing_fees')
  return {
    subscriptionsCents,
    renewalChargesCents,
    saleChargesCents,
    payoutChargesCents,
    processingFeesCents,
    netCents: subscriptionsCents + renewalChargesCents + saleChargesCents + payoutChargesCents - processingFeesCents,
    renewals: sum('renewals'),
    salePayments: sum('sale_payments'),
    payouts: sum('payouts'), // payouts a service charge was kept out of
  }
}

async function getIncome(db: D1Database, url: URL): Promise<Response> {
  const year = readYear(url)
  const range = [`${year}-01-01`, `${year + 1}-01-01`]

  const renewalSql = (key: string) =>
    `SELECT ${key} AS key,
       SUM(${RENEWAL_SUBSCRIPTION}) AS subscriptions,
       SUM(${RENEWAL_CHARGE}) AS renewal_charges,
       SUM(COALESCE(sr.processing_fee_cents, 0)) AS processing_fees,
       COUNT(*) AS renewals
     FROM subscription_renewals sr WHERE sr.status = 'paid' AND ${between('sr.paid_at')} GROUP BY key`
  // Only payments made through a checkout: their charge was paid to the platform
  const saleSql = (key: string) =>
    `SELECT ${key} AS key, SUM(sp.service_charge_cents) AS sale_charges,
       SUM(COALESCE(sp.processing_fee_cents, 0)) AS sale_processing_fees, COUNT(*) AS sale_payments
     FROM sale_payments sp WHERE sp.checkout_id IS NOT NULL AND ${between('sp.created_at')}
     GROUP BY key`
  // Service charges kept out of withdrawals, when their payout was recorded
  const payoutSql = (key: string) =>
    `SELECT ${key} AS key, SUM(po.service_charge_cents) AS payout_charges, COUNT(*) AS payouts
     FROM store_payouts po WHERE po.service_charge_cents > 0 AND ${between('po.created_at')}
     GROUP BY key`

  const [
    renewalMonths,
    saleMonths,
    payoutMonths,
    renewalStores,
    saleStores,
    payoutStores,
    first,
    plans,
    renewalMethods,
    saleMethods,
  ] = await db.batch<Record<string, string | number | null>>([
      db.prepare(renewalSql(`strftime('%m', sr.paid_at, ${LOCAL})`)).bind(...range),
      db.prepare(saleSql(`strftime('%m', sp.created_at, ${LOCAL})`)).bind(...range),
      db.prepare(payoutSql(`strftime('%m', po.created_at, ${LOCAL})`)).bind(...range),
      db.prepare(renewalSql('sr.store_id')).bind(...range),
      db.prepare(saleSql('sp.store_id')).bind(...range),
      db.prepare(payoutSql('po.store_id')).bind(...range),
      db.prepare(
        `SELECT MIN(year) AS key FROM (
           SELECT MIN(strftime('%Y', paid_at, ${LOCAL})) AS year FROM subscription_renewals WHERE status = 'paid'
           UNION ALL
           SELECT MIN(strftime('%Y', created_at, ${LOCAL})) FROM sale_payments WHERE checkout_id IS NOT NULL
           UNION ALL
           SELECT MIN(strftime('%Y', created_at, ${LOCAL})) FROM store_payouts WHERE service_charge_cents > 0)`,
      ),
      // Subscriptions by plan, and how many were paid online
      db
        .prepare(
          `SELECT sr.plan_id AS id, COALESCE(p.name, sr.plan_id) AS name, COUNT(*) AS renewals,
             SUM(sr.months) AS months, SUM(${RENEWAL_SUBSCRIPTION}) AS cents, SUM(${RENEWAL_ONLINE}) AS online,
             SUM(CASE WHEN ${RENEWAL_ONLINE} THEN ${RENEWAL_SUBSCRIPTION} ELSE 0 END) AS online_cents
           FROM subscription_renewals sr LEFT JOIN plans p ON p.id = sr.plan_id
           WHERE sr.status = 'paid' AND ${between('sr.paid_at')} GROUP BY sr.plan_id ORDER BY cents DESC`,
        )
        .bind(...range),
      // Online payments by method: their service charges and PayMongo fees
      db
        .prepare(
          `SELECT COALESCE(sr.payment_method, 'other') AS method, COUNT(*) AS count, SUM(${RENEWAL_CHARGE}) AS charges,
             SUM(COALESCE(sr.processing_fee_cents, 0)) AS fees
           FROM subscription_renewals sr WHERE sr.status = 'paid' AND ${RENEWAL_ONLINE} AND ${between('sr.paid_at')}
           GROUP BY method`,
        )
        .bind(...range),
      db
        .prepare(
          `SELECT sp.method AS method, COUNT(*) AS count, SUM(sp.service_charge_cents) AS charges,
             SUM(COALESCE(sp.processing_fee_cents, 0)) AS fees, SUM(sp.amount_cents) AS store_cents
           FROM sale_payments sp WHERE sp.checkout_id IS NOT NULL AND ${between('sp.created_at')} GROUP BY method`,
        )
        .bind(...range),
    ])

  const emptyMethod = (method: string) => ({
    method,
    renewals: 0,
    renewalChargesCents: 0,
    salePayments: 0,
    saleChargesCents: 0,
    processingFeesCents: 0,
    storeCents: 0, // sale amounts paid through to the stores (not income)
  })
  const methods = new Map<string, ReturnType<typeof emptyMethod>>()
  const methodRow = (method: string) => methods.get(method) ?? methods.set(method, emptyMethod(method)).get(method)!
  for (const row of renewalMethods!.results) {
    const m = methodRow(String(row.method))
    m.renewals += Number(row.count)
    m.renewalChargesCents += Number(row.charges)
    m.processingFeesCents += Number(row.fees)
  }
  for (const row of saleMethods!.results) {
    const m = methodRow(String(row.method))
    m.salePayments += Number(row.count)
    m.saleChargesCents += Number(row.charges)
    m.processingFeesCents += Number(row.fees)
    m.storeCents += Number(row.store_cents)
  }

  /** Joins the renewal and sale rows that share a key */
  function merge(...lists: Record<string, unknown>[][]) {
    const byKey = new Map<string, Partial<IncomeRow>>()
    for (const row of lists.flat()) byKey.set(String(row.key), { ...byKey.get(String(row.key)), ...(row as Partial<IncomeRow>) })
    return byKey
  }

  const months = merge(renewalMonths!.results, saleMonths!.results, payoutMonths!.results)
  const stores = merge(renewalStores!.results, saleStores!.results, payoutStores!.results)
  const storeNames = new Map<string, string>()
  if (stores.size) {
    const ids = [...stores.keys()].map(Number)
    const { results } = await db
      .prepare(`SELECT id, name FROM stores WHERE id IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(ids))
      .all<{ id: number; name: string }>()
    for (const row of results) storeNames.set(String(row.id), row.name)
  }

  return Response.json({
    year,
    firstYear: Math.min(Number(first!.results[0]?.key ?? year) || year, year),
    months: Array.from({ length: 12 }, (_, i) => {
      const month = String(i + 1).padStart(2, '0')
      return { month: `${year}-${month}`, ...incomeTotals([months.get(month) ?? {}]) }
    }),
    stores: [...stores.entries()]
      .map(([id, row]) => ({ id: Number(id), name: storeNames.get(id) ?? 'Deleted store', ...incomeTotals([row]) }))
      .sort((a, b) => b.netCents - a.netCents),
    sources: {
      plans: plans!.results.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        renewals: Number(row.renewals),
        months: Number(row.months),
        cents: Number(row.cents),
        online: Number(row.online),
        onlineCents: Number(row.online_cents),
      })),
      methods: [...methods.values()].sort(
        (a, b) => b.renewalChargesCents + b.saleChargesCents - (a.renewalChargesCents + a.saleChargesCents),
      ),
    },
    totals: incomeTotals([...months.values()]),
  })
}

interface EntryRow {
  source: 'subscription' | 'sale' | 'payout'
  id: number
  store_id: number
  store_name: string | null
  at: string
  method: string
  online: number
  plan_name: string | null
  months: number | null
  sale_id: number | null
  reference: string | null
  received_cents: number
  store_cents: number
  subscription_cents: number
  charge_cents: number
  fee_cents: number
}

/** GET /api/us-panel/income/entries: each payment the income came from, newest first. */
async function getIncomeEntries(db: D1Database, url: URL): Promise<Response> {
  const year = readYear(url)
  const month = Number(url.searchParams.get('month'))
  const pad = (n: number) => String(n).padStart(2, '0')
  const range =
    Number.isSafeInteger(month) && month >= 1 && month <= 12
      ? [`${year}-${pad(month)}-01`, month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`]
      : [`${year}-01-01`, `${year + 1}-01-01`]
  const storeId = Number(url.searchParams.get('store'))
  const source = url.searchParams.get('source')
  const offset = Math.max(Math.floor(Number(url.searchParams.get('offset'))) || 0, 0)

  const where: string[] = []
  const params: (string | number)[] = []
  if (Number.isSafeInteger(storeId) && storeId > 0) {
    where.push('e.store_id = ?')
    params.push(storeId)
  }
  if (source === 'subscription' || source === 'sale' || source === 'payout') {
    where.push('e.source = ?')
    params.push(source)
  }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : ''

  // received: what the customer or store paid (for a payout, what left the store's wallet);
  // store: the part that's the store's (a sale's amount, or what a payout sent the store)
  const entriesSql = `
    SELECT 'subscription' AS source, sr.id, sr.store_id, sr.paid_at AS at, COALESCE(sr.payment_method, 'other') AS method,
      ${RENEWAL_ONLINE} AS online, COALESCE(p.name, sr.plan_id) AS plan_name, sr.months, NULL AS sale_id,
      sr.payment_reference AS reference, COALESCE(sr.amount, 0) * 100 AS received_cents, 0 AS store_cents,
      ${RENEWAL_SUBSCRIPTION} AS subscription_cents, ${RENEWAL_CHARGE} AS charge_cents,
      COALESCE(sr.processing_fee_cents, 0) AS fee_cents
    FROM subscription_renewals sr LEFT JOIN plans p ON p.id = sr.plan_id
    WHERE sr.status = 'paid' AND ${between('sr.paid_at')}
    UNION ALL
    SELECT 'sale', sp.id, sp.store_id, sp.created_at, sp.method, 1, NULL, NULL, sp.sale_id,
      COALESCE(c.payment_reference, sp.reference), sp.amount_cents + sp.service_charge_cents, sp.amount_cents,
      0, sp.service_charge_cents, COALESCE(sp.processing_fee_cents, 0)
    FROM sale_payments sp LEFT JOIN sale_checkouts c ON c.id = sp.checkout_id
    WHERE sp.checkout_id IS NOT NULL AND ${between('sp.created_at')}
    UNION ALL
    SELECT 'payout', po.id, po.store_id, po.created_at, po.method, po.transfer_id IS NOT NULL, NULL, NULL, NULL,
      po.reference, po.amount_cents, po.amount_cents - po.service_charge_cents, 0, po.service_charge_cents, 0
    FROM store_payouts po
    WHERE po.service_charge_cents > 0 AND ${between('po.created_at')}`

  const [page, sums] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT e.*, st.name AS store_name FROM (${entriesSql}) e LEFT JOIN stores st ON st.id = e.store_id
         ${filter} ORDER BY e.at DESC, e.source, e.id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...range, ...range, ...range, ...params, ENTRIES_PAGE + 1, offset),
    db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(e.subscription_cents), 0) AS subscriptions,
           COALESCE(SUM(e.charge_cents), 0) AS charges, COALESCE(SUM(e.fee_cents), 0) AS fees,
           COALESCE(SUM(e.store_cents), 0) AS store
         FROM (${entriesSql}) e ${filter}`,
      )
      .bind(...range, ...range, ...range, ...params),
  ])

  const rows = page!.results as unknown as EntryRow[]
  const sum = sums!.results[0] as { count: number; subscriptions: number; charges: number; fees: number; store: number }
  return Response.json({
    entries: rows.slice(0, ENTRIES_PAGE).map((row) => ({
      source: row.source,
      id: row.id,
      storeId: row.store_id,
      storeName: row.store_name ?? 'Deleted store',
      at: row.at,
      method: row.method,
      online: !!row.online,
      planName: row.plan_name,
      months: row.months,
      saleReference: row.sale_id === null ? null : `INV-${String(row.sale_id).padStart(5, '0')}`,
      payoutReference: row.source === 'payout' ? `PO-${String(row.id).padStart(5, '0')}` : null,
      reference: row.reference,
      receivedCents: row.received_cents,
      storeCents: row.store_cents,
      subscriptionCents: row.subscription_cents,
      chargeCents: row.charge_cents,
      processingFeeCents: row.fee_cents,
      netCents: row.subscription_cents + row.charge_cents - row.fee_cents,
    })),
    count: sum.count,
    totals: {
      subscriptionsCents: sum.subscriptions,
      chargesCents: sum.charges,
      processingFeesCents: sum.fees,
      storeCents: sum.store,
      netCents: sum.subscriptions + sum.charges - sum.fees,
    },
    hasMore: rows.length > ENTRIES_PAGE,
  })
}

/** Validates one charge from the request body; returns it or an error message. */
function readCharge(value: unknown, label: string, withMethods: boolean): ServiceCharge | string {
  const body = value as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return `Set the ${label} charge`
  const kind = body.kind
  if (kind !== 'fixed' && kind !== 'percent') return `Choose a fixed amount or a percentage for the ${label} charge`
  const max = kind === 'fixed' ? MAX_FIXED_CENTS : MAX_PERCENT_BP
  if (!Number.isSafeInteger(body.value) || (body.value as number) < 0 || (body.value as number) > max) {
    return kind === 'fixed'
      ? `The ${label} charge must be from 0 to ₱${(MAX_FIXED_CENTS / 100).toLocaleString('en-US')}`
      : `The ${label} charge must be from 0% to 100%`
  }
  let methods: string[] = []
  if (withMethods) {
    if (!Array.isArray(body.methods) || !body.methods.every((m) => (ONLINE_METHODS as readonly string[]).includes(m))) {
      return `Choose the payment methods the ${label} charge applies to`
    }
    methods = [...new Set(body.methods as string[])]
  }
  return { kind, value: body.value as number, methods }
}

async function updateServiceCharges(db: D1Database, request: Request, admin: SuperAdmin): Promise<Response> {
  const body = await request.json<Record<string, unknown>>().catch(() => null)
  if (!body) return error('Invalid request body', 400)
  const renewal = readCharge(body.renewal, 'renewal', false)
  if (typeof renewal === 'string') return error(renewal, 400)
  const sale = readCharge(body.sale, 'sale', true)
  if (typeof sale === 'string') return error(sale, 400)
  const payout = readCharge(body.payout, 'withdrawal', false)
  if (typeof payout === 'string') return error(payout, 400)

  const save = (id: string, charge: ServiceCharge) =>
    db
      .prepare(
        `INSERT INTO service_charges (id, kind, value, methods, updated_by) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, value = excluded.value, methods = excluded.methods,
           updated_by = excluded.updated_by, updated_at = datetime('now')`,
      )
      .bind(id, charge.kind, charge.value, JSON.stringify(charge.methods), admin.id)
  await db.batch([save('renewal', renewal), save('sale', sale), save('payout', payout)])
  return Response.json(await getServiceCharges(db))
}

/** Handles /api/us-panel/income and /api/us-panel/service-charges, or returns null. */
export async function handleIncome(
  db: D1Database,
  request: Request,
  url: URL,
  admin: SuperAdmin,
): Promise<Response | null> {
  if (url.pathname === '/api/us-panel/income') {
    return request.method === 'GET' ? getIncome(db, url) : error('Method not allowed', 405)
  }
  if (url.pathname === '/api/us-panel/income/entries') {
    return request.method === 'GET' ? getIncomeEntries(db, url) : error('Method not allowed', 405)
  }
  if (url.pathname === '/api/us-panel/service-charges') {
    if (request.method === 'GET') return Response.json(await getServiceCharges(db))
    if (request.method === 'PUT') return updateServiceCharges(db, request, admin)
    return error('Method not allowed', 405)
  }
  return null
}
