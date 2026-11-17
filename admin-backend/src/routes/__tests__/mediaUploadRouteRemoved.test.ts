/**
 * Files are stored as base64 in their rows (owner decision 2026-11-04), so the admin API keeps no disk upload route.
 * POST /api/media/upload wrote files to a local ./uploads folder and nothing in admin, user, user-backend or
 * admin-backend called it: the route, its registration and its multipart parser are gone, and nothing serves ./uploads.
 *
 * No database: reads the server entry and the route modules.
 * Run: node --env-file-if-exists=.env --test --import tsx src/routes/__tests__/mediaUploadRouteRemoved.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const UPLOAD = /\/api\/media|@fastify\/multipart|@fastify\/static|fastifyStatic|['"`]\.?\/uploads['"`]/

/** A module's code without its comments, which may still name the removed route. */
const code = (file: string) =>
  readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('no disk upload route', () => {
  it('the media route module is gone and the server entry registers none', () => {
    assert.equal(existsSync(join(SRC, 'routes', 'media.ts')), false)
    const entry = code(join(SRC, 'index.ts'))
    assert.match(entry, /await registerGmagGameDataRoutes\(app\)/, 'reads the route registrations')
    assert.doesNotMatch(entry, /registerMediaRoutes|routes\/media/)
    assert.doesNotMatch(entry, UPLOAD)
  })

  it('no route module accepts a multipart upload or serves the uploads folder', () => {
    const modules = readdirSync(join(SRC, 'routes')).filter((file) => file.endsWith('.ts'))
    assert.ok(modules.includes('health.ts'), 'reads the route modules')
    for (const file of modules) assert.doesNotMatch(code(join(SRC, 'routes', file)), UPLOAD, file)
  })
})
