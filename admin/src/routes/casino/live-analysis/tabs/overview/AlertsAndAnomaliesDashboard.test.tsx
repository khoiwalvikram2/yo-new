import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen } from '@testing-library/react'
import { AlertsAndAnomaliesDashboard } from './AlertsAndAnomaliesDashboard'

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number) => `INR ${Number(amount).toFixed(2)}`,
    convertFromWhitelabelCurrency: (amount: number) => amount,
  }),
}))

const kpis = (rtp: number, wagered: number) => ({ rtp, wagered, betsPerMin: wagered > 0 ? 3 : 0, activePlayers: wagered > 0 ? 2 : 0 })

describe('AlertsAndAnomaliesDashboard', () => {
  test('a window with no bets raises no RTP alert and says there was no activity', () => {
    // RTP is 0% when nothing was wagered: it raised "1 CRITICAL - Overall RTP Below Threshold" while the RTP card
    // beside it called the same 0% good.
    render(<AlertsAndAnomaliesDashboard kpis={kpis(0, 0)} breakdown={{ byGame: [] }} windowMins={10} />)
    assert.equal(screen.queryByText('Overall RTP Below Threshold'), null)
    assert.equal(screen.queryByText(/Critical/), null)
    assert.ok(screen.getByText('No activity'))
    assert.ok(screen.getByText('No casino bets in the last 10 minutes, so there is nothing to check.'))
  })

  test('a thin window is not judged on RTP either', () => {
    render(<AlertsAndAnomaliesDashboard kpis={kpis(20, 100)} breakdown={{ byGame: [] }} />)
    assert.equal(screen.queryByText('Overall RTP Below Threshold'), null)
    assert.ok(screen.getByText('All systems normal'))
  })

  test('a real low RTP is critical, on the same 90% band the RTP card uses', () => {
    render(<AlertsAndAnomaliesDashboard kpis={kpis(85, 5000)} breakdown={{ byGame: [] }} />)
    assert.ok(screen.getByText('Overall RTP Below Threshold'))
    assert.ok(screen.getByText('Overall RTP is 85.00%, which is below the acceptable threshold of 90%'))
    assert.ok(screen.getByText('1 Critical'))
  })

  test('an RTP inside the band is normal', () => {
    render(<AlertsAndAnomaliesDashboard kpis={kpis(96, 5000)} breakdown={{ byGame: [] }} />)
    assert.ok(screen.getByText('All systems normal'))
  })
})
