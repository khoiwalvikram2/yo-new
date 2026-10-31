import test from 'node:test'
import assert from 'node:assert/strict'
import { gapLog } from './gapCasinoLog.js'

function withEnvironment(
  values: { NODE_ENV?: string; GAP_DEBUG?: string },
  callback: (lines: string[]) => void
): void {
  const previousNodeEnv = process.env.NODE_ENV
  const previousGapDebug = process.env.GAP_DEBUG
  const previousLog = console.log
  const lines: string[] = []

  if (values.NODE_ENV === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = values.NODE_ENV
  if (values.GAP_DEBUG === undefined) delete process.env.GAP_DEBUG
  else process.env.GAP_DEBUG = values.GAP_DEBUG
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(' '))

  try {
    callback(lines)
  } finally {
    console.log = previousLog
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    if (previousGapDebug === undefined) delete process.env.GAP_DEBUG
    else process.env.GAP_DEBUG = previousGapDebug
  }
}

test('GAP tracing is off by default and cannot be enabled in production', () => {
  withEnvironment({ NODE_ENV: 'development' }, (lines) => {
    gapLog('[Gap]', 'DefaultOff', { status: 'ok' })
    assert.deepEqual(lines, [])
  })

  withEnvironment({ NODE_ENV: 'production', GAP_DEBUG: '1' }, (lines) => {
    gapLog('[Gap]', 'ProductionOff', { status: 'ok' })
    assert.deepEqual(lines, [])
  })
})

test('explicit development tracing redacts secrets recursively', () => {
  withEnvironment({ NODE_ENV: 'development', GAP_DEBUG: 'true' }, (lines) => {
    gapLog('[Gap]', 'Incoming', {
      status: 'ok',
      token: 'session-token',
      rawBody: '{"password":"hidden"}',
      nested: { signaturePreview: 'signature-prefix', userId: 7 },
    })

    assert.equal(lines.length, 1)
    assert.match(lines[0], /^\[Gap\] Incoming /)
    assert.match(lines[0], /"status":"ok"/)
    assert.match(lines[0], /"userId":7/)
    assert.doesNotMatch(lines[0], /session-token|hidden|signature-prefix/)
    assert.match(lines[0], /\[redacted\]/)
  })
})
