// Every dashboard widget. The API decides which ones a role may see (see WIDGETS in
// worker/dashboard.ts, which must list the same keys); this adds what the browser needs.
import type { Component } from 'vue'
import ExpiringList from './widgets/ExpiringList.vue'
import InventoryValue from './widgets/InventoryValue.vue'
import LowStockList from './widgets/LowStockList.vue'
import OpenQuotations from './widgets/OpenQuotations.vue'
import PaymentMethods from './widgets/PaymentMethods.vue'
import ProfitSummary from './widgets/ProfitSummary.vue'
import QuickActions from './widgets/QuickActions.vue'
import ReceivablesList from './widgets/ReceivablesList.vue'
import RecentSales from './widgets/RecentSales.vue'
import SalesOverview from './widgets/SalesOverview.vue'
import SalesTrend from './widgets/SalesTrend.vue'
import TopCustomers from './widgets/TopCustomers.vue'
import TopProducts from './widgets/TopProducts.vue'

export interface WidgetInfo {
  key: string
  title: string
  description: string
  icon: string // tabler icon name, without the "ti-" prefix
  size: string // Bootstrap column classes; every widget is full width on phones
  component: Component
}

export const WIDGET_INFO: WidgetInfo[] = [
  {
    key: 'quick-actions',
    title: 'Quick Actions',
    description: 'Shortcuts to the POS, new sales, quotations and products',
    icon: 'bolt',
    size: 'col-12',
    component: QuickActions,
  },
  {
    key: 'sales-overview',
    title: 'Sales Overview',
    description: "Today's and this month's sales, money collected and receivables",
    icon: 'chart-bar',
    size: 'col-12',
    component: SalesOverview,
  },
  {
    key: 'sales-trend',
    title: 'Sales Trend',
    description: 'Net sales per day for the last 7 or 30 days',
    icon: 'chart-bar',
    size: 'col-12 col-xl-8',
    component: SalesTrend,
  },
  {
    key: 'payment-methods',
    title: 'Payment Methods',
    description: 'Money received this month by cash, card, GCash and others',
    icon: 'credit-card',
    size: 'col-12 col-md-6 col-xl-4',
    component: PaymentMethods,
  },
  {
    key: 'profit',
    title: 'Profit This Month',
    description: 'Net sales less the cost of goods sold, with the margin',
    icon: 'report-money',
    size: 'col-12 col-md-6 col-xl-4',
    component: ProfitSummary,
  },
  {
    key: 'inventory-value',
    title: 'Inventory Value',
    description: 'What the stock on hand is worth at cost and selling price',
    icon: 'building-warehouse',
    size: 'col-12 col-md-6 col-xl-4',
    component: InventoryValue,
  },
  {
    key: 'top-products',
    title: 'Top Products',
    description: 'Best sellers this month',
    icon: 'trophy',
    size: 'col-12 col-lg-6 col-xl-4',
    component: TopProducts,
  },
  {
    key: 'top-customers',
    title: 'Top Customers',
    description: 'Customers who bought the most this month',
    icon: 'users-group',
    size: 'col-12 col-lg-6 col-xl-4',
    component: TopCustomers,
  },
  {
    key: 'recent-sales',
    title: 'Recent Sales',
    description: 'The latest sales and whether they are paid',
    icon: 'receipt-2',
    size: 'col-12 col-lg-6 col-xl-4',
    component: RecentSales,
  },
  {
    key: 'receivables',
    title: 'Unpaid Invoices',
    description: 'Balances customers still owe, overdue first',
    icon: 'file-invoice',
    size: 'col-12 col-lg-6 col-xl-4',
    component: ReceivablesList,
  },
  {
    key: 'low-stock',
    title: 'Low Stock',
    description: 'Products at or below their low stock alert',
    icon: 'alert-triangle',
    size: 'col-12 col-lg-6 col-xl-4',
    component: LowStockList,
  },
  {
    key: 'expiring',
    title: 'Expiring Products',
    description: 'Products that have expired or expire within 30 days',
    icon: 'calendar-exclamation',
    size: 'col-12 col-lg-6 col-xl-4',
    component: ExpiringList,
  },
  {
    key: 'quotations',
    title: 'Open Quotations',
    description: 'Draft and sent quotations still waiting for an answer',
    icon: 'file-description',
    size: 'col-12 col-lg-6 col-xl-4',
    component: OpenQuotations,
  },
]

const BY_KEY = new Map(WIDGET_INFO.map((w) => [w.key, w]))

/** The widgets for these keys, in the same order; unknown keys are skipped */
export const widgetsFor = (keys: string[]) => keys.map((k) => BY_KEY.get(k)).filter((w): w is WidgetInfo => !!w)
