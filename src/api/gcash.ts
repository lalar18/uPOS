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

const MAX_QR_SIDE = 1200

/**
 * Shrinks a QR screenshot so it fits the upload limit. Kept as PNG (sharp edges scan best) unless
 * that's still too big, then JPEG at high quality.
 */
export async function prepareQrImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_QR_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff' // transparent PNGs get a white background, so the QR stays readable
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const toBlob = (type: string, quality?: number) =>
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the image'))), type, quality),
    )
  const png = await toBlob('image/png')
  return png.size <= 1_000_000 ? png : toBlob('image/jpeg', 0.92)
}
