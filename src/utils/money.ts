// Helpers for money. Amounts are whole hundredths of the store's currency (₱12.50 -> 1250).
import { currentUser } from '@/auth'

/** Currencies a store can pick on General Settings (keep in step with CURRENCIES in worker/settings.ts). */
export const CURRENCIES = [
  { code: 'PHP', name: 'Philippine Peso' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'MYR', name: 'Malaysian Ringgit' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'QAR', name: 'Qatari Riyal' },
] as const

const formats = new Map<string, Intl.NumberFormat>()

/** The logged-in store's currency. Reactive inside computed() and templates. */
export const currencyCode = () => currentUser.value?.store.currency ?? 'PHP'

function moneyFormat(currency: string): Intl.NumberFormat {
  let format = formats.get(currency)
  if (!format) {
    // narrowSymbol shows "$" rather than "US$"
    format = new Intl.NumberFormat('en-PH', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
    formats.set(currency, format)
  }
  return format
}

/** 1250 -> "₱12.50" (in the store's currency) */
export const formatMoney = (cents: number, currency = currencyCode()) => moneyFormat(currency).format(cents / 100)

const compactFormats = new Map<string, Intl.NumberFormat>()

/** 1_250_000_00 -> "₱1.25M", for chart axes where space is tight */
export function formatMoneyCompact(cents: number, currency = currencyCode()): string {
  let format = compactFormats.get(currency)
  if (!format) {
    format = new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      notation: 'compact',
      maximumFractionDigits: 1,
    })
    compactFormats.set(currency, format)
  }
  return format.format(cents / 100)
}

/** "₱" for PHP, "$" for USD; used beside amount inputs */
export const currencySymbol = (currency = currencyCode()) =>
  moneyFormat(currency).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency

/** "12.5" -> 1250 centavos; '' -> null; anything else (or more than 2 decimals) -> NaN */
export function parsePeso(text: string | number): number | null {
  const clean = String(text).replace(/[\p{Sc},\s]/gu, '') // any currency symbol, e.g. ₱ or $
  if (clean === '') return null
  return /^\d+(\.\d{1,2})?$/.test(clean) ? Math.round(Number(clean) * 100) : NaN
}

/** 1250 -> "12.50" for an input; null -> '' */
export const centsToText = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2))

/** A tax rate typed as a percent: "12" -> 1200 basis points; '' -> 0; anything else -> NaN */
export function parsePercentBp(text: string | number): number {
  const clean = String(text).replace(/[%\s]/g, '')
  if (clean === '') return 0
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return NaN
  const bp = Math.round(Number(clean) * 100)
  return bp <= 10_000 ? bp : NaN
}

/** 1200 -> "12%", 1250 -> "12.5%" */
export const formatPercentBp = (bp: number) => `${(bp / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`

/**
 * A random id for a save, so a retried request never saves twice. Uses getRandomValues,
 * which (unlike randomUUID) also works when the app is opened over plain http on a LAN.
 */
export function newUid(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
}
