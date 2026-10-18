// Reports (see worker/reports.ts). Every report has the same shape, so one page draws them all.
import { readJson } from './http'

export type ReportFormat =
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

export type ReportCell = string | number | null
export type ReportRow = Record<string, ReportCell>

export interface ReportColumn {
  key: string
  label: string
  format?: ReportFormat
}

export interface ReportTable {
  title: string
  columns: ReportColumn[]
  rows: ReportRow[]
  totals?: ReportRow
  link?: { route: 'sale-detail'; idKey: string }
  truncated?: boolean
}

export interface ReportTile {
  label: string
  value: number | null
  format: ReportFormat
  icon: string
  tone?: 'primary' | 'success' | 'danger' | 'info' | 'warning'
  hint?: string
}

export interface ReportChart {
  title: string
  format: 'money' | 'count'
  granularity: 'day' | 'month'
  countLabel?: string
  points: { key: string; value: number; count?: number }[] // key: YYYY-MM-DD or YYYY-MM
}

export interface ReportBreakdown {
  title: string
  format: ReportFormat
  labelFormat?: ReportFormat
  items: { label: string; value: number; hint?: string }[]
}

export interface Report {
  tiles: ReportTile[]
  chart?: ReportChart
  breakdowns: ReportBreakdown[]
  tables: ReportTable[]
  notes: string[]
}

export async function getReport(key: string, params: Record<string, string>): Promise<Report> {
  const query = new URLSearchParams({ ...params, tzOffset: String(new Date().getTimezoneOffset()) })
  return readJson<Report>(await fetch(`/api/reports/${key}?${query}`))
}
