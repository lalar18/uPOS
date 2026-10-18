// The "All time / Today / Last 7 days / ..." filter on document lists. Documents are
// dated with the store's local YYYY-MM-DD date, so periods are plain date ranges.
import { addDays, toIsoDate } from './date'

export type Period = '' | 'today' | '7' | '30' | 'month' | 'last-month' | 'year' | 'custom'

export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: '', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
]

/** Reports always cover a range of dates, so they have no "All time" */
export const REPORT_PERIOD_OPTIONS: { value: Exclude<Period, ''>; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
]

/** The period as dates, both inclusive; null means open-ended */
export function periodDates(period: Period, customFrom: string, customTo: string): { from: string | null; to: string | null } {
  const today = toIsoDate()
  switch (period) {
    case 'today':
      return { from: today, to: today }
    case '7':
      return { from: addDays(today, -6), to: today }
    case '30':
      return { from: addDays(today, -29), to: today }
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today }
    case 'last-month': {
      const lastDay = addDays(`${today.slice(0, 8)}01`, -1)
      return { from: `${lastDay.slice(0, 8)}01`, to: lastDay }
    }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today }
    case 'custom':
      return { from: customFrom || null, to: customTo || null }
    default:
      return { from: null, to: null }
  }
}

/** An error message when a custom range ends before it starts, else '' */
export const rangeError = (period: Period, customFrom: string, customTo: string) =>
  period === 'custom' && customFrom && customTo && customTo < customFrom ? 'The end date is before the start date.' : ''
