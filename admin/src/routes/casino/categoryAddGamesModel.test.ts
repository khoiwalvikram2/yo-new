import { describe, expect, test } from 'vitest'
import {
  categoryLabel,
  filterAndSortGames,
  filterSelectedGames,
  hasActiveFilters,
  mapCatalogGame,
  mergeCatalogPages,
  selectionDiff,
  shouldLoadNextPage,
  type CatalogGame,
} from './categoryAddGamesModel'

const game = (overrides: Partial<CatalogGame> = {}): CatalogGame => ({
  id: 'g1',
  name: 'Lightning Roulette',
  slug: 'lightning-roulette',
  vendorName: 'Evolution',
  enabled: true,
  featured: false,
  premiumOnly: false,
  rtp: 97.3,
  categoryAssigned: false,
  ...overrides,
})

describe('category add-games model', () => {
  test('normalises API games and keeps false/optional values', () => {
    expect(mapCatalogGame({
      id: 7,
      name: 'Dice',
      slug: 'dice',
      tenantEnabled: false,
      premiumOnly: 1,
      featured: true,
      categoryAssigned: true,
      rtp: '96.4',
    })).toEqual(expect.objectContaining({
      id: '7',
      enabled: false,
      premiumOnly: true,
      featured: true,
      categoryAssigned: true,
      rtp: 96.4,
    }))
  })

  test('a game the platform switched off is not enabled, whatever its whitelabel row says', () => {
    // Core mode lists Master Control-disabled games (so they can be switched back on); the picker must not call them enabled.
    expect(mapCatalogGame({ id: 1, isActive: false, tenantEnabled: true }).enabled).toBe(false)
    expect(mapCatalogGame({ id: 2, isActive: false, tenantEnabled: null }).enabled).toBe(false)
    expect(mapCatalogGame({ id: 3, isActive: true, tenantEnabled: null }).enabled).toBe(true)
  })

  test('uses safe fallbacks for malformed optional game fields', () => {
    expect(mapCatalogGame({ id: 'x', rtp: 'bad' })).toEqual({
      id: 'x',
      name: 'Unnamed game',
      slug: '',
      vendorId: undefined,
      vendorName: undefined,
      thumbnailUrl: undefined,
      enabled: true,
      featured: false,
      premiumOnly: false,
      rtp: undefined,
      categoryAssigned: false,
    })
  })

  test('replaces page one and de-duplicates appended pages', () => {
    const first = game()
    const second = game({ id: 'g2' })
    expect(mergeCatalogPages([first], [second], 1)).toEqual([second])
    expect(mergeCatalogPages([first], [first, second], 2)).toEqual([first, second])
  })

  test('builds the exact add/remove selection difference as strings', () => {
    expect(selectionDiff([1, 'g2'], new Set(['g2', 'g3']))).toEqual({ remove: ['1'], add: ['g3'] })
  })

  test('filters enabled, disabled and premium games', () => {
    const games = [
      game(),
      game({ id: 'g2', enabled: false, premiumOnly: true }),
    ]
    const base = { games, selectedIds: new Set<string>(), selectedDetails: {}, categoryFilter: 'all' as const, sortBy: 'popular' as const }
    expect(filterAndSortGames({ ...base, quickFilter: 'enabled' }).map((item) => item.id)).toEqual(['g1'])
    expect(filterAndSortGames({ ...base, quickFilter: 'disabled' }).map((item) => item.id)).toEqual(['g2'])
    expect(filterAndSortGames({ ...base, quickFilter: 'premium' }).map((item) => item.id)).toEqual(['g2'])
  })

  test('builds selected-only results from persistent details', () => {
    const selected = game({ id: 'saved' })
    expect(filterAndSortGames({
      games: [],
      selectedIds: new Set(['missing', 'saved']),
      selectedDetails: { saved: selected },
      quickFilter: 'selected',
      categoryFilter: 'all',
      sortBy: 'popular',
    })).toEqual([selected])
  })

  test('filters category membership independently', () => {
    const games = [game(), game({ id: 'assigned', categoryAssigned: true })]
    const base = { games, selectedIds: new Set<string>(), selectedDetails: {}, quickFilter: 'all' as const, sortBy: 'popular' as const }
    expect(filterAndSortGames({ ...base, categoryFilter: 'in-categories' }).map((item) => item.id)).toEqual(['assigned'])
    expect(filterAndSortGames({ ...base, categoryFilter: 'not-in-categories' }).map((item) => item.id)).toEqual(['g1'])
  })

  test('sorts by name, vendor and descending RTP without mutating input', () => {
    const games = [
      game({ id: 'b', name: 'Zulu', vendorName: 'Alpha', rtp: 95 }),
      game({ id: 'a', name: 'Alpha', vendorName: 'Zulu', rtp: 98 }),
    ]
    const base = { games, selectedIds: new Set<string>(), selectedDetails: {}, quickFilter: 'all' as const, categoryFilter: 'all' as const }
    expect(filterAndSortGames({ ...base, sortBy: 'name' }).map((item) => item.id)).toEqual(['a', 'b'])
    expect(filterAndSortGames({ ...base, sortBy: 'vendor' }).map((item) => item.id)).toEqual(['b', 'a'])
    expect(filterAndSortGames({ ...base, sortBy: 'rtp' }).map((item) => item.id)).toEqual(['a', 'b'])
    expect(games.map((item) => item.id)).toEqual(['b', 'a'])
  })

  test('searches selected names, vendors, slugs and unloaded ids', () => {
    const details = { g1: game() }
    const ids = new Set(['g1', 'unloaded-42'])
    expect(filterSelectedGames(ids, details, 'evolution')).toEqual(['g1'])
    expect(filterSelectedGames(ids, details, 'roulette')).toEqual(['g1'])
    expect(filterSelectedGames(ids, details, '42')).toEqual(['unloaded-42'])
    expect(filterSelectedGames(ids, details, ' ')).toEqual(['g1', 'unloaded-42'])
  })

  test('loads another page only when the infinite-scroll contract allows it', () => {
    const base = { intersecting: true, loading: false, networkStatus: 7, clientFilterActive: false, loaded: 50, total: 100 }
    expect(shouldLoadNextPage(base)).toBe(true)
    expect(shouldLoadNextPage({ ...base, networkStatus: 3 })).toBe(false)
    expect(shouldLoadNextPage({ ...base, clientFilterActive: true })).toBe(false)
    expect(shouldLoadNextPage({ ...base, loaded: 100 })).toBe(false)
  })

  test('formats category enum labels', () => {
    expect(categoryLabel('LIVE_CASINO')).toBe('LIVE CASINO')
    expect(categoryLabel('LOUNGE')).toBe('Casino lounge')
  })

  test('detects every visible filter and the default state', () => {
    expect(hasActiveFilters('', '', 'all', 'all', 'name')).toBe(false)
    expect(hasActiveFilters('dice', '', 'all', 'all', 'name')).toBe(true)
    expect(hasActiveFilters('', 'vendor', 'all', 'all', 'name')).toBe(true)
    expect(hasActiveFilters('', '', 'premium', 'all', 'name')).toBe(true)
    expect(hasActiveFilters('', '', 'all', 'in-categories', 'name')).toBe(true)
    expect(hasActiveFilters('', '', 'all', 'all', 'rtp')).toBe(true)
  })
})
