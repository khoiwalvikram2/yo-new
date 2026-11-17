/**
 * Images the admin stores are base64 data URIs (owner decision 2026-11-04: S3 is gone): an image of at most
 * 2 MB, or a link, is stored; an S3 object key or S3 URL, anything that is not an image, and an image past the
 * cap are refused with a message naming the field.
 *
 * Unit, no database.
 *   node --env-file-if-exists=.env --test --import tsx src/services/storage/__tests__/storedImage.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { STORED_IMAGE_MAX_BYTES, assertStorableImage, storedImageProblem } from '../storedImage.js'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
/** An image data URI that decodes to exactly `bytes` bytes. */
const imageOf = (bytes: number) => `data:image/webp;base64,${Buffer.alloc(bytes, 7).toString('base64')}`

describe('storedImageProblem', () => {
  it('stores image data URIs and links as they are', () => {
    assert.equal(storedImageProblem(PNG, 'Logo'), null)
    assert.equal(storedImageProblem('data:image/svg+xml;base64,PHN2Zy8+', 'Logo'), null)
    assert.equal(storedImageProblem('data:image/x-icon;base64,AAABAAEAEBA=', 'Favicon'), null)
    assert.equal(storedImageProblem('https://cdn.example.com/banner.webp', 'Banner'), null)
    assert.equal(storedImageProblem('http://cdn.example.com/banner.webp', 'Banner'), null)
  })

  it('refuses an S3 object key or S3 URL: nothing uploads to S3 or reads from it any more', () => {
    for (const value of [
      'advertisements/1771860453943-452799692833bd60.png',
      'deposits/1772012489525-c35741aa5fd4a6b4.png',
      'https://gd-bucket-s3.s3.ap-south-1.amazonaws.com/advertisements/a.png',
      'C:\\fakepath\\WhatsApp Image 2026-06-06 at 6.34.22 PM.jpeg',
      'manual',
    ]) {
      assert.equal(storedImageProblem(value, 'UPI QR code'), 'UPI QR code must be an uploaded image or an https link', value)
    }
  })

  it('refuses a data URI that is not a base64 image', () => {
    assert.equal(storedImageProblem('data:text/html;base64,PGgxPmhpPC9oMT4=', 'Advertisement image'), 'Advertisement image must be an image file')
    assert.equal(storedImageProblem('data:image/svg+xml,<svg/>', 'Logo'), 'Logo must be an image file')
  })

  it('caps a decoded image at 2 MB', () => {
    assert.equal(STORED_IMAGE_MAX_BYTES, 2 * 1024 * 1024)
    assert.equal(storedImageProblem(imageOf(STORED_IMAGE_MAX_BYTES), 'Category icon'), null)
    assert.equal(
      storedImageProblem(imageOf(STORED_IMAGE_MAX_BYTES + 200 * 1024), 'Category icon'),
      'Category icon is too large (2.2 MB); the limit is 2 MB',
    )
  })
})

describe('assertStorableImage', () => {
  it('lets the field decide what null, undefined and a blank value mean', () => {
    for (const value of [null, undefined, '', '   ']) assert.doesNotThrow(() => assertStorableImage(value, 'Logo'))
  })

  it('throws the refusal', () => {
    assert.doesNotThrow(() => assertStorableImage(PNG, 'Logo'))
    assert.throws(() => assertStorableImage('whitelabels/logos/1.png', 'Logo'), { message: 'Logo must be an uploaded image or an https link' })
  })
})
