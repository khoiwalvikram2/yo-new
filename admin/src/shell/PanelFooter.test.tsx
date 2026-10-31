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
})
