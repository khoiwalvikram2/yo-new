/**
 * Compress a picked image file into a base64 data URI that is small enough to
 * store inline in a database column and ship inside a GraphQL response.
 *
 * Assets are stored as data URIs rather than object-storage keys, so every byte
 * here is a byte in the database and in every player-app payload. Callers pass a
 * per-asset budget; the file is rejected if it cannot be brought under it.
 */

export interface CompressOptions {
  /** Longest edge of the output image, in pixels. */
  maxDim: number
  /** Output mime type. Use image/png for QR codes — they must stay lossless. */
  mime: 'image/webp' | 'image/png' | 'image/jpeg'
  /** Encoder quality for lossy mime types, 0..1. Ignored for image/png. */
  quality?: number
  /** Hard ceiling for the encoded data URI, in bytes. */
  maxBytes: number
  /**
   * Never reject: if the image is still over `maxBytes` at `maxDim`, progressively
   * downscale until it fits instead of throwing. Real QR codes fit at full size, so
   * this only shrinks pathologically large / photographic inputs. Used for QR uploads
   * so any picked image always saves.
   */
  shrinkToFit?: boolean
}

/** Per-asset budgets. Keep these in one place so every uploader agrees. */
export const COMPRESS_PRESETS = {
  logo: { maxDim: 256, mime: 'image/webp', quality: 0.9, maxBytes: 60 * 1024 },
  favicon: { maxDim: 64, mime: 'image/png', maxBytes: 16 * 1024 },
  banner: { maxDim: 1600, mime: 'image/webp', quality: 0.82, maxBytes: 250 * 1024 },
  advertisement: { maxDim: 1600, mime: 'image/webp', quality: 0.82, maxBytes: 250 * 1024 },
  casinoIcon: { maxDim: 96, mime: 'image/png', maxBytes: 24 * 1024 },
  casinoLounge: { maxDim: 1600, mime: 'image/webp', quality: 0.82, maxBytes: 250 * 1024 },
  qr: { maxDim: 512, mime: 'image/png', maxBytes: 200 * 1024, shrinkToFit: true },
} as const satisfies Record<string, CompressOptions>

export type CompressPreset = keyof typeof COMPRESS_PRESETS

/** Decoded byte length of a data URI's base64 payload. */
export function dataUriBytes(dataUri: string): number {
  const comma = dataUri.indexOf(',')
  if (comma === -1) return 0
  const payload = dataUri.slice(comma + 1)
  if (payload.length === 0) return 0
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.floor((payload.length * 3) / 4) - padding
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read the selected file'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The selected file is not a readable image'))
    img.src = src
  })
}

const kb = (bytes: number) => Math.round(bytes / 1024)

/**
 * Compress `file` to a data URI under the preset's byte budget.
 * Throws an Error with a user-facing message if that is not achievable.
 */
export async function compressImageToDataUrl(
  file: File,
  preset: CompressPreset,
): Promise<string> {
  const opts: CompressOptions = COMPRESS_PRESETS[preset]

  // SVG is vector and cannot be canvas-encoded without rasterising it, which would
  // lose the thing that makes it worth using. Store it as-is when it fits.
  if (file.type === 'image/svg+xml') {
    const raw = await readFileAsDataUrl(file)
    if (dataUriBytes(raw) > opts.maxBytes) {
      throw new Error(
        `This SVG is ${kb(dataUriBytes(raw))}KB, over the ${kb(opts.maxBytes)}KB limit. Please use a smaller file.`,
      )
    }
    return raw
  }

  const sourceDataUrl = await readFileAsDataUrl(file)
  const img = await loadImage(sourceDataUrl)

  // Try the requested quality, then step down. PNG ignores quality, so shrinking the
  // dimensions is the only lever for PNG presets (e.g. QR).
  const qualities: (number | undefined)[] =
    opts.mime === 'image/png' ? [undefined] : [opts.quality ?? 0.85, 0.7, 0.55, 0.4]

  /**
   * Encode the image scaled to `maxEdge` (longest side). Returns the first candidate
   * under budget, otherwise the smallest candidate produced at this size.
   */
  const encodeAt = (maxEdge: number): { dataUri: string; bytes: number } => {
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Your browser could not process this image')
    ctx.drawImage(img, 0, 0, w, h)

    let smallest = { dataUri: '', bytes: Number.POSITIVE_INFINITY }
    for (const q of qualities) {
      const dataUri = canvas.toDataURL(opts.mime, q)
      const bytes = dataUriBytes(dataUri)
      if (bytes < smallest.bytes) smallest = { dataUri, bytes }
      if (bytes <= opts.maxBytes) return { dataUri, bytes }
    }
    return smallest
  }

  let attempt = encodeAt(opts.maxDim)
  if (attempt.bytes <= opts.maxBytes) return attempt.dataUri

  // shrinkToFit: never reject — progressively downscale until it fits, then return the
  // best we produced. Real QR codes fit at full size and never reach this loop.
  if (opts.shrinkToFit) {
    let edge = opts.maxDim
    const floor = 96
    while (edge > floor) {
      edge = Math.max(floor, Math.round(edge * 0.8))
      attempt = encodeAt(edge)
      if (attempt.bytes <= opts.maxBytes) return attempt.dataUri
    }
    return attempt.dataUri // last resort: smallest achievable, still no rejection
  }

  throw new Error(
    `This image is still ${kb(attempt.bytes)}KB after compression, over the ${kb(opts.maxBytes)}KB limit. Please use a smaller or simpler image.`,
  )
}
