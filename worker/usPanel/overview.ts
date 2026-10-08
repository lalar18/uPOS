// The US Panel dashboard: how many stores are in each state, what's been collected, and
// what needs attention (renewals waiting for payment, stores about to run out).
//
//   GET /api/us-panel/overview -> { stores, plans, revenue, pendingRenewals, expiringStores }

import { publicRenewal, RENEWAL_SELECT } from './billing'
import { EXPIRING_DAYS } from './stores'

const LIST_LIMIT = 10
const RECENTLY_EXPIRED_DAYS = 30

// Months start at midnight in the Philippines (UTC+8); timestamps are stored in UTC
const MONTH_START = "datetime('now', '+8 hours', 'start of month', '-8 hours')"
const LAST_MONTH_START = "datetime('now', '+8 hours', 'start of month', '-1 month', '-8 hours')"

export async function getOverview(db: D1Database): Promise<Response> {
  const expired = "(st.plan_expires_at IS NULL OR st.plan_expires_at <= datetime('now'))"
  const [stores, plans, revenue, pending, expiring] = await db.batch([
    db
      .prepare(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(st.is_active = 1 AND NOT ${expired}), 0) AS active,
           COALESCE(SUM(st.is_active = 1 AND NOT ${expired} AND st.plan_expires_at <= datetime('now', ?)), 0) AS expiring,
           COALESCE(SUM(st.is_active = 1 AND ${expired}), 0) AS expired,
           COALESCE(SUM(st.is_active = 0), 0) AS disabled
         FROM stores st`,
      )
      .bind(`+${EXPIRING_DAYS} days`),
    // Paying stores per plan, and what they bring in each month
    db.prepare(
      `SELECT p.id, p.name, p.monthly_price,
         COUNT(st.id) AS stores,
         COALESCE(SUM(st.is_active = 1 AND NOT ${expired}), 0) AS active
       FROM plans p LEFT JOIN stores st ON st.plan_id = p.id
       GROUP BY p.id ORDER BY p.sort_order`,
    ),
    db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN paid_at >= ${MONTH_START} THEN amount END), 0) AS this_month,
         COALESCE(SUM(CASE WHEN paid_at >= ${LAST_MONTH_START} AND paid_at < ${MONTH_START} THEN amount END), 0) AS last_month,
         COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS all_time,
         COALESCE(SUM(status = 'pending'), 0) AS pending
       FROM subscription_renewals`,
    ),
    db.prepare(`${RENEWAL_SELECT} WHERE sr.status = 'pending' ORDER BY sr.id LIMIT ?`).bind(LIST_LIMIT),
    db
      .prepare(
        `SELECT st.id, st.name, p.name AS plan_name, st.plan_expires_at, ${expired} AS expired,
           EXISTS (SELECT 1 FROM subscription_renewals WHERE store_id = st.id AND status = 'pending') AS pending_renewal
         FROM stores st JOIN plans p ON p.id = st.plan_id
         WHERE st.is_active = 1 AND st.plan_expires_at <= datetime('now', ?) AND st.plan_expires_at > datetime('now', ?)
         ORDER BY st.plan_expires_at LIMIT ?`,
      )
      .bind(`+${EXPIRING_DAYS} days`, `-${RECENTLY_EXPIRED_DAYS} days`, LIST_LIMIT),
  ])

  type Row = Record<string, number | string | null>
  const storeCounts = stores!.results[0] as Row
  const money = revenue!.results[0] as Row
  const pendingRows = pending!.results as Parameters<typeof publicRenewal>[0][]

  return Response.json({
    stores: storeCounts,
    plans: (plans!.results as Row[]).map((row) => ({
      id: row.id,
      name: row.name,
      monthlyPrice: row.monthly_price,
      stores: row.stores,
      active: row.active,
    })),
    revenue: { thisMonth: money.this_month, lastMonth: money.last_month, allTime: money.all_time },
    pendingRenewals: { total: money.pending, items: pendingRows.map(publicRenewal) },
    expiringStores: (expiring!.results as Row[]).map((row) => ({
      id: row.id,
      name: row.name,
      planName: row.plan_name,
      expiresAt: row.plan_expires_at,
      expired: row.expired === 1,
      pendingRenewal: row.pending_renewal === 1,
    })),
  })
}
