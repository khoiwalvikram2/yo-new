/**
 * /referrals/earnings against a mocked GraphQL server (MockedProvider with a link that answers by operation
 * name): the guard, the documents and variables sent for every filter, the referrer/referee searches and
 * the referee-to-referrer attribution, the totals, the table's column filters, sorting and paging, and the
 * loading, empty and error states.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider } from '@apollo/client/testing'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { print } from 'graphql'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import EarningsPage from './EarningsPage'
import type { ReferralEarning } from './referralEarningsModel'

interface GuardCall {
  required: Array<{ domain: string; actions: string[] }>
  requireAny?: boolean
}

interface ServerCall {
  operationName: string
  variables: Record<string, unknown>
  document: string
}

interface Person {
  id: number
  name: string | null
  phone: string | null
}

interface ServerState {
  earnings: ReferralEarning[]
  earningsError: Error | null
  users: Person[]
  referees: Person[]
  attribution: { referrerId: number; refereeId: number } | null
  calls: ServerCall[]
}

const guard = vi.hoisted(() => ({ allowed: true, calls: [] as GuardCall[] }))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency = 'INR') => `${currency} ${Number(amount).toFixed(2)}`,
  }),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDateTime: (value: string, pattern: string) => `at:${value}:${pattern}`,
  }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, requireAny, children }: GuardCall & { children: ReactNode }) => {
    guard.calls.push({ required, requireAny })
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

const RAM: Person = { id: 7, name: 'Ram Kumar', phone: '9876500007' }
const RAJ: Person = { id: 9, name: 'Raj Singh', phone: null }
const SUNITA: Person = { id: 8, name: 'Sunita Rathi', phone: '9876500008' }

function earning(id: string, overrides: Partial<ReferralEarning> = {}): ReferralEarning {
  return {
    id,
    referrerId: 7,
    refereeId: 8,
    referrerName: 'Ram Kumar',
    referrerPhone: '9876500007',
    refereeName: 'Sunita Rathi',
    refereePhone: '9876500008',
    tier: 1,
    ruleType: 'SIGNUP_CPA',
    grossAmount: 100,
    netAmount: 90,
    currency: 'INR',
    calculatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  }
}

const THREE = [
  earning('e1'),
  earning('e2', { tier: 2, ruleType: 'FIRST_DEPOSIT_PCT', grossAmount: 500, netAmount: 450, referrerName: 'Arif', refereePhone: null }),
  earning('e3', { tier: null, ruleType: null, grossAmount: '250.5', netAmount: '200', calculatedAt: null }),
  earning('e4', { ruleType: 'REVSHARE', netAmount: 9999 }),
]

let server: ServerState

function calls(operationName: string) {
  return server.calls.filter((call) => call.operationName === operationName)
}

/** Variables as they travel: undefined keys dropped. */
function lastSent(operationName: string) {
  const list = calls(operationName)
  return JSON.parse(JSON.stringify(list[list.length - 1]?.variables ?? null)) as Record<string, unknown>
}

const person = (row: Person) => ({ __typename: 'User', ...row })

function answer(operation: Operation): FetchResult {
  switch (operation.operationName) {
    case 'ReferralEarnings':
      if (server.earningsError) throw server.earningsError
      return {
        data: { referralEarnings: server.earnings.map((row) => ({ __typename: 'ReferralEarning', ...row })) },
      }
    case 'UsersSearch':
      return { data: { users: server.users.map(person) } }
    case 'ReferralReferees':
      return { data: { referralReferees: server.referees.map(person) } }
    case 'ReferralAttribution':
      return {
        data: {
          referralAttribution: server.attribution
            ? { __typename: 'ReferralAttribution', ...server.attribution }
            : null,
        },
      }
    case 'UserById': {
      const found = [RAM, RAJ, SUNITA].find((row) => String(row.id) === String(operation.variables.id))
      return { data: { user: found ? person(found) : null } }
    }
    default:
      throw new Error(`unexpected operation ${operation.operationName}`)
  }
}

const serverLink = new ApolloLink((operation) => new Observable<FetchResult>((observer) => {
  server.calls.push({
    operationName: operation.operationName,
    variables: { ...operation.variables },
    document: print(operation.query).replace(/\s+/g, ' '),
  })
  Promise.resolve()
    .then(() => answer(operation))
    .then(
      (result) => {
        observer.next(result)
        observer.complete()
      },
      (error: unknown) => observer.error(error),
    )
}))

function renderPage() {
  return render(
    <MockedProvider link={serverLink}>
      <MemoryRouter initialEntries={['/referrals/earnings']}>
        <PageEyebrowProvider value="Marketing">
          <EarningsPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

const table = () => screen.getByRole('table', { name: 'Referral earnings' })

function bodyRows() {
  const [, ...rows] = within(table()).getAllByRole('row')
  return rows
}

function firstCells() {
  return bodyRows().map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '')
}

async function renderLoaded() {
  const view = renderPage()
  await waitFor(() => assert.ok(screen.queryByText('Loading Referral earnings') === null))
  return view
}

const combobox = (name: string) => screen.getByRole('combobox', { name }) as HTMLInputElement
const status = () => screen.getByText(/filters? applied/).textContent

beforeEach(() => {
  guard.allowed = true
  guard.calls.length = 0
  server = {
    earnings: THREE,
    earningsError: null,
    users: [RAM, RAJ],
    referees: [SUNITA],
    attribution: { referrerId: 7, refereeId: 8 },
    calls: [],
  }
})

describe('EarningsPage', () => {
  test('sends the legacy earnings document with no filter, behind the referrals.earnings view guard', async () => {
    await renderLoaded()
    assert.deepEqual(guard.calls[0], { required: [{ domain: 'referrals.earnings', actions: ['view'] }], requireAny: undefined })
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Referral Earnings')
    assert.ok(screen.queryByText('View and track all referral earnings') === null)
    assert.equal(screen.getByRole('link', { name: 'Back to Referrals' }).getAttribute('href'), '/referrals')
    assert.equal(calls('ReferralEarnings').length, 1)
    assert.deepEqual(lastSent('ReferralEarnings'), {})
    assert.match(
      calls('ReferralEarnings')[0].document,
      /query ReferralEarnings\(\$referrerId: ID, \$refereeId: ID, \$ruleType: String, \$tier: Int, \$fromDate: String, \$toDate: String\) \{ referralEarnings\( ?referrerId: \$referrerId refereeId: \$refereeId ruleType: \$ruleType tier: \$tier fromDate: \$fromDate toDate: \$toDate ?\) \{ id referrerId refereeId referrerName referrerPhone refereeName refereePhone tier ruleType grossAmount netAmount currency calculatedAt/,
    )
    assert.equal(status(), '0 filters applied')
    // No search runs until something is typed.
    assert.equal(calls('UsersSearch').length + calls('ReferralReferees').length, 0)
  })

  test('a denied caller sees the denial and starts no query', async () => {
    guard.allowed = false
    renderPage()
    assert.ok(screen.getByRole('alert').textContent === 'Access denied')
    await act(async () => {
      await Promise.resolve()
    })
    assert.equal(server.calls.length, 0)
  })

  test('lists every earning but REVSHARE with the totals, the cells and the legacy total text', async () => {
    await renderLoaded()
    await waitFor(() => assert.equal(bodyRows().length, 3))
    const headers = within(table()).getAllByRole('columnheader').map((header) => header.textContent)
    assert.deepEqual(headers, ['Referrer', 'Referee', 'Tier', 'Rule Type', 'Gross Amount', 'Net Amount', 'Date'])
    const summary = screen.getByRole('group', { name: 'Earnings summary' })
    assert.match(summary.textContent ?? '', /Total EarningsINR 740\.00Net/)
    assert.match(summary.textContent ?? '', /Total GrossINR 850\.50Gross/)
    assert.match(summary.textContent ?? '', /Total Records3/)
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Earnings (3)' }))
    assert.ok(screen.getByText('Total: INR 740.00'))

    const [first, second, third] = bodyRows()
    assert.deepEqual(
      within(first).getAllByRole('cell').map((cell) => cell.textContent),
      [
        'Ram Kumar9876500007ID: 7',
        'Sunita Rathi9876500008ID: 8',
        'L1',
        'SIGNUP CPA',
        'INR 100.00',
        'INR 90.00',
        'at:2026-10-01T10:00:00.000Z:MMM d, yyyy HH:mm',
      ],
    )
    assert.match(second.textContent ?? '', /Sunita Rathi—ID: 8L2FIRST DEPOSIT PCT/)
    assert.deepEqual(
      within(third).getAllByRole('cell').slice(2).map((cell) => cell.textContent),
      ['—', '—', 'INR 250.50', 'INR 200.00', '—'],
    )
    assert.ok(screen.getByText('Total 3 earnings'))
  })

  test('loading, then the empty state without totals or pager', async () => {
    server.earnings = [earning('only', { ruleType: 'REVSHARE' })]
    renderPage()
    assert.ok(screen.getByText('Loading Referral earnings'))
    assert.ok(await within(table()).findByText('No earnings data available'))
    assert.ok(screen.queryByRole('group', { name: 'Earnings summary' }) === null)
    assert.ok(screen.queryByRole('navigation', { name: 'Pagination' }) === null)
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Earnings (0)' }))
  })

  test('a failed query shows the error, which can be dismissed', async () => {
    server.earningsError = new Error('Server unavailable')
    renderPage()
    const alert = await screen.findByRole('alert')
    assert.match(alert.textContent ?? '', /Could not load earningsServer unavailable/)
    assert.ok(within(table()).getByText('No earnings data available'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    assert.ok(screen.queryByText('Could not load earnings') === null)
  })

  test('the referrer search waits for three characters, then filters by the chosen referrer', async () => {
    await renderLoaded()
    const referrer = combobox('Referrer')
    assert.equal(referrer.getAttribute('placeholder'), 'Referrer (search name or phone)')
    fireEvent.change(referrer, { target: { value: 'ra' } })
    assert.ok(screen.getAllByText('Type 3+ chars').length > 0)
    fireEvent.change(referrer, { target: { value: 'ram' } })
    await waitFor(() => assert.deepEqual(lastSent('UsersSearch'), { query: 'ram' }), { timeout: 2000 })
    assert.match(calls('UsersSearch')[0].document, /query UsersSearch\(\$query: String\) \{ users\(query: \$query\) \{ id name phone/)
    fireEvent.click(await screen.findByRole('option', { name: 'Ram Kumar · 9876500007' }))

    await waitFor(() => assert.deepEqual(lastSent('ReferralEarnings'), { referrerId: '7' }))
    assert.equal(referrer.value, 'Ram Kumar · 9876500007')
    // The referee field now lists this referrer's referees, loaded once with no query.
    await waitFor(() => assert.deepEqual(lastSent('ReferralReferees'), { referrerId: '7' }))
    assert.match(calls('ReferralReferees')[0].document, /referralReferees\(referrerId: \$referrerId, query: \$query\)/)
    assert.equal(combobox('Referee').getAttribute('placeholder'), "Referee (this referrer's referrals)")
    assert.equal(status(), '1 filter applied')

    // Back to no filter: Apollo answers those variables from its cache (cache-first, as before).
    fireEvent.click(screen.getByRole('button', { name: 'Clear Referrer' }))
    await waitFor(() => assert.equal(status(), '0 filters applied'))
    assert.equal(referrer.value, '')
    await waitFor(() => assert.equal(bodyRows().length, 3))
  })

  test('Enter takes the first person a search returns when nothing is active', async () => {
    await renderLoaded()
    const referrer = combobox('Referrer')
    fireEvent.change(referrer, { target: { value: 'raj' } })
    await waitFor(() => assert.ok(calls('UsersSearch').length === 1), { timeout: 2000 })
    await screen.findByRole('option', { name: 'Ram Kumar · 9876500007' })
    fireEvent.keyDown(referrer, { key: 'Enter' })
    await waitFor(() => assert.deepEqual(lastSent('ReferralEarnings'), { referrerId: '7' }))
  })

  test('choosing a referee alone looks up its referrer and fills the referrer filter', async () => {
    await renderLoaded()
    const referee = combobox('Referee')
    assert.equal(referee.getAttribute('placeholder'), 'Referee (search name or phone)')
    server.users = [SUNITA]
    fireEvent.change(referee, { target: { value: 'sun' } })
    await waitFor(() => assert.deepEqual(lastSent('UsersSearch'), { query: 'sun' }), { timeout: 2000 })
    fireEvent.click(await screen.findByRole('option', { name: 'Sunita Rathi · 9876500008' }))

    await waitFor(() => assert.deepEqual(lastSent('ReferralAttribution'), { refereeId: '8' }))
    await waitFor(() => assert.deepEqual(lastSent('UserById'), { id: '7' }))
    assert.match(calls('ReferralAttribution')[0].document, /referralAttribution\(refereeId: \$refereeId\) \{ referrerId refereeId/)
    assert.match(calls('UserById')[0].document, /user\(id: \$id\) \{ id name phone/)
    await waitFor(() => assert.deepEqual(lastSent('ReferralEarnings'), { referrerId: '7', refereeId: '8' }))
    await waitFor(() => assert.equal(combobox('Referrer').value, 'Ram Kumar · 9876500007'))
    assert.equal(referee.value, 'Sunita Rathi · 9876500008')
    assert.equal(status(), '2 filters applied')
  })

  test('a referee with no attribution clears the referrer filter', async () => {
    server.attribution = null
    server.users = [SUNITA]
    await renderLoaded()
    fireEvent.change(combobox('Referee'), { target: { value: 'sun' } })
    fireEvent.click(await screen.findByRole('option', { name: 'Sunita Rathi · 9876500008' }, { timeout: 2000 }))
    await waitFor(() => assert.deepEqual(lastSent('ReferralAttribution'), { refereeId: '8' }))
    await waitFor(() => assert.deepEqual(lastSent('ReferralEarnings'), { refereeId: '8' }))
    assert.equal(calls('UserById').length, 0)
    assert.equal(combobox('Referrer').value, '')
  })

  test('rule type and date range go to the server; Clear all returns to no filter', async () => {
    await renderLoaded()
    const ruleType = combobox('Rule Type')
    fireEvent.keyDown(ruleType, { key: 'ArrowDown' })
    const list = screen.getByRole('listbox', { name: 'Rule Type' })
    assert.deepEqual(within(list).getAllByRole('option').map((option) => option.textContent), [
      'Signup CPA', 'First Deposit %', 'Reload Deposits %', 'Deposits Window %', 'Activity Milestone',
    ])
    fireEvent.click(within(list).getByRole('option', { name: 'Reload Deposits %' }))
    await waitFor(() => assert.deepEqual(lastSent('ReferralEarnings'), { ruleType: 'RELOAD_DEPOSITS_PCT' }))

    fireEvent.click(screen.getByRole('button', { name: 'Date range: All dates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Custom range' }))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-22' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => assert.deepEqual(lastSent('ReferralEarnings'), {
      ruleType: 'RELOAD_DEPOSITS_PCT',
      fromDate: '2026-09-21T18:30:00.000Z',
      toDate: '2026-09-30T18:29:59.999Z',
    }))
    assert.equal(status(), '2 filters applied')
    assert.ok(screen.getByRole('button', { name: 'Date range: 2026-09-22 – 2026-09-30' }))

    // Back to no filter: Apollo answers those variables from its cache (cache-first, as before).
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => assert.equal(status(), '0 filters applied'))
    assert.equal(ruleType.value, '')
    assert.ok(screen.getByRole('button', { name: 'Date range: All dates' }))
  })

  test('the tier and rule type table filters narrow the rows on screen only', async () => {
    await renderLoaded()
    await waitFor(() => assert.equal(bodyRows().length, 3))
    const sentBefore = calls('ReferralEarnings').length

    fireEvent.keyDown(combobox('Show tiers'), { key: 'ArrowDown' })
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Show tiers' })).getByRole('option', { name: 'Tier 2' }))
    fireEvent.keyDown(combobox('Show tiers'), { key: 'Escape' })
    await waitFor(() => assert.equal(bodyRows().length, 1))
    assert.match(bodyRows()[0].textContent ?? '', /^Arif/)
    assert.ok(screen.getByText('Total 1 earnings'))
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Earnings (3)' }))
    assert.equal(status(), '1 filter applied')

    fireEvent.keyDown(combobox('Show rule types'), { key: 'ArrowDown' })
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Show rule types' })).getByRole('option', { name: 'Signup CPA' }))
    fireEvent.keyDown(combobox('Show rule types'), { key: 'Escape' })
    assert.ok(await within(table()).findByText('No earnings match your filters'))
    assert.equal(status(), '2 filters applied')
    assert.equal(calls('ReferralEarnings').length, sentBefore)

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => assert.equal(bodyRows().length, 3))
  })

  test('sorting cycles ascending, descending, off, on the client', async () => {
    await renderLoaded()
    await waitFor(() => assert.equal(bodyRows().length, 3))
    const net = () => within(table()).getByRole('button', { name: /^Net Amount/ })
    fireEvent.click(net())
    await waitFor(() => assert.deepEqual(bodyRows().map((row) => within(row).getAllByRole('cell')[5].textContent), [
      'INR 90.00', 'INR 200.00', 'INR 450.00',
    ]))
    fireEvent.click(net())
    await waitFor(() => assert.deepEqual(bodyRows().map((row) => within(row).getAllByRole('cell')[5].textContent), [
      'INR 450.00', 'INR 200.00', 'INR 90.00',
    ]))
    fireEvent.click(net())
    await waitFor(() => assert.deepEqual(firstCells().map((text) => text.slice(0, 4)), ['Ram ', 'Arif', 'Ram ']))
  })

  test('pages of 20 on the client, with the legacy page sizes', async () => {
    server.earnings = Array.from({ length: 25 }, (_, index) => earning(`p${index + 1}`, { referrerName: `Referrer ${index + 1}` }))
    await renderLoaded()
    await waitFor(() => assert.equal(bodyRows().length, 20))
    assert.ok(screen.getByText('Total 25 earnings'))
    const sizes = within(screen.getByRole('navigation', { name: 'Pagination' })).getByRole('combobox') as HTMLSelectElement
    assert.deepEqual(Array.from(sizes.options).map((option) => option.value), ['10', '20', '50', '100'])
    assert.equal(sizes.value, '20')
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await waitFor(() => assert.equal(bodyRows().length, 5))
    assert.match(firstCells()[0], /^Referrer 21/)
  })
})
