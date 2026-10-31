import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'
import { navigationData, type NavigationSection } from './navigationData'
import { getNavigationForUser } from '@/shared/core/navigationUtils'
import { toShellSections } from '@/shell/panelRows'

const ui = vi.hoisted(() => ({ directorMode: 'core' as 'core' | 'whitelabel' }))
vi.mock('@/shared/core/uiStore', () => ({ useUIStore: { getState: () => ui } }))

function matkaRoutes(navigation: Record<string, NavigationSection>) {
  return toShellSections(navigation).flatMap(section => section.rows).filter(row => row.to.startsWith('/matka/')).map(row => row.to)
}
const allMatka = ['/matka/running', '/matka/results', '/matka/live', '/matka/management', '/matka/worli']

describe('Matka navigation follows granted permissions in each admin context', () => {
  beforeEach(() => { ui.directorMode = 'core' })

  test('grandwinn Whitelabel Admin can see all Matka pages with its existing flat read/write grants', () => {
    const nav = getNavigationForUser(navigationData, [{ domain: 'matka', actions: ['read', 'write'] }], ['Whitelabel Admin'])
    assert.deepEqual(matkaRoutes(nav), allMatka)
  })

  test('Super Admin can configure Matka while viewing the selected whitelabel', () => {
    ui.directorMode = 'whitelabel'
    const nav = getNavigationForUser(navigationData, [{ domain: 'all', actions: ['*'] }], ['Super Admin'])
    assert.deepEqual(matkaRoutes(nav), allMatka)
  })

  test('Super Admin core mode retains management while operational pages belong to the whitelabel', () => {
    const nav = getNavigationForUser(navigationData, [{ domain: 'all', actions: ['*'] }], ['Super Admin'])
    assert.deepEqual(matkaRoutes(nav), ['/matka/management'])
  })

  test('a management-only admin is not blocked by the unrelated Results permission on the parent', () => {
    const nav = getNavigationForUser(navigationData, [{ domain: 'matka.management', actions: ['view'] }], ['Operator'])
    assert.deepEqual(matkaRoutes(nav), ['/matka/management'])
  })

  test('a result viewer sees only its granted Matka page', () => {
    const nav = getNavigationForUser(navigationData, [{ domain: 'matka.results', actions: ['view'] }], ['Viewer'])
    assert.deepEqual(matkaRoutes(nav), ['/matka/running', '/matka/results'])
  })

  test('an admin without Matka grants gains no Matka links', () => {
    const nav = getNavigationForUser(navigationData, [{ domain: 'settlements.center', actions: ['view'] }], ['Finance Manager'])
    assert.deepEqual(matkaRoutes(nav), [])
  })
})
