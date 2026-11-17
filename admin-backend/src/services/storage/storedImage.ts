import { classifyStoredAsset, estimateBase64Bytes } from '@shared/utils/dataUri.js'

/**
 * The images the admin stores (advertisements, popup banners, a whitelabel's logo and favicon, casino category
 * icons, payment-method QR codes) are kept in their rows as base64 data URIs (owner decision 2026-11-04: Amazon S3
 * is gone). Every one of those fields also took a link, which still shows as it is.
 */

/** The largest image a row stores, decoded: 2 MB. */
export const STORED_IMAGE_MAX_BYTES = 2 * 1024 * 1024

const MB = 1024 * 1024
const IMAGE_DATA_URI = /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=._+-]+)*;base64,/i
/** A size in MB rounded up to one decimal, so a refused size never reads as the limit itself. */
const mbOf = (bytes: number) => (Math.ceil((bytes / MB) * 10) / 10).toFixed(1)

/**
 * Why `value` cannot be stored as `label`, or null when it can: a base64 image data URI of at most 2 MB, or an
 * http(s) link outside S3. Anything else is refused, an S3 object key or S3 URL among them: nothing uploads to S3
 * or reads from it any more, so that image would never show.
 */
export function storedImageProblem(value: string, label: string): string | null {
  switch (classifyStoredAsset(value)) {
    case 'data-uri': {
      if (!IMAGE_DATA_URI.test(value)) return `${label} must be an image file`
      const bytes = estimateBase64Bytes(value)
      return bytes > STORED_IMAGE_MAX_BYTES ? `${label} is too large (${mbOf(bytes)} MB); the limit is 2 MB` : null
    }
    case 'external-url':
      return null
    default:
      return `${label} must be an uploaded image or an https link`
  }
}

/** storedImageProblem as a throw. Null, undefined and a blank value are not images and pass: each field decides what they mean. */
export function assertStorableImage(value: string | null | undefined, label: string): void {
  if (value === null || value === undefined || value.trim() === '') return
  const problem = storedImageProblem(value, label)
  if (problem) throw new Error(problem)
}
