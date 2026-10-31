/**
 * The GlobalSearch Pages group (decision 10) turns panel rows into search results. Each page result must
 * carry the row's destination as both id and route, its label, and its section title as the subtitle, so
 * selecting it goes exactly where the panel row goes. usePageMatcher feeds useGlobalSearch, whose results and
 * keyboard-list memos depend on the callback: it must keep its identity while the navigation is unchanged,
 * and change when a Super Admin switches core/whitelabel mode, so the Pages group follows the panel.
 */
import { test, describe, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import { renderHook, act } from '@testing-library/react'
import { IconPoint } from '@tabler/icons-react'
import { navigationData } from '@/components/sidebar/navigationData'
import { useAuthStore } from '@/shared/core/authStore'
import { getAgentNavigation, getNavigationForUser } from '@/shared/core/navigationUtils'
import type { ShellRow } from './shellTypes'
import { matchPages, searchablePageRows } from './matchPages'
import { toShellSections } from './panelRows'
import { PAGE_RESULT_ICON, toPageSearchResults } from './pageSearchResults'
import { usePageMatcher } from './usePageMatcher'

vi.mock('@/shared/core/uiStore', async () => {
  const { create } = await import('zustand')
  return { useUIStore: create<{ directorMode: 'core' | 'whitelabel' }>(() => ({ directorMode: 'core' })) }
})

async function uiStore() {
  const { useUIStore } = await import('@/shared/core/uiStore')
  return useUIStore
}

function row(to: string, label: string, keywords: readonly string[] = [], extra: Partial<ShellRow> = {}): ShellRow {
  return {
    id: `test|${label}|${to}`,
    sectionKey: 'test',
    sectionTitle: 'Test',
    to,
    label,
    icon: IconPoint,
    keywords,
    badgeKey: null,
    ...extra,
  }
}

describe('toPageSearchResults', () => {
  test('the page icon is fa-file-lines', () => {
    assert.equal(PAGE_RESULT_ICON, 'fa-file-lines')
  })

  test('maps a row to a page result: destination as id and route, section title as subtitle', () => {
    const ledger = row('/finance/ledger', 'Ledger', ['ledger book'], { sectionKey: 'finance', sectionTitle: 'Finance' })
    assert.deepStrictEqual(toPageSearchResults([ledger]), [
      {
        type: 'page',
        id: '/finance/ledger',
        label: 'Ledger',
        subtitle: 'Finance',
        route: '/finance/ledger',
        icon: 'fa-file-lines',
      },
    ])
  })

  test('keeps input order, copies the destination verbatim and never mutates its input', () => {
    const rows = [row('/players?tab=all', 'All Players'), row('/bets/', 'Bet List')]
    const copies = rows.map((r) => ({ ...r }))
    const results = toPageSearchResults(rows)
    assert.deepStrictEqual(
      results.map((r) => [r.id, r.route, r.label]),
      [
        ['/players?tab=all', '/players?tab=all', 'All Players'],
        ['/bets/', '/bets/', 'Bet List'],
      ],
    )
    assert.deepStrictEqual(rows, copies)
    assert.deepStrictEqual(toPageSearchResults([]), [])
  })

  test('keeps the ranked order matchPages returns', () => {
    const rows = [
      row('/a', 'Settings', ['alpha deposit']),
      row('/b', 'Payments', ['deposits']),
      row('/c', 'Pending deposits'),
      row('/d', 'Deposit Requests'),
    ]
    assert.deepStrictEqual(
      toPageSearchResults(matchPages('dep', rows)).map((r) => r.label),
      ['Deposit Requests', 'Pending deposits', 'Payments', 'Settings'],
    )
  })
})

const SUPER_ADMIN_ROLES = ['Super Admin']
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

type Navigation = Parameters<typeof toShellSections>[0]

function expectedPages(query: string, navigation: Navigation) {
  return toPageSearchResults(matchPages(query, searchablePageRows(toShellSections(navigation))))
}

function signInSuperAdmin() {
  useAuthStore.setState({
    user: { id: 'admin-shell-test', name: 'Shell Test Admin' },
    agent: undefined,
    roles: SUPER_ADMIN_ROLES,
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

describe('usePageMatcher', () => {
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

  test("matches the signed-in admin's available navigation", () => {
    signInSuperAdmin()
    const { result } = renderHook(() => usePageMatcher())

    const report = result.current('report')
    assert.ok(report.length > 0 && report.length <= 8)
    assert.deepStrictEqual(
      report,
      expectedPages('report', getNavigationForUser(navigationData, ALL_PERMISSIONS, SUPER_ADMIN_ROLES)),
    )
    assert.deepStrictEqual(result.current('help'), [])
  })

  test('returns no pages below 2 characters, IP-like input included', () => {
    signInSuperAdmin()
    const { result } = renderHook(() => usePageMatcher())
    assert.deepStrictEqual(result.current(''), [])
    assert.deepStrictEqual(result.current('r'), [])
    assert.deepStrictEqual(result.current(' h '), [])
    assert.deepStrictEqual(result.current('1'), [])
  })

  test('keeps the same callback while the navigation is unchanged', () => {
    signInSuperAdmin()
    const { result, rerender } = renderHook(() => usePageMatcher())
    const first = result.current

    rerender()
    assert.equal(result.current, first)

    act(() => useAuthStore.setState({ isReadOnly: true }))
    assert.equal(result.current, first)
  })

  test('gives a new callback that follows a Super Admin core/whitelabel switch', async () => {
    const useUIStore = await uiStore()
    signInSuperAdmin()
    const { result } = renderHook(() => usePageMatcher())
    const core = result.current

    act(() => useUIStore.setState({ directorMode: 'whitelabel' }))
    assert.notEqual(result.current, core)
    assert.deepStrictEqual(
      result.current('report'),
      expectedPages('report', getNavigationForUser(navigationData, ALL_PERMISSIONS, SUPER_ADMIN_ROLES)),
    )
  })

  test("an agent matches on the agent's navigation", () => {
    signInAgent()
    const { result } = renderHook(() => usePageMatcher())

    const settle = result.current('settle')
    assert.deepStrictEqual(
      settle.map((page) => [page.label, page.route]),
      [['Settlement Center', '/settlement']],
    )
    assert.deepStrictEqual(settle, expectedPages('settle', getAgentNavigation(AGENT, AGENT.allowedDomains)))
  })
})
