import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { DeskHealthPage } from '@/routes/DeskHealthPage'
import { DESK_HEALTH } from '@/lib/gql'

/**
 * Desk health is the one screen whose whole job is presentation: the server
 * hands it six buckets and it decides what a person is shown. Every decision it
 * makes is invisible to the backend tests —
 *
 *   - an empty desk must read as success, not as a page that failed to load
 *   - a bucket with nothing in it must not render an empty card
 *   - "342 minutes" has to become something a person reads at a glance, and the
 *     boundaries between minutes, hours and days are exactly where that breaks
 *   - a truncated bucket must say so, or the count becomes a lie
 *
 * All four have been shipped wrong in other products. None would fail a
 * typecheck.
 */

/** A task bucket in the shape the server sends. `total` defaults to the row
 *  count and is passed explicitly only when testing a truncated bucket. */
const bucket = (rows: Array<Record<string, unknown>> = [], total = rows.length) => ({
  __typename: 'CrmDeskTaskBucket',
  total,
  rows,
})

const empty = {
  __typename: 'CrmDeskHealth',
  allClear: true,
  reachedNobody: bucket(),
  uncoveredBooks: { __typename: 'CrmUncoveredBookBucket', total: 0, rows: [] },
  ladderExhausted: bucket(),
  breaching: bucket(),
  unassigned: bucket(),
  neverReached: { __typename: 'CrmUnreachedPlayerBucket', total: 0, rows: [] },
}

/**
 * Carries every field any bucket selects. The buckets ask for different subsets
 * — only `reachedNobody` wants `failedAttempts`/`firstFailedAt`, only
 * `ladderExhausted` wants `escalationLevel` — and a mock missing one makes
 * Apollo warn and hands the component a row the server would never send.
 */
function task(over: Partial<Record<string, unknown>> = {}) {
  return {
    __typename: 'CrmDeskTask',
    id: 'task-1',
    title: 'Chase the deposit',
    bookName: 'Book A',
    playerId: '42',
    assigneeName: null,
    minutesOverdue: 30,
    failedAttempts: 0,
    firstFailedAt: null,
    escalationLevel: 0,
    ...over,
  }
}

function mount(data: Record<string, unknown>) {
  const mocks = [
    { request: { query: DESK_HEALTH }, result: { data: { crmDeskHealth: data } } },
  ]
  return render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter>
        <DeskHealthPage />
      </MemoryRouter>
    </MockedProvider>
  )
}


describe('an empty desk', () => {
  test('reads as success rather than as a page that failed', async () => {
    mount(empty)
    await waitFor(() => assert.ok(screen.getByText('Nothing is falling through')))
    // The failure state must not be showing at the same time.
    assert.equal(screen.queryByText('Could not read desk health'), null)
  })

  test('renders no card for a bucket with nothing in it', async () => {
    mount(empty)
    await waitFor(() => assert.ok(screen.getByText('Nothing is falling through')))
    for (const title of ['Reached nobody', 'Ladder exhausted', 'Breaching', 'Unassigned']) {
      assert.equal(screen.queryByText(title), null, `${title} rendered an empty card`)
    }
  })
})

describe('overdue is written the way a person reads it', () => {
  const cases: Array<[number, string]> = [
    [1, '1m late'],
    [59, '59m late'],
    [60, '1h late'],
    [90, '1h late'],
    [1439, '23h late'],
    [1440, '1d 0h late'],
    [1500, '1d 1h late'],
    [2880, '2d 0h late'],
  ]

  for (const [minutes, expected] of cases) {
    test(`${minutes} minutes reads as "${expected}"`, async () => {
      mount({
        ...empty,
        allClear: false,
        breaching: bucket([task({ minutesOverdue: minutes })]),
      })
      await waitFor(() => assert.ok(screen.getByText(expected)))
      cleanup()
    })
  }
})

describe('the buckets that matter most', () => {
  test('"Reached nobody" shows the repeat count as severity, not just a flag', async () => {
    // Failing twelve times over a day is a different problem from failing once,
    // and the card is the only place that distinction is visible.
    mount({
      ...empty,
      allClear: false,
      reachedNobody: bucket([
        task({ id: 'a', failedAttempts: 1, minutesOverdue: 10 }),
        task({ id: 'b', title: 'Second task', failedAttempts: 4, minutesOverdue: 20 }),
      ]),
    })
    await waitFor(() => assert.ok(screen.getByText('Reached nobody')))
    assert.ok(screen.getByText('once'), 'a single failure should not read as "1 times"')
    assert.ok(screen.getByText('4 times'))
  })

  test('an uncovered book explains itself and links to the fix', async () => {
    mount({
      ...empty,
      allClear: false,
      uncoveredBooks: {
        __typename: 'CrmUncoveredBookBucket',
        total: 1,
        rows: [
          { __typename: 'CrmUncoveredBook', bookId: 'b1', bookName: 'Orphan Book', openTasks: 3 },
        ],
      },
    })
    await waitFor(() => assert.ok(screen.getByText('Books with no cover')))
    assert.ok(screen.getByText('Orphan Book'))
    assert.ok(screen.getByText('3 tasks'))
    // The remedy is named on the card; without it the page states a problem
    // nobody knows how to clear.
    assert.ok(screen.getByText(/escalate permission/i))
  })

  test('an unassigned task says so instead of showing a blank owner', async () => {
    mount({
      ...empty,
      allClear: false,
      unassigned: bucket([task({ assigneeName: null })]),
    })
    await waitFor(() => assert.ok(screen.getByText('Unassigned')))
    // The row itself says so, next to the book — a blank there would read as a
    // rendering fault rather than as an owner nobody has picked.
    assert.ok(screen.getByText('Book A · unassigned'))
  })

  test('names the assignee when there is one', async () => {
    mount({
      ...empty,
      allClear: false,
      breaching: bucket([task({ assigneeName: 'Priya' })]),
    })
    await waitFor(() => assert.ok(screen.getByText('Book A · Priya')))
  })
})

describe('a truncated bucket admits it', () => {
  test('says how many of the total are shown', async () => {
    // The server caps the rows it returns. Without this line the header count
    // and the visible rows disagree and the page quietly under-reports.
    mount({
      ...empty,
      allClear: false,
      breaching: bucket([task({ id: 'x' }), task({ id: 'y', title: 'Another' })], 25),
    })
    await waitFor(() => assert.ok(screen.getByText('Breaching')))
    assert.ok(screen.getByText(/Showing 2 of 25/))
  })

  test('says nothing when every row is shown', async () => {
    mount({
      ...empty,
      allClear: false,
      breaching: bucket([task()]),
    })
    await waitFor(() => assert.ok(screen.getByText('Breaching')))
    assert.equal(screen.queryByText(/Showing/), null)
  })
})

describe('when the query fails', () => {
  test('says it could not read, rather than claiming all is well', async () => {
    // The dangerous failure: an error rendered as the success state would tell
    // a supervisor nothing is wrong precisely when they cannot see.
    render(
      <MockedProvider
        mocks={[{ request: { query: DESK_HEALTH }, error: new Error('network down') }]}
       
      >
        <MemoryRouter>
          <DeskHealthPage />
        </MemoryRouter>
      </MockedProvider>
    )
    await waitFor(() => assert.ok(screen.getByText('Could not read desk health')))
    assert.equal(screen.queryByText('Nothing is falling through'), null)
  })
})
