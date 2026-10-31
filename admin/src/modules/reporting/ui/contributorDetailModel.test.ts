import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { contributorDetailPath, contributorDomainOf, isContributorKind, parseContributorSearch } from './contributorDetailModel'

const query = (path: string) => new URLSearchParams(path.split('?')[1])

describe('contributor detail URL', () => {
  test('carries the whole selection with its types, the name and the drilled path, and reads them back', () => {
    const filter = { sportId: '4', leagueId: 'ipl', eventId: undefined, dateFrom: '2000-01-01', dateTo: '2026-10-21', currency: 'INR', minStake: 100, _refreshKey: 3 }
    const path = contributorDetailPath('sports', 'player', 'user 7', { name: 'rocky', context: 'Cricket › IPL', filter: filter as never })
    assert.equal(path.split('?')[0], '/reporting/sports/contributors/player/user%207')
    assert.deepEqual(parseContributorSearch(query(path)), {
      name: 'rocky',
      context: 'Cricket › IPL',
      filter: { sportId: '4', leagueId: 'ipl', dateFrom: '2000-01-01', dateTo: '2026-10-21', currency: 'INR', minStake: 100 },
    })
  })

  test('casino ids keep their type and the domain comes from the path', () => {
    const path = contributorDetailPath('casino', 'agent', 'a1', { name: 'vikram_ag', filter: { vendorId: 12, gameId: 0 } })
    assert.deepEqual(parseContributorSearch(query(path)).filter, { vendorId: 12, gameId: 0 })
    assert.equal(contributorDomainOf(path), 'casino')
    assert.equal(contributorDomainOf('/reporting/sports/contributors/player/1'), 'sports')
    assert.equal(isContributorKind('agent'), true)
    assert.equal(isContributorKind('vendor'), false)
  })

  test('a damaged or hostile filter reads as no selection', () => {
    assert.deepEqual(parseContributorSearch(new URLSearchParams('name=x&f=%7Bnot-json')).filter, {})
    assert.deepEqual(parseContributorSearch(new URLSearchParams('f=' + encodeURIComponent('[1,2]'))).filter, {})
    assert.deepEqual(parseContributorSearch(new URLSearchParams('f=' + encodeURIComponent('{"sportId":"4","nested":{"a":1}}'))).filter, { sportId: '4' })
  })
})
