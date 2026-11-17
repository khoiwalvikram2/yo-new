/**
 * Export files are stored in their job row as a base64 data URI (owner decision 2026-11-04: S3 is gone).
 * - The file is encoded with its real mime type and decodes back to the same bytes.
 * - A file whose base64 passes 40 MB is refused before it is encoded, with its size and what to do.
 * - A download hands out the stored data URI; a job uploaded to S3 before the change is refused by name.
 *
 * Unit, no database.
 *   node --env-file-if-exists=.env --test --import tsx src/services/storage/__tests__/exportFile.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPORT_FILE_MAX_BASE64_BYTES,
  EXPORT_FILE_PREDATES_DATABASE,
  base64LengthOf,
  exportFileDataUri,
  exportFileDownload,
} from '../exportFile.js'

const decode = (uri: string) => Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64').toString('utf-8')

describe('exportFileDataUri', () => {
  it('encodes the file with its mime type, and it decodes back to the same text', () => {
    const csv = 'ID,Name\n1,"Ravi, K"\n2,Zoë'
    const uri = exportFileDataUri(csv, 'text/csv')
    assert.ok(uri.startsWith('data:text/csv;base64,'), uri.slice(0, 40))
    assert.equal(decode(uri), csv)

    const json = exportFileDataUri(Buffer.from('[{"id":1}]', 'utf-8'), 'application/json')
    assert.ok(json.startsWith('data:application/json;base64,'))
    assert.equal(decode(json), '[{"id":1}]')
  })

  it('encodes an empty file', () => {
    assert.equal(exportFileDataUri('', 'text/csv'), 'data:text/csv;base64,')
  })

  it('measures base64 the way Buffer encodes it', () => {
    for (const bytes of [0, 1, 2, 3, 4, 299, 300, 301]) {
      assert.equal(base64LengthOf(bytes), Buffer.alloc(bytes).toString('base64').length, String(bytes))
    }
  })

  it('refuses a file whose base64 passes the cap, naming its size', () => {
    // 30 bytes encode to 40 characters of base64.
    assert.ok(exportFileDataUri(Buffer.alloc(30), 'text/csv', 40).length > 0, 'exactly the cap is stored')
    assert.throws(
      () => exportFileDataUri(Buffer.alloc(31), 'text/csv', 40),
      /^Error: The export is too large to store \(0\.1 MB\); narrow the filters$/,
    )
  })

  it('caps at 40 MB of base64: 30 MB of file is stored, a byte more is refused before encoding', () => {
    assert.equal(EXPORT_FILE_MAX_BASE64_BYTES, 40 * 1024 * 1024)
    assert.equal(base64LengthOf(30 * 1024 * 1024), EXPORT_FILE_MAX_BASE64_BYTES)
    // A 30 MB + 3 byte file (40 MB + 4 of base64) is refused without building the 40 MB string; its size is
    // rounded up, so it never reads as the cap itself.
    assert.throws(
      () => exportFileDataUri(Buffer.alloc(30 * 1024 * 1024 + 3), 'text/csv'),
      { message: 'The export is too large to store (40.1 MB); narrow the filters' },
    )
  })
})

describe('exportFileDownload', () => {
  it('hands out the stored data URI', () => {
    assert.equal(exportFileDownload({ fileUrl: 'PLAYERS-1.csv', fileData: 'data:text/csv;base64,QQ==' }), 'data:text/csv;base64,QQ==')
  })

  it('refuses a job uploaded to S3 before files moved into the database', () => {
    assert.throws(
      () => exportFileDownload({ fileUrl: 'exports/brand-a/brand-a/PLAYERS-1-1700000000000.csv', fileData: null }),
      { message: EXPORT_FILE_PREDATES_DATABASE },
    )
    assert.equal(EXPORT_FILE_PREDATES_DATABASE, 'This export was made before files moved into the database; run it again')
  })

  it('refuses a job that has no file yet', () => {
    assert.throws(() => exportFileDownload({ fileUrl: null, fileData: null }), { message: 'Export file is not available' })
  })
})
