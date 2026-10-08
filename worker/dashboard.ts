// The dashboard: a list of widgets per user, and the numbers each widget shows.
// Every user can add, remove and reorder their own widgets unless an admin has locked
// their dashboard; admins can set any user's widgets from the Users page. Widgets that
// show cost prices need products.manage, like the rest of the app.
//
//   GET /api/dashboard/layout                                 -> layout
//   PUT /api/dashboard/layout   { widgets: string[] | null }   -> layout   (null: back to the default)
//   GET /api/dashboard/widgets/:key?today=YYYY-MM-DD&days=7|30  -> that widget's data
//   GET /api/users/:id/dashboard                               -> layout + available   (admins only)
//   PUT /api/users/:id/dashboard  { widgets: string[] | null, locked } -> layout + available
//
// `today` is the browser's local date, since sales are dated in the store's local time.
// Keep WIDGETS in step with src/views/dashboard/widgets.ts, which has the titles.

import { error, isDate, positiveId, utcToday } from './documents'
import { parsePermissions, PERMISSIONS, type Permission } from './permissions'
import type { SessionUser } from './session'

const WIDGETS: { key: string; permission?: Permission }[] = [
  { key: 'quick-actions' },
  { key: 'sales-overview' },
  { key: 'sales-trend' },
  { key: 'payment-methods' },
  { key: 'profit', permission: 'products.manage' },
  { key: 'inventory-value', permission: 'products.manage' },
  { key: 'top-products' },
  { key: 'top-customers' },
  { key: 'recent-sales' },
  { key: 'receivables' },
  { key: 'low-stock' },
  { key: 'expiring' },
  { key: 'quotations' },
]

const LIST_LIMIT = 6
const TREND_DAYS = new Set([7, 30])
const EXPIRING_SOON_DAYS = 30

/** Widget keys a user with these permissions may see, in the default order */
const availableWidgets = (permissions: ReadonlySet<Permission>) =>
  WIDGETS.filter((w) => !w.permission || permissions.has(w.permission)).map((w) => w.key)

/** The stored JSON list, keeping only widgets that still exist and the role may see; null when unset */
function storedWidgets(json: string | null, available: string[]): string[] | null {
  if (json === null) return null
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value.filter((key): key is string => available.includes(key)) : null
  } catch {
    return null
  }
}

interface LayoutRow {
  dashboard_widgets: string | null
  dashboard_locked: number
  is_admin: number
  permissions: string
}

function layoutOf(row: LayoutRow) {
  const isAdmin = row.is_admin === 1
  const available = availableWidgets(new Set(isAdmin ? PERMISSIONS : parsePermissions(row.permissions)))
  const stored = storedWidgets(row.dashboard_widgets, available)
  return {
    widgets: stored ?? available,
    custom: stored !== null, // false: the default set for the role
    locked: !isAdmin && row.dashboard_locked === 1, // an admin can always change their own
    available,
  }
}

const LAYOUT_SELECT = `SELECT u.dashboard_widgets, u.dashboard_locked, r.is_admin, r.permissions
  FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.store_id = ?`

const readLayoutRow = (db: D1Database, userId: number, storeId: number) =>
  db.prepare(LAYOUT_SELECT).bind(userId, storeId).first<LayoutRow>()

/** A widgets list from a request body: null, or unique keys from `available`. Returns a message when invalid. */
function readWidgets(value: unknown, available: string[]): string[] | null | string {
  if (value === null) return null
  if (!Array.isArray(value)) return 'Widgets must be a list'
  const keys = new Set<string>()
  for (const key of value) {
    if (typeof key !== 'string' || !available.includes(key)) return 'One of the widgets is not available for this role'
    keys.add(key)
  }
  return [...keys]
}

async function saveWidgets(db: D1Database, userId: number, storeId: number, widgets: string[] | null, locked?: boolean) {
  await db
    .prepare(
      `UPDATE users SET dashboard_widgets = ?, dashboard_locked = COALESCE(?, dashboard_locked), updated_at = datetime('now')
       WHERE id = ? AND store_id = ?`,
    )
    .bind(widgets === null ? null : JSON.stringify(widgets), locked === undefined ? null : locked ? 1 : 0, userId, storeId)
    .run()
}

async function handleOwnLayout(db: D1Database, request: Request, user: SessionUser): Promise<Response> {
  const row = await readLayoutRow(db, user.id, user.store_id)
  if (!row) return error('User not found', 404)
  const layout = layoutOf(row)

  if (request.method === 'GET') return Response.json(layout)
  if (request.method !== 'PUT') return error('Method not allowed', 405)

  if (layout.locked) return error('Your dashboard is set by your admin', 403)
  const body = await request.json<{ widgets?: unknown }>().catch(() => null)
  const widgets = readWidgets(body?.widgets, layout.available)
  if (typeof widgets === 'string') return error(widgets, 400)

  await saveWidgets(db, user.id, user.store_id, widgets)
  const updated = await readLayoutRow(db, user.id, user.store_id)
  return updated ? Response.json(layoutOf(updated)) : error('User not found', 404)
}

/** Handles /api/users/:id/dashboard (admins only). */
export async function handleUserDashboard(
  db: D1Database,
  request: Request,
  userId: number,
  user: SessionUser,
): Promise<Response> {
  if (!user.is_admin) return error('Only admins can change other users’ dashboards', 403)
  const row = await readLayoutRow(db, userId, user.store_id)
  if (!row) return error('User not found', 404)

  if (request.method === 'GET') return Response.json(layoutOf(row))
  if (request.method !== 'PUT') return error('Method not allowed', 405)

  const body = await request.json<{ widgets?: unknown; locked?: unknown }>().catch(() => null)
  const widgets = readWidgets(body?.widgets, layoutOf(row).available)
  if (typeof widgets === 'string') return error(widgets, 400)
  if (typeof body?.locked !== 'boolean') return error('Locked must be true or false', 400)

  await saveWidgets(db, userId, user.store_id, widgets, body.locked)
  const updated = await readLayoutRow(db, userId, user.store_id)
  return updated ? Response.json(layoutOf(updated)) : error('User not found', 404)
}

// --- Widget data ---

/** '2026-10-08' plus 3 days -> '2026-10-11' (dates are calendar dates, so UTC is safe) */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The same stretch of last month: Oct 1-8 -> Sep 1-8 (Mar 1-31 -> Feb 1-28) */
function lastMonthRange(today: string): { from: string; to: string } {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number]
  const from = new Date(Date.UTC(year, month - 2, 1))
  const lastDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate()
  const to = new Date(Date.UTC(year, month - 2, Math.min(day, lastDay)))
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

/** Balance still owed on a sale, in SQL */
const DUE_SQL = '(s.total_cents - s.returned_cents - s.paid_cents)'
/** Value of a sale line after returns, in SQL */
const LINE_NET_SQL = 'ROUND(si.total_cents * (si.quantity - si.returned_quantity) / si.quantity)'

interface Range {
  storeId: number
  today: string
  monthStart: string
}

async function salesOverview(db: D1Database, { storeId, today, monthStart }: Range) {
  const yesterday = addDays(today, -1)
  const last = lastMonthRange(today)
  const [sales, collected, due] = await db.batch<Record<string, number>>([
    db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN sale_date = ?1 THEN total_cents - returned_cents END), 0) AS today_cents,
           COUNT(CASE WHEN sale_date = ?1 THEN 1 END) AS today_count,
           COALESCE(SUM(CASE WHEN sale_date = ?2 THEN total_cents - returned_cents END), 0) AS yesterday_cents,
           COALESCE(SUM(CASE WHEN sale_date >= ?3 THEN total_cents - returned_cents END), 0) AS month_cents,
           COUNT(CASE WHEN sale_date >= ?3 THEN 1 END) AS month_count,
           COALESCE(SUM(CASE WHEN sale_date BETWEEN ?4 AND ?5 THEN total_cents - returned_cents END), 0) AS last_month_cents
         FROM sales WHERE store_id = ?6 AND sale_date BETWEEN MIN(?2, ?4) AND ?1`,
      )
      .bind(today, yesterday, monthStart, last.from, last.to, storeId),
    db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM sale_payments
         WHERE store_id = ? AND paid_date BETWEEN ? AND ?`,
      )
      .bind(storeId, monthStart, today),
    db
      .prepare(
        `SELECT COALESCE(SUM(${DUE_SQL}), 0) AS cents, COUNT(*) AS count,
           COUNT(CASE WHEN s.due_date < ? THEN 1 END) AS overdue
         FROM sales s WHERE s.store_id = ? AND ${DUE_SQL} > 0`,
      )
      .bind(today, storeId),
  ])
  const s = sales!.results[0]!
  const c = collected!.results[0]!
  const d = due!.results[0]!
  return {
    today: { cents: s.today_cents, count: s.today_count, yesterdayCents: s.yesterday_cents },
    month: { cents: s.month_cents, count: s.month_count, lastMonthCents: s.last_month_cents },
    collectedCents: c.cents,
    receivable: { cents: d.cents, count: d.count, overdue: d.overdue },
  }
}

async function salesTrend(db: D1Database, { storeId, today }: Range, url: URL) {
  const requested = Number(url.searchParams.get('days'))
  const days = TREND_DAYS.has(requested) ? requested : 30
  const from = addDays(today, -(days - 1))
  const { results } = await db
    .prepare(
      `SELECT sale_date, SUM(total_cents - returned_cents) AS cents, COUNT(*) AS count
       FROM sales WHERE store_id = ? AND sale_date BETWEEN ? AND ? GROUP BY sale_date`,
    )
    .bind(storeId, from, today)
    .all<{ sale_date: string; cents: number; count: number }>()
  const byDate = new Map(results.map((r) => [r.sale_date, r]))
  // Every day appears, so days without sales show as gaps rather than disappearing
  const points = Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i)
    const row = byDate.get(date)
    return { date, cents: row?.cents ?? 0, count: row?.count ?? 0 }
  })
  return { days, points }
}

async function paymentMethods(db: D1Database, { storeId, today, monthStart }: Range) {
  // Refunds (negative payments from sales returns) are left out, so each bar is money received
  const { results } = await db
    .prepare(
      `SELECT method, SUM(amount_cents) AS cents, COUNT(*) AS count FROM sale_payments
       WHERE store_id = ? AND paid_date BETWEEN ? AND ? AND amount_cents > 0
       GROUP BY method ORDER BY cents DESC`,
    )
    .bind(storeId, monthStart, today)
    .all<{ method: string; cents: number; count: number }>()
  return { items: results }
}

async function profit(db: D1Database, { storeId, today, monthStart }: Range) {
  const [lines, discounts] = await db.batch<Record<string, number>>([
    db
      .prepare(
        `SELECT COALESCE(SUM(${LINE_NET_SQL}), 0) AS revenue,
           COALESCE(SUM(ROUND(COALESCE(si.cost_cents, 0) * (si.quantity - si.returned_quantity))), 0) AS cost,
           COUNT(CASE WHEN si.cost_cents IS NULL AND si.quantity > si.returned_quantity THEN 1 END) AS missing_cost
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.store_id = ? AND s.sale_date BETWEEN ? AND ?`,
      )
      .bind(storeId, monthStart, today),
    db
      .prepare(
        `SELECT COALESCE(SUM(discount_cents), 0) AS cents FROM sales
         WHERE store_id = ? AND sale_date BETWEEN ? AND ?`,
      )
      .bind(storeId, monthStart, today),
  ])
  const l = lines!.results[0]!
  const discountCents = discounts!.results[0]!.cents
  // Before tax: tax collected isn't the store's income
  const netSalesCents = Math.max(0, l.revenue - discountCents)
  return {
    netSalesCents,
    costCents: l.cost,
    profitCents: netSalesCents - l.cost,
    missingCost: l.missing_cost, // lines sold without a cost price, counted as free
  }
}

async function inventoryValue(db: D1Database, { storeId }: Range) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS products,
         COALESCE(SUM(CASE WHEN quantity > 0 THEN ROUND(quantity * COALESCE(cost_cents, 0)) END), 0) AS cost_cents,
         COALESCE(SUM(CASE WHEN quantity > 0 THEN ROUND(quantity * price_cents) END), 0) AS retail_cents,
         COUNT(CASE WHEN quantity > 0 AND cost_cents IS NULL THEN 1 END) AS missing_cost
       FROM products WHERE store_id = ? AND status = 'active'`,
    )
    .bind(storeId)
    .first<Record<string, number>>()
  return {
    products: row?.products ?? 0,
    costCents: row?.cost_cents ?? 0,
    retailCents: row?.retail_cents ?? 0,
    missingCost: row?.missing_cost ?? 0,
  }
}

async function topProducts(db: D1Database, { storeId, today, monthStart }: Range) {
  const { results } = await db
    .prepare(
      `SELECT si.product_id, si.product_name, si.product_sku, si.unit_short_name,
         SUM(si.quantity - si.returned_quantity) AS quantity, SUM(${LINE_NET_SQL}) AS cents
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.store_id = ? AND s.sale_date BETWEEN ? AND ?
       GROUP BY si.product_id, si.product_sku HAVING quantity > 0
       ORDER BY cents DESC, quantity DESC LIMIT ?`,
    )
    .bind(storeId, monthStart, today, LIST_LIMIT)
    .all<{ product_id: number | null; product_name: string; product_sku: string; unit_short_name: string; quantity: number; cents: number }>()
  return {
    items: results.map((r) => ({
      productId: r.product_id,
      name: r.product_name,
      sku: r.product_sku,
      unitShortName: r.unit_short_name,
      quantity: Math.round(r.quantity * 1000) / 1000,
      cents: r.cents,
    })),
  }
}

async function topCustomers(db: D1Database, { storeId, today, monthStart }: Range) {
  // Walk-in sales have no customer, so they're left out
  const { results } = await db
    .prepare(
      `SELECT customer_id, customer_name, COUNT(*) AS count, SUM(total_cents - returned_cents) AS cents
       FROM sales WHERE store_id = ? AND customer_id IS NOT NULL AND sale_date BETWEEN ? AND ?
       GROUP BY customer_id ORDER BY cents DESC LIMIT ?`,
    )
    .bind(storeId, monthStart, today, LIST_LIMIT)
    .all<{ customer_id: number; customer_name: string; count: number; cents: number }>()
  return { items: results.map((r) => ({ id: r.customer_id, name: r.customer_name, count: r.count, cents: r.cents })) }
}

interface SaleListRow {
  id: number
  customer_name: string
  sale_date: string
  due_date: string | null
  source: 'pos' | 'manual'
  total_cents: number
  due_cents: number
  paid_cents: number
}

const saleItem = (r: SaleListRow) => ({
  id: r.id,
  customerName: r.customer_name,
  saleDate: r.sale_date,
  dueDate: r.due_date,
  source: r.source,
  totalCents: r.total_cents,
  dueCents: r.due_cents,
  paidCents: r.paid_cents,
})

const SALE_LIST_COLUMNS = `s.id, s.customer_name, s.sale_date, s.due_date, s.source,
  s.total_cents - s.returned_cents AS total_cents, ${DUE_SQL} AS due_cents, s.paid_cents`

async function recentSales(db: D1Database, { storeId }: Range) {
  const { results } = await db
    .prepare(`SELECT ${SALE_LIST_COLUMNS} FROM sales s WHERE s.store_id = ? ORDER BY s.id DESC LIMIT ?`)
    .bind(storeId, LIST_LIMIT)
    .all<SaleListRow>()
  return { items: results.map(saleItem) }
}

async function receivables(db: D1Database, { storeId, today }: Range) {
  const [list, totals] = await db.batch([
    // Overdue first, then those due soonest; sales without a due date last
    db
      .prepare(
        `SELECT ${SALE_LIST_COLUMNS} FROM sales s WHERE s.store_id = ? AND ${DUE_SQL} > 0
         ORDER BY s.due_date IS NULL, s.due_date, s.id LIMIT ?`,
      )
      .bind(storeId, LIST_LIMIT),
    db
      .prepare(
        `SELECT COALESCE(SUM(${DUE_SQL}), 0) AS cents, COUNT(*) AS count,
           COUNT(CASE WHEN s.due_date < ? THEN 1 END) AS overdue
         FROM sales s WHERE s.store_id = ? AND ${DUE_SQL} > 0`,
      )
      .bind(today, storeId),
  ])
  const t = totals!.results[0] as { cents: number; count: number; overdue: number }
  return { items: (list!.results as SaleListRow[]).map(saleItem), ...t }
}

interface ProductListRow {
  id: number
  name: string
  sku: string
  quantity: number
  alert_quantity: number
  expiry_date: string | null
  unit_short_name: string
}

const productItem = (r: ProductListRow) => ({
  id: r.id,
  name: r.name,
  sku: r.sku,
  quantity: r.quantity,
  alertQuantity: r.alert_quantity,
  expiryDate: r.expiry_date,
  unitShortName: r.unit_short_name,
})

const PRODUCT_LIST_COLUMNS = `p.id, p.name, p.sku, p.quantity, p.alert_quantity, p.expiry_date, u.short_name AS unit_short_name`

async function lowStock(db: D1Database, { storeId }: Range) {
  // Same rules as the Low Stocks page: active products only; out of stock first
  const [list, totals] = await db.batch([
    db
      .prepare(
        `SELECT ${PRODUCT_LIST_COLUMNS} FROM products p JOIN units u ON u.id = p.unit_id
         WHERE p.store_id = ? AND p.status = 'active' AND p.quantity <= p.alert_quantity
         ORDER BY p.quantity > 0, p.quantity - p.alert_quantity, p.name LIMIT ?`,
      )
      .bind(storeId, LIST_LIMIT),
    db
      .prepare(
        `SELECT COUNT(CASE WHEN quantity > 0 AND quantity <= alert_quantity THEN 1 END) AS low,
           COUNT(CASE WHEN quantity <= 0 THEN 1 END) AS out
         FROM products WHERE store_id = ? AND status = 'active'`,
      )
      .bind(storeId),
  ])
  const t = totals!.results[0] as { low: number; out: number }
  return { items: (list!.results as ProductListRow[]).map(productItem), ...t }
}

async function expiring(db: D1Database, { storeId, today }: Range) {
  const soonUntil = addDays(today, EXPIRING_SOON_DAYS)
  const [list, totals] = await db.batch([
    db
      .prepare(
        `SELECT ${PRODUCT_LIST_COLUMNS} FROM products p JOIN units u ON u.id = p.unit_id
         WHERE p.store_id = ? AND p.expiry_date IS NOT NULL AND p.expiry_date <= ?
         ORDER BY p.expiry_date, p.name LIMIT ?`,
      )
      .bind(storeId, soonUntil, LIST_LIMIT),
    db
      .prepare(
        `SELECT COUNT(CASE WHEN expiry_date < ?1 THEN 1 END) AS expired,
           COUNT(CASE WHEN expiry_date >= ?1 AND expiry_date <= ?2 THEN 1 END) AS soon
         FROM products WHERE store_id = ?3 AND expiry_date IS NOT NULL`,
      )
      .bind(today, soonUntil, storeId),
  ])
  const t = totals!.results[0] as { expired: number; soon: number }
  return { items: (list!.results as ProductListRow[]).map(productItem), soonDays: EXPIRING_SOON_DAYS, ...t }
}

async function quotations(db: D1Database, { storeId, today }: Range) {
  // Open: draft or sent, and not past "valid until"
  const OPEN = "store_id = ? AND status IN ('draft', 'sent') AND (valid_until IS NULL OR valid_until >= ?)"
  const [list, totals] = await db.batch([
    db
      .prepare(
        `SELECT id, customer_name, quote_date, valid_until, status, total_cents FROM quotations
         WHERE ${OPEN} ORDER BY id DESC LIMIT ?`,
      )
      .bind(storeId, today, LIST_LIMIT),
    db
      .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS cents FROM quotations WHERE ${OPEN}`)
      .bind(storeId, today),
  ])
  type Row = { id: number; customer_name: string; quote_date: string; valid_until: string | null; status: string; total_cents: number }
  const t = totals!.results[0] as { count: number; cents: number }
  return {
    items: (list!.results as Row[]).map((r) => ({
      id: r.id,
      customerName: r.customer_name,
      quoteDate: r.quote_date,
      validUntil: r.valid_until,
      status: r.status,
      totalCents: r.total_cents,
    })),
    ...t,
  }
}

const LOADERS: Record<string, (db: D1Database, range: Range, url: URL) => Promise<unknown>> = {
  'quick-actions': async () => ({}), // links only; the browser decides which the user may use
  'sales-overview': salesOverview,
  'sales-trend': salesTrend,
  'payment-methods': paymentMethods,
  profit,
  'inventory-value': inventoryValue,
  'top-products': topProducts,
  'top-customers': topCustomers,
  'recent-sales': recentSales,
  receivables,
  'low-stock': lowStock,
  expiring,
  quotations,
}

async function widgetData(db: D1Database, url: URL, key: string, user: SessionUser): Promise<Response> {
  const widget = WIDGETS.find((w) => w.key === key)
  const load = LOADERS[key]
  if (!widget || !load) return error('Widget not found', 404)
  if (widget.permission && !user.permissions.has(widget.permission)) {
    return error("You don't have permission to see this widget", 403)
  }

  // A locked dashboard only shows what the admin picked
  const row = await readLayoutRow(db, user.id, user.store_id)
  if (!row) return error('User not found', 404)
  const layout = layoutOf(row)
  if (layout.locked && !layout.widgets.includes(key)) return error('This widget is not on your dashboard', 403)

  const todayParam = url.searchParams.get('today')
  const today = isDate(todayParam) ? todayParam : utcToday()
  return Response.json(await load(db, { storeId: user.store_id, today, monthStart: `${today.slice(0, 8)}01` }, url))
}

/** Handles /api/dashboard/*. */
export async function handleDashboard(
  db: D1Database,
  request: Request,
  url: URL,
  user: SessionUser,
): Promise<Response | null> {
  if (url.pathname === '/api/dashboard/layout') return handleOwnLayout(db, request, user)

  const widgetMatch = url.pathname.match(/^\/api\/dashboard\/widgets\/([a-z-]+)$/)
  if (widgetMatch) {
    if (request.method !== 'GET') return error('Method not allowed', 405)
    return widgetData(db, url, widgetMatch[1]!, user)
  }
  return null
}

/** The user id in /api/users/:id/dashboard, or null for other paths */
export function userDashboardId(pathname: string): number | null {
  const match = pathname.match(/^\/api\/users\/(\d+)\/dashboard$/)
  return match ? positiveId(Number(match[1])) : null
}
