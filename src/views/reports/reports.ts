// The reports, their titles and filters. Keep the keys in step with REPORTS in worker/reports.ts.
import type { Permission } from '@/api/roles'

export interface ReportOption {
  key: string // query parameter
  label: string
  choices: { value: string; label: string }[] // the first is the default
}

export interface ReportDef {
  key: string
  title: string
  description: string
  icon: string // tabler icon name, without the "ti-" prefix
  group: 'Sales' | 'Money' | 'Inventory'
  dated: boolean // false: a snapshot as of today
  permission?: Permission // on top of reports.view
  options?: ReportOption[]
}

export const REPORTS: ReportDef[] = [
  {
    key: 'sales',
    title: 'Sales Summary',
    description: 'Net sales, discounts, returns and tax over time, by channel and by cashier.',
    icon: 'chart-bar',
    group: 'Sales',
    dated: true,
  },
  {
    key: 'product-sales',
    title: 'Sales by Product',
    description: 'What sold best, by product, category or brand, with profit where you can see costs.',
    icon: 'box',
    group: 'Sales',
    dated: true,
    options: [
      {
        key: 'group',
        label: 'Group by',
        choices: [
          { value: 'product', label: 'By product' },
          { value: 'category', label: 'By category' },
          { value: 'brand', label: 'By brand' },
        ],
      },
    ],
  },
  {
    key: 'customers',
    title: 'Sales by Customer',
    description: 'Who buys the most, repeat customers, and what each still owes.',
    icon: 'users-group',
    group: 'Sales',
    dated: true,
  },
  {
    key: 'returns',
    title: 'Sales Returns',
    description: 'Returned value, refunds and return rate, by reason and by product.',
    icon: 'receipt-refund',
    group: 'Sales',
    dated: true,
  },
  {
    key: 'quotations',
    title: 'Quotations',
    description: 'Quotations by status, conversion to sales, and who prepared them.',
    icon: 'file-description',
    group: 'Sales',
    dated: true,
  },
  {
    key: 'profit-loss',
    title: 'Profit & Loss',
    description: 'Net sales, cost of goods sold, gross profit and margin over time.',
    icon: 'report-money',
    group: 'Money',
    dated: true,
    permission: 'products.manage',
  },
  {
    key: 'payments',
    title: 'Payments Received',
    description: 'Money collected and refunded, by payment method and by day.',
    icon: 'cash',
    group: 'Money',
    dated: true,
  },
  {
    key: 'receivables',
    title: 'Receivables & Aging',
    description: 'Unpaid balances today, how overdue they are, and who owes them.',
    icon: 'file-invoice',
    group: 'Money',
    dated: false,
  },
  {
    key: 'tax',
    title: 'Tax Report',
    description: 'Tax collected, taxable and non-taxed sales, by rate and over time.',
    icon: 'receipt-tax',
    group: 'Money',
    dated: true,
  },
  {
    key: 'inventory',
    title: 'Inventory Valuation',
    description: 'Stock on hand and what it is worth, by category and by product.',
    icon: 'building-warehouse',
    group: 'Inventory',
    dated: false,
    options: [
      {
        key: 'stock',
        label: 'Stock',
        choices: [
          { value: '', label: 'All products' },
          { value: 'in', label: 'In stock' },
          { value: 'low', label: 'Low stock' },
          { value: 'out', label: 'Out of stock' },
        ],
      },
    ],
  },
  {
    key: 'stock-movement',
    title: 'Stock Movement',
    description: 'Every change to stock in a period, by reason and by product.',
    icon: 'arrows-exchange',
    group: 'Inventory',
    dated: true,
  },
]

export const REPORT_GROUPS = ['Sales', 'Money', 'Inventory'] as const

export const findReport = (key: string) => REPORTS.find((r) => r.key === key)
