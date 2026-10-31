import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  SELECTOR_FETCH_SIZE,
  SELECTOR_PAGE_SIZE,
  activeSelectorFilterCount,
  casinoGamesVariables,
  casinoRowsForPage,
  filteredMatkas,
  matkaVariables,
  nextSelection,
  searchTerm,
} from './bundleGamesSelectorModel'

describe('bundleGamesSelectorModel — query contracts', () => {
  test('search starts at two trimmed characters', () => {
    assert.equal(searchTerm(' a '), undefined)
    assert.equal(searchTerm(' ab '), 'ab')
    assert.equal(searchTerm('   '), undefined)
  })

  test('casino variables keep category, optional filters and the 200-row fetch contract', () => {
    assert.equal(SELECTOR_FETCH_SIZE, 200)
    assert.equal(SELECTOR_PAGE_SIZE, 50)
    assert.deepEqual(casinoGamesVariables('LIVE_CASINO', {
      search: '  poker  ', providerId: 'p1', vendorId: 'v2',
    }), {
      input: {
        category: 'LIVE_CASINO', providerId: 'p1', vendorId: 'v2', search: 'poker', page: 1, pageSize: 200,
      },
    })
    assert.deepEqual(casinoGamesVariables('SLOTS', { search: 'x', providerId: '', vendorId: '' }), {
      input: {
        category: 'SLOTS', providerId: undefined, vendorId: undefined, search: undefined, page: 1, pageSize: 200,
      },
    })
  })

  test('Matka variables keep ACTIVE and the same two-character search threshold', () => {
    assert.deepEqual(matkaVariables(' ab '), { filters: { query: 'ab', status: 'ACTIVE' } })
    assert.deepEqual(matkaVariables('a'), { filters: { query: undefined, status: 'ACTIVE' } })
  })

  test('active filter counts follow each domain', () => {
    const filters = { search: 'royal', providerId: 'p1', vendorId: 'v1' }
    assert.equal(activeSelectorFilterCount('casino', filters), 3)
    assert.equal(activeSelectorFilterCount('matka', filters), 1)
    assert.equal(activeSelectorFilterCount('sports', filters), 0)
  })
})

describe('bundleGamesSelectorModel — visible rows and selection', () => {
  const games = Array.from({ length: 7 }, (_, index) => ({
    id: `g${index + 1}`,
    vendorId: index % 2 ? 'v2' : 'v1',
  }))

  test('casino filtering precedes paging and reports the filtered total', () => {
    assert.deepEqual(casinoRowsForPage(games, 'v1', 2, 2), {
      rows: [{ id: 'g5', vendorId: 'v1' }, { id: 'g7', vendorId: 'v1' }],
      total: 4,
    })
    assert.deepEqual(casinoRowsForPage(games, '', 1, 3).rows.map((row) => row.id), ['g1', 'g2', 'g3'])
  })

  test('invalid paging values safely fall back to page one and the standard size', () => {
    const result = casinoRowsForPage(games, '', Number.NaN, 0)
    assert.equal(result.rows.length, 7)
    assert.equal(result.total, 7)
  })

  test('Matka search covers name, code and description, case-insensitively', () => {
    const markets = [
      { id: 1, name: 'Kalyan Night', code: 'KN', description: 'Main market' },
      { id: 2, name: 'Milan', code: 'MN', description: 'Royal draw' },
    ]
    assert.deepEqual(filteredMatkas(markets, 'ka').map((row) => row.id), [1])
    assert.deepEqual(filteredMatkas(markets, 'KN').map((row) => row.id), [1])
    assert.deepEqual(filteredMatkas(markets, 'ROYAL').map((row) => row.id), [2])
    assert.deepEqual(filteredMatkas(markets, 'x').map((row) => row.id), [1, 2])
  })

  test('page selection appends visible ids in order and clearing preserves hidden selections', () => {
    const visible = [{ id: 2 }, { id: '3' }]
    assert.deepEqual(nextSelection(['1'], visible, true), ['1', '2', '3'])
    assert.deepEqual(nextSelection(['1', '2', '3', '4'], visible, false), ['1', '4'])
  })
})

