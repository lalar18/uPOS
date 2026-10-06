// Helpers for money typed into forms. Amounts are whole centavos (₱12.50 -> 1250).

/** "12.5" -> 1250 centavos; '' -> null; anything else (or more than 2 decimals) -> NaN */
export function parsePeso(text: string | number): number | null {
  const clean = String(text).replace(/[₱,\s]/g, '')
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
