import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  NTH_DW_PAGE_SIZE_OPTIONS,
  buildNthDwRows,
  isNthDwPermissionRefusal,
  nthDwActiveFilterCount,
  nthDwPlayerIds,
  nthDwPlayerLabel,
  nthDwStatsMap,
  nthDwSummary,
  nthDwTotals,
  reportableNthDwError,
  sortNthDwPage,
  type NthDwRow,
} from './nthDepositWithdrawalModel'

function row(id: string, patch: Partial<NthDwRow> = {}): NthDwRow {
  return {
    id,
    name: `Player ${id}`,
    phone: null,
    username: `user_${id}`,
    agentName: '—',
    totalDepositAmount: 0,
    rangeDepositAmount: 0,
    totalWithdrawalAmount: 0,
    rangeWithdrawalAmount: 0,
    ...patch,
  }
}

describe('player ids and stats', () => {
  test('asks the stats document about the page’s players, as strings, skipping empty ids', () => {
    assert.deepEqual(nthDwPlayerIds([{ id: '12' }, { id: '' }, { id: '7' }]), ['12', '7'])
    assert.deepEqual(nthDwPlayerIds([]), [])
  })

  test('keys the stats by player id and drops rows without one', () => {
    const map = nthDwStatsMap([
      { playerId: 12, totalDepositAmount: 500 },
      null,
      { playerId: '', totalDepositAmount: 1 },
      { playerId: '7', rangeWithdrawalAmount: 40 },
    ])
    assert.deepEqual([...map.keys()], ['12', '7'])
    assert.equal(map.get('12')?.totalDepositAmount, 500)
  })
})

describe('buildNthDwRows', () => {
  test('joins each player to its figures and keeps the legacy fallbacks', () => {
    const stats = nthDwStatsMap([
      {
        playerId: '1',
        totalDepositAmount: 1500,
        rangeDepositAmount: 500,
        totalWithdrawalAmount: 900,
        rangeWithdrawalAmount: null,
      },
    ])
    const rows = buildNthDwRows(
      [
        { id: '1', name: 'Asha Rao', phone: '9800000001', username: 'asha', parentAgent: { id: 'a', username: 'north' } },
        { id: '2', name: '', phone: '', username: null, parentAgent: null },
      ],
      stats,
    )
    assert.deepEqual(rows, [
      {
        id: '1',
        name: 'Asha Rao',
        phone: '9800000001',
        username: 'asha',
        agentName: 'north',
        totalDepositAmount: 1500,
        rangeDepositAmount: 500,
        totalWithdrawalAmount: 900,
        rangeWithdrawalAmount: 0,
      },
      {
        id: '2',
        name: '—',
        phone: null,
        username: '',
        agentName: '—',
        totalDepositAmount: 0,
        rangeDepositAmount: 0,
        totalWithdrawalAmount: 0,
        rangeWithdrawalAmount: 0,
      },
    ])
  })

  test('the link text is the name, then the username, then User <id>; a missing name already reads as a dash', () => {
    assert.equal(nthDwPlayerLabel(row('1', { name: 'Asha' })), 'Asha')
    assert.equal(nthDwPlayerLabel(row('1', { name: '', username: 'asha' })), 'asha')
    assert.equal(nthDwPlayerLabel(row('9', { name: '', username: '' })), 'User 9')
    assert.equal(nthDwPlayerLabel(buildNthDwRows([{ id: '3', username: 'chen' }], new Map())[0] as NthDwRow), '—')
  })
})

describe('totals, sorting and copy', () => {
  test('the KPI figures come from the overview document; the range figures equal the totals', () => {
    assert.deepEqual(nthDwTotals({ totalDeposits: '2500', totalWithdrawals: 4000 }), {
      totalDeposit: 2500,
      rangeDeposit: 2500,
      totalWithdraw: 4000,
      rangeWithdraw: 4000,
      netFlow: -1500,
      rangeNetFlow: -1500,
    })
    assert.deepEqual(nthDwTotals(undefined), {
      totalDeposit: 0,
      rangeDeposit: 0,
      totalWithdraw: 0,
      rangeWithdraw: 0,
      netFlow: 0,
      rangeNetFlow: 0,
    })
  })

  test('a sort orders the page on screen by the legacy comparators, both ways, ties in place', () => {
    const page = [
      row('1', { name: 'Chen', agentName: 'west', totalDepositAmount: 300, rangeWithdrawalAmount: 5 }),
      row('2', { name: '', username: 'asha', agentName: 'east', totalDepositAmount: 100, rangeWithdrawalAmount: 5 }),
      row('3', { name: 'Bilal', agentName: '', totalDepositAmount: 200, rangeWithdrawalAmount: 9 }),
    ]
    const ids = (rows: NthDwRow[]) => rows.map((entry) => entry.id)
    assert.deepEqual(ids(sortNthDwPage(page, { key: 'player', dir: 'asc' })), ['2', '3', '1'])
    assert.deepEqual(ids(sortNthDwPage(page, { key: 'agentName', dir: 'asc' })), ['3', '2', '1'])
    assert.deepEqual(ids(sortNthDwPage(page, { key: 'totalDepositAmount', dir: 'desc' })), ['1', '3', '2'])
    assert.deepEqual(ids(sortNthDwPage(page, { key: 'rangeWithdrawalAmount', dir: 'asc' })), ['1', '2', '3'])
    assert.deepEqual(ids(sortNthDwPage(page, { key: 'rangeWithdrawalAmount', dir: 'desc' })), ['3', '1', '2'])
    assert.deepEqual(ids(sortNthDwPage(page, null)), ['1', '2', '3'])
    assert.deepEqual(ids(sortNthDwPage(page, { key: 'phone', dir: 'asc' })), ['1', '2', '3'])
  })

  test('the card subtitle, the pager sizes and the Clear all rule', () => {
    assert.equal(nthDwSummary(1), '1 player • All amounts in whitelabel currency')
    assert.equal(nthDwSummary(0), '0 players • All amounts in whitelabel currency')
    assert.equal(nthDwSummary(12345), `${(12345).toLocaleString()} players • All amounts in whitelabel currency`)
    assert.deepEqual([...NTH_DW_PAGE_SIZE_OPTIONS], [10, 25, 50, 100])
    assert.equal(nthDwActiveFilterCount('', 'allTime'), 0)
    assert.equal(nthDwActiveFilterCount('   ', 'allTime'), 0)
    assert.equal(nthDwActiveFilterCount(undefined, 'allTime'), 0)
    assert.equal(nthDwActiveFilterCount('asha', 'allTime'), 1)
    assert.equal(nthDwActiveFilterCount('', 'yesterday'), 1)
    assert.equal(nthDwActiveFilterCount(' asha ', 'custom'), 2)
  })

  test('a permission refusal is not reported; any other failure is', () => {
    const refusal = { networkError: null, graphQLErrors: [{ message: 'Forbidden: insufficient permissions for players.list:view' }] }
    const dashboardRefusal = { graphQLErrors: [{ message: 'Forbidden: insufficient permissions to view dashboard' }] }
    const serverFailure = { networkError: null, graphQLErrors: [{ message: 'Database timeout' }] }
    const networkFailure = { networkError: new Error('Failed to fetch'), graphQLErrors: [] }

    assert.equal(isNthDwPermissionRefusal(refusal), true)
    assert.equal(isNthDwPermissionRefusal(dashboardRefusal), true)
    assert.equal(isNthDwPermissionRefusal(serverFailure), false)
    assert.equal(isNthDwPermissionRefusal(networkFailure), false)
    // a refusal that also failed on the wire, or came with another error, is a failure
    assert.equal(isNthDwPermissionRefusal({ ...refusal, networkError: new Error('x') }), false)
    assert.equal(
      isNthDwPermissionRefusal({ graphQLErrors: [...refusal.graphQLErrors, { message: 'Database timeout' }] }),
      false,
    )
    assert.equal(isNthDwPermissionRefusal({ graphQLErrors: [] }), false)

    assert.equal(reportableNthDwError(refusal), undefined)
    assert.equal(reportableNthDwError(dashboardRefusal), undefined)
    assert.equal(reportableNthDwError(serverFailure), serverFailure)
    assert.equal(reportableNthDwError(networkFailure), networkFailure)
    assert.equal(reportableNthDwError(undefined), undefined)
    assert.equal(reportableNthDwError(null), undefined)
  })
})
