// Line items being edited on a sale or quotation form. Quantities and prices are kept
// as typed text and parsed when needed, like the product form does.
import { formatQuantity, type Product } from '@/api/products'
import { lineTotal } from '@/api/sales'
import { centsToText, parsePeso } from '@/utils/money'

export interface EditorLine {
  productId: number
  name: string
  sku: string
  unitShortName: string
  allowDecimal: boolean
  imageUrl: string | null
  stock: number | null // stock on hand when loaded; null when unknown
  catalogPriceCents: number // the product's selling price
  quantityText: string
  priceText: string
}

export function lineFromProduct(product: Product, quantity = 1, priceCents = product.priceCents): EditorLine {
  return {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    unitShortName: product.unit.shortName,
    allowDecimal: product.unit.allowDecimal,
    imageUrl: product.imageUrl,
    stock: product.quantity,
    catalogPriceCents: product.priceCents,
    quantityText: String(quantity),
    priceText: centsToText(priceCents),
  }
}

/** The quantity rounded to 3 decimals, or null while it isn't a valid amount for the unit */
export function lineQuantity(line: EditorLine): number | null {
  const text = String(line.quantityText).trim()
  if (text === '') return null
  const value = Math.round(Number(text) * 1000) / 1000
  if (!Number.isFinite(value) || value <= 0) return null
  if (!line.allowDecimal && !Number.isInteger(value)) return null
  return value
}

/** The unit price in centavos, or null while it isn't a valid amount */
export function linePrice(line: EditorLine): number | null {
  const cents = parsePeso(line.priceText)
  return cents === null || Number.isNaN(cents) ? null : cents
}

/** The line total in centavos (0 while the quantity or price is invalid) */
export function lineCents(line: EditorLine): number {
  const quantity = lineQuantity(line)
  const price = linePrice(line)
  return quantity === null || price === null ? 0 : lineTotal(quantity, price)
}

/** True when more is wanted than the stock loaded with the line */
export function isOverStock(line: EditorLine): boolean {
  const quantity = lineQuantity(line)
  return line.stock !== null && quantity !== null && quantity > line.stock
}

/** The first problem with the lines, or '' when they can be saved */
export function validateLines(lines: EditorLine[], checkStock: boolean): string {
  if (lines.length === 0) return 'Add at least one product.'
  for (const line of lines) {
    if (lineQuantity(line) === null) {
      return line.allowDecimal
        ? `Enter a quantity for ${line.name}.`
        : `Enter a whole-number quantity for ${line.name}.`
    }
    if (linePrice(line) === null) return `Enter a price for ${line.name}, like 12.50.`
    if (checkStock && isOverStock(line)) {
      return `Only ${formatQuantity(Math.max(line.stock ?? 0, 0))} ${line.unitShortName} of ${line.name} in stock.`
    }
  }
  return ''
}

/** The lines as the API expects them. Call after validateLines() passes. */
export const toItems = (lines: EditorLine[]) =>
  lines.map((line) => ({ productId: line.productId, quantity: lineQuantity(line)!, priceCents: linePrice(line)! }))

/** A line as printed on an invoice or quotation (see InvoiceDocument.vue) */
export interface DocumentItem {
  key: number
  name: string
  sku: string
  quantity: number
  unitShortName: string
  priceCents: number
  totalCents: number
  returnedQuantity?: number
}
