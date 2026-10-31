/**
 * ExposureByMarketCard mounts on the dashboard with its own query, so a wrong field, a state that says the
 * wrong thing or a link to the wrong page would only show up in the browser. This mounts the card against a
 * mocked DashboardExposureByMarket reply and checks what a user reads in each state: rows (folded past six,
 * with shares that add up to 100), nothing open, still waiting, a failed refresh after a good reading, and a
 * failure with no reading. Currency is
 * stubbed to a plain formatter that honours fractionDigits, so the card's whole-unit amounts are pinned; the
 * real conversion is CurrencyContext's business, not this card's.
 */
import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useApolloClient, type ApolloClient } from '@apollo/client'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { EXPOSURE_BY_MARKET_QUERY } from '../graphql'
import { ExposureByMarketCard } from './ExposureByMarketCard'

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, _currencyCode?: string, options?: { fractionDigits?: number }) =>
      `INR ${amount.toFixed(options?.fractionDigits ?? 2)}`,
    convertFromWhitelabelCurrency: (amount: number) => amount,
  }),
}))

const AT = '2026-09-22T06:30:05.000Z'

function market(key: string, label: string, amount: number, product = 'sports') {
  return { __typename: 'ExposureByMarketRow', key, product, label, amount }
}

function reply(markets: ReturnType<typeof market>[]): MockedResponse {
  return {
    request: { query: EXPOSURE_BY_MARKET_QUERY },
    result: { data: { exposureByMarket: { __typename: 'ExposureByMarket', at: AT, markets } } },
  }
}

function renderCard(mocks: MockedResponse[]) {
  return render(
    <MemoryRouter>
      <MockedProvider mocks={mocks}>
        <ExposureByMarketCard />
      </MockedProvider>
    </MemoryRouter>
  )
}

describe('ExposureByMarketCard', () => {
  test('draws the top five plus "Others (n)", whole-percent shares and the reading time', async () => {
    renderCard([
      reply([
        market('sports:cricket', 'Cricket', 500),
        market('matka', 'Matka', 200, 'matka'),
        market('sports:football', 'Football', 100),
        market('sports:tennis', 'Tennis', 80),
        market('sports:esports', 'eSports', 60),
        market('sports:golf', 'Golf', 40),
        market('sports:politics', 'Politics', 20),
      ]),
    ])

    const table = await screen.findByRole('table')
    const heads = within(table).getAllByRole('columnheader').map(th => th.textContent)
    assert.deepStrictEqual(heads, ['Market', 'Amount', 'Share'])

    const rows = within(table).getAllByRole('row').slice(1)
    const cells = rows.map(row => [
      within(row).getByRole('rowheader').textContent,
      ...within(row).getAllByRole('cell').map(td => td.textContent),
    ])
    // whole units, as the mockup prints this card; the Share column carries the precision
    assert.deepStrictEqual(cells, [
      ['Cricket', 'INR 500', '50%'],
      ['Matka', 'INR 200', '20%'],
      ['Football', 'INR 100', '10%'],
      ['Tennis', 'INR 80', '8%'],
      ['eSports', 'INR 60', '6%'],
      ['Others (2)', 'INR 60', '6%'],
    ])

    // Each amount has one decorative kit Meter. The adjacent Share cell remains the only
    // accessible carrier of the percentage, so assistive technology does not hear it twice.
    assert.equal(screen.queryAllByRole('meter').length, 0)
    const expectedWidths = ['50%', '20%', '10%', '8%', '6%', '6%']
    rows.forEach((row, index) => {
      const amountCell = within(row).getAllByRole('cell')[0]
      const meter = amountCell.querySelector<HTMLElement>('[aria-hidden="true"]')
      assert.ok(meter, `row ${index + 1} has a decorative meter`)
      assert.equal(meter.tagName, 'DIV')
      assert.equal(meter.querySelector<HTMLElement>('span')?.style.width, expectedWidths[index])
    })

    // The folded row's count is a box of its own after the name, so the name's ellipsis cannot
    // take it; the title keeps the whole name for every row.
    const others = within(rows[5]).getByRole('rowheader')
    const count = within(others).getByText('(2)')
    assert.equal(count.textContent, ' (2)')
    assert.equal(count.previousElementSibling?.textContent, 'Others')
    assert.equal(count.parentElement?.getAttribute('title'), 'Others (2)')
    assert.equal(within(rows[0]).getByTitle('Cricket').textContent, 'Cricket')

    const time = screen.getByText((_, el) => el?.tagName === 'TIME')
    assert.equal(time.getAttribute('datetime'), AT)
    assert.match(time.textContent ?? '', /^\d{2}:\d{2}:\d{2}$/)
    assert.match(time.parentElement?.textContent ?? '', /^Open now · updated \d{2}:\d{2}:\d{2}$/)
  })

  test('says so when nothing is open', async () => {
    renderCard([reply([])])
    assert.ok(await screen.findByText('No open exposure right now.'))
    assert.equal(screen.queryByRole('table'), null)
  })

  test('marks the body busy until the first reading lands', async () => {
    renderCard([reply([])])
    assert.ok(screen.getByText('Loading…'))
    assert.equal(screen.getByText('—').getAttribute('aria-busy'), 'true')
    await screen.findByText('No open exposure right now.')
    assert.equal(screen.getByText('No open exposure right now.').getAttribute('aria-busy'), null)
  })

  test('keeps the last good reading, and says so, when a refresh fails', async () => {
    // The page's Refresh (refetchQueries on every active query) stands in for the 15 s poll.
    let client: ApolloClient<object> | undefined
    function CaptureClient() {
      client = useApolloClient()
      return null
    }
    render(
      <MemoryRouter>
        <MockedProvider
          mocks={[
            reply([market('sports:cricket', 'Cricket', 300), market('matka', 'Matka', 100, 'matka')]),
            { request: { query: EXPOSURE_BY_MARKET_QUERY }, error: new Error('boom') },
          ]}
        >
          <>
            <CaptureClient />
            <ExposureByMarketCard />
          </>
        </MockedProvider>
      </MemoryRouter>
    )
    await screen.findByRole('table')
    await act(async () => {
      await client?.refetchQueries({ include: 'active' }).catch(() => undefined)
    })

    // a stale reading is not "open now": the line leads with the failure and dates what is shown
    const time = screen.getByText((_, el) => el?.tagName === 'TIME')
    assert.match(time.parentElement?.textContent ?? '', /^Refresh failed · as of \d{2}:\d{2}:\d{2}$/)
    assert.equal(time.getAttribute('datetime'), AT)
    assert.deepStrictEqual(
      screen.getAllByRole('rowheader').map(th => th.textContent),
      ['Cricket', 'Matka']
    )
  })

  test('says "Unavailable" when the first reading fails', async () => {
    renderCard([{ request: { query: EXPOSURE_BY_MARKET_QUERY }, error: new Error('boom') }])
    assert.ok(await screen.findByText('Unavailable'))
    assert.equal(screen.queryByRole('table'), null)
    assert.equal(screen.getByText('—').getAttribute('aria-busy'), null)
  })

  test('titles the card and links "View all" to the Exposure Report', async () => {
    renderCard([reply([])])
    assert.ok(screen.getByRole('region', { name: 'Exposure by market' }))
    // a card title sits one level under the page's h1
    assert.ok(screen.getByRole('heading', { name: 'Exposure by market', level: 2 }))
    const link = screen.getByRole('link', { name: 'View all exposure' })
    assert.equal(link.getAttribute('href'), '/reporting/exposure')
    assert.match(link.textContent ?? '', /^View all ›$/)
    await screen.findByText('No open exposure right now.')
  })
})
