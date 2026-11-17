import { displayableAsset } from '@shared/utils/dataUri.js'

/**
 * A deposit's payment proof as a page can show it (owner decision 2026-11-04: S3 is gone, files are base64).
 *
 * The image is a data URI, in proof_data or, when it fits, in proof_key itself; either is handed out as it is.
 * proof_key otherwise holds a sentinel ('welivepay', 'manual', 'proof-missing'), which is not a file, or a legacy
 * S3 object key, which nothing can fetch any more: both are no proof to show. proofKey itself is still returned
 * to the page as stored, so it can tell a manual credit from a missing proof.
 */
export function depositProofUrl(request: { proofKey?: string | null; proofData?: string | null }): string | null {
  return displayableAsset(request.proofData) ?? displayableAsset(request.proofKey)
}
