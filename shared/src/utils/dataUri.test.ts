import test from 'node:test'
import assert from 'node:assert/strict'
import { isDataUri, classifyStoredAsset, estimateBase64Bytes, displayableAsset } from './dataUri.js'

test('isDataUri detects data URIs and rejects everything else', () => {
  assert.equal(isDataUri('data:image/png;base64,iVBORw0KGgo='), true)
  assert.equal(isDataUri('whitelabels/logos/123-abc.png'), false)
  assert.equal(isDataUri('https://gd-bucket-s3.s3.ap-south-1.amazonaws.com/a.png'), false)
  assert.equal(isDataUri(null), false)
  assert.equal(isDataUri(undefined), false)
  assert.equal(isDataUri(''), false)
})

test('classifyStoredAsset labels each production value shape', () => {
  assert.equal(classifyStoredAsset(null), 'empty')
  assert.equal(classifyStoredAsset(''), 'empty')
  assert.equal(classifyStoredAsset('data:image/png;base64,iVBORw0KGgo='), 'data-uri')
  assert.equal(classifyStoredAsset('whitelabels/logos/1773750188117-f2f2.png'), 's3-key')
  assert.equal(
    classifyStoredAsset('https://gd-bucket-s3.s3.ap-south-1.amazonaws.com/whitelabels/favicons/x.png'),
    's3-url',
  )
  assert.equal(classifyStoredAsset('https://cdn.example.com/logo.png'), 'external-url')
})

test('classifyStoredAsset treats deposit sentinels as sentinel, not keys', () => {
  assert.equal(classifyStoredAsset('welivepay'), 'sentinel')
  assert.equal(classifyStoredAsset('manual'), 'sentinel')
  assert.equal(classifyStoredAsset('proof-missing'), 'sentinel')
  // The screenshot is the data URI in proof_data: proof_key 'inline' is a marker, never an S3 key to clear.
  assert.equal(classifyStoredAsset('inline'), 'sentinel')
})

test('estimateBase64Bytes returns decoded byte length of a data URI payload', () => {
  // "hi" -> aGk= (4 base64 chars, no padding chars beyond one '=')
  assert.equal(estimateBase64Bytes('data:text/plain;base64,aGk='), 2)
  assert.equal(estimateBase64Bytes('not-a-data-uri'), 0)
})

test('displayableAsset passes data URIs and external URLs through and reads everything else as null', () => {
  assert.equal(displayableAsset('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(displayableAsset('https://cdn.example.com/logo.png'), 'https://cdn.example.com/logo.png')
  assert.equal(displayableAsset('http://cdn.example.com/logo.png'), 'http://cdn.example.com/logo.png')
  // S3 is gone (owner decision 2026-11-04): a legacy key or S3 URL can no longer be fetched.
  assert.equal(displayableAsset('deposits/1772039387176-a3333bb383159b53.jpg'), null)
  assert.equal(displayableAsset('https://gd-bucket-s3.s3.ap-south-1.amazonaws.com/advertisements/a.png'), null)
  // Deposit sentinels are not files; empty values name none.
  for (const sentinel of ['welivepay', 'manual', 'proof-missing', 'inline']) assert.equal(displayableAsset(sentinel), null)
  assert.equal(displayableAsset(''), null)
  assert.equal(displayableAsset(null), null)
  assert.equal(displayableAsset(undefined), null)
})
