// Reports. Roles need reports.view; profit and cost figures also need products.manage, like the
// rest of the app. Every query is limited to the user's own store.
//
//   GET /api/reports/:key?from=YYYY-MM-DD&to=YYYY-MM-DD&today=YYYY-MM-DD&tzOffset=-480&...  -> report
//
// Every report answers in the same shape (tiles, a chart, breakdowns, tables and notes), so the
// browser draws them all with one page (src/views/reports/ReportView.vue). Dated reports take
// from/to (the store's local dates, both inclusive); `today` is the browser's local date and
// `tzOffset` its Date.getTimezoneOffset(), for timestamps stored in UTC (stock movements).
// Keep REPORTS in step with src/views/reports/reports.ts, which has the titles and filters.

import { error, isDate, roundQuantity, utcToday, WALK_IN_CUSTOMER } from './documents'
import { can, type Permission } from './permissions'
import type { SessionUser } from './session'

type Format =
  | 'text'
  | 'money'
  | 'qty'
  | 'count'
  | 'percent'
  | 'date'
  | 'method'
  | 'returnReason'
  | 'stockReason'
  | 'quoteStatus'

type Cell = string | number | null
type Row = Record<string, Cell>

interface Column {
  key: string
  label: string
  format?: Format // text when left out
}

interface Table {
  title: string
  columns: Column[]
  rows: Row[]
  totals?: Row
  link?: { route: 'sale-detail'; idKey: string } // each row opens this page
  truncated?: boolean // more rows than ROW_LIMIT
}

interface Tile {
  label: string
  value: number | null // null shows as "—"
  format: Format
  icon: string
  tone?: 'primary' | 'success' | 'danger' | 'info' | 'warning'
  hint?: string
}

interface Chart {
  title: string
  format: 'money' | 'count'
  granularity: 'day' | 'month'
  countLabel?: string // "sales", shown under each bar's value
  points: { key: string; value: number; count?: number }[]
}

interface Breakdown {
  title: string
  format: Format
  labelFormat?: Format
  items: { label: string; value: number; hint?: string }[]
}

interface Report {
  tiles: Tile[]
  chart?: Chart
  breakdowns: Breakdown[]
  tables: Table[]
  notes: string[]
}

interface Ctx {
  db: D1Database
  url: URL
  storeId: number
  from: string
  to: string
  today: string
  tzOffset: number // minutes, as Date.getTimezoneOffset() (-480 for the Philippines)
  granularity: 'day' | 'month'
  canCost: boolean
}

const ROW_LIMIT = 1000
const TOP_LIMIT = 10
const MAX_RANGE_DAYS = 3660 // about ten years
const DAILY_UP_TO_DAYS = 62 // longer ranges are charted by month

/** Balance still owed on a sale, in SQL */
const DUE_SQL = '(s.total_cents - s.returned_cents - s.paid_cents)'
/** Value of a sale line after returns, in SQL */
const LINE_NET_SQL = 'ROUND(si.total_cents * (si.quantity - si.returned_quantity) / si.quantity)'
/** Cost of what's left of a sale line after returns; lines without a cost count as free */
const LINE_COST_SQL = 'ROUND(COALESCE(si.cost_cents, 0) * (si.quantity - si.returned_quantity))'
const MISSING_COST_SQL = 'COUNT(CASE WHEN si.cost_cents IS NULL AND si.quantity > si.returned_quantity THEN 1 END)'

// --- Helpers ---

/** '2026-10-08' plus 3 days -> '2026-10-11' (calendar dates, so UTC is safe) */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** The SQL that turns a YYYY-MM-DD column into the chart's bucket key */
const bucketSql = (column: string, granularity: Ctx['granularity']) =>
  granularity === 'day' ? column : `substr(${column}, 1, 7)`

/** Every bucket key in the range, so empty days (or months) still show on the chart */
function bucketKeys({ from, to, granularity }: Ctx): string[] {
  const keys: string[] = []
  if (granularity === 'day') {
    for (let date = from; date <= to; date = addDays(date, 1)) keys.push(date)
  } else {
    let [year, month] = from.split('-').map(Number) as [number, number]
    const last = to.slice(0, 7)
    for (;;) {
      const key = `${year}-${String(month).padStart(2, '0')}`
      if (key > last) break
      keys.push(key)
      month += 1
      if (month > 12) {
        month = 1
        year += 1
      }
    }
  }
  return keys
}

/** A chart with a point for every bucket in the range */
function fillChart(ctx: Ctx, chart: Omit<Chart, 'points' | 'granularity'>, rows: { k: string; value: number; count?: number }[]): Chart {
  const byKey = new Map(rows.map((r) => [r.k, r]))
  return {
    ...chart,
    granularity: ctx.granularity,
    points: bucketKeys(ctx).map((key) => {
      const row = byKey.get(key)
      return { key, value: row?.value ?? 0, count: chart.countLabel ? (row?.count ?? 0) : undefined }
    }),
  }
}

/** Profit as a percent of sales, to one decimal; null when there were no sales */
const margin = (profit: number, sales: number) => (sales > 0 ? Math.round((profit / sales) * 1000) / 10 : null)

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

const sum = (rows: Row[], key: string) => rows.reduce((total, r) => total + (Number(r[key]) || 0), 0)

/** The first ROW_LIMIT rows, saying whether any were left out */
const limitRows = (rows: Row[]) => ({ rows: rows.slice(0, ROW_LIMIT), truncated: rows.length > ROW_LIMIT || undefined })

const periodColumn = (ctx: Ctx): Column => ({
  key: 'period',
  label: ctx.granularity === 'day' ? 'Date' : 'Month',
  format: 'date',
})

/** A UTC "YYYY-MM-DD HH:MM:SS" for midnight at the start of a local date */
function utcStartOf(date: string, tzOffset: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + tzOffset * 60_000).toISOString().slice(0, 19).replace('T', ' ')
}

async function all<T = Row>(statement: D1PreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results
}

// --- Sales summary ---

async function salesReport(ctx: Ctx): Promise<Report> {
  const { db, storeId, from, to } = ctx
  const where = 's.store_id = ? AND s.sale_date BETWEEN ? AND ?'
  const k = bucketSql('s.sale_date', ctx.granularity)
  const [totals, byPeriod, bySource, byCashier] = await db.batch<Row>([
    db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(s.subtotal_cents), 0) AS gross,
           COALESCE(SUM(s.discount_cents), 0) AS discount, COALESCE(SUM(s.tax_cents), 0) AS tax,
           COALESCE(SUM(s.returned_cents), 0) AS returned, COALESCE(SUM(s.total_cents - s.returned_cents), 0) AS net,
           COALESCE(SUM(s.paid_cents), 0) AS paid, COALESCE(SUM(MAX(${DUE_SQL}, 0)), 0) AS due
         FROM sales s WHERE ${where}`,
      )
      .bind(storeId, from, to),
    db
      .prepare(
        `SELECT ${k} AS k, COUNT(*) AS count, SUM(s.subtotal_cents) AS gross, SUM(s.discount_cents) AS discount,
           SUM(s.tax_cents) AS tax, SUM(s.returned_cents) AS returned, SUM(s.total_cents - s.returned_cents) AS net
         FROM sales s WHERE ${where} GROUP BY k ORDER BY k`,
      )
      .bind(storeId, from, to),
    db
      .prepare(
        `SELECT s.source, COUNT(*) AS count, SUM(s.total_cents - s.returned_cents) AS net
         FROM sales s WHERE ${where} GROUP BY s.source ORDER BY net DESC`,
      )
      .bind(storeId, from, to),
    db
      .prepare(
        `SELECT s.user_name AS name, COUNT(*) AS count, SUM(s.total_cents - s.returned_cents) AS net
         FROM sales s WHERE ${where} GROUP BY s.user_name ORDER BY net DESC`,
      )
      .bind(storeId, from, to),
  ])
  const t = totals!.results[0]! as Record<string, number>
  const periods = byPeriod!.results
  const cashiers = byCashier!.results.map((r) => ({
    ...r,
    average: Number(r.count) ? Math.round(Number(r.net) / Number(r.count)) : 0,
    share: share(Number(r.net), t.net),
  }))

  return {
    tiles: [
      { label: 'Net sales', value: t.net, format: 'money', icon: 'receipt', tone: 'primary', hint: 'After discounts and returns, with tax' },
      { label: 'Transactions', value: t.count, format: 'count', icon: 'shopping-cart', tone: 'info' },
      { label: 'Average sale', value: t.count ? Math.round(t.net / t.count) : 0, format: 'money', icon: 'calculator', tone: 'success' },
      { label: 'Discounts', value: t.discount, format: 'money', icon: 'discount', tone: 'warning' },
      { label: 'Returns', value: t.returned, format: 'money', icon: 'receipt-refund', tone: 'danger' },
      { label: 'Balance due', value: t.due, format: 'money', icon: 'alert-circle', tone: 'danger', hint: 'Still owed on these sales' },
    ],
    chart: fillChart(
      ctx,
      { title: 'Net sales', format: 'money', countLabel: 'sales' },
      periods.map((r) => ({ k: String(r.k), value: Number(r.net), count: Number(r.count) })),
    ),
    breakdowns: [
      {
        title: 'By channel',
        format: 'money',
        items: bySource!.results.map((r) => ({
          label: r.source === 'pos' ? 'POS' : 'Manual sales',
          value: Number(r.net),
          hint: `${r.count} ${r.count === 1 ? 'sale' : 'sales'}`,
        })),
      },
    ],
    tables: [
      {
        title: ctx.granularity === 'day' ? 'Sales by day' : 'Sales by month',
        columns: [
          periodColumn(ctx),
          { key: 'count', label: 'Sales', format: 'count' },
          { key: 'gross', label: 'Gross', format: 'money' },
          { key: 'discount', label: 'Discounts', format: 'money' },
          { key: 'tax', label: 'Tax', format: 'money' },
          { key: 'returned', label: 'Returns', format: 'money' },
          { key: 'net', label: 'Net sales', format: 'money' },
        ],
        rows: periods.map((r) => ({ ...r, period: r.k })),
        totals: { period: 'Total', count: t.count, gross: t.gross, discount: t.discount, tax: t.tax, returned: t.returned, net: t.net },
      },
      {
        title: 'Sales by cashier',
        columns: [
          { key: 'name', label: 'Cashier' },
          { key: 'count', label: 'Sales', format: 'count' },
          { key: 'average', label: 'Average sale', format: 'money' },
          { key: 'net', label: 'Net sales', format: 'money' },
          { key: 'share', label: 'Share', format: 'percent' },
        ],
        rows: cashiers,
        totals: { name: 'Total', count: t.count, average: t.count ? Math.round(t.net / t.count) : 0, net: t.net, share: t.net ? 100 : null },
      },
    ],
    notes: ['Gross − discounts + tax − returns = net sales. Returns count against the date of the original sale.'],
  }
}

// --- Sales by product, category or brand ---

async function productSalesReport(ctx: Ctx): Promise<Report> {
  const { db, storeId, from, to, canCost } = ctx
  const requested = ctx.url.searchParams.get('group')
  const group = requested === 'category' || requested === 'brand' ? requested : 'product'

  const select = {
    product: `COALESCE(CAST(si.product_id AS TEXT), 'sku:' || si.product_sku) AS gkey,
      MAX(COALESCE(p.name, si.product_name)) AS name, MAX(si.product_sku) AS sku, MAX(si.unit_short_name) AS unit`,
    category: `COALESCE(c.name, 'Uncategorised') AS gkey, COALESCE(c.name, 'Uncategorised') AS name,
      COUNT(DISTINCT COALESCE(CAST(si.product_id AS TEXT), si.product_sku)) AS products`,
    brand: `COALESCE(b.name, 'No brand') AS gkey, COALESCE(b.name, 'No brand') AS name,
      COUNT(DISTINCT COALESCE(CAST(si.product_id AS TEXT), si.product_sku)) AS products`,
  }[group]

  const rows = await all(
    db
      .prepare(
        `SELECT ${select}, SUM(si.quantity) AS sold, SUM(si.returned_quantity) AS returned,
           SUM(si.total_cents) AS gross, SUM(${LINE_NET_SQL}) AS net, SUM(${LINE_COST_SQL}) AS cost,
           ${MISSING_COST_SQL} AS missing
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN products p ON p.id = si.product_id AND p.store_id = s.store_id
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN brands b ON b.id = p.brand_id
         WHERE s.store_id = ? AND s.sale_date BETWEEN ? AND ?
         GROUP BY gkey ORDER BY net DESC, name`,
      )
      .bind(storeId, from, to),
  )
  for (const r of rows) {
    r.sold = roundQuantity(Number(r.sold))
    r.returned = roundQuantity(Number(r.returned))
    r.profit = Number(r.net) - Number(r.cost)
    r.margin = margin(Number(r.profit), Number(r.net))
  }

  const net = sum(rows, 'net')
  const cost = sum(rows, 'cost')
  const missing = sum(rows, 'missing')
  const products =
    group === 'product' ? rows.filter((r) => Number(r.sold) > Number(r.returned)).length : sum(rows, 'products')

  const nameLabel = { product: 'Product', category: 'Category', brand: 'Brand' }[group]
  const columns: Column[] =
    group === 'product'
      ? [
          { key: 'name', label: nameLabel },
          { key: 'sku', label: 'SKU' },
          { key: 'sold', label: 'Sold', format: 'qty' },
          { key: 'returned', label: 'Returned', format: 'qty' },
          { key: 'unit', label: 'Unit' },
          { key: 'net', label: 'Net sales', format: 'money' },
        ]
      : [
          { key: 'name', label: nameLabel },
          { key: 'products', label: 'Products', format: 'count' },
          { key: 'net', label: 'Net sales', format: 'money' },
        ]
  if (canCost) {
    columns.push(
      { key: 'cost', label: 'Cost', format: 'money' },
      { key: 'profit', label: 'Profit', format: 'money' },
      { key: 'margin', label: 'Margin', format: 'percent' },
    )
  }
  columns.push({ key: 'share', label: 'Share', format: 'percent' })
  for (const r of rows) r.share = share(Number(r.net), net)

  const tiles: Tile[] = [
    { label: 'Products sold', value: products, format: 'count', icon: 'box', tone: 'info' },
    { label: 'Net sales', value: net, format: 'money', icon: 'receipt', tone: 'primary', hint: 'Line values after returns' },
  ]
  if (canCost) {
    tiles.push(
      { label: 'Cost of goods', value: cost, format: 'money', icon: 'coins', tone: 'warning' },
      { label: 'Profit', value: net - cost, format: 'money', icon: 'trending-up', tone: 'success', hint: margin(net - cost, net) === null ? undefined : `${margin(net - cost, net)}% margin` },
    )
  } else {
    tiles.push({ label: 'Returned value', value: sum(rows, 'gross') - net, format: 'money', icon: 'receipt-refund', tone: 'danger' })
  }

  const notes = ['Amounts are line values after returns, before invoice discounts and tax.']
  if (group !== 'product') notes.push(`Products are grouped by their current ${group}.`)
  if (canCost && missing > 0) {
    notes.push(`${missing} sold ${missing === 1 ? 'line has' : 'lines have'} no cost price and ${missing === 1 ? 'is' : 'are'} counted as free, so profit may be overstated.`)
  }

  const totals: Row = { name: 'Total', net, share: net ? 100 : null }
  if (group !== 'product') totals.products = products
  if (canCost) Object.assign(totals, { cost, profit: net - cost, margin: margin(net - cost, net) })

  return {
    tiles,
    breakdowns: [
      {
        title: `Top ${group === 'product' ? 'products' : group === 'category' ? 'categories' : 'brands'}`,
        format: 'money',
        items: rows.slice(0, TOP_LIMIT).filter((r) => Number(r.net) > 0).map((r) => ({ label: String(r.name), value: Number(r.net) })),
      },
    ],
    tables: [{ title: `Sales by ${group}`, columns, ...limitRows(rows), totals }],
    notes,
  }
}

// --- Sales by customer ---

async function customerReport(ctx: Ctx): Promise<Report> {
  const { db, storeId, from, to } = ctx
  const rows = await all(
    db
      .prepare(
        `SELECT COALESCE(s.customer_id, 0) AS cid,
           CASE WHEN s.customer_id IS NULL THEN ? ELSE MAX(s.customer_name) END AS name,
           COUNT(*) AS count, SUM(s.total_cents - s.returned_cents) AS net, SUM(s.paid_cents) AS paid,
           SUM(MAX(${DUE_SQL}, 0)) AS due, MAX(s.sale_date) AS last
         FROM sales s WHERE s.store_id = ? AND s.sale_date BETWEEN ? AND ?
         GROUP BY cid ORDER BY net DESC`,
      )
      .bind(WALK_IN_CUSTOMER, storeId, from, to),
  )
  const named = rows.filter((r) => r.cid !== 0)
  const walkIn = rows.find((r) => r.cid === 0)
  const net = sum(rows, 'net')
  const namedNet = sum(named, 'net')
  for (const r of rows) {
    r.average = Number(r.count) ? Math.round(Number(r.net) / Number(r.count)) : 0
    r.share = share(Number(r.net), net)
  }

  return {
    tiles: [
      { label: 'Customers', value: named.length, format: 'count', icon: 'users-group', tone: 'info', hint: 'Named customers who bought' },
      { label: 'Repeat customers', value: named.filter((r) => Number(r.count) > 1).length, format: 'count', icon: 'repeat', tone: 'success' },
      { label: 'Average per customer', value: named.length ? Math.round(namedNet / named.length) : 0, format: 'money', icon: 'user-dollar', tone: 'primary' },
      { label: 'Walk-in sales', value: Number(walkIn?.net ?? 0), format: 'money', icon: 'walk', tone: 'warning', hint: walkIn ? `${share(Number(walkIn.net), net)}% of net sales` : undefined },
    ],
    breakdowns: [
      {
        title: 'Top customers',
        format: 'money',
        items: named.slice(0, TOP_LIMIT).map((r) => ({ label: String(r.name), value: Number(r.net), hint: `${r.count} ${r.count === 1 ? 'sale' : 'sales'}` })),
      },
    ],
    tables: [
      {
        title: 'Sales by customer',
        columns: [
          { key: 'name', label: 'Customer' },
          { key: 'count', label: 'Sales', format: 'count' },
          { key: 'average', label: 'Average sale', format: 'money' },
          { key: 'net', label: 'Net sales', format: 'money' },
          { key: 'paid', label: 'Paid', format: 'money' },
          { key: 'due', label: 'Balance due', format: 'money' },
          { key: 'last', label: 'Last sale', format: 'date' },
          { key: 'share', label: 'Share', format: 'percent' },
        ],
        ...limitRows(rows),
        totals: { name: 'Total', count: sum(rows, 'count'), net, paid: sum(rows, 'paid'), due: sum(rows, 'due'), share: net ? 100 : null },
      },
    ],
    notes: ['Net sales are after returns. Balance due is what is still owed on the sales in this period.'],
  }
}

// --- Payments received ---

async function paymentsReport(ctx: Ctx): Promise<Report> {
  const { db, storeId, from, to } = ctx
  const where = 'store_id = ? AND paid_date BETWEEN ? AND ?'
  const k = bucketSql('paid_date', ctx.granularity)
  const amounts = `COUNT(CASE WHEN amount_cents > 0 THEN 1 END) AS count,
    COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END), 0) AS received,
    COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents END), 0) AS refunds,
    COALESCE(SUM(amount_cents), 0) AS net`
  const [totals, byMethod, byPeriod] = await db.batch<Row>([
    db
      .prepare(
        `SELECT ${amounts}, COUNT(CASE WHEN amount_cents < 0 THEN 1 END) AS refund_count,
           COALESCE(SUM(CASE WHEN checkout_id IS NOT NULL THEN amount_cents END), 0) AS online
         FROM sale_payments WHERE ${where}`,
      )
      .bind(storeId, from, to),
    db.prepare(`SELECT method, ${amounts} FROM sale_payments WHERE ${where} GROUP BY method ORDER BY received DESC`).bind(storeId, from, to),
    db.prepare(`SELECT ${k} AS k, ${amounts} FROM sale_payments WHERE ${where} GROUP BY k ORDER BY k`).bind(storeId, from, to),
  ])
  const t = totals!.results[0]! as Record<string, number>
  const methods = byMethod!.results.map((r): Row => ({ ...r, share: share(Number(r.received), t.received) }))
  const periods = byPeriod!.results

  return {
    tiles: [
      { label: 'Received', value: t.received, format: 'money', icon: 'cash', tone: 'success' },
      { label: 'Payments', value: t.count, format: 'count', icon: 'receipt-2', tone: 'info' },
      { label: 'Refunds', value: t.refunds, format: 'money', icon: 'receipt-refund', tone: 'danger', hint: `${t.refund_count} ${t.refund_count === 1 ? 'refund' : 'refunds'}` },
      { label: 'Net collected', value: t.net, format: 'money', icon: 'wallet', tone: 'primary' },
      { label: 'Paid online', value: t.online, format: 'money', icon: 'world', tone: 'info', hint: 'Through PayMongo checkouts' },
    ],
    chart: fillChart(
      ctx,
      { title: 'Net collected', format: 'money', countLabel: 'payments' },
      periods.map((r) => ({ k: String(r.k), value: Number(r.net), count: Number(r.count) })),
    ),
    breakdowns: [
      {
        title: 'Received by method',
        format: 'money',
        labelFormat: 'method',
        items: methods.filter((m) => Number(m.received) > 0).map((m) => ({ label: String(m.method), value: Number(m.received), hint: `${m.count} ${m.count === 1 ? 'payment' : 'payments'}` })),
      },
    ],
    tables: [
      {
        title: 'By payment method',
        columns: [
          { key: 'method', label: 'Method', format: 'method' },
          { key: 'count', label: 'Payments', format: 'count' },
          { key: 'received', label: 'Received', format: 'money' },
          { key: 'refunds', label: 'Refunds', format: 'money' },
          { key: 'net', label: 'Net', format: 'money' },
          { key: 'share', label: 'Share', format: 'percent' },
        ],
        rows: methods,
        totals: { method: 'Total', count: t.count, received: t.received, refunds: t.refunds, net: t.net, share: t.received ? 100 : null },
      },
      {
        title: ctx.granularity === 'day' ? 'Payments by day' : 'Payments by month',
        columns: [
          periodColumn(ctx),
          { key: 'count', label: 'Payments', format: 'count' },
          { key: 'received', label: 'Received', format: 'money' },
          { key: 'refunds', label: 'Refunds', format: 'money' },
          { key: 'net', label: 'Net', format: 'money' },
        ],
        rows: periods.map((r) => ({ ...r, period: r.k })),
        totals: { period: 'Total', count: t.count, received: t.received, refunds: t.refunds, net: t.net },
      },
    ],
    notes: ['Payments are dated by when they were received, whatever the date of the sale. Refunds come from sales returns.'],
  }
}

// --- Receivables and aging (as of today) ---

const AGING = [
  { key: 'none', label: 'No due date' },
  { key: 'current', label: 'Not yet due' },
  { key: '1-30', label: '1–30 days overdue' },
  { key: '31-60', label: '31–60 days overdue' },
  { key: '61-90', label: '61–90 days overdue' },
  { key: '90+', label: 'Over 90 days overdue' },
]

async function receivablesReport(ctx: Ctx): Promise<Report> {
  const { db, storeId, today } = ctx
  const overdueDays = `CASE WHEN s.due_date IS NOT NULL AND s.due_date < ?1
    THEN CAST(julianday(?1) - julianday(s.due_date) AS INTEGER) ELSE 0 END`
  const bucket = `CASE WHEN s.due_date IS NULL THEN 'none' WHEN s.due_date >= ?1 THEN 'current'
    WHEN julianday(?1) - julianday(s.due_date) <= 30 THEN '1-30'
    WHEN julianday(?1) - julianday(s.due_date) <= 60 THEN '31-60'
    WHEN julianday(?1) - julianday(s.due_date) <= 90 THEN '61-90' ELSE '90+' END`
  const open = `s.store_id = ?2 AND ${DUE_SQL} > 0`
  const [invoices, aging, byCustomer] = await db.batch<Row>([
    db
      .prepare(
        `SELECT s.id, 'INV-' || printf('%05d', s.id) AS reference, s.customer_name AS customer, s.sale_date, s.due_date,
           s.total_cents - s.returned_cents AS total, s.paid_cents AS paid, ${DUE_SQL} AS balance, ${overdueDays} AS overdue_days
         FROM sales s WHERE ${open}
         ORDER BY overdue_days DESC, s.due_date IS NULL, s.due_date, s.id LIMIT ${ROW_LIMIT + 1}`,
      )
      .bind(today, storeId),
    db
      .prepare(`SELECT ${bucket} AS bucket, COUNT(*) AS count, SUM(${DUE_SQL}) AS balance FROM sales s WHERE ${open} GROUP BY bucket`)
      .bind(today, storeId),
    db
      .prepare(
        `SELECT COALESCE(s.customer_id, 0) AS cid,
           CASE WHEN s.customer_id IS NULL THEN ?3 ELSE MAX(s.customer_name) END AS customer,
           COUNT(*) AS count, SUM(${DUE_SQL}) AS balance,
           COALESCE(SUM(CASE WHEN s.due_date < ?1 THEN ${DUE_SQL} END), 0) AS overdue,
           MIN(s.due_date) AS oldest_due
         FROM sales s WHERE ${open} GROUP BY cid ORDER BY balance DESC`,
      )
      .bind(today, storeId, WALK_IN_CUSTOMER),
  ])
  const agingRows = aging!.results
  const byBucket = new Map(agingRows.map((r) => [r.bucket, r]))
  const total = sum(agingRows, 'balance')
  const count = sum(agingRows, 'count')
  const overdueRows = agingRows.filter((r) => !['none', 'current'].includes(String(r.bucket)))
  const overdue = sum(overdueRows, 'balance')

  return {
    tiles: [
      { label: 'Total receivable', value: total, format: 'money', icon: 'file-invoice', tone: 'primary' },
      { label: 'Open invoices', value: count, format: 'count', icon: 'files', tone: 'info' },
      { label: 'Overdue', value: overdue, format: 'money', icon: 'alert-triangle', tone: 'danger', hint: `${share(overdue, total) ?? 0}% of receivables` },
      { label: 'Overdue invoices', value: sum(overdueRows, 'count'), format: 'count', icon: 'clock-exclamation', tone: 'warning' },
    ],
    breakdowns: [
      {
        title: 'Aging',
        format: 'money',
        items: AGING.map((a) => {
          const row = byBucket.get(a.key)
          const n = Number(row?.count ?? 0)
          return { label: a.label, value: Number(row?.balance ?? 0), hint: `${n} ${n === 1 ? 'invoice' : 'invoices'}` }
        }),
      },
    ],
    tables: [
      {
        title: 'Balance by customer',
        columns: [
          { key: 'customer', label: 'Customer' },
          { key: 'count', label: 'Invoices', format: 'count' },
          { key: 'overdue', label: 'Overdue', format: 'money' },
          { key: 'oldest_due', label: 'Oldest due date', format: 'date' },
          { key: 'balance', label: 'Balance', format: 'money' },
        ],
        ...limitRows(byCustomer!.results),
        totals: { customer: 'Total', count, overdue, balance: total },
      },
      {
        title: 'Open invoices',
        columns: [
          { key: 'reference', label: 'Invoice' },
          { key: 'customer', label: 'Customer' },
          { key: 'sale_date', label: 'Date', format: 'date' },
          { key: 'due_date', label: 'Due date', format: 'date' },
          { key: 'overdue_days', label: 'Days overdue', format: 'count' },
          { key: 'total', label: 'Total', format: 'money' },
          { key: 'paid', label: 'Paid', format: 'money' },
          { key: 'balance', label: 'Balance', format: 'money' },
        ],
        ...limitRows(invoices!.results),
        link: { route: 'sale-detail', idKey: 'id' },
      },
    ],
    notes: ['As of today, for every sale with a balance still owed, whatever its date.'],
  }
}

// --- Profit and loss ---

async function profitLossReport(ctx: Ctx): Promise<Report> {
  const { db, storeId, from, to } = ctx
  const k = bucketSql('s.sale_date', ctx.granularity)
  const [lines, sales] = await db.batch<Row>([
    db
      .prepare(
        `SELECT ${k} AS k, SUM(si.total_cents) AS gross, SUM(${LINE_NET_SQL}) AS lines, SUM(${LINE_COST_SQL}) AS cost,
           ${MISSING_COST_SQL} AS missing
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.store_id = ? AND s.sale_date BETWEEN ? AND ? GROUP BY k`,
      )
      .bind(storeId, from, to),
    db
      .prepare(
        `SELECT ${k} AS k, SUM(s.discount_cents) AS discount, SUM(s.tax_cents) AS tax
         FROM sales s WHERE s.store_id = ? AND s.sale_date BETWEEN ? AND ? GROUP BY k`,
      )
      .bind(storeId, from, to),
  ])
  const salesByKey = new Map(sales!.results.map((r) => [r.k, r]))
  const periods = lines!.results
    .map((r) => {
      const s = salesByKey.get(r.k)
      const discount = Number(s?.discount ?? 0)
      // Before tax: tax collected isn't the store's income
      const netSales = Math.max(0, Number(r.lines) - discount)
      const cost = Number(r.cost)
      return {
        period: String(r.k),
        gross: Number(r.gross),
        returns: Number(r.gross) - Number(r.lines),
        discount,
        netSales,
        cost,
        profit: netSales - cost,
        margin: margin(netSales - cost, netSales),
        tax: Number(s?.tax ?? 0),
        missing: Number(r.missing),
      }
    })
    .sort((a, b) => a.period.localeCompare(b.period))

  const total = (key: keyof (typeof periods)[number]) => periods.reduce((acc, p) => acc + Number(p[key]), 0)
  const gross = total('gross')
  const returns = total('returns')
  const discount = total('discount')
  const netSales = total('netSales')
  const cost = total('cost')
  const profit = netSales - cost
  const missing = total('missing')
  const pct = (value: number) => share(value, netSales)

  const notes = [
    `Tax collected (${formatPlain(total('tax'))}) is owed to the government, so it isn't counted as income.`,
    'Operating expenses (rent, wages, utilities) aren’t recorded in the app, so this stops at gross profit.',
  ]
  if (missing > 0) {
    notes.push(`${missing} sold ${missing === 1 ? 'line has' : 'lines have'} no cost price and ${missing === 1 ? 'is' : 'are'} counted as free, so profit may be overstated.`)
  }

  return {
    tiles: [
      { label: 'Net sales', value: netSales, format: 'money', icon: 'receipt', tone: 'primary', hint: 'After returns and discounts, before tax' },
      { label: 'Cost of goods sold', value: cost, format: 'money', icon: 'coins', tone: 'warning' },
      { label: 'Gross profit', value: profit, format: 'money', icon: 'trending-up', tone: profit < 0 ? 'danger' : 'success' },
      { label: 'Gross margin', value: margin(profit, netSales), format: 'percent', icon: 'percentage', tone: 'info' },
    ],
    chart: fillChart(
      ctx,
      { title: 'Gross profit', format: 'money' },
      periods.map((p) => ({ k: p.period, value: p.profit })),
    ),
    breakdowns: [],
    tables: [
      {
        title: 'Statement',
        columns: [
          { key: 'item', label: 'Item' },
          { key: 'amount', label: 'Amount', format: 'money' },
          { key: 'share', label: '% of net sales', format: 'percent' },
        ],
        rows: [
          { item: 'Gross sales', amount: gross, share: pct(gross) },
          { item: 'Less: returns', amount: -returns, share: pct(-returns) },
          { item: 'Less: discounts', amount: -discount, share: pct(-discount) },
          { item: 'Net sales', amount: netSales, share: pct(netSales) },
          { item: 'Less: cost of goods sold', amount: -cost, share: pct(-cost) },
        ],
        totals: { item: 'Gross profit', amount: profit, share: pct(profit) },
      },
      {
        title: ctx.granularity === 'day' ? 'Profit by day' : 'Profit by month',
        columns: [
          periodColumn(ctx),
          { key: 'netSales', label: 'Net sales', format: 'money' },
          { key: 'cost', label: 'Cost', format: 'money' },
          { key: 'profit', label: 'Gross profit', format: 'money' },
          { key: 'margin', label: 'Margin', format: 'percent' },
        ],
        rows: periods,
        totals: { period: 'Total', netSales, cost, profit, margin: margin(profit, netSales) },
      },
    ],
    notes,
  }
}

/** 12345 -> "123.45", for notes (the browser formats every other amount in the store's currency) */
const formatPlain = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// --- Inventory valuation (current stock) ---

async function inventoryReport(ctx: Ctx): Promise<Report> {
  const { db, storeId, canCost } = ctx
  const stock = ctx.url.searchParams.get('stock')
  const rows = await all(
    db
      .prepare(
        `SELECT p.name, p.sku, COALESCE(c.name, 'Uncategorised') AS category, u.short_name AS unit,
           p.quantity, p.alert_quantity, p.cost_cents AS cost, p.price_cents AS price,
           CASE WHEN p.quantity > 0 THEN ROUND(p.quantity * COALESCE(p.cost_cents, 0)) ELSE 0 END AS cost_value,
           CASE WHEN p.quantity > 0 THEN ROUND(p.quantity * p.price_cents) ELSE 0 END AS retail_value
         FROM products p
         JOIN units u ON u.id = p.unit_id
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.store_id = ? AND p.status = 'active'
         ORDER BY p.name`,
      )
      .bind(storeId),
  )
  for (const r of rows) {
    const quantity = Number(r.quantity)
    r.quantity = roundQuantity(quantity)
    r.status = quantity <= 0 ? 'Out of stock' : quantity <= Number(r.alert_quantity) ? 'Low stock' : 'In stock'
  }
  const low = rows.filter((r) => r.status === 'Low stock').length
  const out = rows.filter((r) => r.status === 'Out of stock').length
  const costValue = sum(rows, 'cost_value')
  const retailValue = sum(rows, 'retail_value')
  const missing = rows.filter((r) => Number(r.quantity) > 0 && r.cost === null).length

  const categories = new Map<string, { category: string; products: number; cost_value: number; retail_value: number }>()
  for (const r of rows) {
    const key = String(r.category)
    const entry = categories.get(key) ?? { category: key, products: 0, cost_value: 0, retail_value: 0 }
    entry.products += 1
    entry.cost_value += Number(r.cost_value)
    entry.retail_value += Number(r.retail_value)
    categories.set(key, entry)
  }
  const byCategory = [...categories.values()].sort((a, b) => b.retail_value - a.retail_value)

  const listed = rows.filter((r) =>
    stock === 'in' ? r.status === 'In stock' : stock === 'low' ? r.status === 'Low stock' : stock === 'out' ? r.status === 'Out of stock' : true,
  )

  const tiles: Tile[] = [
    { label: 'Active products', value: rows.length, format: 'count', icon: 'box', tone: 'info' },
    { label: 'Retail value', value: retailValue, format: 'money', icon: 'tag', tone: 'primary', hint: 'Stock on hand at selling price' },
  ]
  if (canCost) {
    tiles.push(
      { label: 'Cost value', value: costValue, format: 'money', icon: 'coins', tone: 'warning', hint: 'Stock on hand at cost' },
      { label: 'Potential profit', value: retailValue - costValue, format: 'money', icon: 'trending-up', tone: 'success' },
    )
  }
  tiles.push(
    { label: 'Low stock', value: low, format: 'count', icon: 'trending-down', tone: 'warning' },
    { label: 'Out of stock', value: out, format: 'count', icon: 'alert-circle', tone: 'danger' },
  )

  const categoryColumns: Column[] = [
    { key: 'category', label: 'Category' },
    { key: 'products', label: 'Products', format: 'count' },
    ...(canCost ? [{ key: 'cost_value', label: 'Cost value', format: 'money' } as Column] : []),
    { key: 'retail_value', label: 'Retail value', format: 'money' },
  ]
  const productColumns: Column[] = [
    { key: 'name', label: 'Product' },
    { key: 'sku', label: 'SKU' },
    { key: 'category', label: 'Category' },
    { key: 'quantity', label: 'Stock', format: 'qty' },
    { key: 'unit', label: 'Unit' },
    { key: 'status', label: 'Status' },
    ...(canCost ? [{ key: 'cost', label: 'Cost', format: 'money' } as Column] : []),
    { key: 'price', label: 'Price', format: 'money' },
    ...(canCost ? [{ key: 'cost_value', label: 'Cost value', format: 'money' } as Column] : []),
    { key: 'retail_value', label: 'Retail value', format: 'money' },
  ]
  const listedTotals: Row = { name: 'Total', retail_value: sum(listed, 'retail_value') }
  if (canCost) listedTotals.cost_value = sum(listed, 'cost_value')
  const productRows = canCost ? listed : listed.map(({ cost: _cost, cost_value: _value, ...r }) => r)

  const notes = ['Active products only. Values count stock on hand; products at zero or below add nothing.']
  if (canCost && missing > 0) {
    notes.push(`${missing} ${missing === 1 ? 'product' : 'products'} in stock ${missing === 1 ? 'has' : 'have'} no cost price, so the cost value is understated.`)
  }

  return {
    tiles,
    breakdowns: [
      {
        title: 'Retail value by category',
        format: 'money',
        items: byCategory.slice(0, TOP_LIMIT).map((c) => ({ label: c.category, value: c.retail_value, hint: `${c.products} ${c.products === 1 ? 'product' : 'products'}` })),
      },
    ],
    tables: [
      {
        title: 'By category',
        columns: categoryColumns,
        rows: canCost ? byCategory : byCategory.map(({ cost_value: _value, ...c }) => c),
        totals: { category: 'Total', products: rows.length, retail_value: retailValue, ...(canCost ? { cost_value: costValue } : {}) },
      },
      { title: 'Products', columns: productColumns, ...limitRows(productRows), totals: listedTotals },
    ],
    notes,
  }
}

// --- Stock movement ---

async function stockMovementReport(ctx: Ctx): Promise<Report> {
  const { db, storeId } = ctx
  const fromTs = utcStartOf(ctx.from, ctx.tzOffset)
  const toTs = utcStartOf(addDays(ctx.to, 1), ctx.tzOffset) // exclusive
  const where = 'a.store_id = ? AND a.created_at >= ? AND a.created_at < ?'
  const [byReason, byProduct] = await db.batch<Row>([
    db
      .prepare(
        `SELECT a.reason, COUNT(*) AS count, COUNT(CASE WHEN a.quantity_change > 0 THEN 1 END) AS increases,
           COUNT(CASE WHEN a.quantity_change < 0 THEN 1 END) AS decreases
         FROM stock_adjustments a WHERE ${where} GROUP BY a.reason ORDER BY count DESC`,
      )
      .bind(storeId, fromTs, toTs),
    db
      .prepare(
        `SELECT MAX(COALESCE(p.name, a.product_name)) AS name, MAX(COALESCE(p.sku, a.product_sku)) AS sku,
           MAX(a.unit_short_name) AS unit, COUNT(*) AS count,
           COALESCE(SUM(CASE WHEN a.quantity_change > 0 THEN a.quantity_change END), 0) AS qty_in,
           COALESCE(SUM(CASE WHEN a.quantity_change < 0 THEN -a.quantity_change END), 0) AS qty_out,
           SUM(a.quantity_change) AS net, MAX(p.quantity) AS on_hand
         FROM stock_adjustments a LEFT JOIN products p ON p.id = a.product_id
         WHERE ${where}
         GROUP BY COALESCE(CAST(a.product_id AS TEXT), 'sku:' || a.product_sku)
         ORDER BY count DESC, name`,
      )
      .bind(storeId, fromTs, toTs),
  ])
  const reasons = byReason!.results
  const products = byProduct!.results.map((r) => ({
    ...r,
    qty_in: roundQuantity(Number(r.qty_in)),
    qty_out: roundQuantity(Number(r.qty_out)),
    net: roundQuantity(Number(r.net)),
    on_hand: r.on_hand === null ? null : roundQuantity(Number(r.on_hand)),
  }))
  const count = sum(reasons, 'count')

  return {
    tiles: [
      { label: 'Movements', value: count, format: 'count', icon: 'arrows-exchange', tone: 'primary' },
      { label: 'Products affected', value: products.length, format: 'count', icon: 'box', tone: 'info' },
      { label: 'Stock in', value: sum(reasons, 'increases'), format: 'count', icon: 'arrow-down-circle', tone: 'success', hint: 'Movements that added stock' },
      { label: 'Stock out', value: sum(reasons, 'decreases'), format: 'count', icon: 'arrow-up-circle', tone: 'danger', hint: 'Movements that removed stock' },
    ],
    breakdowns: [
      {
        title: 'Movements by reason',
        format: 'count',
        labelFormat: 'stockReason',
        items: reasons.map((r) => ({ label: String(r.reason), value: Number(r.count) })),
      },
    ],
    tables: [
      {
        title: 'By reason',
        columns: [
          { key: 'reason', label: 'Reason', format: 'stockReason' },
          { key: 'count', label: 'Movements', format: 'count' },
          { key: 'increases', label: 'Added stock', format: 'count' },
          { key: 'decreases', label: 'Removed stock', format: 'count' },
        ],
        rows: reasons,
        totals: { reason: 'Total', count, increases: sum(reasons, 'increases'), decreases: sum(reasons, 'decreases') },
      },
      {
        title: 'By product',
        columns: [
          { key: 'name', label: 'Product' },
          { key: 'sku', label: 'SKU' },
          { key: 'count', label: 'Movements', format: 'count' },
          { key: 'qty_in', label: 'In', format: 'qty' },
          { key: 'qty_out', label: 'Out', format: 'qty' },
          { key: 'net', label: 'Net change', format: 'qty' },
          { key: 'on_hand', label: 'On hand now', format: 'qty' },
          { key: 'unit', label: 'Unit' },
        ],
        ...limitRows(products),
      },
    ],
    notes: ['Every change to stock: sales, returns put back in stock, and manual adjustments.'],
  }
}

// --- Sales returns ---

async function returnsReport(ctx: Ctx): Promise<Report> {
  const { db, storeId, from, to } = ctx
  const where = 'r.store_id = ? AND r.return_date BETWEEN ? AND ?'
  const [totals, sales, byReason, byProduct] = await db.batch<Row>([
    db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(r.total_cents), 0) AS value, COALESCE(SUM(r.refund_cents), 0) AS refunds,
           COALESCE(SUM(r.restock), 0) AS restocked
         FROM sales_returns r WHERE ${where}`,
      )
      .bind(storeId, from, to),
    db
      .prepare('SELECT COALESCE(SUM(total_cents), 0) AS total FROM sales WHERE store_id = ? AND sale_date BETWEEN ? AND ?')
      .bind(storeId, from, to),
    db
      .prepare(
        `SELECT r.reason, COUNT(*) AS count, SUM(r.total_cents) AS value, SUM(r.refund_cents) AS refunds
         FROM sales_returns r WHERE ${where} GROUP BY r.reason ORDER BY value DESC`,
      )
      .bind(storeId, from, to),
    db
      .prepare(
        `SELECT MAX(ri.product_name) AS name, MAX(ri.product_sku) AS sku, MAX(ri.unit_short_name) AS unit,
           COUNT(DISTINCT r.id) AS count, SUM(ri.quantity) AS quantity, SUM(ri.total_cents) AS value
         FROM sales_return_items ri JOIN sales_returns r ON r.id = ri.return_id
         WHERE ${where}
         GROUP BY COALESCE(CAST(ri.product_id AS TEXT), 'sku:' || ri.product_sku)
         ORDER BY value DESC, name`,
      )
      .bind(storeId, from, to),
  ])
  const t = totals!.results[0]! as Record<string, number>
  const salesTotal = Number(sales!.results[0]!.total)
  const reasons = byReason!.results
  const products = byProduct!.results.map((r) => ({ ...r, quantity: roundQuantity(Number(r.quantity)) }))

  return {
    tiles: [
      { label: 'Returns', value: t.count, format: 'count', icon: 'receipt-refund', tone: 'info' },
      { label: 'Value returned', value: t.value, format: 'money', icon: 'arrow-back-up', tone: 'danger' },
      { label: 'Refunded', value: t.refunds, format: 'money', icon: 'cash', tone: 'warning', hint: 'Money given back' },
      { label: 'Put back in stock', value: t.restocked, format: 'count', icon: 'package-import', tone: 'success', hint: `of ${t.count} returns` },
      { label: 'Return rate', value: share(t.value, salesTotal), format: 'percent', icon: 'percentage', tone: 'primary', hint: 'Value returned ÷ sales in the period' },
    ],
    breakdowns: [
      {
        title: 'Value by reason',
        format: 'money',
        labelFormat: 'returnReason',
        items: reasons.map((r) => ({ label: String(r.reason), value: Number(r.value), hint: `${r.count} ${r.count === 1 ? 'return' : 'returns'}` })),
      },
    ],
    tables: [
      {
        title: 'By reason',
        columns: [
          { key: 'reason', label: 'Reason', format: 'returnReason' },
          { key: 'count', label: 'Returns', format: 'count' },
          { key: 'value', label: 'Value', format: 'money' },
          { key: 'refunds', label: 'Refunded', format: 'money' },
        ],
        rows: reasons,
        totals: { reason: 'Total', count: t.count, value: t.value, refunds: t.refunds },
      },
      {
        title: 'By product',
        columns: [
          { key: 'name', label: 'Product' },
          { key: 'sku', label: 'SKU' },
          { key: 'count', label: 'Returns', format: 'count' },
          { key: 'quantity', label: 'Quantity', format: 'qty' },
          { key: 'unit', label: 'Unit' },
          { key: 'value', label: 'Value', format: 'money' },
        ],
        ...limitRows(products),
        totals: { name: 'Total', value: sum(products, 'value') },
      },
    ],
    notes: ['Returns are dated by when the goods came back.'],
  }
}

// --- Tax ---

async function taxReport(ctx: Ctx): Promise<Report> {
  const { db, storeId, from, to } = ctx
  const where = 's.store_id = ? AND s.sale_date BETWEEN ? AND ?'
  const k = bucketSql('s.sale_date', ctx.granularity)
  const amounts = `COUNT(CASE WHEN s.tax_cents > 0 THEN 1 END) AS taxed_count,
    COALESCE(SUM(CASE WHEN s.tax_rate_bp > 0 THEN s.subtotal_cents - s.discount_cents END), 0) AS taxable,
    COALESCE(SUM(s.tax_cents), 0) AS tax,
    COALESCE(SUM(CASE WHEN s.tax_rate_bp = 0 THEN s.total_cents END), 0) AS untaxed,
    COALESCE(SUM(s.total_cents), 0) AS total`
  const [totals, byPeriod, byRate] = await db.batch<Row>([
    db.prepare(`SELECT ${amounts} FROM sales s WHERE ${where}`).bind(storeId, from, to),
    db.prepare(`SELECT ${k} AS k, ${amounts} FROM sales s WHERE ${where} GROUP BY k ORDER BY k`).bind(storeId, from, to),
    db
      .prepare(
        `SELECT s.tax_rate_bp / 100.0 AS rate, COUNT(*) AS count, SUM(s.subtotal_cents - s.discount_cents) AS base,
           SUM(s.tax_cents) AS tax, SUM(s.total_cents) AS total
         FROM sales s WHERE ${where} GROUP BY s.tax_rate_bp ORDER BY s.tax_rate_bp DESC`,
      )
      .bind(storeId, from, to),
  ])
  const t = totals!.results[0]! as Record<string, number>
  const periods = byPeriod!.results
  const rates = byRate!.results

  return {
    tiles: [
      { label: 'Tax collected', value: t.tax, format: 'money', icon: 'receipt-tax', tone: 'primary' },
      { label: 'Taxable sales', value: t.taxable, format: 'money', icon: 'file-dollar', tone: 'info', hint: 'Before tax, after discounts' },
      { label: 'Non-taxed sales', value: t.untaxed, format: 'money', icon: 'file-off', tone: 'warning', hint: 'Sales at 0% tax' },
      { label: 'Taxed sales', value: t.taxed_count, format: 'count', icon: 'receipt', tone: 'success' },
    ],
    chart: fillChart(
      ctx,
      { title: 'Tax collected', format: 'money', countLabel: 'taxed sales' },
      periods.map((r) => ({ k: String(r.k), value: Number(r.tax), count: Number(r.taxed_count) })),
    ),
    breakdowns: [],
    tables: [
      {
        title: 'By tax rate',
        columns: [
          { key: 'rate', label: 'Rate', format: 'percent' },
          { key: 'count', label: 'Sales', format: 'count' },
          { key: 'base', label: 'Taxable base', format: 'money' },
          { key: 'tax', label: 'Tax', format: 'money' },
          { key: 'total', label: 'Total', format: 'money' },
        ],
        rows: rates,
        totals: { rate: 'Total', count: sum(rates, 'count'), base: sum(rates, 'base'), tax: t.tax, total: t.total },
      },
      {
        title: ctx.granularity === 'day' ? 'Tax by day' : 'Tax by month',
        columns: [
          periodColumn(ctx),
          { key: 'taxed_count', label: 'Taxed sales', format: 'count' },
          { key: 'taxable', label: 'Taxable sales', format: 'money' },
          { key: 'tax', label: 'Tax', format: 'money' },
          { key: 'untaxed', label: 'Non-taxed sales', format: 'money' },
          { key: 'total', label: 'Total', format: 'money' },
        ],
        rows: periods.map((r) => ({ ...r, period: r.k })),
        totals: { period: 'Total', taxed_count: t.taxed_count, taxable: t.taxable, tax: t.tax, untaxed: t.untaxed, total: t.total },
      },
    ],
    notes: ['Amounts are as invoiced; sales returns are not deducted here.'],
  }
}

// --- Quotations ---

async function quotationsReport(ctx: Ctx): Promise<Report> {
  const { db, storeId, from, to, today } = ctx
  const status = `CASE WHEN q.status IN ('draft', 'sent') AND q.valid_until < ?1 THEN 'expired' ELSE q.status END`
  const where = 'q.store_id = ?2 AND q.quote_date BETWEEN ?3 AND ?4'
  const [byStatus, byUser] = await db.batch<Row>([
    db
      .prepare(`SELECT ${status} AS status, COUNT(*) AS count, SUM(q.total_cents) AS value FROM quotations q WHERE ${where} GROUP BY 1 ORDER BY count DESC`)
      .bind(today, storeId, from, to),
    db
      .prepare(
        `SELECT q.user_name AS name, COUNT(*) AS count, SUM(q.total_cents) AS value,
           COUNT(CASE WHEN q.status = 'converted' THEN 1 END) AS converted,
           COALESCE(SUM(CASE WHEN q.status = 'converted' THEN q.total_cents END), 0) AS converted_value
         FROM quotations q WHERE q.store_id = ? AND q.quote_date BETWEEN ? AND ? GROUP BY q.user_name ORDER BY value DESC`,
      )
      .bind(storeId, from, to),
  ])
  const statuses = byStatus!.results
  const users = byUser!.results.map((r) => ({ ...r, rate: share(Number(r.converted), Number(r.count)) }))
  const count = sum(statuses, 'count')
  const value = sum(statuses, 'value')
  const converted = statuses.find((s) => s.status === 'converted')

  return {
    tiles: [
      { label: 'Quotations', value: count, format: 'count', icon: 'file-description', tone: 'info' },
      { label: 'Quoted value', value, format: 'money', icon: 'currency-dollar', tone: 'primary' },
      { label: 'Converted to sales', value: Number(converted?.value ?? 0), format: 'money', icon: 'circle-check', tone: 'success', hint: `${converted?.count ?? 0} quotations` },
      { label: 'Conversion rate', value: share(Number(converted?.count ?? 0), count), format: 'percent', icon: 'percentage', tone: 'warning' },
    ],
    breakdowns: [
      {
        title: 'Value by status',
        format: 'money',
        labelFormat: 'quoteStatus',
        items: statuses.map((s) => ({ label: String(s.status), value: Number(s.value), hint: `${s.count} ${s.count === 1 ? 'quotation' : 'quotations'}` })),
      },
    ],
    tables: [
      {
        title: 'By status',
        columns: [
          { key: 'status', label: 'Status', format: 'quoteStatus' },
          { key: 'count', label: 'Quotations', format: 'count' },
          { key: 'value', label: 'Value', format: 'money' },
          { key: 'share', label: 'Share', format: 'percent' },
        ],
        rows: statuses.map((s) => ({ ...s, share: share(Number(s.count), count) })),
        totals: { status: 'Total', count, value, share: count ? 100 : null },
      },
      {
        title: 'By user',
        columns: [
          { key: 'name', label: 'Prepared by' },
          { key: 'count', label: 'Quotations', format: 'count' },
          { key: 'value', label: 'Value', format: 'money' },
          { key: 'converted', label: 'Converted', format: 'count' },
          { key: 'converted_value', label: 'Converted value', format: 'money' },
          { key: 'rate', label: 'Conversion', format: 'percent' },
        ],
        rows: users,
      },
    ],
    notes: ['Draft and sent quotations past their "valid until" date count as expired.'],
  }
}

// --- Routing ---

const REPORTS: Record<string, { load: (ctx: Ctx) => Promise<Report>; dated: boolean; permission?: Permission }> = {
  sales: { load: salesReport, dated: true },
  'product-sales': { load: productSalesReport, dated: true },
  customers: { load: customerReport, dated: true },
  payments: { load: paymentsReport, dated: true },
  receivables: { load: receivablesReport, dated: false },
  'profit-loss': { load: profitLossReport, dated: true, permission: 'products.manage' },
  inventory: { load: inventoryReport, dated: false },
  'stock-movement': { load: stockMovementReport, dated: true },
  returns: { load: returnsReport, dated: true },
  tax: { load: taxReport, dated: true },
  quotations: { load: quotationsReport, dated: true },
}

/** Handles /api/reports/*. */
export async function handleReports(db: D1Database, request: Request, url: URL, user: SessionUser): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/reports\/([a-z-]+)$/)
  if (!match) return null
  if (request.method !== 'GET') return error('Method not allowed', 405)

  const report = REPORTS[match[1]!]
  if (!report) return error('Report not found', 404)
  if (!can(user, 'reports.view')) return error("You don't have permission to view reports", 403)
  if (report.permission && !can(user, report.permission)) return error("You don't have permission to view this report", 403)

  const todayParam = url.searchParams.get('today')
  const today = isDate(todayParam) ? todayParam : utcToday()
  const offset = Number(url.searchParams.get('tzOffset') ?? 0)
  const tzOffset = Number.isInteger(offset) && Math.abs(offset) <= 14 * 60 ? offset : 0

  let from = today
  let to = today
  if (report.dated) {
    const fromParam = url.searchParams.get('from')
    const toParam = url.searchParams.get('to')
    if (!isDate(fromParam) || !isDate(toParam)) return error('Choose the dates for the report', 400)
    if (toParam < fromParam) return error('The end date is before the start date', 400)
    if (daysBetween(fromParam, toParam) > MAX_RANGE_DAYS) return error('Choose a range of ten years or less', 400)
    from = fromParam
    to = toParam
  }

  const data = await report.load({
    db,
    url,
    storeId: user.store_id,
    from,
    to,
    today,
    tzOffset,
    granularity: daysBetween(from, to) < DAILY_UP_TO_DAYS ? 'day' : 'month',
    canCost: can(user, 'products.manage'),
  })
  return Response.json(data)
}
