// The platform owner's income, for super admins (US Panel): subscription payments, the service
// charges added to online payments, less what PayMongo kept. Also where the charges are set.
//
//   GET /api/us-panel/income?year=YYYY  -> { year, firstYear, months, stores, totals }   (months in Philippine time)
//   GET /api/us-panel/service-charges   -> { renewal, sale }
//   PUT /api/us-panel/service-charges   { renewal: { kind, value }, sale: { kind, value, methods } } -> { renewal, sale }
//
// Money is in centavos. A renewal's subscription income is what was received less its service
// charge. A sale's service charge was collected by the store from its customer, or, for a sale
// paid online (saleCheckouts.ts), by PayMongo, which kept its fee out of the payment.

import { error } from '../documents'
import { getServiceCharges, ONLINE_METHODS, type ServiceCharge } from '../serviceCharges'
import type { SuperAdmin } from './session'

const MAX_FIXED_CENTS = 1_000_000 // PHP 10,000
const MAX_PERCENT_BP = 10_000 // 100%

// Paid times are stored in UTC; months and years are counted in Philippine time (UTC+8)
const LOCAL = "'+8 hours'"

interface IncomeRow {
  key: string | number // month ('01'..'12') or store id
  subscriptions: number
  renewal_charges: number
  processing_fees: number
  renewals: number
  sale_charges: number
  sale_processing_fees: number
  sale_payments: number
}

function incomeTotals(rows: Partial<IncomeRow>[]) {
  const sum = (field: keyof IncomeRow) => rows.reduce((total, row) => total + Number(row[field] ?? 0), 0)
  const subscriptionsCents = sum('subscriptions')
  const renewalChargesCents = sum('renewal_charges')
  const saleChargesCents = sum('sale_charges')
  const processingFeesCents = sum('processing_fees') + sum('sale_processing_fees')
  return {
    subscriptionsCents,
    renewalChargesCents,
    saleChargesCents,
    processingFeesCents,
    netCents: subscriptionsCents + renewalChargesCents + saleChargesCents - processingFeesCents,
    renewals: sum('renewals'),
    salePayments: sum('sale_payments'),
  }
}

async function getIncome(db: D1Database, url: URL): Promise<Response> {
  const thisYear = new Date(Date.now() + 8 * 3_600_000).getUTCFullYear()
  const requested = Number(url.searchParams.get('year') ?? thisYear)
  const year = Number.isSafeInteger(requested) && requested >= 2000 && requested <= thisYear + 1 ? requested : thisYear
  const range = [`${year}-01-01`, `${year + 1}-01-01`]
  const between = (column: string) => `${column} >= datetime(?, '-8 hours') AND ${column} < datetime(?, '-8 hours')`

  const renewalSql = (key: string) =>
    `SELECT ${key} AS key,
       SUM(COALESCE(amount, 0) * 100 - service_charge_cents) AS subscriptions,
       SUM(service_charge_cents) AS renewal_charges,
       SUM(COALESCE(processing_fee_cents, 0)) AS processing_fees,
       COUNT(*) AS renewals
     FROM subscription_renewals WHERE status = 'paid' AND ${between('paid_at')} GROUP BY key`
  const saleSql = (key: string) =>
    `SELECT ${key} AS key, SUM(service_charge_cents) AS sale_charges,
       SUM(COALESCE(processing_fee_cents, 0)) AS sale_processing_fees, COUNT(*) AS sale_payments
     FROM sale_payments WHERE (service_charge_cents > 0 OR checkout_id IS NOT NULL) AND ${between('created_at')}
     GROUP BY key`

  const [renewalMonths, saleMonths, renewalStores, saleStores, first] = await db.batch<Partial<IncomeRow>>([
    db.prepare(renewalSql(`strftime('%m', paid_at, ${LOCAL})`)).bind(...range),
    db.prepare(saleSql(`strftime('%m', created_at, ${LOCAL})`)).bind(...range),
    db.prepare(renewalSql('store_id')).bind(...range),
    db.prepare(saleSql('store_id')).bind(...range),
    db.prepare(
      `SELECT MIN(year) AS key FROM (
         SELECT MIN(strftime('%Y', paid_at, ${LOCAL})) AS year FROM subscription_renewals WHERE status = 'paid'
         UNION ALL
         SELECT MIN(strftime('%Y', created_at, ${LOCAL})) FROM sale_payments WHERE service_charge_cents > 0)`,
    ),
  ])

  /** Joins the renewal and sale rows that share a key */
  function merge(...lists: Partial<IncomeRow>[][]) {
    const byKey = new Map<string, Partial<IncomeRow>>()
    for (const row of lists.flat()) byKey.set(String(row.key), { ...byKey.get(String(row.key)), ...row })
    return byKey
  }

  const months = merge(renewalMonths!.results, saleMonths!.results)
  const stores = merge(renewalStores!.results, saleStores!.results)
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
    totals: incomeTotals([...months.values()]),
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

  const save = (id: string, charge: ServiceCharge) =>
    db
      .prepare(
        `INSERT INTO service_charges (id, kind, value, methods, updated_by) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, value = excluded.value, methods = excluded.methods,
           updated_by = excluded.updated_by, updated_at = datetime('now')`,
      )
      .bind(id, charge.kind, charge.value, JSON.stringify(charge.methods), admin.id)
  await db.batch([save('renewal', renewal), save('sale', sale)])
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
  if (url.pathname === '/api/us-panel/service-charges') {
    if (request.method === 'GET') return Response.json(await getServiceCharges(db))
    if (request.method === 'PUT') return updateServiceCharges(db, request, admin)
    return error('Method not allowed', 405)
  }
  return null
}
