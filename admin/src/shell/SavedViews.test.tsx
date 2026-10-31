/**
 * SavedViews renders each favourited row as a quiet PanelRow, sharing the star, the sports-event reload and
 * the active-row styling with every other panel row, while keeping aria-current="page" unique to the one
 * primary row (deviation D2, contracts §16) — a Saved-view copy of the active page gets data-current only.
 */
import { test, describe, beforeEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { IconCash, IconUsers } from '@tabler/icons-react'
import { useSidebarStore } from '@/state/sidebarStore'
// explicit extension: a bare './SavedViews' resolves to savedViews.ts on a case-insensitive
// filesystem (Vite tries the .ts candidate before .tsx and that candidate case-insensitively
// matches the sibling util file) — do not "clean up" this import to drop the extension.
import { SavedViews } from './SavedViews.tsx'
import { ContextPanel } from './ContextPanel'
import type { ShellEntry, ShellRow, ShellSection } from './shellTypes'

vi.mock('@/shared/services/badgeService', () => ({ useOptionalBadgeCount: () => 3 }))

const paymentsRow: ShellRow = {
  id: 'trading|payments|/payments',
  sectionKey: 'trading',
  sectionTitle: 'Trading',
  to: '/payments',
  label: 'Payments',
  icon: IconCash,
  keywords: [],
  badgeKey: null,
}

const playersRow: ShellRow = {
  id: 'players|players|/players',
  sectionKey: 'players',
  sectionTitle: 'Players',
  to: '/players',
  label: 'Players',
  icon: IconUsers,
  keywords: [],
  badgeKey: null,
}

const entries: ShellEntry[] = [
  { kind: 'row', row: paymentsRow },
  { kind: 'row', row: playersRow },
]

const section: ShellSection = {
  key: 'trading',
  title: 'Trading',
  subtitle: null,
  icon: IconCash,
  badgeKey: null,
  entries,
  rows: [paymentsRow, playersRow],
}

beforeEach(() => {
  useSidebarStore.setState({ favorites: [] })
})

describe('SavedViews', () => {
  test('a saved view for the active page has data-current and no aria-current', () => {
    useSidebarStore.setState({ favorites: ['/payments'] })
    render(
      <MemoryRouter>
        <SavedViews sections={[section]} activeTo="/payments" onNavigate={() => {}} />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: /Payments/ })
    assert.equal(link.getAttribute('data-current'), 'true')
    assert.equal(link.getAttribute('aria-current'), null)
  })

  test('a saved path outside the visible sections is hidden', () => {
    useSidebarStore.setState({ favorites: ['/gone'] })
    render(
      <MemoryRouter>
        <SavedViews sections={[section]} activeTo={null} onNavigate={() => {}} />
      </MemoryRouter>,
    )
    assert.equal(screen.queryByText('Saved views'), null)
    assert.equal(screen.queryByRole('link'), null)
  })

  test('renders nothing with no visible saved views', () => {
    const { container } = render(
      <MemoryRouter>
        <SavedViews sections={[section]} activeTo={null} onNavigate={() => {}} />
      </MemoryRouter>,
    )
    assert.equal(container.firstChild, null)
  })

  test('a saved view of the active page does not add a second aria-current="page"', () => {
    useSidebarStore.setState({ favorites: ['/payments'] })
    render(
      <MemoryRouter>
        <ContextPanel
          section={section}
          activeTo="/payments"
          collapsed={false}
          onNavigate={() => {}}
          sections={[section]}
          brandName={null}
        />
      </MemoryRouter>,
    )
    const current = document.querySelectorAll('[aria-current="page"]')
    assert.equal(current.length, 1)
    assert.equal(current[0].textContent?.includes('Payments'), true)
  })
})
