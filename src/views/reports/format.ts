// Formatting report values for the screen and for CSV downloads.
import type { ReportCell, ReportColumn, ReportFormat, ReportTable } from '@/api/reports'
import { formatQuantity } from '@/api/products'
import { quotationStatusLabel } from '@/api/quotations'
import { paymentMethodLabel } from '@/api/sales'
import { returnReasonLabel } from '@/api/salesReturns'
import { reasonLabel } from '@/api/stock'
import { formatIsoDate, parseIsoDate } from '@/utils/date'
import { formatMoney } from '@/utils/money'

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' })

/** '2026-10-06' -> "06 Oct 2026"; '2026-10' -> "Oct 2026" */
export function formatPeriodKey(value: string): string {
  if (/^\d{4}-\d{2}$/.test(value)) return monthFormat.format(parseIsoDate(`${value}-01`))
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatIsoDate(value)
  return value
}

const LABELS: Partial<Record<ReportFormat, (value: string) => string>> = {
  method: paymentMethodLabel,
  returnReason: returnReasonLabel,
  stockReason: reasonLabel,
  quoteStatus: (value) => quotationStatusLabel(value as Parameters<typeof quotationStatusLabel>[0]) ?? value,
}

/** A value as shown on the page. Text in a number column (like "Total") is shown as-is. */
export function formatCell(value: ReportCell, format: ReportFormat = 'text'): string {
  if (value === null || value === '') return '—'
  if (typeof value === 'string') {
    if (format === 'date') return formatPeriodKey(value)
    return LABELS[format]?.(value) ?? value
  }
  switch (format) {
    case 'money':
      return formatMoney(value)
    case 'qty':
      return formatQuantity(value)
    case 'count':
      return value.toLocaleString()
    case 'percent':
      return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
    default:
      return String(value)
  }
}

export const isNumeric = (column: ReportColumn) =>
  column.format === 'money' || column.format === 'qty' || column.format === 'count' || column.format === 'percent'

/** A value for a CSV cell: plain numbers (money in units, not cents) so spreadsheets can add them up */
function csvValue(value: ReportCell, format: ReportFormat = 'text'): string {
  if (value === null) return ''
  if (typeof value === 'number') return format === 'money' ? (value / 100).toFixed(2) : String(value)
  return format === 'date' ? value : formatCell(value, format)
}

const csvEscape = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)

/** Downloads a table as a CSV file */
export function downloadCsv(table: ReportTable, fileName: string) {
  const lines = [table.columns.map((c) => csvEscape(c.label)).join(',')]
  for (const row of [...table.rows, ...(table.totals ? [table.totals] : [])]) {
    lines.push(table.columns.map((c) => csvEscape(csvValue(row[c.key] ?? null, c.format))).join(','))
  }
  // The BOM makes Excel read the file as UTF-8 (₱, ñ)
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName.replace(/[^\w.-]+/g, '-').toLowerCase()
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
