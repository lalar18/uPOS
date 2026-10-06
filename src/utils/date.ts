// Helpers for calendar dates stored as 'YYYY-MM-DD' (no time, no timezone).

/** A date as 'YYYY-MM-DD' in the device's local time; today when no date is given. */
export function toIsoDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 'YYYY-MM-DD' -> a local Date at midnight */
export function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

/** '2026-10-06' plus 30 days -> '2026-11-05' */
export function addDays(value: string, days: number): string {
  const date = parseIsoDate(value)
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

/** Whole days from `from` to `to`; negative when `to` is earlier */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000)
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' })

/** '2026-10-06' -> "06 Oct 2026" */
export const formatIsoDate = (value: string) => dateFormat.format(parseIsoDate(value))
