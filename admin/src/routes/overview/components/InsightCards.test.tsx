/**
 * The Overview's insight cards read one stubbed DashboardInsights reply: Top Risk Events lists the open
 * book by event with each row's share, and Big Bets & Winners links each player to their profile. (The
 * Agents Near Credit Limit card went with the credit limits: the CREDIT scheme is on chips since 2026-11-02.)
 * The Players tab's retention and the Financial tab's casino providers and bonus analysis are checked against
 * their own stubs.
 */
import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable } from '@apollo/client'
import * as insightCards from './InsightCards'
import { BigBetsCard, TopRiskEventsCard } from './InsightCards'
import { DASHBOARD_INSIGHTS_QUERY } from '../graphql'
import { print } from 'graphql'
import { RetentionSections } from './RetentionSections'
import { BonusAnalysisSection, CasinoProvidersCard } from './FinancialInsights'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    convertFromWhitelabelCurrency: (amount: number) => amount,
    formatAmount: (amount: number) => `INR ${amount}`,
  }),
}))

afterEach(cleanup)

const INSIGHTS = {
  __typename: 'DashboardInsights',
  openExposure: 10000,
  riskEvents: [
    { __typename: 'DashboardRiskEvent', key: 'sports:e1', product: 'sports', label: 'India v Australia', detail: 'Cricket', startsAt: null, exposure: 6000, bets: 12, players: 5 },
    { __typename: 'DashboardRiskEvent', key: 'matka:m1', product: 'matka', label: 'KALYAN', detail: 'close · 29 Oct', startsAt: null, exposure: 4000, bets: 4, players: 2 },
  ],
  bigBets: [
    { __typename: 'DashboardBigBet', id: 'sports:b1', product: 'sports', userId: 746, username: 'rakesh001', agent: 'vijayji', label: 'India v Australia', amount: 5000, outcome: 'won', playerPl: 4000, placedAt: '2026-10-29T08:00:00.000Z' },
  ],
  topWinners: [
    { __typename: 'DashboardTopWinner', userId: 746, username: 'rakesh001', agent: null, profit: 100900, staked: 1100, bets: 11 },
  ],
}

const RETENTION = {
  __typename: 'DashboardPlayerRetention',
  dailyActive: 10, weeklyActive: 40, monthlyActive: 100, activeInPeriod: 40, activePrevious: 50, returning: 25,
  newPlayers: 20, newDepositors: 5, repeatDepositors: 6, depositors: 12, lapsing: 9,
}

const FINANCIAL = {
  __typename: 'DashboardFinancialInsights',
  casinoProviders: [
    { __typename: 'DashboardCasinoProvider', vendor: 'Ezugi', turnover: 10000, payouts: 9000, ggr: 1000, bets: 50, players: 7 },
    { __typename: 'DashboardCasinoProvider', vendor: 'Spribe', turnover: 2000, payouts: 2500, ggr: -500, bets: 20, players: 3 },
  ],
  casinoTotal: { __typename: 'DashboardCasinoProvider', vendor: 'All providers', turnover: 12000, payouts: 11500, ggr: 500, bets: 70, players: 9 },
  bonusGiven: 2000, bonusAwards: 4,
  bonusByType: [{ __typename: 'DashboardBonusType', type: 'daily_first_deposit', amount: 1500, awards: 3 }],
  bonusOutstanding: 7000, bonusOutstandingAwards: 11, bonusCompleted: 3, bonusExpired: 1, bonusStakes: 900,
}

function mount(children: ReactNode, insights: object = INSIGHTS) {
  const link = new ApolloLink((operation) => new Observable((observer) => {
    const reply = operation.operationName === 'DashboardPlayerRetention' ? { dashboardPlayerRetention: RETENTION }
      : operation.operationName === 'DashboardFinancialInsights' ? { dashboardFinancialInsights: FINANCIAL }
      : { dashboardInsights: insights }
    const timer = setTimeout(() => { observer.next({ data: reply }); observer.complete() }, 1)
    return () => clearTimeout(timer)
  }))
  return render(
    <MemoryRouter>
      <ApolloProvider client={new ApolloClient({ link, cache: new InMemoryCache() })}>{children}</ApolloProvider>
    </MemoryRouter>,
  )
}

/** A figure's value: the dd that follows its label in the named section. */
function figure(section: string, label: string): HTMLElement {
  const value = within(screen.getByRole('region', { name: section })).getByText(label).parentElement?.querySelector('dd')
  assert.ok(value, `${section} › ${label} has a value`)
  return value as HTMLElement
}

describe('Overview insight cards', () => {
  test('Top Risk Events lists each open event with its share of the open book', async () => {
    mount(<TopRiskEventsCard />)
    const card = screen.getByRole('region', { name: 'Top Risk Events' })
    await within(card).findByText('India v Australia')
    assert.ok(within(card).getByText('Cricket · 12 bets · 5 players'))
    assert.ok(within(card).getByText('INR 6000'))
    assert.ok(within(card).getByText('60.0% of open'))
    assert.ok(within(card).getByText('KALYAN'))
  })

  test('Big Bets & Winners links each player to their profile', async () => {
    mount(<BigBetsCard />)
    const card = screen.getByRole('region', { name: 'Big Bets & Winners' })
    const links = await within(card).findAllByRole('link', { name: 'rakesh001' })
    assert.equal(links.length, 2)
    assert.ok(links.every((link) => link.getAttribute('href') === '/players/profile/746'))
    assert.ok(within(card).getByText('Won'))
    assert.ok(within(card).getByText('+INR 100900'))
  })

  test('a Super Admin in core mode sees the players without profile links the players module cannot open (PLA-05)', async () => {
    // Core mode's insights span every whitelabel; its profile page reads the platform's own site ("Player not found").
    const ui = useUIStore.getState(); const roles = useAuthStore.getState().roles
    useAuthStore.setState({ roles: ['Super Admin'] }); useUIStore.setState({ directorMode: 'core', selectedWhitelabelId: null })
    try {
      const core = mount(<BigBetsCard />)
      const card = screen.getByRole('region', { name: 'Big Bets & Winners' })
      assert.equal((await within(card).findAllByText('rakesh001')).length, 2)
      assert.equal(within(card).queryAllByRole('link').length, 0)
      assert.ok(within(card).getByText('+INR 100900'))
      core.unmount()
      // With a whitelabel selected the profile opens in that site, so the names link again.
      useUIStore.setState({ directorMode: 'whitelabel', selectedWhitelabelId: 'grandwinn-com' })
      mount(<BigBetsCard />)
      const links = await within(screen.getByRole('region', { name: 'Big Bets & Winners' })).findAllByRole('link', { name: 'rakesh001' })
      assert.ok(links.length === 2 && links.every((link) => link.getAttribute('href') === '/players/profile/746'))
    } finally {
      useAuthStore.setState({ roles }); useUIStore.setState({ directorMode: ui.directorMode, selectedWhitelabelId: ui.selectedWhitelabelId })
    }
  })

  test('there is no near-credit-limit card, and the insights read no credit-limit figures', () => {
    // CREDIT agents are on chips (Deposit / Withdraw): no limit to be near, so no card and no such fields.
    assert.equal('AgentsNearLimitCard' in insightCards, false)
    const document = print(DASHBOARD_INSIGHTS_QUERY)
    for (const field of ['agentsNearLimit', 'nearLimitShare', 'creditUsed', 'usedShare']) assert.equal(document.includes(field), false, field)
  })

  test('Retention figures divide as labelled', async () => {
    mount(<RetentionSections />)
    await screen.findByRole('region', { name: 'Active Players' })
    await within(screen.getByRole('region', { name: 'Active Players' })).findByText('10')
    assert.equal(figure('Active Players', 'Stickiness').textContent, '10.0%')
    assert.equal(figure('Retention & Conversion', 'First-Deposit Conversion').textContent, '25.0%')
    assert.ok(screen.getByText("50.0% of last period's players came back"))
  })

  test('Casino providers carry hold and a total row; bonus is set against GGR', async () => {
    mount(<><CasinoProvidersCard /><BonusAnalysisSection ggr={10000} /></>)
    const table = await screen.findByRole('table', { name: 'Casino providers by turnover' })
    assert.ok(within(table).getByText('Ezugi'))
    assert.ok(within(table).getByText('10.0%'))
    assert.ok(within(table).getByText('All providers'))
    await within(screen.getByRole('region', { name: 'Bonus Analysis' })).findByText('INR 2000')
    assert.equal(figure('Bonus Analysis', 'Bonus vs GGR').textContent, '20.0%')
    assert.equal(figure('Bonus Analysis', 'Wagering Completed').textContent, '75.0%')
    assert.ok(screen.getByText('Daily first deposit'))
  })
})
