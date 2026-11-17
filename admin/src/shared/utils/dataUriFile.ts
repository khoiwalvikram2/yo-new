/**
 * Files the server hands over inline as base64 data URIs (owner decision 2026-11-04: no external file store;
 * an export is kept in its job row and its download query answers `data:<mime>;base64,<payload>`).
 *
 * The URI is decoded into a Blob and saved through an object URL rather than used as a link itself: browsers
 * cap how long a data: link may be, and an export can run to tens of megabytes.
 */

export interface DecodedDataUri {
  /** The media type the URI names, with its parameters (`text/csv;charset=utf-8`); octet-stream when unnamed. */
  mime: string
  bytes: Uint8Array<ArrayBuffer>
}

const DEFAULT_MIME = 'application/octet-stream'

/** True for a `data:` URI. */
export function isDataUri(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:')
}

/** The header of a data URI: its media type and whether the payload is base64. Null when it is not one. */
function readHeader(uri: string): { mime: string; base64: boolean; comma: number } | null {
  const comma = isDataUri(uri) ? uri.indexOf(',') : -1
  if (comma === -1) return null
  const params = uri.slice('data:'.length, comma).split(';').map((part) => part.trim())
  const base64 = params.length > 1 && params[params.length - 1].toLowerCase() === 'base64'
  const typeParts = (base64 ? params.slice(0, -1) : params).filter(Boolean)
  const mime = typeParts.length > 0 && typeParts[0].includes('/') ? typeParts.join(';') : DEFAULT_MIME
  return { mime, base64, comma }
}

/** The media type a data URI names, without decoding its payload; null when the value is not a data URI. */
export function dataUriMime(uri: string): string | null {
  return readHeader(uri)?.mime ?? null
}

/** The URI's media type and its decoded bytes. Throws when it is not a readable data URI. */
export function decodeDataUri(uri: string): DecodedDataUri {
  const header = readHeader(uri)
  if (!header) throw new Error('The file the server sent could not be read.')
  const { mime, base64, comma } = header
  const payload = uri.slice(comma + 1)
  if (!base64) return { mime, bytes: Uint8Array.from(new TextEncoder().encode(decodeURIComponent(payload))) }
  let binary: string
  try {
    binary = atob(payload)
  } catch {
    throw new Error('The file the server sent could not be read.')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return { mime, bytes }
}

/** The data URI as a Blob of the type it names. */
export function dataUriToBlob(uri: string): Blob {
  const { mime, bytes } = decodeDataUri(uri)
  return new Blob([bytes], { type: mime })
}

/** Saves a Blob under `filename` through a temporary link. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

/** Decodes a data URI and saves it under `filename`. Throws when the URI cannot be read. */
export function saveDataUri(uri: string, filename: string): void {
  saveBlob(dataUriToBlob(uri), filename)
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'text/csv': 'csv',
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/plain': 'txt',
  'application/zip': 'zip',
}

/** The usual file extension for a media type (its parameters ignored), or null for one this list does not know. */
export function extensionForMime(mime: string): string | null {
  const essence = mime.split(';')[0].trim().toLowerCase()
  return Object.hasOwn(EXTENSIONS, essence) ? EXTENSIONS[essence] : null
}
