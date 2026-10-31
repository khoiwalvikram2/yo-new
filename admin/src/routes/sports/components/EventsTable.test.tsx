/**
 * The events table on its own: the legacy columns and every cell rule, the name and View links to the
 * event page, the favourite star, client paging (25 a page, 10/25/50/100, a shrunken list showing its last
 * page), and the loading, empty and error states.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useSportsEventsStore } from '@/state/sportsEventsStore'
import type { SportsEvent } from '../eventsPageModel'
import { EventsTable } from './EventsTable'

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number) => `₹${amount.toFixed(2)}`,
    convertFromWhitelabelCurrency: (amount: number) => amount,
    getCurrencySymbol: () => '₹',
  }),
}))

vi.mock('@/shared/core/useFormatDate', async () => {
  const { formatInTimeZone } = await import('@/shared/utils/date')
  return {
    useFormatDate: () => ({
      formatDate: (value: string, pattern = 'dd MMM yyyy') => formatInTimeZone(value, pattern, 'Asia/Kolkata'),
      formatDateTime: (value: string, pattern = 'dd MMM yyyy HH:mm') => formatInTimeZone(value, pattern, 'Asia/Kolkata'),
    }),
  }
})

// 2026-10-07 17:30 IST
const NOW = Date.parse('2026-10-07T12:00:00.000Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const at = (ms: number) => new Date(NOW + ms).toISOString()

function sportsEvent(id: string, overrides: Partial<SportsEvent> = {}): SportsEvent {
  return {
    id,
    sport: 'Cricket',
    competition: 'IPL',
    name: `Event ${id}`,
    startTime: at(2 * HOUR),
    status: 'active',
    marketCount: 10,
    totalLiquidity: 500,
    matchedVolume: 0,
    betsCount: 1,
    inPlay: false,
    updatedAt: at(-HOUR),
    lastBetAt: null,
    ...overrides,
  }
}

const FOUR: SportsEvent[] = [
  sportsEvent('e1', {
    name: 'India vs Australia',
    inPlay: true,
    startTime: at(-2 * HOUR),
    marketCount: 64,
    totalLiquidity: 1_240_000,
    betsCount: 1234,
    lastBetAt: at(-5 * MINUTE),
  }),
  sportsEvent('e2', {
    name: 'Man City vs Arsenal',
    sport: 'Football',
    competition: 'EPL',
    startTime: at(30 * MINUTE),
    marketCount: 21,
    totalLiquidity: 150_000,
    betsCount: 0,
  }),
  sportsEvent('e3', {
    name: 'Alcaraz vs Sinner',
    sport: 'Tennis',
    competition: 'Wimbledon',
    status: 'suspended',
    startTime: at(26 * HOUR),
    marketCount: 5,
    totalLiquidity: 800,
    betsCount: 3,
    lastBetAt: at(-3 * HOUR),
  }),
  sportsEvent('e4', {
    name: 'Lakers vs Celtics',
    sport: 'Basketball',
    competition: 'NBA',
    status: 'finished',
    startTime: at(-5 * HOUR),
    marketCount: 30,
    totalLiquidity: 50_000,
    betsCount: 12,
    lastBetAt: at(-9 * 24 * HOUR),
  }),
]

function renderTable(props: Partial<Parameters<typeof EventsTable>[0]> = {}) {
  const element = (next: Partial<Parameters<typeof EventsTable>[0]>) => (
    <MemoryRouter>
      <EventsTable events={FOUR} {...next} />
    </MemoryRouter>
  )
  const view = render(element(props))
  return { ...view, update: (next: Partial<Parameters<typeof EventsTable>[0]>) => view.rerender(element(next)) }
}

function table() {
  return screen.getByRole('table', { name: 'Events' })
}

function bodyRows() {
  const [, ...rows] = within(table()).getAllByRole('row')
  return rows
}

function cells(row: HTMLElement) {
  return within(row).getAllByRole('cell').map((cell) => cell.textContent)
}

function rowNames() {
  return bodyRows().map((row) => within(row).getAllByRole('link')[0].textContent)
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  useSportsEventsStore.setState({ favoriteEvents: new Set<string>(), viewMode: 'table' })
})

describe('EventsTable', () => {
  test('the legacy columns and every cell rule', () => {
    renderTable()
    assert.deepEqual(
      within(table()).getAllByRole('columnheader').map((header) => header.textContent),
      ['Event Details', 'Start Time', 'Markets', 'Liability', 'Status', 'Recent Activity', 'Actions'],
    )
    const [live, soon, suspended, finished] = bodyRows()
    assert.deepEqual(cells(live).slice(0, 6), [
      'India vs AustraliaCricket•IPL',
      'Oct 7, 15:30LIVE NOW',
      '64High',
      '₹1.2M1,234 bets',
      'Live',
      '5m agoOct 7, 17:25',
    ])
    assert.deepEqual(cells(soon).slice(0, 6), [
      'Man City vs ArsenalFootball•EPL',
      'Oct 7, 18:0030m',
      '21Medium',
      '₹150.0K0 bets',
      'Upcoming',
      'No bets yet',
    ])
    assert.ok(within(soon).getAllByRole('cell')[1].querySelector('svg'), 'a start within the hour carries the flame')
    assert.deepEqual(cells(suspended).slice(0, 6), [
      'Alcaraz vs SinnerTennis•Wimbledon',
      'Oct 8, 19:301d 2h',
      '5Low',
      '₹800.003 bets',
      'Suspended',
      '3h agoOct 7, 14:30',
    ])
    assert.deepEqual(cells(finished).slice(1, 6), ['Oct 7, 12:30Finished', '30Medium', '₹50.0K12 bets', 'Finished', 'Sep 28Sep 28, 17:30'])
    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /Showing 1–4 of 4 events/)
  })

  test('the name and View open the event page', () => {
    renderTable()
    const [live] = bodyRows()
    assert.equal(within(live).getByRole('link', { name: 'India vs Australia' }).getAttribute('href'), '/sports/event/e1')
    assert.equal(within(live).getByRole('link', { name: 'View India vs Australia' }).getAttribute('href'), '/sports/event/e1')
    assert.equal(within(live).getByRole('link', { name: 'India vs Australia' }).getAttribute('title'), 'India vs Australia')
  })

  test('the star adds the event to the saved favourites and takes it out again', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: 'Add Man City vs Arsenal to favorites' }))
    assert.equal(useSportsEventsStore.getState().isFavorite('e2'), true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Man City vs Arsenal from favorites' }))
    assert.equal(useSportsEventsStore.getState().isFavorite('e2'), false)
  })

  test('pages 25 at a time; a new page size returns to page 1; a shrunken list shows its last page', () => {
    const thirty = Array.from({ length: 30 }, (_, index) => sportsEvent(String(index + 1)))
    const view = renderTable({ events: thirty })
    assert.equal(bodyRows().length, 25)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    assert.deepEqual(rowNames(), ['Event 26', 'Event 27', 'Event 28', 'Event 29', 'Event 30'])

    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page:' }), { target: { value: '10' } })
    assert.equal(rowNames()[0], 'Event 1')
    assert.equal(bodyRows().length, 10)
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    assert.equal(rowNames()[0], 'Event 21')

    view.update({ events: thirty.slice(0, 12) })
    assert.deepEqual(rowNames(), ['Event 11', 'Event 12'])
  })

  test('loading, empty and error states', () => {
    const onRetry = vi.fn()
    const view = renderTable({ events: [], loading: true })
    assert.ok(screen.getByText('Loading Events'))
    assert.equal(screen.queryByRole('navigation', { name: 'Pagination' }), null)

    view.update({ events: [] })
    assert.ok(screen.getByText('No events found'))
    assert.ok(screen.getByText('Try adjusting your filters or search query'))
    assert.equal(screen.queryByRole('navigation', { name: 'Pagination' }), null)

    view.update({ events: [], error: 'Network down', onRetry })
    assert.ok(screen.getByText('Network down'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    assert.equal(onRetry.mock.calls.length, 1)

    view.update({ events: FOUR, loading: true })
    assert.equal(bodyRows().length, 4, 'rows stay while the list refreshes')
    assert.equal(table().getAttribute('aria-busy'), 'true')
  })
})
