import { readJson, sendJson } from './http'

export interface Settings {
  defaultTaxRateBp: number // filled in on new POS sales, sales and quotations (1200 = 12%)
  quotationValidDays: number // 0 leaves "valid until" blank on new quotations
  receiptFooter: string // '' prints no message
  currency: string // ISO 4217 code amounts are shown in (see CURRENCIES in utils/money.ts)
}

/** Used if the settings can't be loaded, so the sales screens still work. Matches the database defaults. */
export const DEFAULT_SETTINGS: Settings = {
  defaultTaxRateBp: 0,
  quotationValidDays: 15,
  receiptFooter: 'Thank you for your purchase!',
  currency: 'PHP',
}

export async function getSettings(): Promise<Settings> {
  return readJson(await fetch('/api/settings'))
}

/** Like getSettings, but falls back to the defaults instead of failing. */
export const getSettingsOrDefaults = () => getSettings().catch(() => DEFAULT_SETTINGS)

export const updateSettings = (input: Settings) => sendJson<Settings>('PUT', '/api/settings', input)

/** 1200 -> "12" for a tax input; 0 -> '' */
export const taxRateText = (bp: number) => (bp > 0 ? String(bp / 100) : '')
