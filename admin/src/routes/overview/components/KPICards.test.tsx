/**
 * Each of the four KPI cards opens the list that adds up to its own figure (DAS-KPI-DRILL-GGR): Gross
 * Revenue and Net GGR open their parts (GGR by player, each top-level agent's commission, each bonus paid);
 * they opened the GGR-only "GGR by player" list, which stays on the GGR card.
 */
import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DrilldownContext, type DrillRequest } from './drilldownContext'
import { KPICards } from './KPICards'

const mocks = vi.hoisted(() => ({ useQuery: vi.fn() }))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return { ...actual, useQuery: mocks.useQuery }
})

vi.mock('@/state/dashboardStore', () => ({
  useDashboardStore: () => ({
    getDateRangeForQuery: () => ({ dateFrom: '2026-01-01T00:00:00.000Z', dateTo: '2026-11-02T18:29:59.999Z' }),
    filters: { dateRange: { preset: 'custom' } },
  }),
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    convertFromWhitelabelCurrency: (amount: number) => amount,
    formatAmount: (amount: number) => `INR ${amount}`,
  }),
}))

afterEach(cleanup)

/* Gross Revenue 5,000 (GGR 2,000 + commission 3,000); Net GGR -1,500 (2,000 - 3,000 - bonus 500). */
const KPIS = {
  ggr: 2000, agentCommission: 3000, bonusPayouts: 500, ngr: -1500, turnover: 90000,
  sportsGGR: 2000, casinoGGR: 0, matkaGGR: 0, sportsTurnover: 90000, casinoTurnover: 0, matkaTurnover: 0,
}

describe('KPI cards', () => {
  test('each figure opens the list that adds up to it (DAS-KPI-DRILL-GGR)', () => {
    mocks.useQuery.mockReturnValue({ data: { overviewKPIs: KPIS, dashboardTrends: [] }, loading: false })
    const opened: DrillRequest[] = []
    render(
      <DrilldownContext.Provider value={(request) => { opened.push(request) }}>
        <KPICards />
      </DrilldownContext.Provider>,
    )
    for (const figure of ['INR 5000', 'INR 2000', '-INR 1500', 'INR 90000']) {
      fireEvent.click(screen.getByRole('button', { name: figure }))
    }
    assert.deepEqual(opened, [
      { kind: 'gross_revenue', title: 'Gross revenue' },
      { kind: 'ggr_players', title: 'GGR by player' },
      { kind: 'net_ggr', title: 'Net GGR' },
      { kind: 'turnover_players', title: 'Turnover by player' },
    ])
  })
})
