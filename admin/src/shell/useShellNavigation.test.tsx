/**
 * useShellNavigation is the only place the new shell gets its navigation from. It must call
 * getNavigationForUser / getAgentNavigation with the inputs the old Sidebar passes, so no role gains or loses
 * a page. It must recompute when a Super Admin switches core/whitelabel mode, because getNavigationForUser
 * reads that mode synchronously from uiStore. And it must return the same array while its inputs are
 * unchanged, so the rail, panel and Pages-search memos do not rerun on every render.
 */
import { test, describe, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import { renderHook, act } from '@testing-library/react'
import { navigationData } from '@/components/sidebar/navigationData'
import { useAuthStore } from '@/shared/core/authStore'
import { getAgentNavigation, getNavigationForUser } from '@/shared/core/navigationUtils'
import { toShellSections } from './panelRows'
import type { ShellSection } from './shellTypes'
import { useShellNavigation } from './useShellNavigation'

vi.mock('@/shared/core/uiStore', async () => {
  const { create } = await import('zustand')
  return { useUIStore: create<{ directorMode: 'core' | 'whitelabel' }>(() => ({ directorMode: 'core' })) }
})

async function uiStore() {
  const { useUIStore } = await import('@/shared/core/uiStore')
  return useUIStore
}

const SUPER_ADMIN_ROLES = ['Super Admin']
const ADMIN_ROLES = ['Admin']
const ALL_PERMISSIONS = [{ domain: 'all', actions: ['*'] }]

const AGENT = {
  id: 'agent-shell-test',
  tenantId: 'wl-shell-test',
  username: 'zzshell-sharing',
  phone: null,
  schemeType: 'SHARING' as const,
  allowedDomains: ['sports'],
  status: 'ACTIVE',
  parentAgentId: null,
  levelIndex: 1,
  tallyEnabled: false,
  tallyDomains: null,
  createdAt: '2026-09-15T00:00:00.000Z',
}

function signInAdmin(roles: string[]) {
  useAuthStore.setState({
    user: { id: 'admin-shell-test', name: 'Shell Test Admin' },
    agent: undefined,
    roles,
    permissions: ALL_PERMISSIONS,
    agentPermissions: [],
  })
}

function signInAgent() {
  useAuthStore.setState({
    user: undefined,
    agent: AGENT,
    roles: [],
    permissions: [],
    agentPermissions: [],
  })
}

function sectionKeys(sections: readonly ShellSection[]): string[] {
  return sections.map((section) => section.key)
}

describe('useShellNavigation', () => {
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

  test("the uiStore mock reaches navigationUtils.ts's './uiStore' import", async () => {
    const useUIStore = await uiStore()
    const core = getNavigationForUser(navigationData, ALL_PERMISSIONS, SUPER_ADMIN_ROLES)
    useUIStore.setState({ directorMode: 'whitelabel' })
    const whitelabel = getNavigationForUser(navigationData, ALL_PERMISSIONS, SUPER_ADMIN_ROLES)
    // navigationData.ts: userManagement has showInWhitelabelMode: true and showInCoreMode: false
    assert.equal('userManagement' in core, false)
    assert.equal('userManagement' in whitelabel, true)
  })

  test('an admin gets getNavigationForUser(navigationData, permissions, roles) as shell sections', () => {
    signInAdmin(SUPER_ADMIN_ROLES)
    const { result } = renderHook(() => useShellNavigation())

    const expected = toShellSections(getNavigationForUser(navigationData, ALL_PERMISSIONS, SUPER_ADMIN_ROLES))
    assert.deepStrictEqual(result.current, expected)
    // the dashboard opens inside Trading, at its top (one rail button for both)
    assert.equal(result.current[0]?.key, 'trading')
    assert.equal(result.current[0]?.rows[0]?.to, '/overview')
    assert.equal(sectionKeys(result.current).includes('userManagement'), false)
  })

  test('an agent gets getAgentNavigation(agent, agent.allowedDomains) as shell sections', () => {
    signInAgent()
    const { result } = renderHook(() => useShellNavigation())

    const expected = toShellSections(getAgentNavigation(AGENT, AGENT.allowedDomains))
    assert.deepStrictEqual(result.current, expected)
    assert.equal(result.current[0]?.rows[0]?.to, '/agent')
    const destinations = result.current.flatMap((section) => section.rows.map((row) => row.to))
    assert.equal(destinations.includes('/overview'), false)
  })

  test('switching the signed-in principal from an admin to an agent recomputes from the agent branch', () => {
    signInAdmin(SUPER_ADMIN_ROLES)
    const { result } = renderHook(() => useShellNavigation())
    assert.equal(result.current[0]?.rows[0]?.to, '/overview')

    act(() => signInAgent())

    assert.deepStrictEqual(result.current, toShellSections(getAgentNavigation(AGENT, AGENT.allowedDomains)))
    assert.equal(result.current[0]?.rows[0]?.to, '/agent')
  })

  test('returns the same array while its inputs are unchanged', () => {
    signInAdmin(SUPER_ADMIN_ROLES)
    const { result, rerender } = renderHook(() => useShellNavigation())
    const first = result.current

    rerender()
    assert.equal(result.current, first)

    act(() => useAuthStore.setState({ isReadOnly: true }))
    assert.equal(result.current, first)
  })

  test('recomputes when directorMode changes, and getNavigationForUser sees the new mode', async () => {
    const useUIStore = await uiStore()
    signInAdmin(SUPER_ADMIN_ROLES)
    const { result } = renderHook(() => useShellNavigation())
    const core = result.current
    assert.equal(sectionKeys(core).includes('userManagement'), false)

    act(() => useUIStore.setState({ directorMode: 'whitelabel' }))
    assert.notEqual(result.current, core)
    assert.equal(sectionKeys(result.current).includes('userManagement'), true)
    assert.deepStrictEqual(
      result.current,
      toShellSections(getNavigationForUser(navigationData, ALL_PERMISSIONS, SUPER_ADMIN_ROLES)),
    )

    act(() => useUIStore.setState({ directorMode: 'core' }))
    assert.equal(sectionKeys(result.current).includes('userManagement'), false)
  })

  test('an admin who is not a Super Admin gets the same sections in both modes', async () => {
    const useUIStore = await uiStore()
    signInAdmin(ADMIN_ROLES)
    const { result } = renderHook(() => useShellNavigation())
    const core = result.current

    act(() => useUIStore.setState({ directorMode: 'whitelabel' }))
    assert.deepStrictEqual(result.current, core)
  })
})
