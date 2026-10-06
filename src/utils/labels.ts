// Barcode and QR code images for printed labels, as SVG markup that scales to any label size.
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'

/** True for a 13-digit EAN with a correct check digit, which scanners read best as EAN-13 */
function isEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false
  const digits = [...value].map(Number)
  const sum = digits.slice(0, 12).reduce((total, d, i) => total + d * (i % 2 === 0 ? 1 : 3), 0)
  return (10 - (sum % 10)) % 10 === digits[12]
}

/** A barcode for `value`: EAN-13 for valid retail barcodes, Code 128 for everything else (SKUs). */
export function barcodeSvg(value: string): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  JsBarcode(svg, value, {
    format: isEan13(value) ? 'EAN13' : 'CODE128',
    width: 2,
    height: 60,
    margin: 0,
    fontSize: 16,
    textMargin: 2,
    background: 'transparent',
  })
  // Swap the fixed pixel size for a viewBox so CSS can scale it to the label
  const width = svg.getAttribute('width')!.replace('px', '')
  const height = svg.getAttribute('height')!.replace('px', '')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  svg.removeAttribute('style')
  return svg.outerHTML
}

/** A QR code for `value`, with no quiet zone (the label's padding provides it). */
export function qrSvg(value: string): Promise<string> {
  return QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
}
