/**
 * The Bet List table card: the column set the rows choose (sports, casino, matka or mixed, with the Details
 * column where the legacy table put it), every cell rule, the two detail popovers, the GM-Ag Round Detail
 * mutation (MockedProvider) with its new-tab open and its three failure toasts, and the card's count,
 * export button and loading, empty and error states.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider, MockLink, type MockedResponse } from '@apollo/client/testing'
import { ApolloLink, Observable } from '@apollo/client'
import type { ComponentProps } from 'react'
import { GMAG_ROUND_DETAIL } from '@/lib/graphql/casino'
import type { CasinoBetItem, MatkaBetItem, SportsBetItem } from '../betListModel'
import { BetListTable } from './BetListTable'

const feedback = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency = 'INR') => `${currency} ${amount.toFixed(2)}`,
  }),
}))

vi.mock('@/shared/core/useFormatDate', async () => {
  const { formatInTimeZone } = await import('@/shared/utils/date')
  return {
    useFormatDate: () => ({
      formatDate: (value: string, pattern = 'dd MMM yyyy') => formatInTimeZone(value, pattern, 'Asia/Kolkata'),
      formatTime: (value: string, pattern = 'HH:mm') => formatInTimeZone(value, pattern, 'Asia/Kolkata'),
    }),
  }
})

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

function sports(id: string, overrides: Partial<SportsBetItem> = {}): SportsBetItem {
  return {
    __typename: 'SportsBet',
    id,
    userId: 'u1',
    userName: 'rk_sharma88',
    userPhone: '9876543210',
    sportName: 'Cricket',
    leagueName: 'ICC',
    eventName: 'Ind vs Aus',
    marketName: 'Match Odds',
    selectionName: 'India',
    side: 'lay',
    stake: 25000,
    price: 1.9,
    oddsSize: 120.4,
    liability: 21500,
    pl: -25000,
    result: null,
    eventResult: 'Australia won',
    status: 'lost',
    currency: 'INR',
    createdAt: '2026-10-07T05:00:00.000Z',
    walletType: 'referral_bonus',
    ipAddress: '10.1.2.3',
    deviceInfo: 'Android 14',
    location: null,
    country: 'IN',
    campaign: {
      id: 'cmp1',
      name: 'Weekend Boost',
      type: 'deposit',
      distributionType: 'instant_cash',
      wageringReq: 5,
      amount: 500,
      validFrom: '2026-10-01T00:00:00.000Z',
    },
    ...overrides,
  }
}

function casino(id: string, overrides: Partial<CasinoBetItem> = {}): CasinoBetItem {
  return {
    __typename: 'CasinoBet',
    id,
    userId: null,
    userName: null,
    userPhone: null,
    gameName: 'Aviator',
    vendorName: 'Spribe',
    tableId: null,
    stake: 5000,
    payout: 12000,
    winAmount: 12000,
    netAmount: 7000,
    status: 'won',
    currency: 'INR',
    createdAt: '2026-10-07T04:00:00.000Z',
    walletType: null,
    sessionId: 'S-1',
    gameRoundId: `R-${id}`,
    transactionId: null,
    settledAt: '2026-10-07T04:05:00.000Z',
    providerCode: 'GMAG',
    campaign: null,
    ...overrides,
  }
}

function matka(id: string, overrides: Partial<MatkaBetItem> = {}): MatkaBetItem {
  return {
    __typename: 'MatkaBet',
    id,
    userId: 'u3',
    userName: 'neha_21',
    userPhone: null,
    marketName: 'Kalyan',
    matkaType: null,
    marketSession: 'close',
    bidType: null,
    betNumbers: null,
    betAmount: 100,
    payoutMultiplier: null,
    potentialWin: null,
    actualWin: 900,
    result: '47',
    status: 'won',
    currency: 'INR',
    createdAt: '2026-10-07T03:00:00.000Z',
    walletType: 'bonus',
    campaign: null,
    ...overrides,
  }
}

type HeldRound = { release?: () => void }
function renderTable(props: Partial<ComponentProps<typeof BetListTable>> = {}, mocks: MockedResponse[] = [], held?: HeldRound) {
  const handlers = { onExportAll: vi.fn(async () => {}), onRetry: vi.fn() }
  const link = held ? ApolloLink.from([new ApolloLink((operation, forward) => new Observable((observer) => {
    let cancel: (() => void) | undefined
    held.release = () => {
      const subscription = forward(operation).subscribe(observer)
      cancel = () => subscription.unsubscribe()
    }
    return () => { held.release = undefined; cancel?.() }
  })), new MockLink(mocks)]) : undefined
  render(
    <MockedProvider mocks={mocks} link={link}>
      <MemoryRouter>
        <BetListTable items={[]} total={0} loading={false} {...handlers} {...props} />
      </MemoryRouter>
    </MockedProvider>,
  )
  return handlers
}

function headers() {
  return within(screen.getByRole('table', { name: 'Bets' }))
    .getAllByRole('columnheader')
    .map((header) => header.textContent)
}

function rowCells(index: number) {
  const [, ...rows] = within(screen.getByRole('table', { name: 'Bets' })).getAllByRole('row')
  return within(rows[index]).getAllByRole('cell')
}

function roundMock(id: string, result: MockedResponse['result'] | undefined, extra: Partial<MockedResponse> = {}): MockedResponse {
  return {
    request: {
      query: GMAG_ROUND_DETAIL,
      variables: { roundId: `R-${id}`, endTime: '2026-10-07T04:05:00.000Z', providerCode: 'GMAG' },
    },
    result,
    ...extra,
  }
}

beforeEach(() => {
  feedback.toast.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BetListTable', () => {
  test('a sports-only page gets the sports columns, Details after Status, the full path and spaced odds', () => {
    renderTable({ items: [sports('1')], total: 1 })

    assert.deepEqual(headers(), [
      'Time', 'Domain', 'Name', 'Phone', 'Wallet', 'Campaign', 'Event', 'Market', 'Selection', 'Type',
      'Stake', 'Odds', 'Liability', 'P/L', 'Result', 'Status', 'Details',
    ])
    const cells = rowCells(0)
    const text = cells.map((cell) => cell.textContent)
    assert.equal(text[0], '07 Oct 2610:30:00')
    assert.equal(text[4], 'Referral')
    assert.equal(text[5], 'Weekend Boost')
    assert.equal(text[6], 'Cricket › ICC › Ind vs Aus')
    assert.equal(within(cells[6]).getByTitle('Cricket › ICC › Ind vs Aus').tagName, 'SPAN')
    assert.deepEqual(text.slice(7, 14), [
      'Match Odds', 'India', 'lay', 'INR 25000.00', '120 / 1.90', 'INR 21500.00', 'INR -25000.00',
    ])
    assert.equal(text[14], 'Australia wonLost')
    assert.equal(text[15], 'Lost')
    assert.equal(text[16], 'View')
  })

  test('a casino-only page: Table and Win Amt, outcomes only for won or lost, Round Detail only when settled', () => {
    renderTable({
      items: [casino('1'), casino('2', { status: 'cancelled', settledAt: null, sessionId: null, gameRoundId: null })],
      total: 2,
    })

    assert.deepEqual(headers(), [
      'Time', 'Domain', 'Name', 'Phone', 'Wallet', 'Campaign', 'Game', 'Vendor', 'Table', 'Stake', 'Payout',
      'Win Amt', 'P/L', 'Result', 'Status', 'Details',
    ])
    const settled = rowCells(0).map((cell) => cell.textContent)
    assert.deepEqual(settled.slice(1, 6), ['Casino', '—', '—', 'Cash', '—'])
    assert.deepEqual(settled.slice(6, 15), [
      'Aviator', 'Spribe', '—', 'INR 5000.00', 'INR 12000.00', 'INR 12000.00', '+INR 7000.00', 'Won', 'Won',
    ])
    assert.ok(within(rowCells(0)[15]).getByRole('button', { name: 'Round Detail' }))

    const open = rowCells(1).map((cell) => cell.textContent)
    assert.equal(open[13], '—', 'a cancelled casino bet has no outcome')
    assert.equal(open[14], 'Cancelled')
    assert.equal(open[15], '—', 'no identifiers and no settled round: a dash')
  })

  test('a matka-only page puts a dash Details column before Status and derives P/L from the win', () => {
    renderTable({ items: [matka('1'), matka('2', { status: 'cancelled', result: null, actualWin: null })], total: 2 })

    assert.deepEqual(headers(), [
      'Time', 'Domain', 'Name', 'Phone', 'Wallet', 'Campaign', 'Matka', 'Session', 'Bid Type', 'Numbers', 'Stake',
      'Multiplier', 'Potential Win', 'P/L', 'Result', 'Details', 'Status',
    ])
    const won = rowCells(0).map((cell) => cell.textContent)
    assert.deepEqual(won.slice(6, 17), [
      'Kalyan', 'close', '—', '—', 'INR 100.00', '—', '—', '+INR 800.00', '47', '—', 'Won',
    ])
    const cancelled = rowCells(1).map((cell) => cell.textContent)
    assert.deepEqual([cancelled[13], cancelled[14], cancelled[16]], ['INR 0.00', 'Cancelled', 'Cancelled'])
  })

  test('a mixed page uses the shared columns with Details before Status', () => {
    renderTable({ items: [sports('1'), casino('2'), matka('3')], total: 3 })

    assert.deepEqual(headers(), [
      'Time', 'Domain', 'Name', 'Phone', 'Wallet', 'Campaign', 'Event / Game', 'Market / Vendor', 'Type',
      'Stake', 'Odds', 'Liability', 'P/L', 'Result', 'Details', 'Status',
    ])
    assert.equal(rowCells(0)[10].textContent, '120/1.90', 'the mixed list writes odds without spaces')
    assert.equal(rowCells(0)[6].textContent, 'Cricket › Ind vs Aus')
    assert.equal(rowCells(2)[13].textContent, '47')
    assert.equal(rowCells(2)[14].textContent, '—')
  })

  test('View opens the bet details popover; the campaign name opens its details', async () => {
    renderTable({ items: [sports('1')], total: 1 })

    fireEvent.click(within(rowCells(0)[16]).getByRole('button', { name: 'View' }))
    const details = await screen.findByRole('dialog', { name: 'Bet Details' })
    assert.deepEqual(within(details).getAllByRole('term').map((term) => term.textContent), ['IP', 'Country', 'Device'])
    assert.deepEqual(
      within(details).getAllByRole('definition').map((value) => value.textContent),
      ['10.1.2.3', 'IN', 'Android 14'],
    )
    fireEvent.keyDown(details, { key: 'Escape' })
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Bet Details' }), null))

    const campaign = within(rowCells(0)[5]).getByRole('button', { name: 'Weekend Boost' })
    assert.equal(campaign.getAttribute('title'), 'Weekend Boost')
    fireEvent.click(campaign)
    const campaignDetails = await screen.findByRole('dialog', { name: 'Campaign details' })
    assert.deepEqual(within(campaignDetails).getAllByRole('term').map((term) => term.textContent), [
      'Name', 'Type', 'Payout type', 'Wagering', 'Amount', 'Valid from',
    ])
    assert.ok(within(campaignDetails).getByText('Instant Cash'))
    assert.ok(within(campaignDetails).getByText('01 Oct 2026'))
  })

  test('Round Detail sends the settled round, opens the URL in a new tab and holds the other rounds', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const held: HeldRound = {}
    renderTable(
      { items: [casino('1'), casino('2')], total: 2 },
      [roundMock('1', { data: { gmagRoundDetail: { __typename: 'GmagRoundDetail', url: 'https://gm.example.test/r/1' } } })],
      held,
    )

    const first = within(rowCells(0)[15]).getByRole('button', { name: 'Round Detail' })
    fireEvent.click(first)
    await waitFor(() => assert.equal(first.getAttribute('aria-busy'), 'true'))
    const second = within(rowCells(1)[15]).getByRole('button', { name: 'Round Detail' })
    assert.equal(second.getAttribute('aria-disabled'), 'true', 'another round waits while one is opening')
    assert.equal(open.mock.calls.length, 0)
    assert.ok(held.release)
    held.release()

    await waitFor(() => assert.deepEqual(open.mock.calls, [['https://gm.example.test/r/1', '_blank', 'noopener,noreferrer']]))
    await waitFor(() => assert.equal(second.getAttribute('aria-disabled'), null))
    assert.equal(feedback.toast.mock.calls.length, 0)
  })

  test('Round Detail reports a refusal, a missing URL and a network failure as Round Detail toasts', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderTable(
      { items: [casino('1'), casino('2'), casino('3')], total: 3 },
      [
        roundMock('1', { errors: [{ message: 'Round not found' }] as never }),
        roundMock('2', { data: { gmagRoundDetail: { __typename: 'GmagRoundDetail', url: null } } }),
        roundMock('3', undefined, { error: new Error('Provider timeout') }),
      ],
    )

    for (const [row, message] of [[0, 'Round not found'], [1, 'No URL returned.'], [2, 'Provider timeout']] as const) {
      fireEvent.click(within(rowCells(row)[15]).getByRole('button', { name: 'Round Detail' }))
      await waitFor(() => assert.deepEqual(feedback.toast.mock.calls.at(-1)?.[0], {
        title: 'Round Detail',
        message,
        tone: 'error',
        duration: 4500,
      }))
      await waitFor(() => assert.equal(
        within(rowCells(row)[15]).getByRole('button', { name: 'Round Detail' }).getAttribute('aria-busy'),
        null,
      ))
    }
    assert.equal(open.mock.calls.length, 0)
  })

  test('the card counts the bets and exports on demand', () => {
    const { onExportAll } = renderTable({ items: [matka('1')], total: 1 })
    const card = screen.getByRole('region', { name: 'Bet List' })
    assert.equal(within(card).getByRole('heading', { level: 2 }).textContent, 'Bet List')
    assert.ok(within(card).getByText('1 bet'))
    fireEvent.click(within(card).getByRole('button', { name: 'Export Excel' }))
    assert.equal(onExportAll.mock.calls.length, 1)
  })

  test('a refetch keeps the rows, marks the table busy and holds the export', () => {
    renderTable({ items: [matka('1')], total: 1, loading: true })
    assert.equal(screen.getByRole('table', { name: 'Bets' }).getAttribute('aria-busy'), 'true')
    assert.equal(rowCells(0)[2].textContent, 'neha_21')
    assert.equal((screen.getByRole('button', { name: 'Export Excel' }) as HTMLButtonElement).disabled, true)
  })

  test('the first load shows the loading state under the mixed headers', () => {
    renderTable({ loading: true })
    assert.ok(screen.getByText('Loading Bets'))
    assert.equal(headers()[6], 'Event / Game')
    assert.equal((screen.getByRole('button', { name: 'Export Excel' }) as HTMLButtonElement).disabled, true)
  })

  test('an empty page says no bets were found and cannot be exported', () => {
    renderTable()
    assert.ok(screen.getByText('No bets found'))
    assert.ok(screen.getByText('0 bets'))
    assert.equal((screen.getByRole('button', { name: 'Export Excel' }) as HTMLButtonElement).disabled, true)
  })

  test('a failed page shows the error under the headers and Retry asks again', () => {
    const { onRetry } = renderTable({ error: 'Bets service unavailable' })
    const table = screen.getByRole('table', { name: 'Bets' })
    assert.ok(within(table).getByText('Bets service unavailable'))
    fireEvent.click(within(table).getByRole('button', { name: 'Retry' }))
    assert.equal(onRetry.mock.calls.length, 1)
  })
})
