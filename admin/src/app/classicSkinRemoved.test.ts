/**
 * G601 (owner, 2026-11-04): the classic admin look is removed. localStorage 'admin-skin' = 'classic' used to
 * make index.html set <html data-skin="classic">, which switched the player skin off. These checks keep the
 * switch from coming back. The player-skin CSS blocks keep their html:not([data-skin='classic']) scope on
 * purpose (with nothing setting data-skin they always apply), so only classic-only selectors are refused.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { test } from 'vitest'

const SRC = resolve('src')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(path, out)
    else out.push(path)
  }
  return out
}

test('the boot script sets only the theme, even for a browser that still stores admin-skin = classic', () => {
  const entry = readFileSync(resolve('index.html'), 'utf8')
  const script = entry.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(script)
  const attributes: Record<string, string> = {}
  const readKeys: string[] = []
  runInNewContext(script, {
    window: {
      localStorage: { getItem: (key: string) => { readKeys.push(key); return key === 'admin-skin' ? 'classic' : null } },
      matchMedia: () => ({ matches: false }),
    },
    document: { documentElement: { setAttribute: (name: string, value: string) => { attributes[name] = value } } },
  })
  assert.deepEqual(attributes, { 'data-theme': 'light' })
  assert.deepEqual(readKeys, ['theme-mode'])
  assert.equal(/admin-skin|data-skin/.test(entry), false, 'index.html no longer mentions the skin switch')
})

test('no app code reads or sets the skin switch', () => {
  const offenders = sourceFiles(SRC)
    .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file))
    .filter((file) => /admin-skin|data-skin|dataset\.skin/.test(readFileSync(file, 'utf8')))
    .map((file) => relative(SRC, file))
  assert.deepEqual(offenders, [])
})

test('no CSS rule applies only under the classic skin', () => {
  const offenders: string[] = []
  for (const file of sourceFiles(SRC).filter((name) => name.endsWith('.css'))) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of css.matchAll(/\[data-skin/g)) {
      if (!css.slice(0, match.index).endsWith(':not(')) offenders.push(relative(SRC, file))
    }
  }
  assert.deepEqual(offenders, [])
})
