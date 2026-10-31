import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AlertsAndAnomaliesDashboard } from './AlertsAndAnomaliesDashboard'
import { MatkaPerformance } from './MatkaPerformance'
import { RiskAnalyticsDashboard } from '../performance/RiskAnalyticsDashboard'
import { isOpenMatkaRiskAlert } from '../../liveUiModel'

const notifyError = vi.hoisted(() => vi.fn())
vi.mock('@/shared/services/notification', () => ({ notify: { error: notifyError } }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => value.toFixed(2), convertFromWhitelabelCurrency: (value: number) => value }) }))
const empty = { rtp: 0, wagered: 0, payouts: 0, ggr: 0, betsPerMin: 0, activePlayers: 0 }
const openMarket = { matkaId: 'qa', matkaName: 'QA Market', wagered: 1000, payouts: 0, ggr: 1000, bets: 10 }

describe('Matka live RTP requires final settled returns', () => {
  beforeEach(() => notifyError.mockReset())

  test('zero bets is an empty state without an RTP error notification', () => {
    render(<AlertsAndAnomaliesDashboard kpis={empty} breakdown={{ byMatka: [] }} />)
    screen.getByText('No open Matka bets'); screen.getByText('RTP unavailable for open bets')
    assert.equal(screen.queryByText('Overall RTP Below Threshold'), null)
    assert.equal(notifyError.mock.calls.length, 0)
  })

  test('pending stakes with no final payout do not create low-RTP alerts, while concentration still works', () => {
    render(<AlertsAndAnomaliesDashboard kpis={{ ...empty, wagered: 1000, activePlayers: 2 }} breakdown={{ byMatka: [openMarket] }} />)
    screen.getByText('High Matka Concentration')
    assert.equal(screen.queryByText('Overall RTP Below Threshold'), null)
    assert.equal(screen.queryByText(/Matka RTP Alert:/), null)
    assert.equal(notifyError.mock.calls.length, 0)
  })

  test('open-bet performance and risk do not label missing RTP as zero or use it for volatility risk', () => {
    render(<><MatkaPerformance breakdown={{ byMatka: [openMarket] }} /><RiskAnalyticsDashboard kpis={{ ...empty, wagered: 1000, activePlayers: 2 }} breakdown={{ byMatka: [openMarket] }} /></>)
    screen.getByText('RTP pending'); screen.getByText('RTP / Volatility')
    assert.equal(screen.queryByText('RTP deviation'), null)
    assert.equal(screen.queryByText('Volatility risk is HIGH'), null)
  })

  test('old server RTP frames are ignored without suppressing valid volume or exposure alerts', () => {
    const alert = { id: 'rtp-overall-low', title: '', description: '', entity: '', severity: 'critical' }
    assert.equal(isOpenMatkaRiskAlert(alert), false)
    assert.equal(isOpenMatkaRiskAlert({ ...alert, id: 'custom', type: 'rtp' }), false)
    assert.equal(isOpenMatkaRiskAlert({ ...alert, id: 'volume-spike-bets', type: 'volume' }), true)
    assert.equal(isOpenMatkaRiskAlert({ ...alert, id: 'market-limit', type: 'exposure' }), true)
  })
})
