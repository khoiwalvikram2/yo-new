#!/usr/bin/env node
/**
 * Discovers and runs every test file in the calling workspace.
 *
 * Hand-maintained test lists in package.json silently drop tests: before this
 * script existed, 14 of 34 test files were never run by any npm script.
 * Discovery removes that failure mode — a new *.test.ts runs automatically.
 *
 * Usage:
 *   node ../scripts/run-tests.mjs            # unit tests only
 *   node ../scripts/run-tests.mjs --integration   # *.integration.test.ts only
 *   node ../scripts/run-tests.mjs --all           # everything
 */
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

const mode = process.argv.includes('--all') ? 'all'
  : process.argv.includes('--integration') ? 'integration'
  : 'unit'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
if (!existsSync(SRC)) {
  console.error('no src/ directory in', ROOT)
  process.exit(1)
}

const found = []
;(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (/\.test\.tsx?$/.test(entry.name)) found.push(p)
  }
})(SRC)

const isIntegration = (f) => /\.integration\.test\.tsx?$/.test(f)
const files = found.filter((f) =>
  mode === 'all' ? true : mode === 'integration' ? isIntegration(f) : !isIntegration(f)
)

if (files.length === 0) {
  console.log(`no ${mode} tests found`)
  process.exit(0)
}

console.log(`running ${files.length} ${mode} test file(s):`)
for (const f of files) console.log('  ' + relative(ROOT, f))
console.log()

const args = ['--test', '--import', 'tsx']
if (existsSync(join(ROOT, '.env'))) args.unshift('--env-file-if-exists=.env')

const res = spawnSync(process.execPath, [...args, ...files], { stdio: 'inherit' })
process.exit(res.status ?? 1)
