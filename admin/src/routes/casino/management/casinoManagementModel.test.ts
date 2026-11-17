import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  EMPTY_BET_VALUES,
  betSettingsVariables,
  betTargetIds,
  betValuesFromSetting,
  betValuesError,
  canReorderGames,
  casinoGameCounts,
  casinoScopeCountInput,
  casinoStats,
  categoryLabel,
  enabledVipTierIds,
  gameAccessStatus,
  gameQueryInput,
  groupBetSettings,
  isCoreModeView,
  isWhitelabelAdminRole,
  lastGamesPage,
  moveGameId,
  paginationCopy,
  playerSearchLabel,
  reorderVendorGameIds,
  searchedGameTerm,
  sortGameRows,
  toggleSelection,
  vendorOrderQueryInput,
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

  test('builds exact paged game query inputs; "All" asks the server for one page of every category', () => {
    const filters = {
      providerId: 'p1', vendorId: 'v1', vipTierId: 'vip1', search: '  wheel ', enabled: false,
      page: 3, pageSize: 20, whitelabelAdmin: false,
    }
    // It used to fetch each category with pageSize 10000 and page them in the browser: past the
    // server's 10,000 cap games were lost and the last pages were empty under a full total.
    assert.deepEqual(gameQueryInput(filters, 'ALL'), {
      input: {
        providerId: 'p1', category: undefined, vendorId: 'v1', vipTierId: 'vip1', search: 'wheel',
        enabled: false, page: 3, pageSize: 20,
      },
    })
    assert.deepEqual(gameQueryInput({ ...filters, whitelabelAdmin: true }, 'SLOTS'), {
      input: {
        providerId: undefined, category: 'SLOTS', vendorId: 'v1', vipTierId: 'vip1', search: 'wheel',
        enabled: false, page: 3, pageSize: 20,
      },
    })
  })

  test('the last page with games, for the pagination clamp', () => {
    assert.equal(lastGamesPage(12520, 100), 126)
    assert.equal(lastGamesPage(12500, 100), 125)
    assert.equal(lastGamesPage(0, 20), 1)
  })

  test('a drag renumbers the vendor\'s whole order, not just the visible page', () => {
    assert.deepEqual(vendorOrderQueryInput({ providerId: 'p1', whitelabelAdmin: false }, 'v1', 'LIVE_CASINO'), {
      input: { providerId: 'p1', category: 'LIVE_CASINO', vendorId: 'v1', page: 1, pageSize: 10000 },
    })
    const full = ['a', 'b', 'c', 'd', 'e', 'f']
    // Page 2 holds d, e, f: f dragged to the top of it stays on page 2, before d.
    assert.deepEqual(reorderVendorGameIds(full, ['f', 'd', 'e'], 'f'), ['a', 'b', 'c', 'f', 'd', 'e'])
    // Down: d dragged below e lands right after e.
    assert.deepEqual(reorderVendorGameIds(full, ['e', 'd', 'f'], 'd'), ['a', 'b', 'c', 'e', 'd', 'f'])
    // A filtered view (b, e visible): e above b moves e next to b, the rest keep their places.
    assert.deepEqual(reorderVendorGameIds(full, ['e', 'b'], 'e'), ['a', 'e', 'b', 'c', 'd', 'f'])
    assert.equal(reorderVendorGameIds(full, ['x', 'a'], 'x'), null, 'a game the vendor list does not hold')
    assert.equal(reorderVendorGameIds(['a'], ['a'], 'a'), null, 'nothing to place it beside')
  })

  test('core mode is a Super Admin outside whitelabel mode', () => {
    assert.equal(isCoreModeView(['Super Admin'], 'core'), true)
    assert.equal(isCoreModeView(['super_admin'], undefined), true)
    assert.equal(isCoreModeView(['Super Admin'], 'whitelabel'), false)
    assert.equal(isCoreModeView(['Whitelabel Admin'], 'core'), false, 'the store defaults to core for everyone')
  })

  test('bet values: a minimum above the maximum or a negative amount is marked on its field', () => {
    assert.deepEqual(betValuesError({ betEnabled: true, minStake: 100, maxStake: 10, maxWin: 50 }), {
      field: 'minStake', message: 'Minimum cannot be above the maximum',
    })
    assert.deepEqual(betValuesError({ betEnabled: true, minStake: null, maxStake: -1, maxWin: null }), {
      field: 'maxStake', message: 'Cannot be negative',
    })
    assert.equal(betValuesError({ betEnabled: true, minStake: 10, maxStake: 10, maxWin: null }), null)
    assert.equal(betValuesError(EMPTY_BET_VALUES), null)
  })

  test('player search labels use the first identifier a player has', () => {
    assert.equal(playerSearchLabel({ name: 'Vfy agentSharing', email: null, phone: '9876543210', username: null }), 'Vfy agentSharing (9876543210)')
    assert.equal(playerSearchLabel({ name: 'Ann', username: 'ann01', phone: '98', email: 'a@x.io' }), 'Ann (ann01)')
    assert.equal(playerSearchLabel({ name: null, username: 'ann01', phone: '98' }), 'ann01 (98)')
    assert.equal(playerSearchLabel({ name: 'Ann', email: null, phone: null, username: null }), 'Ann')
  })

  test('keeps provider and category optional in vendor variables for tenant/all scope', () => {
    assert.deepEqual(vendorVariables('p1', 'CASINO', false), { providerId: 'p1', category: 'CASINO' })
    assert.deepEqual(vendorVariables('p1', 'ALL', false), { providerId: 'p1', category: undefined })
    assert.deepEqual(vendorVariables('p1', 'SLOTS', true), { providerId: undefined, category: 'SLOTS' })
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

  test('core mode shows the platform flag, the only status a game has across whitelabels', () => {
    assert.deepEqual(gameAccessStatus({ isActive: true, tenantEnabled: null }, true), { label: 'ACTIVE', tone: 'ok' })
    assert.deepEqual(gameAccessStatus({ isActive: false, tenantEnabled: null }, true), { label: 'BLOCKED', tone: 'neg' })
    const stats = casinoStats([], [], { total: 3, items: [game('1', { tenantEnabled: null }), game('2', { isActive: false, tenantEnabled: null }), game('3', { tenantEnabled: null })] }, true)
    assert.deepEqual([stats.gamesEnabled, stats.gamesDisabled], [2, 1])
  })

  test('the Games card counts the table\'s scope without its narrowing filters (B002)', () => {
    // grandwinn's All view: 12,520 games, 12,451 switched on.
    assert.deepEqual(casinoGameCounts(12520, 12451), { gamesTotal: 12520, gamesEnabled: 12451, gamesDisabled: 69 })
    assert.deepEqual(casinoGameCounts(undefined, undefined), { gamesTotal: 0, gamesEnabled: 0, gamesDisabled: 0 })
    assert.deepEqual(casinoGameCounts(5, 9), { gamesTotal: 5, gamesEnabled: 5, gamesDisabled: 0 }, 'never more enabled than games')
    // The All view names no category; a whitelabel admin names no provider; a chosen vendor narrows it.
    assert.deepEqual(casinoScopeCountInput('p1', 'ALL', null, false), { providerId: 'p1', category: undefined, vendorId: undefined, page: 1, pageSize: 1 })
    assert.deepEqual(casinoScopeCountInput('p1', 'SLOTS', 'v9', true), { providerId: undefined, category: 'SLOTS', vendorId: 'v9', page: 1, pageSize: 1 })
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
