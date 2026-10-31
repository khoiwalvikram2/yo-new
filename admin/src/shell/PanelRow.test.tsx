/**
 * PanelRow computes aria-current/data-current itself from props (react-router
 * Link, not NavLink), so exactly one row can be marked current across
 * sections (deviation D1, contracts §16), and it keeps the old sports-event
 * hard-reload behaviour (navClick.ts, decision 6).
 */
import { test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { IconCash } from '@tabler/icons-react'
import { PanelRow } from './PanelRow'
import type { ShellRow } from './shellTypes'

vi.mock('@/shared/services/badgeService', () => ({ useOptionalBadgeCount: () => 3 }))

const row: ShellRow = {
  id: 'trading|payments|/payments',
  sectionKey: 'trading',
  sectionTitle: 'Trading',
  to: '/payments',
  label: 'Payments',
  icon: IconCash,
  keywords: ['payments'],
  badgeKey: 'payments',
}

test('current row carries both aria-current and data-current', () => {
  render(
    <MemoryRouter>
      <PanelRow row={row} isCurrent />
    </MemoryRouter>,
  )
  const link = screen.getByRole('link', { name: /Payments/ })
  assert.equal(link.getAttribute('aria-current'), 'page')
  assert.equal(link.getAttribute('data-current'), 'true')
})

test('announceCurrent=false gives data-current without aria-current', () => {
  render(
    <MemoryRouter>
      <PanelRow row={row} isCurrent announceCurrent={false} />
    </MemoryRouter>,
  )
  const link = screen.getByRole('link', { name: /Payments/ })
  assert.equal(link.getAttribute('data-current'), 'true')
  assert.equal(link.getAttribute('aria-current'), null)
})

test('leaving a sports event page does a full reload instead of a client navigation', () => {
  const originalLocation = window.location
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, assign },
  })
  try {
    render(
      <MemoryRouter initialEntries={['/sports/event/77']}>
        <PanelRow row={row} isCurrent={false} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('link', { name: /Payments/ }))
    assert.equal(assign.mock.calls.length, 1)
    assert.equal(assign.mock.calls[0][0], '/payments')
  } finally {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  }
})

test('a normal client click calls onNavigate', () => {
  const onNavigate = vi.fn()
  render(
    <MemoryRouter>
      <PanelRow row={row} isCurrent={false} onNavigate={onNavigate} />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('link', { name: /Payments/ }))
  assert.equal(onNavigate.mock.calls.length, 1)
})
