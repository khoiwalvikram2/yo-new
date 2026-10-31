/**
 * canAccessExportCenterContext is ExportCenterWhitelabelGuard's rule lifted out of ExportsPage so the
 * dashboard's reports banner can ask the same question. The lift must not change who can open the Export
 * Center, so the first test runs a copy of the guard's original inline expression (ExportsPage.tsx before
 * the extraction) against the extracted function over every combination of the inputs below. The rest pin
 * the cases a reader would reason about, and the hook is checked against the stores the guard read.
 */
import { test, describe, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import { renderHook, act } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import { canAccessExportCenterContext, useCanAccessExportCenterContext } from './exportCenterAccess'

vi.mock('@/shared/core/uiStore', async () => {
  const { create } = await import('zustand')
  return { useUIStore: create<{ directorMode: 'core' | 'whitelabel' }>(() => ({ directorMode: 'core' })) }
})

async function uiStore() {
  const { useUIStore } = await import('@/shared/core/uiStore')
  return useUIStore
}

/** The guard's body before the extraction, verbatim apart from taking its three inputs as arguments. */
function originalGuardExpression(roles: string[], directorMode: 'core' | 'whitelabel', isAgent: boolean): boolean {
  const isWhitelabelAdmin = roles.some(
    (r) => r === 'Whitelabel Admin' || r.toLowerCase() === 'whitelabel_admin' || r.toLowerCase().includes('whitelabel')
  )
  const isSuperAdmin = roles.some(
    (r) => r === 'Super Admin' || r.toLowerCase() === 'super_admin' || (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
  )
  return isAgent || isWhitelabelAdmin || (isSuperAdmin && directorMode === 'whitelabel')
}

/* Role names seen in this codebase, plus the near misses the loose substring tests catch or skip. */
const ROLE_SETS: string[][] = [
  [],
  ['Super Admin'],
  ['super_admin'],
  ['SUPER ADMIN'],
  ['superadmin'],
  ['Super Viewer'],
  ['Whitelabel Admin'],
  ['whitelabel_admin'],
  ['Whitelabel Support'],
  ['Director Admin'],
  ['Director'],
  ['director_admin'],
  ['Reports Viewer'],
  ['Admin'],
  ['Reports Viewer', 'Super Admin'],
  ['Director', 'Whitelabel Admin'],
]

const MODES = ['core', 'whitelabel'] as const

const AGENT = {
  id: 'agent-export-center-test',
  tenantId: 'wl-export-center-test',
  username: 'zzexport-agent',
  phone: null,
  schemeType: 'SHARING',
  allowedDomains: ['sports'],
  status: 'ACTIVE',
  parentAgentId: null,
  levelIndex: 1,
  tallyEnabled: false,
  tallyDomains: null,
  createdAt: '2026-09-22T00:00:00.000Z',
}

describe('canAccessExportCenterContext', () => {
  test('answers exactly as the guard did for every role set, mode and agent flag', () => {
    let compared = 0
    for (const roles of ROLE_SETS) {
      for (const directorMode of MODES) {
        for (const isAgent of [false, true]) {
          assert.equal(
            canAccessExportCenterContext({ roles, directorMode, isAgent }),
            originalGuardExpression(roles, directorMode, isAgent),
            `roles=${JSON.stringify(roles)} mode=${directorMode} agent=${isAgent}`
          )
          compared += 1
        }
      }
    }
    assert.equal(compared, ROLE_SETS.length * MODES.length * 2)
  })

  test('an agent is always in context, whatever the roles and mode', () => {
    for (const directorMode of MODES) {
      assert.equal(canAccessExportCenterContext({ roles: [], directorMode, isAgent: true }), true)
    }
  })

  test('a Whitelabel Admin is in context in both modes', () => {
    for (const directorMode of MODES) {
      assert.equal(canAccessExportCenterContext({ roles: ['Whitelabel Admin'], directorMode, isAgent: false }), true)
      assert.equal(canAccessExportCenterContext({ roles: ['whitelabel_admin'], directorMode, isAgent: false }), true)
    }
  })

  test('a Super Admin is in context only in whitelabel mode', () => {
    assert.equal(canAccessExportCenterContext({ roles: ['Super Admin'], directorMode: 'whitelabel', isAgent: false }), true)
    assert.equal(canAccessExportCenterContext({ roles: ['Super Admin'], directorMode: 'core', isAgent: false }), false)
  })

  test('a Director, a Reports Viewer and a session with no roles are not', () => {
    for (const directorMode of MODES) {
      for (const roles of [['Director Admin'], ['Director'], ['Reports Viewer'], []]) {
        assert.equal(canAccessExportCenterContext({ roles, directorMode, isAgent: false }), false)
      }
    }
  })

  test('keeps the guard\'s loose substring tests', () => {
    // Any role containing "whitelabel" counts as a Whitelabel Admin, and any containing both "super" and
    // "admin" as a Super Admin. Pinned so a tidy-up cannot quietly change who opens the Export Center.
    assert.equal(canAccessExportCenterContext({ roles: ['Whitelabel Support'], directorMode: 'core', isAgent: false }), true)
    assert.equal(canAccessExportCenterContext({ roles: ['superadmin'], directorMode: 'whitelabel', isAgent: false }), true)
    assert.equal(canAccessExportCenterContext({ roles: ['Super Viewer'], directorMode: 'whitelabel', isAgent: false }), false)
  })
})

describe('useCanAccessExportCenterContext', () => {
  beforeEach(async () => {
    useAuthStore.setState({
      user: undefined,
      agent: undefined,
      roles: [],
      permissions: [],
      agentPermissions: [],
      token: undefined,
      isReadOnly: false,
    })
    const useUIStore = await uiStore()
    useUIStore.setState({ directorMode: 'core' })
  })

  test('reads the roles and follows the director switch', async () => {
    useAuthStore.setState({ user: { id: 'admin-export-center-test', name: 'Export Test Admin' }, roles: ['Super Admin'] })
    const { result } = renderHook(() => useCanAccessExportCenterContext())
    assert.equal(result.current, false)

    const useUIStore = await uiStore()
    act(() => useUIStore.setState({ directorMode: 'whitelabel' }))
    assert.equal(result.current, true)
  })

  test('lets an agent session in', () => {
    useAuthStore.setState({ agent: AGENT, roles: [] })
    const { result } = renderHook(() => useCanAccessExportCenterContext())
    assert.equal(result.current, true)
  })

  test('treats missing roles as none', () => {
    // The guard read `s.roles || []`; the hook defaults outside the selector and must agree.
    useAuthStore.setState({ roles: undefined as unknown as string[] })
    const { result } = renderHook(() => useCanAccessExportCenterContext())
    assert.equal(result.current, false)
  })
})
