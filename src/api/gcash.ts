// The store's own GCash account (see worker/gcash.ts). Not a payment gateway: the customer scans the
// store's GCash QR, pays into that account, and the cashier types in the reference no.
import { readJson } from './http'

export interface GcashAccount {
  accountName: string
  accountNumber: string // '' if not given
  qrUrl: string
}

/** The store's GCash account, or null if the admin hasn't set it up */
export async function getGcashAccount(): Promise<GcashAccount | null> {
  return readJson(await fetch('/api/settings/gcash'))
}

/** Saves the account; `qr` is needed the first time, and replaces the QR after that */
export async function saveGcashAccount(input: { accountName: string; accountNumber: string; qr: Blob | null }) {
  const body = new FormData()
  body.set('accountName', input.accountName)
  body.set('accountNumber', input.accountNumber)
  if (input.qr) body.set('qr', input.qr, 'qr')
  return readJson<GcashAccount>(await fetch('/api/settings/gcash', { method: 'PUT', body }))
}

export async function removeGcashAccount(): Promise<void> {
  await readJson(await fetch('/api/settings/gcash', { method: 'DELETE' }))
}

/** "09171234567" -> "0917 123 4567" */
export const formatGcashNumber = (number: string) => number.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3')

/** Longest side of the saved QR image; the crop dialog scales the crop down to fit */
export const MAX_QR_SIDE = 1200

/**
 * Turns the cropped QR into an image to upload. Kept as PNG (sharp edges scan best) unless that's
 * too big for the upload limit, then JPEG at high quality.
 */
export async function qrCanvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const toBlob = (type: string, quality?: number) =>
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the image'))), type, quality),
    )
  const png = await toBlob('image/png')
  return png.size <= 1_000_000 ? png : toBlob('image/jpeg', 0.92)
}
