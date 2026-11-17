/**
 * notifications.list and promotions.campaigns / promotions.content gate nothing since 2026-11-04: every admin opens its
 * own alerts and tasks without notifications.list (T068), and the Promotions pages were retired (MAR-14). They left
 * the catalogue the tenants are seeded from and the flat-to-nested map, and no permission check names them.
 *
 * No database: reads the catalogue and the source.
 * Run: node --env-file-if-exists=.env --test --import tsx src/config/__tests__/retiredPermissions.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NESTED_PERMISSIONS, getFlatPermissionsThatGrantNested } from '../nestedPermissions.js'

const RETIRED: Array<[string, string[]]> = [
  ['notifications.list', ['view', 'update']],
  ['promotions.campaigns', ['view', 'create', 'update', 'delete']],
  ['promotions.content', ['view', 'create', 'update', 'delete']],
]
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

/**
 * Files that may still name a retired code, neither of them as a check: the role editor leaves them out of the
 * tenants' permission rows, and rbacRepo's Marketing Manager template still seeds the Promotions pair.
 */
const MAY_NAME = new Set(['admin/src/routes/security/roles/roleFormModel.ts', 'admin-backend/src/repos/rbac/rbacRepo.ts'])

/** Every source file (tests, builds and dependencies left out) that quotes one of the retired codes. */
function quotingSources(): string[] {
  const quoted = /["'`](?:notifications\.list|promotions\.campaigns|promotions\.content)(?::[a-z]+)?["'`]/
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        if (!['node_modules', 'dist', '__tests__'].includes(entry)) walk(path)
      } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) && quoted.test(readFileSync(path, 'utf8'))) {
        found.push(relative(REPO, path).replace(/\\/g, '/'))
      }
    }
  }
  for (const root of ['admin-backend/src', 'user-backend/src', 'shared/src', 'admin/src', 'crm/src']) walk(join(REPO, root))
  return found
}

describe('the retired permissions', () => {
  it('are not in the catalogue the tenants are seeded from', () => {
    const seeded = new Set(NESTED_PERMISSIONS.map((p) => p.domain))
    for (const [domain] of RETIRED) assert.equal(seeded.has(domain), false, domain)
  })

  it('are granted by no flat permission any more', () => {
    for (const [domain, actions] of RETIRED) {
      for (const action of actions) assert.deepEqual(getFlatPermissionsThatGrantNested(domain, action), [], `${domain}:${action}`)
    }
    // The map itself still answers for the permissions that stay.
    assert.deepEqual(getFlatPermissionsThatGrantNested('credit.management', 'view'), [{ domain: 'credit', action: 'read' }])
  })

  it('are checked nowhere in the backends or the admin panel', () => {
    assert.deepEqual(quotingSources().filter((file) => !MAY_NAME.has(file)), [])
  })
})
