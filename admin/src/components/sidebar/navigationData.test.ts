/**
 * Two navigation-data defects found by the 2026-11-03 verification. Super Admin's core mode showed two
 * "Management" rows under CASINO: the second was Matka Management, the Matka group's only row there, which loses
 * its heading. And a Whitelabel Admin had no link to the Chips page (/credit), where the whitelabel funds its root
 * agents, although the Agents entry promises "Management & Chips".
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'
import { navigationData } from './navigationData'
import { canOpenChipsPage } from '@/shared/core/chipsPageAccess'
import { getNavigationForUser } from '@/shared/core/navigationUtils'
import { toShellSections } from '@/shell/panelRows'

const ui = vi.hoisted(() => ({ directorMode: 'core' as 'core' | 'whitelabel' }))
vi.mock('@/shared/core/uiStore', () => ({ useUIStore: { getState: () => ui } }))

const WL_ADMIN_PERMISSIONS = [
  { domain: 'agents', actions: ['view', 'read', 'write', 'manage'] },
  { domain: 'players', actions: ['view', 'read', 'write', 'manage'] },
  { domain: 'users', actions: ['read', 'write'] },
]

function rows(permissions: { domain: string; actions: string[] }[], roles: string[]) {
  return toShellSections(getNavigationForUser(navigationData, permissions, roles)).flatMap((section) => section.rows)
}

beforeEach(() => { ui.directorMode = 'core' })

describe('a lone group child names its group', () => {
  test('Super Admin core mode: Casino keeps its Management row, Matka shows Matka Management', () => {
    const labels = rows([{ domain: 'all', actions: ['*'] }], ['Super Admin'])
      .filter((row) => row.to === '/casino/management' || row.to === '/matka/management')
      .map((row) => [row.to, row.label])
    assert.deepEqual(labels, [['/casino/management', 'Management'], ['/matka/management', 'Matka Management']])
  })

  test('in a group of several, the children keep their short labels under the heading', () => {
    ui.directorMode = 'whitelabel'
    const matka = rows([{ domain: 'all', actions: ['*'] }], ['Super Admin']).filter((row) => row.to.startsWith('/matka/'))
    assert.deepEqual(matka.map((row) => row.label), ['Running Markets', 'Results', 'Live Analysis', 'Management', 'Worli Markets'])
  })
})

describe('the Chips page in the admin navigation', () => {
  test('a Whitelabel Admin reaches /credit from the Agents entry', () => {
    const chips = rows(WL_ADMIN_PERMISSIONS, ['Whitelabel Admin']).filter((row) => row.to === '/credit')
    assert.deepEqual(chips.map((row) => [row.label, row.sectionKey]), [['Chips', 'userManagement']])
  })

  test('a staff role with agent access but no pool gets no link to a page that would refuse it', () => {
    assert.deepEqual(rows(WL_ADMIN_PERMISSIONS, ['Manager']).filter((row) => row.to === '/credit'), [])
  })

  test('Super Admin core mode has no whitelabel pool, so no Chips link', () => {
    assert.deepEqual(rows([{ domain: 'all', actions: ['*'] }], ['Super Admin']).filter((row) => row.to === '/credit'), [])
  })
})

/* T068: the link follows the page's own access rule (canOpenChipsPage), so everyone the page admits can reach it. */
describe('the Chips link for everyone who can open /credit', () => {
  // Finance Manager as live (grandwinn-com): the pool's permission, payments and settlements, but no agent access.
  const FINANCE_MANAGER = [
    { domain: 'credit.history', actions: ['view'] },
    { domain: 'credit.management', actions: ['view'] },
    { domain: 'credit.settlements', actions: ['view'] },
    { domain: 'payments.deposits', actions: ['approve', 'reject', 'view'] },
    { domain: 'payments.withdrawals', actions: ['approve', 'reject', 'view'] },
    { domain: 'settlements.center', actions: ['view'] },
  ]
  // Reports Viewer as live (grandwinn-com): agent access and the pool's permission.
  const REPORTS_VIEWER = [
    { domain: 'agents.list', actions: ['export', 'view'] },
    { domain: 'credit.management', actions: ['view'] },
    { domain: 'reporting.pnl', actions: ['view'] },
  ]
  const chips = (permissions: { domain: string; actions: string[] }[], roles: string[]) =>
    rows(permissions, roles).filter((row) => row.to === '/credit').map((row) => [row.label, row.sectionKey])

  test('a Finance Manager (credit.management:view, no agent access) gets the link, and no other Agents row', () => {
    const all = rows(FINANCE_MANAGER, ['Finance Manager'])
    assert.deepEqual(chips(FINANCE_MANAGER, ['Finance Manager']), [['Chips', 'userManagement']])
    assert.deepEqual(all.filter((row) => row.to.startsWith('/agents')), [], 'the pool permission opens no agent page')
    assert.equal(canOpenChipsPage(['Finance Manager'], FINANCE_MANAGER), true)
  })

  test('a Reports Viewer reaches it beside its agent rows', () => {
    assert.deepEqual(chips(REPORTS_VIEWER, ['Reports Viewer']), [['Chips', 'userManagement']])
    assert.ok(rows(REPORTS_VIEWER, ['Reports Viewer']).some((row) => row.to === '/agents'))
  })

  test('Super Admin in whitelabel mode gets it; in core mode it stays hidden (no pool there)', () => {
    ui.directorMode = 'whitelabel'
    assert.deepEqual(chips([{ domain: 'all', actions: ['*'] }], ['Super Admin']), [['Chips', 'userManagement']])
    ui.directorMode = 'core'
    assert.deepEqual(chips([{ domain: 'all', actions: ['*'] }], ['Super Admin']), [])
  })

  test('any other role the page admits by its name gets it too', () => {
    assert.equal(canOpenChipsPage(['Senior Whitelabel Manager'], []), true)
    assert.deepEqual(chips(WL_ADMIN_PERMISSIONS, ['Senior Whitelabel Manager']), [['Chips', 'userManagement']])
    assert.deepEqual(chips(WL_ADMIN_PERMISSIONS, ['whitelabel_admin']), [['Chips', 'userManagement']])
  })

  test('the link and the page agree for every role', () => {
    const cases: Array<[string[], { domain: string; actions: string[] }[]]> = [
      [['Whitelabel Admin'], WL_ADMIN_PERMISSIONS],
      [['Finance Manager'], FINANCE_MANAGER],
      [['Reports Viewer'], REPORTS_VIEWER],
      [['Manager'], WL_ADMIN_PERMISSIONS],
      [['Viewer'], [{ domain: 'reporting.pnl', actions: ['view'] }]],
      [['Compliance Officer'], [{ domain: 'agents.list', actions: ['view'] }, { domain: 'credit.history', actions: ['view'] }]],
    ]
    for (const [roles, permissions] of cases) {
      assert.equal(chips(permissions, roles).length === 1, canOpenChipsPage(roles, permissions), roles.join(','))
    }
  })
})
