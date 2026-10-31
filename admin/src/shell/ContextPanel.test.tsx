/**
 * ContextPanel renders one section's rows and groups and must mark exactly
 * one row aria-current="page" (deviation D1, contracts §16), matching the
 * mockup's `[aria-current="page"]` styling hook. The Payments group's badge
 * is decision 5: the count sits on the group heading once permission
 * filtering leaves 2+ visible children.
 */
import { test, vi, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { IconCash, IconUsers } from '@tabler/icons-react'
import { useSidebarStore } from '@/state/sidebarStore'
import { ContextPanel } from './ContextPanel'
import type { ShellSection } from './shellTypes'

// Key-aware: only 'payments' has a nonzero count, so a zero-count group heading
// (added below) can be tested without every badge in the fixture going to zero.
vi.mock('@/shared/services/badgeService', () => ({
  useOptionalBadgeCount: (key: string | null) => (key === 'payments' ? 3 : 0),
}))

const section: ShellSection = {
  key: 'trading',
  title: 'Trading',
  subtitle: 'Sports and matka operations',
  icon: IconCash,
  badgeKey: 'payments',
  entries: [
    {
      kind: 'row',
      row: {
        id: 'trading|overview|/trading',
        sectionKey: 'trading',
        sectionTitle: 'Trading',
        to: '/trading',
        label: 'Overview',
        icon: IconCash,
        keywords: [],
        badgeKey: null,
      },
    },
    {
      kind: 'group',
      id: 'trading|payments',
      label: 'Payments',
      badgeKey: 'payments',
      rows: [
        {
          id: 'trading|payments|/payments/deposits',
          sectionKey: 'trading',
          sectionTitle: 'Trading',
          to: '/payments/deposits',
          label: 'Deposit Requests',
          icon: IconUsers,
          keywords: [],
          badgeKey: null,
        },
        {
          id: 'trading|payments|/payments/withdrawals',
          sectionKey: 'trading',
          sectionTitle: 'Trading',
          to: '/payments/withdrawals',
          label: 'Withdrawal Requests',
          icon: IconUsers,
          keywords: [],
          badgeKey: null,
        },
      ],
    },
  ],
  rows: [],
}

beforeEach(() => {
  useSidebarStore.setState({ favorites: [] })
})

test('shows the section header, every row and group heading, and the heading badge text', () => {
  render(
    <MemoryRouter>
      <ContextPanel section={section} activeTo="/payments/deposits" collapsed={false} onNavigate={() => {}} sections={[]} brandName={null} />
    </MemoryRouter>,
  )
  assert.ok(screen.getByRole('heading', { name: 'Trading' }))
  assert.ok(screen.getByText('Sports and matka operations'))
  assert.ok(screen.getByRole('heading', { name: 'Payments' }))
  assert.ok(screen.getByText('3 waiting'))
  assert.ok(screen.getByRole('link', { name: /Overview/ }))
  assert.ok(screen.getByRole('link', { name: /Deposit Requests/ }))
  assert.ok(screen.getByRole('link', { name: /Withdrawal Requests/ }))
})

test('exactly one row is announced as the current page', () => {
  render(
    <MemoryRouter>
      <ContextPanel section={section} activeTo="/payments/deposits" collapsed={false} onNavigate={() => {}} sections={[]} brandName={null} />
    </MemoryRouter>,
  )
  const current = document.querySelectorAll('[aria-current="page"]')
  assert.equal(current.length, 1)
  assert.equal(current[0].textContent?.includes('Deposit Requests'), true)
})

test('a group heading with a real badgeKey but zero live count shows no badge or waiting text', () => {
  const zeroBadgeSection: ShellSection = {
    key: 'ops',
    title: 'Ops',
    subtitle: null,
    icon: IconCash,
    badgeKey: null,
    entries: [
      {
        kind: 'group',
        id: 'ops|alerts',
        label: 'Alerts',
        badgeKey: 'alerts',
        rows: [
          {
            id: 'ops|alerts|/alerts/queue',
            sectionKey: 'ops',
            sectionTitle: 'Ops',
            to: '/alerts/queue',
            label: 'Queue',
            icon: IconUsers,
            keywords: [],
            badgeKey: null,
          },
        ],
      },
    ],
    rows: [],
  }
  render(
    <MemoryRouter>
      <ContextPanel section={zeroBadgeSection} activeTo={null} collapsed={false} onNavigate={() => {}} sections={[]} brandName={null} />
    </MemoryRouter>,
  )
  assert.ok(screen.getByRole('heading', { name: 'Alerts' }))
  assert.equal(screen.queryByText(/waiting/), null)
})

test('renders nothing when there is no section to show', () => {
  render(
    <MemoryRouter>
      <ContextPanel section={null} activeTo={null} collapsed={false} onNavigate={() => {}} sections={[]} brandName={null} />
    </MemoryRouter>,
  )
  assert.equal(screen.queryByRole('heading'), null)
  assert.equal(document.querySelectorAll('[aria-current="page"]').length, 0)
})

test('with a real section, the saved views heading/row and the panel footer brand render together', () => {
  // resolveSavedViews (SavedViews.tsx) matches against section.rows, not section.entries — the
  // shared `section` fixture above leaves rows empty since ContextPanel itself never reads it.
  const overviewRow = {
    id: 'trading|overview|/trading',
    sectionKey: 'trading',
    sectionTitle: 'Trading',
    to: '/trading',
    label: 'Overview',
    icon: IconCash,
    keywords: [],
    badgeKey: null,
  }
  const sectionWithRows: ShellSection = { ...section, rows: [overviewRow] }
  useSidebarStore.setState({ favorites: ['/trading'] })
  render(
    <MemoryRouter>
      <ContextPanel
        section={sectionWithRows}
        activeTo="/payments/deposits"
        collapsed={false}
        onNavigate={() => {}}
        sections={[sectionWithRows]}
        brandName="GoldBet77"
      />
    </MemoryRouter>,
  )
  assert.ok(screen.getByRole('heading', { name: 'Saved views' }))
  assert.equal(screen.getAllByRole('link', { name: /Overview/ }).length, 2)
  assert.ok(screen.getByText('GoldBet77'))
})
