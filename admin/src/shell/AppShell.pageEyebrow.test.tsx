import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IconPoint } from '@tabler/icons-react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { ShellRow, ShellRowEntry, ShellSection } from './shellTypes'
import { AppShell } from './AppShell'
import { usePageEyebrow } from './PageEyebrowContext'

function row(sectionKey: string, sectionTitle: string, to: string, label: string): ShellRow {
  return {
    id: `${sectionKey}|${to}|${to}`,
    sectionKey,
    sectionTitle,
    to,
    label,
    icon: IconPoint,
    keywords: [],
    badgeKey: null,
  }
}

function section(key: string, title: string, to: string, rowLabel: string): ShellSection {
  const sectionRow = row(key, title, to, rowLabel)
  const entry: ShellRowEntry = { kind: 'row', row: sectionRow }
  return {
    key,
    title,
    subtitle: null,
    icon: IconPoint,
    badgeKey: null,
    entries: [entry],
    rows: [sectionRow],
  }
}

// A row moved into another section's panel (as the Overview is in Trading) carries its own eyebrow.
function sectionWithMovedRow(): ShellSection {
  const moved: ShellRow = { ...row('trading', 'Trading', '/analytics-home', 'Analytics home'), eyebrow: 'Analytics' }
  const own = row('trading', 'Trading', '/bets', 'Bet List')
  return {
    key: 'trading',
    title: 'Trading',
    subtitle: null,
    icon: IconPoint,
    badgeKey: null,
    entries: [{ kind: 'row', row: moved }, { kind: 'row', row: own }],
    rows: [moved, own],
  }
}

const SECTIONS: readonly ShellSection[] = [
  section('overview', 'Overview', '/overview', 'Dashboard'),
  section('payments', 'Payment Operations', '/payments/deposits', 'Deposit Requests'),
  section('reporting', 'Reports & Insights', '/reporting/exposure', 'Exposure Report'),
  sectionWithMovedRow(),
]

interface SelectorState {
  panelCollapsed: boolean
  setPanelCollapsed: (collapsed: boolean) => void
}

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { isAgent: () => boolean }) => unknown) =>
    selector({ isAgent: () => false }),
}))
vi.mock('@/shared/core/useSupportPermissionSync', () => ({ useSupportPermissionSync: () => {} }))

vi.mock('@/shared/core/uiStore', () => ({
  useUIStore: (selector: (state: SelectorState) => unknown) =>
    selector({ panelCollapsed: false, setPanelCollapsed: () => {} }),
}))

vi.mock('@/shared/core/useWhitelabels', () => ({
  useCurrentWhitelabel: () => ({ whitelabel: null, loading: false, error: undefined }),
}))

vi.mock('@/shared/hooks/useBreakpoint', () => ({
  useBreakpoint: () => ({ isWide: true, isSmallScreen: false }),
}))

vi.mock('@/shared/services/badgeService', () => ({
  badgeService: { startPolling: () => {}, stopPolling: () => {} },
}))

vi.mock('./migratedRoutes', () => ({ useIsMigratedRoute: () => false }))

vi.mock('./useShellNavigation', () => ({ useShellNavigation: () => SECTIONS }))

vi.mock('./usePanelLayout', () => ({
  usePanelLayout: () => ({
    showPanelToggle: true,
    panelExpanded: true,
    togglePanel: () => {},
    revealPanel: () => {},
  }),
}))

vi.mock('./useNavDrawer', () => ({
  useNavDrawer: () => ({
    isDrawer: false,
    isOpen: false,
    setOpen: () => {},
    burgerRef: () => {},
    getBurgerProps: () => ({
      'aria-expanded': false,
      'aria-controls': 'shell-nav-drawer',
      onClick: () => {},
    }),
  }),
}))

vi.mock('./NavDrawer', () => ({
  NavDrawer: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

interface RailStubProps {
  sections: readonly ShellSection[]
  shownKey: string | null
  onSelectSection: (key: string) => void
}

vi.mock('./Rail', () => ({
  Rail: ({ sections, shownKey, onSelectSection }: RailStubProps) => (
    <nav aria-label="Section rail" data-shown-key={shownKey ?? ''}>
      {sections.map((candidate) => (
        <button key={candidate.key} type="button" onClick={() => onSelectSection(candidate.key)}>
          Show {candidate.title}
        </button>
      ))}
    </nav>
  ),
}))

vi.mock('./ContextPanel', () => ({
  ContextPanel: ({ section: shown }: { section: ShellSection | null }) => (
    <aside data-testid="shown-panel">{shown?.title ?? 'no section'}</aside>
  ),
}))

vi.mock('./Topbar', () => ({ Topbar: () => <header data-testid="topbar" /> }))
vi.mock('./ToolRail', () => ({ ToolRail: () => <aside data-testid="tool-rail" /> }))

function RouteContent() {
  const eyebrow = usePageEyebrow()
  const navigate = useNavigate()

  return (
    <>
      <output data-testid="page-eyebrow">{eyebrow ?? 'no section'}</output>
      <button type="button" onClick={() => navigate('/overview')}>
        Go to overview
      </button>
      <button type="button" onClick={() => navigate('/payments/deposits')}>
        Go to deposits
      </button>
      <button type="button" onClick={() => navigate('/reporting/exposure')}>
        Go to exposure
      </button>
      <button type="button" onClick={() => navigate('/bets')}>
        Go to bets
      </button>
      <button type="button" onClick={() => navigate('/notifications')}>
        Go to unmatched page
      </button>
    </>
  )
}

function renderShell(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <AppShell>
        <RouteContent />
      </AppShell>
    </MemoryRouter>,
  )
}

async function expectEyebrow(label: string) {
  await waitFor(() => {
    assert.equal(screen.getByTestId('page-eyebrow').textContent, label)
    assert.equal(screen.getByTestId('shown-panel').textContent, label)
  })
}

describe('AppShell page eyebrow', () => {
  test('publishes the shown section title and changes it with matched navigation', async () => {
    renderShell('/overview')
    await expectEyebrow('Overview')

    fireEvent.click(screen.getByRole('button', { name: 'Go to deposits' }))
    await expectEyebrow('Payment Operations')

    fireEvent.click(screen.getByRole('button', { name: 'Go to exposure' }))
    await expectEyebrow('Reports & Insights')
  })

  test('tracks the actually shown section across a rail choice, unmatched route, and next matched route', async () => {
    renderShell('/overview')
    await expectEyebrow('Overview')

    fireEvent.click(screen.getByRole('button', { name: 'Show Reports & Insights' }))
    await expectEyebrow('Reports & Insights')

    fireEvent.click(screen.getByRole('button', { name: 'Go to unmatched page' }))
    await expectEyebrow('Reports & Insights')

    fireEvent.click(screen.getByRole('button', { name: 'Go to deposits' }))
    await expectEyebrow('Payment Operations')
  })

  test("a moved row's page keeps its own eyebrow while its panel shows the section it moved into", async () => {
    renderShell('/analytics-home')
    await waitFor(() => {
      assert.equal(screen.getByTestId('page-eyebrow').textContent, 'Analytics')
      assert.equal(screen.getByTestId('shown-panel').textContent, 'Trading')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Go to bets' }))
    await expectEyebrow('Trading')
  })
})
