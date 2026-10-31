/**
 * panelRows maps one NavigationSection into ShellEntry[]: a row for a leaf or single-child item, a group
 * heading for an item with >= 2 children and badge placement (heading vs. row, decision 5). These rows feed the rail's badge, the
 * contextual panel and Pages search, so getting the single-child and group shapes wrong breaks all three.
 */
import assert from 'node:assert/strict'
import { describe, test, vi } from 'vitest'
import {
  IconArrowUp,
  IconBuilding,
  IconChartLine,
  IconClipboardList,
  IconCoins,
  IconPoint,
  IconTicket,
  IconWallet,
} from '@tabler/icons-react'
import type { NavItem, NavSection, NavigationSection } from '@/components/sidebar/navigationData'
import { isShellBadgeKey, panelRows, SHELL_BADGE_KEYS } from './panelRows'

// panelRows never reaches navigationUtils.ts (it only imports types from navigationData.ts), but every
// shell test mocks uiStore for consistency with the tests that do (contracts §8.9, §14).
const ui = vi.hoisted(() => ({ directorMode: 'core' as 'core' | 'whitelabel' }))
vi.mock('@/shared/core/uiStore', () => ({ useUIStore: { getState: () => ui } }))

function navSection(label: string, items: NavItem[]): NavSection {
  return { label, items }
}

describe('SHELL_BADGE_KEYS / isShellBadgeKey', () => {
  test('SHELL_BADGE_KEYS is the BadgeCounts key list NavItem.badgeKey is guarded against', () => {
    assert.deepEqual(SHELL_BADGE_KEYS, [
      'deposits',
      'withdrawals',
      'payments',
      'sportsEvents',
      'matkaDraws',
      'agentRequests',
      'alerts',
    ])
  })

  test('isShellBadgeKey accepts only the known keys', () => {
    for (const key of SHELL_BADGE_KEYS) assert.equal(isShellBadgeKey(key), true)
    assert.equal(isShellBadgeKey('refunds'), false)
    assert.equal(isShellBadgeKey(undefined), false)
    assert.equal(isShellBadgeKey(42), false)
  })
})

describe('panelRows: leaf and no-children items', () => {
  test('item with no children becomes a row; badge on the row', () => {
    const item: NavItem = {
      key: 'deposits',
      to: '/payments/deposits',
      icon: 'fa-solid fa-wallet',
      label: 'Deposit Requests',
      badgeKey: 'payments',
      keywords: ['deposits', 'pending'],
    }
    const entries = panelRows('finance', navSection('Finance', [item]))
    assert.equal(entries.length, 1)
    const entry = entries[0]
    assert.equal(entry.kind, 'row')
    if (entry.kind !== 'row') throw new Error('unreachable')
    assert.deepEqual(entry.row, {
      id: 'finance|deposits|/payments/deposits',
      sectionKey: 'finance',
      sectionTitle: 'Finance',
      to: '/payments/deposits',
      label: 'Deposit Requests',
      icon: IconWallet,
      keywords: ['deposits', 'pending'],
      badgeKey: 'payments',
    })
  })

  test('item with children: [] is treated as no children; source key falls back to item.to', () => {
    const item: NavItem = {
      to: '/matka/results',
      icon: 'fa-solid fa-ticket',
      label: 'Matka',
      children: [],
    }
    const entries = panelRows('trading', navSection('Trading', [item]))
    assert.equal(entries.length, 1)
    const entry = entries[0]
    if (entry.kind !== 'row') throw new Error('unreachable')
    assert.deepEqual(entry.row, {
      id: 'trading|/matka/results|/matka/results',
      sectionKey: 'trading',
      sectionTitle: 'Trading',
      to: '/matka/results',
      label: 'Matka',
      icon: IconTicket,
      keywords: [],
      badgeKey: null,
    })
  })

  test('badgeKey outside SHELL_BADGE_KEYS becomes null', () => {
    const item: NavItem = { key: 'x', to: '/x', icon: 'fa-solid fa-box', label: 'X', badgeKey: 'refunds' }
    const entries = panelRows('system', navSection('System', [item]))
    if (entries[0].kind !== 'row') throw new Error('unreachable')
    assert.equal(entries[0].row.badgeKey, null)
  })

  test('source key uses item.to when item.key is absent (Audit Trail shape)', () => {
    const item: NavItem = { to: '/audit/events', icon: 'fa-solid fa-clipboard-list', label: 'Audit Trail' }
    const entries = panelRows('system', navSection('System', [item]))
    if (entries[0].kind !== 'row') throw new Error('unreachable')
    assert.equal(entries[0].row.id, 'system|/audit/events|/audit/events')
    assert.equal(entries[0].row.icon, IconClipboardList)
  })

  test('an FA name outside NAV_ICONS falls back to IconPoint', () => {
    const item: NavItem = { key: 'promo', to: '/promotions', icon: 'fa-solid fa-rocket', label: 'Promotions' }
    const entries = panelRows('marketing', navSection('Marketing', [item]))
    if (entries[0].kind !== 'row') throw new Error('unreachable')
    assert.equal(entries[0].row.icon, IconPoint)
  })

  test('a section key outside SECTION_META falls back to the section label for sectionTitle', () => {
    const item: NavItem = { key: 'x', to: '/x', icon: 'fa-solid fa-box', label: 'X' }
    const entries = panelRows('promotions', navSection('Promotions', [item]))
    if (entries[0].kind !== 'row') throw new Error('unreachable')
    assert.equal(entries[0].row.sectionTitle, 'Promotions')
  })
})

describe('panelRows: single-child item', () => {
  test('exactly one child becomes the child\'s row; keywords = child + item label + item keywords; badge on the row', () => {
    const item: NavItem = {
      key: 'payments',
      to: '/payments',
      icon: 'fa-solid fa-wallet',
      label: 'Payments',
      badgeKey: 'payments',
      keywords: ['money'],
      children: [
        { to: '/payments/deposits', icon: 'fa-solid fa-coins', label: 'Deposit Requests', keywords: ['deposits', 'pending'] },
      ],
    }
    const entries = panelRows('finance', navSection('Finance', [item]))
    assert.equal(entries.length, 1)
    const entry = entries[0]
    if (entry.kind !== 'row') throw new Error('unreachable')
    assert.deepEqual(entry.row, {
      id: 'finance|payments|/payments/deposits',
      sectionKey: 'finance',
      sectionTitle: 'Finance',
      to: '/payments/deposits',
      label: 'Deposit Requests',
      icon: IconCoins,
      keywords: ['deposits', 'pending', 'payments', 'money'],
      badgeKey: 'payments',
    })
  })
})

describe('panelRows: group (>= 2 children)', () => {
  test('badge on the heading, rows badge null, landing child inherits item label + keywords', () => {
    const item: NavItem = {
      key: 'payments',
      to: '/payments/deposits',
      icon: 'fa-solid fa-wallet',
      label: 'Payments',
      badgeKey: 'payments',
      keywords: ['money'],
      children: [
        { to: '/payments/deposits', icon: 'fa-solid fa-coins', label: 'Deposit Requests', keywords: ['deposits', 'pending'] },
        { to: '/payments/withdrawals/', icon: 'fa-solid fa-arrow-up', label: 'Withdrawal Requests', keywords: ['withdrawals'] },
      ],
    }
    const entries = panelRows('finance', navSection('Finance', [item]))
    assert.equal(entries.length, 1)
    const entry = entries[0]
    assert.equal(entry.kind, 'group')
    if (entry.kind !== 'group') throw new Error('unreachable')
    assert.equal(entry.id, 'finance|payments')
    assert.equal(entry.label, 'Payments')
    assert.equal(entry.badgeKey, 'payments')
    assert.equal(entry.rows.length, 2)
    assert.deepEqual(entry.rows[0], {
      id: 'finance|payments|/payments/deposits',
      sectionKey: 'finance',
      sectionTitle: 'Finance',
      to: '/payments/deposits',
      label: 'Deposit Requests',
      icon: IconCoins,
      keywords: ['deposits', 'pending', 'payments', 'money'],
      badgeKey: null,
    })
    assert.deepEqual(entry.rows[1], {
      id: 'finance|payments|/payments/withdrawals/',
      sectionKey: 'finance',
      sectionTitle: 'Finance',
      to: '/payments/withdrawals/',
      label: 'Withdrawal Requests',
      icon: IconArrowUp,
      keywords: ['withdrawals'],
      badgeKey: null,
    })
  })
})

describe('panelRows: special sections', () => {
  test("admin overview (to === '/overview') has one real Overview row", () => {
    const special: NavigationSection = {
      to: '/overview',
      icon: 'fa-solid fa-chart-line',
      label: 'Dashboard',
      isSpecial: true,
    }
    const entries = panelRows('overview', special)
    assert.equal(entries.length, 1)

    const overview = entries[0]
    if (overview.kind !== 'row') throw new Error('unreachable')
    assert.deepEqual(overview.row, {
      id: 'overview|overview|/overview',
      sectionKey: 'overview',
      sectionTitle: 'Analytics',
      to: '/overview',
      label: 'Overview',
      icon: IconChartLine,
      keywords: ['dashboard'],
      badgeKey: null,
    })

  })

  test("any other special (agent '/agent') becomes one row with the data label", () => {
    const special: NavigationSection = {
      to: '/agent',
      icon: 'fa-solid fa-building',
      label: 'Dashboard',
      isSpecial: true,
    }
    const entries = panelRows('overview', special)
    assert.equal(entries.length, 1)
    const entry = entries[0]
    if (entry.kind !== 'row') throw new Error('unreachable')
    assert.deepEqual(entry.row, {
      id: 'overview|overview|/agent',
      sectionKey: 'overview',
      sectionTitle: 'Analytics',
      to: '/agent',
      label: 'Dashboard',
      icon: IconBuilding,
      keywords: [],
      badgeKey: null,
    })
  })
})

describe('panelRows: purity', () => {
  test('never mutates its input', () => {
    const section: NavSection = {
      label: 'Finance',
      items: [
        {
          key: 'payments',
          to: '/payments/deposits',
          icon: 'fa-solid fa-wallet',
          label: 'Payments',
          badgeKey: 'payments',
          keywords: ['money'],
          children: [
            { to: '/payments/deposits', icon: 'fa-solid fa-coins', label: 'Deposit Requests', keywords: ['deposits', 'pending'] },
            { to: '/payments/withdrawals', icon: 'fa-solid fa-arrow-up', label: 'Withdrawal Requests', keywords: ['withdrawals'] },
          ],
        },
      ],
    }
    const before = JSON.parse(JSON.stringify(section)) as unknown
    panelRows('finance', section)
    assert.deepEqual(JSON.parse(JSON.stringify(section)) as unknown, before)
  })
})
