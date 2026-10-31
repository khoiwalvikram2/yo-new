export const MAX_LOUNGE_IMAGE_BYTES = 250 * 1024
export const MAX_LOUNGE_IMAGE_PAYLOAD = 6 * 1024 * 1024

export type CasinoLoungeImageInput = { gameId: string | number; imageData: string | null }

export function loungeNumericId(value: unknown): number {
  if (!/^[1-9]\d*$/.test(String(value))) throw new Error('Invalid casino category or game ID')
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id > 2147483647) throw new Error('Invalid casino category or game ID')
  return id
}

/** Store raster data URIs only; uploaded artwork never changes a provider's master image. */
export function validateLoungeImage(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_LOUNGE_IMAGE_BYTES / 3) * 4 + 32) {
    throw new Error('Lounge image must be a Base64 PNG, JPEG or WebP up to 250 KB')
  }
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[2].length % 4 !== 0) throw new Error('Lounge image must be a Base64 PNG, JPEG or WebP')
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.length === 0 || bytes.length > MAX_LOUNGE_IMAGE_BYTES || bytes.toString('base64') !== match[2]) {
    throw new Error('Invalid or oversized Lounge image encoding')
  }
  const valid = match[1] === 'png'
    ? bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii', 12, 16) === 'IHDR'
    : match[1] === 'jpeg'
      ? bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length
  if (!valid) throw new Error('Lounge image content does not match its image type')
  return value
}

export function normalizeLoungeSave(categoryId: unknown, gameIds: unknown[], images: CasinoLoungeImageInput[] = []) {
  if (!Array.isArray(gameIds) || gameIds.length > 10000 || !Array.isArray(images) || images.length > 10000) throw new Error('Too many Lounge games or images')
  const category = loungeNumericId(categoryId)
  const games = [...new Set(gameIds.map(loungeNumericId))]
  const selected = new Set(games)
  const seen = new Set<number>()
  let payload = 0
  const artwork = images.map(image => {
    const gameId = loungeNumericId(image?.gameId)
    if (!selected.has(gameId)) throw new Error('An image can only be saved for a selected Lounge game')
    if (seen.has(gameId)) throw new Error('Duplicate Lounge game image')
    seen.add(gameId)
    const imageData = validateLoungeImage(image.imageData)
    payload += imageData?.length ?? 0
    if (payload > MAX_LOUNGE_IMAGE_PAYLOAD) throw new Error('Lounge image changes exceed 6 MB; save fewer images at a time')
    return { gameId, imageData }
  })
  return { categoryId: category, gameIds: games, images: artwork }
}
