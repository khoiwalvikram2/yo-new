/**
 * The payment screenshot sent with a manual deposit request.
 *
 * There is no file upload any more (owner 2026-11-04: no Amazon S3; files are stored as base64). The chosen image is
 * scaled down here, in the browser, to a JPEG data URI that createAdminDeposit carries in its `proofKey` argument.
 * The server accepts only a base64 PNG, JPEG or WebP data URI of at most 2 MB decoded; at most 1600 px on the
 * longest side and quality 0.8 a screenshot comes to a few hundred KB.
 */

/** Longest side of the image sent, in pixels; a larger image is scaled down to it. */
export const PROOF_MAX_SIDE = 1600
/** JPEG qualities tried in turn until the image is small enough. */
export const PROOF_QUALITIES = [0.8, 0.65, 0.5] as const
/** What the image is brought under: well below the server's limit, so the request stays light on a phone. */
export const PROOF_TARGET_BYTES = 900 * 1024
/** The server's limit (decoded bytes): a larger image is refused there. */
export const PROOF_MAX_BYTES = 2 * 1024 * 1024

export const PROOF_NOT_IMAGE = 'Choose an image of the payment (a PNG, JPEG or WebP screenshot).'
export const PROOF_UNREADABLE = 'This image could not be read. Choose a PNG, JPEG or WebP screenshot.'
export const PROOF_TOO_LARGE = 'This image is too large to send. Choose a smaller screenshot.'

/** A decoded image, and how to free it. */
export interface DecodedProofImage {
  image: CanvasImageSource
  width: number
  height: number
  release(): void
}

/** How an image is read and written; the browser's own by default (a test passes its own). */
export interface ProofImageTools {
  decode(file: Blob): Promise<DecodedProofImage>
  /** The image drawn at width x height, as a JPEG data URI of the given quality. */
  encode(image: CanvasImageSource, width: number, height: number, quality: number): string
}

/** The size that fits within maxSide on its longest side, keeping the aspect ratio; never scaled up. */
export function fitWithin(width: number, height: number, maxSide = PROOF_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Decoded byte size of a base64 data URI. */
export function dataUriBytes(uri: string): number {
  const payload = uri.slice(uri.indexOf(',') + 1)
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.floor((payload.length * 3) / 4) - padding
}

export const browserImageTools: ProofImageTools = {
  async decode(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file)
        return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
      } catch {
        // An <img> decodes some formats a bitmap cannot (HEIC photos in Safari): try that below.
      }
    }
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('decode'))
        img.src = url
      })
      return { image: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) }
    } catch (error) {
      URL.revokeObjectURL(url)
      throw error
    }
  },
  encode(image, width, height, quality) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas')
    // A JPEG has no transparency: a transparent screenshot is drawn on white paper, not black. Not a UI colour.
    context.fillStyle = '#ffffff' // theme: fixed
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', quality)
  },
}

/**
 * The chosen screenshot as the JPEG data URI to send: scaled to PROOF_MAX_SIDE, at the first quality that brings it
 * under PROOF_TARGET_BYTES (or the last one, while it is within the server's limit). Throws an Error whose message
 * is meant for the player.
 */
export async function compressDepositProof(file: File, tools: ProofImageTools = browserImageTools): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error(PROOF_NOT_IMAGE)
  let decoded: DecodedProofImage
  try {
    decoded = await tools.decode(file)
  } catch {
    throw new Error(PROOF_UNREADABLE)
  }
  try {
    if (!(decoded.width > 0 && decoded.height > 0)) throw new Error(PROOF_UNREADABLE)
    const { width, height } = fitWithin(decoded.width, decoded.height)
    let smallest = ''
    for (const quality of PROOF_QUALITIES) {
      let uri: string
      try {
        uri = tools.encode(decoded.image, width, height, quality)
      } catch {
        throw new Error(PROOF_UNREADABLE)
      }
      if (!uri.startsWith('data:image/')) throw new Error(PROOF_UNREADABLE)
      if (dataUriBytes(uri) <= PROOF_TARGET_BYTES) return uri
      smallest = uri
    }
    if (dataUriBytes(smallest) <= PROOF_MAX_BYTES) return smallest
    throw new Error(PROOF_TOO_LARGE)
  } finally {
    decoded.release()
  }
}
