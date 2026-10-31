import assert from 'node:assert/strict'
import { render, screen, within } from '@testing-library/react'
import { describe, test, vi } from 'vitest'
import { RiskAnalyticsDashboard } from './RiskAnalyticsDashboard'

vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => value.toFixed(2), convertFromWhitelabelCurrency: (value: number) => value }) }))
const kpis = { wagered: 1000, payouts: 900, ggr: 100, rtp: 90, activePlayers: 3 }
const game = (gameId: string, wagered: number) => ({ gameId, gameName: gameId, wagered, payouts: 0, ggr: 0, bets: 1 })
describe('casino risk calculation parity', () => {
  test('restores liquidity requirement and all risk score memo calculations', () => {
    render(<RiskAnalyticsDashboard kpis={kpis} breakdown={{ byGame: [game('roulette', 600), game('slots', 400)], byVendor: [] }} />)
    assert.ok(screen.getByText('38.0%'))
    assert.ok(screen.getByText('Req: 1900.00'))
    assert.ok(screen.getByText('MODERATE RISK'))
    const overall = screen.getByText('Overall Risk Score').parentElement!
    assert.ok(within(overall).getByText('25'))
  })
  test('retains original critical concentration, volatility and low-liquidity thresholds', () => {
    render(<RiskAnalyticsDashboard kpis={{ ...kpis, payouts: 1200, ggr: 1, rtp: 120 }} breakdown={{ byGame: [game('roulette', 1000)] }} />)
    assert.ok(screen.getByText('CRITICAL RISK'))
    assert.ok(screen.getByText('High Risk Detected'))
    assert.ok(screen.getByText('Concentration risk is HIGH. Volatility risk is HIGH. Liquidity risk is HIGH'))
  })
  test('keeps unavailable breakdown as a real no-data state', () => {
    render(<RiskAnalyticsDashboard kpis={kpis} breakdown={{ byGame: [] }} />)
    assert.ok(screen.getByText('No risk data yet'))
    assert.equal(screen.queryByRole('status'), null)
    assert.equal(Boolean(screen.queryByText('Overall Risk Score')), false)
  })
})
