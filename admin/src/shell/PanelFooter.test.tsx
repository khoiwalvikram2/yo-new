/** PanelFooter shows the whitelabel name with decision 8's "GameDash"/"GD" fallback. */
import { test, describe, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PanelFooter } from './PanelFooter'

vi.mock('@/shared/services/badgeService', () => ({ useOptionalBadgeCount: () => 3 }))

describe('PanelFooter', () => {
  test('falls back to the GameDash brand and GD tile with no whitelabel', () => {
    render(
      <MemoryRouter>
        <PanelFooter brandName={null} />
      </MemoryRouter>,
    )
    assert.ok(screen.getByText('GameDash'))
    assert.ok(screen.getByText('GD'))
  })

  test('shows the whitelabel name and its initials when one is set', () => {
    render(
      <MemoryRouter>
        <PanelFooter brandName="GoldBet77" />
      </MemoryRouter>,
    )
    assert.ok(screen.getByText('GoldBet77'))
    assert.ok(screen.getByText('G7'))
  })

  // The clock moved here from the topbar (owner, 2026-11-17): it sits under the brand card.
  test('shows the IST date and time under the brand card', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-04T11:49:30Z'))
    try {
      render(
        <MemoryRouter>
          <PanelFooter brandName="GoldBet77" />
        </MemoryRouter>,
      )
      const date = screen.getByText('Fri, 04 Sep 2026')
      const time = screen.getByText('17:19 IST')
      const card = screen.getByText('GoldBet77')
      assert.ok(
        Boolean(card.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING),
        'the date comes after the brand card',
      )
      assert.ok(
        Boolean(date.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING),
        'the time comes after the date',
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
