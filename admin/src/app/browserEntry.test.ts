import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { test } from 'vitest'

const entry = readFileSync(resolve('index.html'), 'utf8')

test('the browser entry uses a real branded favicon instead of the missing starter asset', () => {
  assert.match(entry, /rel="icon"[^>]*href="\/favicon\.svg"/)
  assert.equal(entry.includes('/vite.svg'), false)
  const favicon = readFileSync(resolve('public/favicon.svg'), 'utf8')
  assert.match(favicon, /<svg[^>]*viewBox="0 0 48 48"/)
  assert.match(favicon, /<title>GameDash<\/title>/)
})

test.each([
  { raw: null, systemDark: true, expected: 'light' },
  { raw: '{"state":{"mode":"dark"}}', systemDark: false, expected: 'dark' },
  { raw: '{"state":{"mode":"light"}}', systemDark: true, expected: 'light' },
  { raw: '{"state":{"mode":"system"}}', systemDark: true, expected: 'dark' },
  { raw: '{"state":{"mode":"system"}}', systemDark: false, expected: 'light' },
  { raw: 'invalid storage', systemDark: true, expected: 'light' },
])('sets $expected before the app loads for preference $raw and system dark $systemDark', ({ raw, systemDark, expected }) => {
  const script = entry.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(script)
  const attributes: Record<string, string> = {}
  runInNewContext(script, {
    window: {
      localStorage: { getItem: (key: string) => key === 'theme-mode' ? raw : null },
      matchMedia: () => ({ matches: systemDark }),
    },
    document: { documentElement: { setAttribute: (name: string, value: string) => { attributes[name] = value } } },
  })
  assert.equal(attributes['data-theme'], expected)
})
