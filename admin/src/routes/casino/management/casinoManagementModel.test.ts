import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  EMPTY_BET_VALUES,
  betSettingsVariables,
  betTargetIds,
  betValuesFromSetting,
  canReorderGames,
  casinoStats,
  categoryLabel,
  combineAllCategoryGames,
  enabledVipTierIds,
  gameAccessStatus,
  gameQueryInput,
  groupBetSettings,
  isWhitelabelAdminRole,
  moveGameId,
  paginationCopy,
  searchedGameTerm,
  sortGameRows,
  toggleSelection,
  vendorVariables,
  vipTierDiff,
  type BetSetting,
  type GameRow,
} from './casinoManagementModel'

const game = (id: string, patch: Partial<GameRow> = {}): GameRow => ({
  id,
  name: `Game ${id}`,
  slug: `game-${id}`,
  mainCategory: 'CASINO',
  vendorId: 'vendor-1',
  vendorName: 'Evolution',
  isActive: true,
  tenantEnabled: true,
  order: null,
  ...patch,
})

const bet = (id: string, patch: Partial<BetSetting> = {}): BetSetting => ({
  id,
  gameId: 'g1',
  playerId: null,
  betEnabled: true,
  minStake: 10,
  maxStake: 100,
  maxWin: 1000,
  ...patch,
})

describe('casino management model', () => {
  test('detects both tenant role spellings without case sensitivity', () => {
    assert.equal(isWhitelabelAdminRole(['SUPPORT_ADMIN']), false)
    assert.equal(isWhitelabelAdminRole(['WhiteLabel Admin']), true)
    assert.equal(isWhitelabelAdminRole(['TENANT_OPERATOR']), true)
    assert.equal(isWhitelabelAdminRole(undefined), false)
  })

  test('only sends a trimmed search after the legacy three-character threshold', () => {
    assert.equal(searchedGameTerm(' ab '), undefined)
    assert.equal(searchedGameTerm(' abc '), 'abc')
  })

  test('builds exact all-category and paged game query inputs', () => {
    const filters = {
      providerId: 'p1', vendorId: 'v1', vipTierId: 'vip1', search: '  wheel ', enabled: false,
      page: 3, pageSize: 20, whitelabelAdmin: false,
    }
    assert.deepEqual(gameQueryInput(filters, 'LIVE_CASINO', true), {
      input: {
        providerId: 'p1', category: 'LIVE_CASINO', vendorId: 'v1', vipTierId: 'vip1', search: 'wheel',
        enabled: false, page: 1, pageSize: 10000,
      },
    })
    assert.deepEqual(gameQueryInput({ ...filters, whitelabelAdmin: true }, 'SLOTS', false), {
      input: {
        providerId: undefined, category: 'SLOTS', vendorId: 'v1', vipTierId: 'vip1', search: 'wheel',
        enabled: false, page: 3, pageSize: 20,
      },
    })
  })

  test('keeps provider and category optional in vendor variables for tenant/all scope', () => {
    assert.deepEqual(vendorVariables('p1', 'CASINO', false), { providerId: 'p1', category: 'CASINO' })
    assert.deepEqual(vendorVariables('p1', 'ALL', false), { providerId: 'p1', category: undefined })
    assert.deepEqual(vendorVariables('p1', 'SLOTS', true), { providerId: undefined, category: 'SLOTS' })
  })

  test('combines category totals, applies the vendor filter, and pages without mutation', () => {
    const first = { total: 4, page: 1, pageSize: 10000, items: [game('a'), game('b', { vendorId: 'v2' })] }
    const second = { total: 2, page: 1, pageSize: 10000, items: [game('c'), game('d')] }
    assert.deepEqual(combineAllCategoryGames([first, second], null, 2, 2), {
      total: 6, page: 2, pageSize: 2, items: [first.items[0] && second.items[0], second.items[1]],
    })
    assert.deepEqual(combineAllCategoryGames([first, second], 'vendor-1', 1, 2).items.map((row) => row.id), ['a', 'c'])
    assert.equal(combineAllCategoryGames([first, second], 'vendor-1', 1, 2).total, 3)
  })

  test('sorts order first and name second without mutating the query result', () => {
    const rows = [game('z', { name: 'Zulu' }), game('b', { name: 'Beta', order: 1 }), game('a', { name: 'Alpha', order: 1 })]
    assert.deepEqual(sortGameRows(rows).map((row) => row.id), ['a', 'b', 'z'])
    assert.deepEqual(rows.map((row) => row.id), ['z', 'b', 'a'])
  })

  test('moves ids only for a valid drag and gates reorder to a vendor/category scope', () => {
    assert.deepEqual(moveGameId(['a', 'b', 'c'], 'a', 'c'), ['b', 'c', 'a'])
    assert.equal(moveGameId(['a', 'b'], 'a', 'a'), null)
    assert.equal(moveGameId(['a'], 'missing', 'a'), null)
    assert.equal(canReorderGames('v1', 'CASINO'), true)
    assert.equal(canReorderGames('v1', 'ALL'), false)
    assert.equal(canReorderGames(null, 'CASINO'), false)
  })

  test('toggles selection immutably', () => {
    const current = new Set(['a'])
    assert.deepEqual([...toggleSelection(current, 'b')], ['a', 'b'])
    assert.deepEqual([...toggleSelection(current, 'a')], [])
    assert.deepEqual([...current], ['a'])
  })

  test('retains pagination and category copy', () => {
    assert.equal(paginationCopy(2, 20, 45), 'Showing 21–40 of 45 games')
    assert.equal(paginationCopy(1, 20, 0), 'Showing 0 of 0 games')
    assert.equal(categoryLabel('LIVE_CASINO'), 'LIVE CASINO')
    assert.equal(categoryLabel('ALL'), 'All Categories')
  })

  test('derives the three visible access states', () => {
    assert.deepEqual(gameAccessStatus({ isActive: false, tenantEnabled: true }), { label: 'BLOCKED', tone: 'neg' })
    assert.deepEqual(gameAccessStatus({ isActive: true, tenantEnabled: true }), { label: 'ENABLED', tone: 'ok' })
    assert.deepEqual(gameAccessStatus({ isActive: true, tenantEnabled: false }), { label: 'DISABLED', tone: 'muted' })
  })

  test('computes the same provider, vendor and game statistics as the legacy cards', () => {
    assert.deepEqual(casinoStats(
      [{ id: 'p1', name: 'One', status: 'ACTIVE' }, { id: 'p2', name: 'Two', status: 'inactive' }],
      [{ id: 'v1', name: 'Vendor' }],
      { total: 3, items: [game('1'), game('2', { tenantEnabled: false }), game('3')] },
    ), {
      totalProviders: 2, activeProviders: 1, inactiveProviders: 1, totalVendors: 1,
      gamesTotal: 3, gamesEnabled: 2, gamesDisabled: 1, activeRate: 50,
    })
  })

  test('groups all-player rules first and merges identical specific-player limits', () => {
    const groups = groupBetSettings([
      bet('specific-1', { playerId: 'u1' }),
      bet('all', { playerId: null }),
      bet('specific-2', { playerId: 'u2' }),
      bet('other', { playerId: 'u3', maxWin: 2000 }),
    ])
    assert.equal(groups.length, 3)
    assert.equal(groups[0].isAllPlayers, true)
    assert.deepEqual(groups[1].settings.map((setting) => setting.playerId), ['u1', 'u2'])
    assert.deepEqual(groups[2].settings.map((setting) => setting.playerId), ['u3'])
  })

  test('maps a setting to controlled values and preserves empty defaults', () => {
    assert.deepEqual(betValuesFromSetting(bet('one', { betEnabled: false, minStake: null })), {
      betEnabled: false, minStake: null, maxStake: 100, maxWin: 1000,
    })
    assert.deepEqual(betValuesFromSetting(undefined), EMPTY_BET_VALUES)
  })

  test('builds target ids and exact upsert variables', () => {
    assert.deepEqual(betTargetIds('all', [{ id: 'u1', label: 'One' }]), [null])
    assert.deepEqual(betTargetIds('specific', [{ id: 'u1', label: 'One' }, { id: 'u2', label: 'Two' }]), ['u1', 'u2'])
    assert.deepEqual(betSettingsVariables('g1', null, { betEnabled: true, minStake: 1, maxStake: null, maxWin: 10 }), {
      gameId: 'g1',
      settings: { playerId: undefined, betEnabled: true, minStake: 1, maxStake: undefined, maxWin: 10 },
    })
  })

  test('derives enabled VIP ids and the enable/disable delta', () => {
    const current = enabledVipTierIds([
      { tierId: 'bronze', enabled: true }, { tierId: 'silver', enabled: false }, { tierId: 'gold', enabled: true },
    ])
    assert.deepEqual([...current], ['bronze', 'gold'])
    assert.deepEqual(vipTierDiff(current, new Set(['gold', 'platinum'])), {
      enable: ['platinum'], disable: ['bronze'],
    })
  })
})
