/**
 * Scales an image down to fit a size x size box (never up), keeping transparency.
 * Encodes as WebP, or PNG where the browser can't encode WebP.
 */
export async function resizeImage(file: File, size: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(size / bitmap.width, size / bitmap.height, 1)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(Math.round(bitmap.width * scale), 1)
  canvas.height = Math.max(Math.round(bitmap.height * scale), 1)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not read the image'))), 'image/webp', 0.9),
  )
}
