/**
 * Files the server sends inline as base64 data URIs (owner decision 2026-11-04: no external file store). They are
 * decoded into a Blob of the type the URI names and saved under the page's file name.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { dataUriMime, dataUriToBlob, decodeDataUri, extensionForMime, isDataUri, saveDataUri } from './dataUriFile'

const CSV = 'name,amount\nAsha,1200\n'
const csvUri = (mime = 'text/csv') => `data:${mime};base64,${btoa(CSV)}`

/** jsdom's Blob has no text(); FileReader reads it. */
function blobText(blob: Blob | undefined): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (!blob) return reject(new Error('no blob'))
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

describe('decodeDataUri', () => {
  test('reads the media type and the bytes of a base64 URI', () => {
    const decoded = decodeDataUri(csvUri())
    assert.equal(decoded.mime, 'text/csv')
    assert.equal(new TextDecoder().decode(decoded.bytes), CSV)
  })

  test('keeps the type parameters, and binary bytes survive unchanged', () => {
    assert.equal(decodeDataUri(csvUri('text/csv;charset=utf-8')).mime, 'text/csv;charset=utf-8')
    const binary = String.fromCharCode(0, 255, 80, 75, 3, 4)
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    assert.deepEqual(Array.from(decodeDataUri(`data:${xlsx};base64,${btoa(binary)}`).bytes), [0, 255, 80, 75, 3, 4])
  })

  test('an unnamed type is octet-stream, and a percent-encoded URI is read too', () => {
    assert.equal(decodeDataUri(`data:;base64,${btoa('x')}`).mime, 'application/octet-stream')
    assert.equal(new TextDecoder().decode(decodeDataUri('data:text/plain,a%20b').bytes), 'a b')
  })

  test('refuses what is not a readable data URI', () => {
    assert.throws(() => decodeDataUri('https://bucket.example/exports/1.csv'), /could not be read/)
    assert.throws(() => decodeDataUri('data:text/csv;base64'), /could not be read/)
    assert.throws(() => decodeDataUri('data:text/csv;base64,@@@not base64@@@'), /could not be read/)
  })
})

describe('dataUriToBlob', () => {
  test('is a Blob of the named type holding the decoded bytes', async () => {
    const blob = dataUriToBlob(csvUri())
    assert.equal(blob.type, 'text/csv')
    assert.equal(blob.size, CSV.length)
    assert.equal(await blobText(blob), CSV)
  })
})

describe('saveDataUri', () => {
  const saved: Array<{ href: string; download: string; blob: Blob | undefined }> = []
  let lastBlob: Blob | undefined

  beforeEach(() => {
    saved.length = 0
    lastBlob = undefined
    window.URL.createObjectURL = vi.fn((blob: Blob) => {
      lastBlob = blob
      return 'blob:saved-1'
    })
    window.URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      saved.push({ href: this.getAttribute('href') ?? '', download: this.download, blob: lastBlob })
    })
  })

  afterEach(() => { vi.restoreAllMocks() })

  test('saves the decoded Blob under the given name and lets its object URL go', async () => {
    saveDataUri(csvUri(), 'Players Data-2026-11-04-job-1.csv')
    assert.equal(saved.length, 1)
    assert.equal(saved[0].href, 'blob:saved-1')
    assert.equal(saved[0].download, 'Players Data-2026-11-04-job-1.csv')
    assert.equal(saved[0].blob?.type, 'text/csv')
    assert.equal(await blobText(saved[0].blob), CSV)
    assert.deepEqual((window.URL.revokeObjectURL as ReturnType<typeof vi.fn>).mock.calls, [['blob:saved-1']])
    assert.equal(document.querySelectorAll('a').length, 0, 'the temporary link is removed')
  })

  test('saves nothing for a value that is not a data URI', () => {
    assert.throws(() => saveDataUri('exports/t/t/ggr-job-1.csv', 'f.csv'), /could not be read/)
    assert.equal(saved.length, 0)
  })
})

describe('helpers', () => {
  test('isDataUri, the type a URI names, and the usual extension for a type', () => {
    assert.equal(dataUriMime(csvUri('application/json')), 'application/json')
    assert.equal(dataUriMime('ggr-job-1.csv'), null)
    assert.equal(isDataUri(csvUri()), true)
    assert.equal(isDataUri('https://x.test/a.csv'), false)
    assert.equal(isDataUri(null), false)
    assert.equal(extensionForMime('text/csv;charset=utf-8'), 'csv')
    assert.equal(extensionForMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'xlsx')
    assert.equal(extensionForMime('application/json'), 'json')
    assert.equal(extensionForMime('application/x-unknown'), null)
  })
})
