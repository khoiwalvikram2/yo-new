/**
 * Payment-method QR codes and deposit proofs are read as stored (owner decision 2026-11-04: S3 is gone).
 * - A data URI or a link is handed out as it is; nothing is presigned any more.
 * - A legacy S3 key or S3 URL reads as null: qrUrl and qrKey both, so saving the method clears the dead key.
 * - A deposit's proof is its proof_data data URI, else proof_key when that holds an image; a sentinel
 *   ('manual', 'proof-missing', 'welivepay') or a legacy S3 key is no proof to show.
 *
 * Unit, no database.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/deposits/__tests__/storedAssetReads.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { attachQrUrls } from '../resolvers/qrUrl.js'
import { depositProofUrl } from '../resolvers/proofUrl.js'

const QR = 'data:image/png;base64,iVBORw0KGgo='

describe('attachQrUrls', () => {
  it('hands data URIs and links out as they are, and reads a legacy S3 key as no QR at all', async () => {
    const out = await attachQrUrls([
      { id: 'u1', qrKey: QR },
      { id: 'u2', qrKey: 'https://cdn.example.com/qr.png' },
      { id: 'u3', qrKey: 'deposits/1772012489525-c35741aa5fd4a6b4.png' },
      { id: 'u4', qrKey: 'https://gd-bucket-s3.s3.ap-south-1.amazonaws.com/deposits/a.png' },
      { id: 'u5', qrKey: null },
      { id: 'u6' },
    ])
    assert.deepEqual(out.map((u) => [u.id, u.qrKey ?? null, u.qrUrl]), [
      ['u1', QR, QR],
      ['u2', 'https://cdn.example.com/qr.png', 'https://cdn.example.com/qr.png'],
      ['u3', null, null],
      ['u4', null, null],
      ['u5', null, null],
      ['u6', null, null],
    ])
  })

  it('answers an empty list for no entries', async () => {
    assert.deepEqual(await attachQrUrls(null), [])
    assert.deepEqual(await attachQrUrls(undefined), [])
  })
})

describe('depositProofUrl', () => {
  it('shows the proof image stored in proof_data, or in proof_key', () => {
    assert.equal(depositProofUrl({ proofKey: 'manual', proofData: QR }), QR)
    assert.equal(depositProofUrl({ proofKey: QR, proofData: null }), QR)
  })

  it('shows nothing for a sentinel, a legacy S3 key or an empty proof', () => {
    for (const proofKey of ['manual', 'proof-missing', 'welivepay', 'deposits/1772039387176-a3333bb383159b53.jpg', '']) {
      assert.equal(depositProofUrl({ proofKey, proofData: null }), null, proofKey)
    }
    assert.equal(depositProofUrl({}), null)
  })
})

describe('the deposit read paths', () => {
  it('presign nothing and import nothing from S3', () => {
    for (const file of ['qrUrl.ts', 'proofUrl.ts', 'queries.ts', 'subscriptions.ts', 'mutations.ts']) {
      const src = readFileSync(join('src', 'domains', 'deposits', 'resolvers', file), 'utf8')
      assert.doesNotMatch(src, /storage\/s3|generatePresignedGetUrl|getS3ObjectUrl/, file)
    }
  })
})
