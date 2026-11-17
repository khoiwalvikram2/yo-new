/**
 * toShellSections turns the navigation utilities' ordered Record into the sections the rail, the panel and the
 * Pages search all read, so a mistake here shows up in three places at once. The rail must keep the order the
 * utilities return (role order for admins, getAgentNavigation's order for agents). It must not show a button for
 * a section with nothing in it: a CREDIT agent's marketing has items: []. And it must keep the Payments count on
 * Finance wherever permission filtering leaves the Payments item. The dashboard section (Analytics: one Overview
 * row, or an agent's Dashboard) has no rail button of its own: it opens at the top of Trading (the owner,
 * 2026-10-21), unless there is no Trading section to hold it.
 */
import { test, describe, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import {
  IconChartBar,
  IconCube,
  IconGift,
  IconHeartHandshake,
  IconHistory,
  IconLink,
  IconPoint,
  IconSettings,
  IconStack2,
  IconUsers,
  IconWallet,
} from '@tabler/icons-react'
import { navigationData, type NavSection, type NavigationSection } from '@/components/sidebar/navigationData'
import { getAgentNavigation, type AgentAccount } from '@/shared/core/navigationUtils'
import { mergeOverviewIntoTrading, toShellSections } from './panelRows'
import type { ShellSection } from './shellTypes'

// navigationUtils.ts:2 imports ./uiStore, which loads the Apollo client at import time. Replace it (contracts §14).
const ui = vi.hoisted(() => ({ directorMode: 'core' as 'core' | 'whitelabel' }))
vi.mock('@/shared/core/uiStore', () => ({ useUIStore: { getState: () => ui } }))

const rawSections = (nav: Readonly<Record<string, NavigationSection>> = navigationData) => toShellSections(nav)

const agentSections = (schemeType: AgentAccount['schemeType'], allowedDomains: string[], levelIndex: number | null) =>
  toShellSections(getAgentNavigation({ id: 'agent-1', schemeType, allowedDomains, levelIndex }, allowedDomains))

function sectionByKey(sections: readonly ShellSection[], key: string): ShellSection {
  const found = sections.find((section) => section.key === key)
  if (!found) throw new Error(`no section ${key}`)
  return found
}

const tos = (section: ShellSection) => section.rows.map((row) => row.to)
const rowCount = (sections: readonly ShellSection[]) => sections.reduce((total, section) => total + section.rows.length, 0)

function itemsSection(key: string): NavSection {
  const section = navigationData[key]
  if (!section || !('items' in section)) throw new Error(`${key} is not an items section`)
  return section
}

function paymentsItem() {
  const item = itemsSection('finance').items.find((candidate) => candidate.badgeKey === 'payments')
  if (!item) throw new Error('finance has no item with badgeKey payments')
  return item
}

beforeEach(() => {
  ui.directorMode = 'core'
})

describe('toShellSections — admin navigationData', () => {
  test('keeps the Record order and yields 62 rows including live support', () => {
    const sections = rawSections()
    assert.deepEqual(
      sections.map((section) => section.key),
      ['trading', 'userManagement', 'marketing', 'finance', 'reporting', 'system'],
    )
    // 62 since 2026-11-03: Agents gained Chips (/credit), the whitelabel's Chips page.
    assert.equal(rowCount(sections), 62)
  })

  test('takes titles, subtitles and icons from sectionMeta', () => {
    const sections = rawSections()
    assert.deepEqual(
      sections.map((section) => [section.key, section.title, section.subtitle]),
      [
        ['trading', 'Trading', 'Overview, markets and bets'],
        ['userManagement', 'Users', 'Players and agents'],
        ['marketing', 'Marketing', 'Bonuses, referrals and VIP'],
        ['finance', 'Finance', 'Money in and money out'],
        ['reporting', 'Reporting', 'Numbers you can export'],
        ['system', 'System', 'Access and configuration'],
      ],
    )
    const icons = sections.map((section) => section.icon)
    const expected = [IconCube, IconUsers, IconGift, IconWallet, IconStack2, IconSettings]
    assert.equal(icons.length, expected.length)
    icons.forEach((icon, i) => assert.equal(icon, expected[i]))
  })

  test('every row carries its own section key and title', () => {
    for (const section of rawSections()) {
      for (const row of section.rows) {
        assert.equal(row.sectionKey, section.key)
        assert.equal(row.sectionTitle, section.title)
      }
    }
  })

  test('rows are the entries flattened in display order, and never empty', () => {
    for (const section of rawSections()) {
      const flattened = section.entries.flatMap((entry) => (entry.kind === 'row' ? [entry.row] : entry.rows))
      assert.ok(section.rows.length > 0, `${section.key} has no rows`)
      assert.equal(section.rows.length, flattened.length)
      section.rows.forEach((row, i) => assert.equal(row, flattened[i]))
    }
    const finance = sectionByKey(rawSections(), 'finance')
    assert.deepEqual(
      finance.rows.map((row) => row.label),
      ['Deposit Requests', 'Withdrawal Requests', 'Payout Account Approvals', 'Payment Methods', 'Settlement Center'],
    )
  })

  test('puts the Payments count on Finance and on no other rail button', () => {
    const sections = rawSections()
    assert.equal(sectionByKey(sections, 'finance').badgeKey, 'payments')
    assert.deepEqual(
      sections.filter((section) => section.badgeKey !== null).map((section) => section.key),
      ['finance'],
    )
  })

  test('opens the Overview at the top of Trading, under Trading, with unique ids', () => {
    const trading = sectionByKey(rawSections(), 'trading')
    const first = trading.entries[0]
    assert.equal(first.kind, 'row')
    assert.deepEqual(first.kind === 'row' ? [first.row.label, first.row.to, first.row.sectionKey, first.row.sectionTitle] : null, ['Overview', '/overview', 'trading', 'Trading'])
    assert.equal(trading.rows[0], first.kind === 'row' ? first.row : null)
    assert.equal(trading.rows[0].eyebrow, 'Analytics', 'the dashboard page still reads Analytics')
    assert.equal(trading.rows[1].eyebrow, undefined)
    const ids = rawSections().flatMap((section) => section.rows.map((row) => row.id))
    assert.equal(new Set(ids).size, ids.length)
  })

  test('the dashboard keeps its own button when there is no Trading section', () => {
    const { trading: _trading, ...withoutTrading } = navigationData
    void _trading
    const sections = rawSections(withoutTrading)
    assert.equal(sections[0].key, 'overview')
    assert.equal(sections[0].title, 'Analytics')
    assert.equal(sections[0].icon, IconChartBar)
    assert.deepEqual(tos(sections[0]), ['/overview'])
  })

  test('the merge leaves sections without a dashboard untouched', () => {
    const sections = rawSections({ finance: itemsSection('finance') })
    assert.deepEqual(mergeOverviewIntoTrading(sections), sections)
  })

  test('does not mutate its input', () => {
    const before = JSON.stringify(navigationData)
    rawSections()
    assert.equal(JSON.stringify(navigationData), before)
  })
})

describe('toShellSections — shapes built from real entries', () => {
  test('drops a section whose items are empty and keeps the order of the rest', () => {
    const sections = rawSections({
      ...navigationData,
      marketing: { label: 'Marketing & Engagement', icon: 'fa-solid fa-bullhorn', items: [] },
    })
    assert.deepEqual(
      sections.map((section) => section.key),
      ['trading', 'userManagement', 'finance', 'reporting', 'system'],
    )
  })

  test('falls back to the section label, no subtitle and IconPoint for an unknown key', () => {
    const sections = rawSections({
      promotions: {
        label: 'Promotions',
        items: [
          { to: '/promotions/campaigns', icon: 'fa-solid fa-bullhorn', label: 'Campaigns' },
          { to: '/promotions/content', icon: 'fa-solid fa-rocket', label: 'Content' },
        ],
      },
    })
    assert.equal(sections.length, 1)
    assert.equal(sections[0].key, 'promotions')
    assert.equal(sections[0].title, 'Promotions')
    assert.equal(sections[0].subtitle, null)
    assert.equal(sections[0].icon, IconPoint)
    assert.deepEqual(tos(sections[0]), ['/promotions/campaigns', '/promotions/content'])
    assert.equal(sections[0].rows[0].sectionTitle, 'Promotions')
  })

  test('keeps the rail badge when filtering leaves Payments a single child', () => {
    const finance = itemsSection('finance')
    const payments = paymentsItem()
    const firstChild = payments.children?.[0]
    if (!firstChild) throw new Error('Payments has no children')
    const sections = rawSections({ finance: { ...finance, items: [{ ...payments, children: [firstChild] }] } })
    assert.equal(sections[0].entries[0].kind, 'row')
    assert.equal(sections[0].rows[0].badgeKey, 'payments')
    assert.equal(sections[0].badgeKey, 'payments')
  })

  test('keeps the rail badge when Payments has no children', () => {
    const finance = itemsSection('finance')
    const payments = paymentsItem()
    const sections = rawSections({ finance: { ...finance, items: [{ ...payments, children: undefined }] } })
    assert.equal(sections[0].rows[0].label, 'Payments')
    assert.equal(sections[0].rows[0].badgeKey, 'payments')
    assert.equal(sections[0].badgeKey, 'payments')
  })

  test('ignores a badgeKey that is not a BadgeCounts key', () => {
    const finance = itemsSection('finance')
    const payments = paymentsItem()
    const sections = rawSections({ finance: { ...finance, items: [{ ...payments, badgeKey: 'refunds' }] } })
    assert.equal(sections[0].badgeKey, null)
  })

  test('returns no sections for an empty navigation record', () => {
    assert.deepEqual(rawSections({}), [])
  })
})

describe('toShellSections — getAgentNavigation output', () => {
  test('A1 CREDIT agent: empty marketing is skipped; the Dashboard → /agent opens Trading', () => {
    const sections = agentSections('CREDIT', ['sports', 'casino', 'matka'], 1)
    assert.deepEqual(
      sections.map((section) => section.key),
      ['trading', 'userManagement', 'finance', 'reporting'],
    )
    // 20 rows: a CREDIT agent's finance is its Chips page alone (no Settlement Center since 2026-11-02).
    assert.equal(rowCount(sections), 20)
    // Every agent scheme has the Export Center (owner decision 4, 2026-10-22), last under Reporting,
    // whatever its domains and level.
    for (const scheme of ['CREDIT', 'SHARING', 'COMMISSION'] as const) {
      for (const [domains, level] of [[['sports', 'casino', 'matka'], 1], [[], 4]] as const) {
        const reporting = sectionByKey(agentSections(scheme, [...domains], level), 'reporting')
        const last = reporting.rows[reporting.rows.length - 1]
        assert.deepEqual(
          [last.label, last.to],
          ['Export Center', '/reporting/exports'],
          `${scheme} ${domains.join('+') || 'no domains'} level ${level}`,
        )
      }
    }
    const trading = sectionByKey(sections, 'trading')
    assert.equal(trading.title, 'Trading')
    assert.equal(trading.icon, IconCube)
    assert.deepEqual([trading.rows[0].label, trading.rows[0].to], ['Dashboard', '/agent'])
  })

  test('A2 SHARING agent with sports only', () => {
    const sections = agentSections('SHARING', ['sports'], 1)
    assert.deepEqual(
      sections.map((section) => section.key),
      ['trading', 'userManagement', 'marketing', 'finance', 'reporting'],
    )
    const trading = sectionByKey(sections, 'trading')
    assert.deepEqual(tos(trading), ['/agent', '/sports/events', '/bets'])
    assert.equal(trading.rows[1].label, 'Sports Running Events')
    assert.deepEqual(trading.rows[1].keywords, ['sports exchange'])
    const referral = sectionByKey(sections, 'marketing').rows[0]
    assert.equal(referral.label, 'My Referral Link')
    assert.equal(referral.to, '/agent/referral')
    assert.equal(referral.icon, IconLink)
    const settlement = sectionByKey(sections, 'finance').rows[0]
    assert.equal(settlement.label, 'Settlement Center')
    assert.equal(settlement.icon, IconHeartHandshake)
    assert.equal(sectionByKey(sections, 'reporting').entries[1].kind, 'row')
    assert.deepEqual(tos(sectionByKey(sections, 'userManagement')), ['/players', '/players/create', '/agents', '/agent/create'])
  })

  test('A3 COMMISSION agent with no domains', () => {
    const sections = agentSections('COMMISSION', [], 2)
    assert.deepEqual(tos(sectionByKey(sections, 'trading')), ['/agent', '/bets'])
    const subAgents = sectionByKey(sections, 'userManagement').entries[1]
    assert.equal(subAgents.kind, 'group')
    assert.equal(subAgents.kind === 'group' ? subAgents.label : null, 'Sub-Agents')
    const finance = sectionByKey(sections, 'finance')
    assert.deepEqual(
      finance.rows.map((row) => [row.label, row.to]),
      [
        ['Dashboard', '/commission/overview'],
        ['Commission History', '/commission/history'],
      ],
    )
    assert.equal(finance.rows[1].icon, IconHistory)
    assert.deepEqual(tos(sectionByKey(sections, 'reporting')), [
      '/reporting/pnl',
      '/reporting/exposure',
      '/reporting/agents/performance',
      '/reporting/players/activity',
      '/reporting/players/nth-dw',
      '/reporting/exports',
    ])
  })

  test('A3b agents get Matka Live Analysis (not the admin-only Results); CREDIT agents get their Chips page', () => {
    const credit = agentSections('CREDIT', ['matka'], 1)
    const trading = tos(sectionByKey(credit, 'trading'))
    assert.ok(trading.includes('/matka/live'))
    assert.equal(trading.includes('/matka/results'), false)
    // CREDIT settles nothing since 2026-11-02 (spec §6): its finance is its Chips page, with no Settlement Center.
    assert.deepEqual(
      sectionByKey(credit, 'finance').rows.map((row) => [row.label, row.to]),
      [['Chips', '/agent/credit']],
    )
    const sharingFinance = tos(sectionByKey(agentSections('SHARING', ['matka'], 1), 'finance'))
    assert.deepEqual(sharingFinance, ['/settlement'])
  })

  test('A4 level-4 SHARING agent has no Agents group', () => {
    const sections = agentSections('SHARING', ['casino'], 4)
    assert.deepEqual(tos(sectionByKey(sections, 'userManagement')), ['/players', '/players/create'])
  })

  test('A5 agent navigation carries no badge on any section or row', () => {
    for (const sections of [
      agentSections('CREDIT', ['sports'], 1),
      agentSections('SHARING', ['sports'], 1),
      agentSections('COMMISSION', ['matka'], 1),
    ]) {
      assert.equal(
        sections.some((section) => section.badgeKey !== null || section.rows.some((row) => row.badgeKey !== null)),
        false,
      )
    }
  })
})
