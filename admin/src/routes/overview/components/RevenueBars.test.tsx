/**
 * RevenueBars is the kit dashboard's Revenue panel: gross revenue as bars for its own window (14 days, 12
 * weeks or 12 months), in one readable unit, the latest bar named in the chart's label. This mounts it
 * against a stubbed DashboardTrends reply and checks the window each grouping asks for, the unit and the
 * summary a screen reader hears.
 */
import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable } from '@apollo/client'
import { nowIST } from '@/shared/utils/date'
import { RevenueBars } from './RevenueBars'

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    convertFromWhitelabelCurrency: (amount: number) => amount,
    getCurrencySymbol: () => '₹',
    selectedCurrency: 'INR',
    formatAmount: (amount: number) => `INR ${amount}`,
  }),
}))

afterEach(cleanup)

const DAY = 24 * 60 * 60 * 1000
let ranges: Array<{ dateFrom: string; dateTo: string }>

/** Today and the 13 days before it, with gross revenue rising one lakh a day (1 lakh 13 days ago, 14 today). */
function lastFourteenDays() {
  return Array.from({ length: 14 }, (_, index) => ({
    __typename: 'DashboardTrendPoint',
    date: nowIST().subtract(13 - index, 'day').format('YYYY-MM-DD'),
    turnover: 0, ggr: (index + 1) * 100000, ngr: 0, deposits: 0, withdrawals: 0, netDeposits: 0,
    sportsGGR: 0, casinoGGR: 0, matkaGGR: 0, activePlayers: 0, betCount: 0,
  }))
}

function mount() {
  ranges = []
  const link = new ApolloLink((operation) => new Observable((observer) => {
    ranges.push(operation.variables.dateRange)
    const timer = setTimeout(() => { observer.next({ data: { dashboardTrends: lastFourteenDays() } }); observer.complete() }, 1)
    return () => clearTimeout(timer)
  }))
  return render(<ApolloProvider client={new ApolloClient({ link, cache: new InMemoryCache() })}><RevenueBars /></ApolloProvider>)
}

describe('RevenueBars', () => {
  test('draws the last 14 days in lakh, the latest day named in the chart label', async () => {
    mount()
    const chart = await screen.findByRole('img', { name: /^Daily gross revenue for the last 14 days, in ₹ lakh: latest 14/ })
    assert.ok(chart)
    assert.ok(screen.getByText('Last 14 days · ₹ lakh'))
    // Today and the 13 days before it, in IST.
    const span = new Date(ranges[0].dateTo).getTime() - new Date(ranges[0].dateFrom).getTime()
    assert.equal(Math.round(span / DAY), 14)
  })

  test('Week asks for 12 Monday-to-Sunday weeks and sums the days into them', async () => {
    mount()
    await screen.findByRole('img', { name: /^Daily gross revenue/ })
    fireEvent.click(within(screen.getByRole('group', { name: 'Group revenue by' })).getByRole('button', { name: 'Week' }))
    await waitFor(() => assert.ok(screen.getByText('Last 12 weeks · ₹ lakh')))
    const range = ranges[ranges.length - 1]
    // IST is UTC+5:30 all year, so the window's first instant read in IST is a Monday midnight.
    const startIst = new Date(new Date(range.dateFrom).getTime() + 5.5 * 60 * 60 * 1000)
    assert.equal(startIst.getUTCDay(), 1, 'the window starts on a Monday')
    assert.equal(startIst.getUTCHours(), 0)
    const weeks = (new Date(range.dateTo).getTime() - new Date(range.dateFrom).getTime()) / (7 * DAY)
    assert.ok(weeks > 11 && weeks <= 12, `about 12 weeks, got ${weeks}`)
    // The latest week holds today and the days of this week before it, so its sum is at least today's 14 lakh.
    const chart = await screen.findByRole('img', { name: /^Weekly gross revenue for the last 12 weeks/ })
    const latest = Number(/latest ([\d,.]+)/.exec(chart.getAttribute('aria-label') ?? '')?.[1].replace(/,/g, ''))
    assert.ok(latest >= 14, `latest week ${latest}`)
  })
})
