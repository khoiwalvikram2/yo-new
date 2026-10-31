/**
 * The icon rail renders one button per visible section, marks the section the
 * panel is currently showing, exposes the whitelabel initials on the brand
 * tile (falling back to "GD"), and shows a ", <n> waiting" badge only on the
 * section that owns a badgeKey (decision 5) — a rail button with no badgeKey
 * must never grow a stray badge just because some other section has a count.
 */
import { describe, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import assert from 'node:assert/strict'
import { IconCreditCard, IconHome2 } from '@tabler/icons-react'
import { Rail } from './Rail'
import type { ShellSection } from './shellTypes'

// Key-aware: only 'payments' has a nonzero count, so a badge appearing (or not)
// actually proves which key was threaded through, not just that some mock ran.
vi.mock('@/shared/services/badgeService', () => ({
  useOptionalBadgeCount: (key: string | null) => (key === 'payments' ? 3 : 0),
}))

const homeSection: ShellSection = {
  key: 'home',
  title: 'Overview',
  subtitle: null,
  icon: IconHome2,
  badgeKey: null,
  entries: [],
  rows: [],
}

const financeSection: ShellSection = {
  key: 'finance',
  title: 'Finance',
  subtitle: null,
  icon: IconCreditCard,
  badgeKey: 'payments',
  entries: [],
  rows: [],
}

const alertsSection: ShellSection = {
  key: 'alerts',
  title: 'Alerts',
  subtitle: null,
  icon: IconCreditCard,
  badgeKey: 'alerts',
  entries: [],
  rows: [],
}

const sections: readonly ShellSection[] = [homeSection, financeSection]

function renderRail(overrides: Partial<Parameters<typeof Rail>[0]> = {}) {
  const props = {
    sections,
    shownKey: 'home',
    onSelectSection: () => {},
    brandName: 'GoldBet77',
    showPanelToggle: true,
    panelExpanded: true,
    onTogglePanel: () => {},
    ...overrides,
  }
  return render(<Rail {...props} />)
}

describe('Rail', () => {
  test('brand tile shows initials from the whitelabel name, GD when there is none', () => {
    const { rerender } = renderRail({ brandName: 'GoldBet77' })
    assert.ok(screen.getByText('G7'))

    rerender(
      <Rail
        sections={sections}
        shownKey="home"
        onSelectSection={() => {}}
        brandName={null}
        showPanelToggle
        panelExpanded
        onTogglePanel={() => {}}
      />,
    )
    assert.ok(screen.getByText('GD'))
  })

  test('one button per section; aria-pressed and aria-controls are correct', () => {
    renderRail({ shownKey: 'finance' })
    const home = screen.getByRole('button', { name: 'Overview' })
    const finance = screen.getByRole('button', { name: 'Finance, 3 waiting' })
    assert.equal(home.getAttribute('aria-pressed'), 'false')
    assert.equal(finance.getAttribute('aria-pressed'), 'true')
    assert.equal(home.getAttribute('aria-controls'), 'shell-panel')
    assert.equal(finance.getAttribute('aria-controls'), 'shell-panel')
  })

  test('clicking a section button reports its key', () => {
    const onSelectSection = vi.fn()
    renderRail({ onSelectSection })
    fireEvent.click(screen.getByRole('button', { name: 'Finance, 3 waiting' }))
    assert.deepEqual(onSelectSection.mock.calls, [['finance']])
  })

  test('the badge and its accessible text sit only on the section with a badgeKey', () => {
    renderRail()
    assert.ok(screen.getByRole('button', { name: 'Overview' }))
    assert.equal(screen.queryByRole('button', { name: /Overview,/ }), null)
    const badgeText = screen.getByText('3')
    assert.equal(badgeText.getAttribute('aria-hidden'), 'true')
  })

  test('a section with a real badgeKey whose live count is 0 shows no waiting badge', () => {
    renderRail({ sections: [homeSection, alertsSection] })
    assert.ok(screen.getByRole('button', { name: 'Alerts' }))
    assert.equal(screen.queryByRole('button', { name: /Alerts,/ }), null)
    assert.equal(screen.queryByText('0'), null)
  })

  test('the collapse chevron reflects panelExpanded and is absent when showPanelToggle is false', () => {
    const onTogglePanel = vi.fn()
    const { rerender } = renderRail({ panelExpanded: false, onTogglePanel })
    const collapsedToggle = screen.getByRole('button', { name: 'Expand the section panel' })
    assert.equal(collapsedToggle.getAttribute('aria-expanded'), 'false')
    assert.equal(collapsedToggle.getAttribute('aria-controls'), 'shell-panel')
    fireEvent.click(collapsedToggle)
    assert.equal(onTogglePanel.mock.calls.length, 1)

    rerender(
      <Rail
        sections={sections}
        shownKey="home"
        onSelectSection={() => {}}
        brandName="GoldBet77"
        showPanelToggle
        panelExpanded
        onTogglePanel={onTogglePanel}
      />,
    )
    assert.ok(screen.getByRole('button', { name: 'Collapse the section panel' }))

    rerender(
      <Rail
        sections={sections}
        shownKey="home"
        onSelectSection={() => {}}
        brandName="GoldBet77"
        showPanelToggle={false}
        panelExpanded
        onTogglePanel={onTogglePanel}
      />,
    )
    assert.equal(screen.queryByRole('button', { name: /section panel/ }), null)
  })
})
