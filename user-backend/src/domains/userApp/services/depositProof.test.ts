/**
 * The deposit screenshot a player sends (owner 2026-11-04: no S3, files are stored as base64 data URIs): only a base64
 * PNG, JPEG or WebP image of at most 2 MB decoded is accepted, and the sentinels stay the server's own.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEPOSIT_PROOF_INLINE, DEPOSIT_PROOF_MAX_BYTES, DepositProofError, depositProofFields, parseDepositProof } from './depositProof.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
/** An image of the given header padded to `size` bytes. */
const image = (head: Buffer, size = 2048) => Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 1)])
const uri = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString('base64')}`

const TYPE_ERROR = /must be a PNG, JPEG or WebP image/
const READ_ERROR = /could not be read/

test('a PNG, JPEG or WebP data URI is accepted and stored with the type its bytes show', () => {
  for (const [type, head] of [['image/png', PNG], ['image/jpeg', JPEG], ['image/webp', WEBP]] as const) {
    const value = uri(type, image(head))
    assert.equal(parseDepositProof(value), value, type)
  }
  // image/jpg is not a real type; the bytes decide.
  assert.equal(parseDepositProof(uri('image/jpg', image(JPEG))), uri('image/jpeg', image(JPEG)))
  assert.equal(parseDepositProof(uri('IMAGE/PNG', image(PNG))), uri('image/png', image(PNG)))
  // Declared as PNG but really a JPEG (the player app always sends JPEG): stored as what it is.
  assert.equal(parseDepositProof(uri('image/png', image(JPEG))), uri('image/jpeg', image(JPEG)))
})

test('anything else is refused with a message for the player, sentinels and S3 keys included', () => {
  const refused = [
    uri('image/gif', Buffer.from('GIF89a' + 'x'.repeat(40))),
    uri('image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    uri('application/pdf', Buffer.from('%PDF-1.7 fixture')),
    uri('text/html', Buffer.from('<script>alert(1)</script>')),
    'data:image/png,not-base64',
    'deposits/1772039387176-a3333bb383159b53.jpg',
    'https://gd-bucket-s3.s3.ap-south-1.amazonaws.com/deposits/a.jpg',
    'welivepay',
    'manual',
    'proof-missing',
  ]
  for (const value of refused) assert.throws(() => parseDepositProof(value), (error: Error) => error instanceof DepositProofError && TYPE_ERROR.test(error.message), value)
  // Declared as an image, but the bytes are not one.
  assert.throws(() => parseDepositProof(uri('image/png', Buffer.from('<html><body>not an image</body></html>'))), TYPE_ERROR)
})

test('a payload that is not base64 is refused', () => {
  for (const payload of ['', 'abc', 'ab$d', 'aGVsbG8=aGVs', 'aGk=\n', ' aGk=']) {
    assert.throws(() => parseDepositProof(`data:image/png;base64,${payload}`), READ_ERROR, JSON.stringify(payload))
  }
})

test('at most 2 MB decoded: the limit itself passes, one byte more is refused', () => {
  const atLimit = uri('image/jpeg', image(JPEG, DEPOSIT_PROOF_MAX_BYTES))
  assert.equal(parseDepositProof(atLimit), atLimit)
  assert.throws(() => parseDepositProof(uri('image/jpeg', image(JPEG, DEPOSIT_PROOF_MAX_BYTES + 1))), /too large \(2\.0 MB\)\. The limit is 2 MB/)
  // Far over the limit: refused by its length, before any decoding.
  assert.throws(() => parseDepositProof(`data:image/jpeg;base64,${'A'.repeat(8 * 1024 * 1024)}`), /too large \(6\.0 MB\)/)
})

test('proof_key and proof_data of a new request: the screenshot inline, else the server sentinels', () => {
  const screenshot = uri('image/jpeg', image(JPEG))
  assert.deepEqual(depositProofFields(screenshot, 'UTR123'), { proofKey: DEPOSIT_PROOF_INLINE, proofData: screenshot })
  assert.deepEqual(depositProofFields(screenshot, undefined), { proofKey: 'inline', proofData: screenshot })
  assert.deepEqual(depositProofFields(undefined, 'UTR123'), { proofKey: 'manual', proofData: null })
  assert.deepEqual(depositProofFields('', 'UTR123'), { proofKey: 'manual', proofData: null })
  assert.deepEqual(depositProofFields(null, undefined), { proofKey: 'proof-missing', proofData: null })
  // A player can never pick a sentinel: 'welivepay' would pass a manual request off as a gateway deposit.
  assert.throws(() => depositProofFields('welivepay', 'UTR123'), DepositProofError)
})
