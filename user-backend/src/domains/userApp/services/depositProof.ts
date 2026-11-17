/**
 * The payment screenshot a player sends with a manual deposit request.
 *
 * Files are stored in the database as base64 data URIs (owner 2026-11-04: Amazon S3 is gone). The player app scales
 * the chosen image down in the browser and sends its data URI in createAdminDeposit's `proofKey` argument, the
 * argument that carried the S3 key before. The data URI is kept in deposit_requests.proof_data (proof_key is a
 * varchar(512) and cannot hold it), and proof_key then reads DEPOSIT_PROOF_INLINE. proof_key keeps its sentinels,
 * all set by the server and never taken from a player: 'manual' (a reference, no screenshot), 'proof-missing'
 * (neither) and 'welivepay' (a gateway deposit).
 */

/** proof_key of a request whose screenshot is the data URI in proof_data. */
export const DEPOSIT_PROOF_INLINE = 'inline'
/** Largest screenshot accepted, decoded. The player app sends far less (longest side 1600 px, quality 0.8). */
export const DEPOSIT_PROOF_MAX_BYTES = 2 * 1024 * 1024

const PROOF_PREFIX = /^data:image\/(png|jpeg|jpg|webp);base64,/i
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const TYPE_ERROR = 'The payment screenshot must be a PNG, JPEG or WebP image. Please choose the screenshot again.'
const READ_ERROR = 'The payment screenshot could not be read. Please choose the screenshot again.'

/** A refusal the player can act on; the message is shown as it is. */
export class DepositProofError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DepositProofError'
  }
}

/** The image type the bytes really are, from their first bytes; null for anything else. */
function sniffImageType(head: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/** Decoded byte size of a base64 payload (checked as base64 first). */
function decodedBytes(payload: string): number {
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return (payload.length / 4) * 3 - padding
}

const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1)

/**
 * Checks the screenshot a player sent and answers the data URI to store: a base64 PNG, JPEG or WebP image of at most
 * DEPOSIT_PROOF_MAX_BYTES decoded, whose bytes are that kind of image. The stored type is the one the bytes show.
 * Throws a DepositProofError with a message for the player otherwise.
 */
export function parseDepositProof(value: string): string {
  const prefix = PROOF_PREFIX.exec(value)
  if (!prefix) throw new DepositProofError(TYPE_ERROR)
  const payload = value.slice(prefix[0].length)
  // Refused by length before any further work: base64 takes 4 characters for every 3 bytes.
  if (payload.length > Math.ceil(DEPOSIT_PROOF_MAX_BYTES / 3) * 4) {
    throw new DepositProofError(`The payment screenshot is too large (${megabytes((payload.length / 4) * 3)} MB). The limit is 2 MB.`)
  }
  if (payload.length === 0 || payload.length % 4 !== 0 || !BASE64.test(payload)) throw new DepositProofError(READ_ERROR)
  const bytes = decodedBytes(payload)
  if (bytes > DEPOSIT_PROOF_MAX_BYTES) {
    throw new DepositProofError(`The payment screenshot is too large (${megabytes(bytes)} MB). The limit is 2 MB.`)
  }
  const type = sniffImageType(Buffer.from(payload.slice(0, 16), 'base64'))
  if (!type) throw new DepositProofError(TYPE_ERROR)
  return `data:${type};base64,${payload}`
}

/**
 * proof_key and proof_data of a new manual deposit request: the screenshot when one was sent (checked by
 * parseDepositProof), else 'manual' when the player gave a reference, else 'proof-missing'.
 */
export function depositProofFields(proof: string | null | undefined, txnRef: string | undefined): { proofKey: string; proofData: string | null } {
  if (proof) return { proofKey: DEPOSIT_PROOF_INLINE, proofData: parseDepositProof(proof) }
  return { proofKey: txnRef ? 'manual' : 'proof-missing', proofData: null }
}
