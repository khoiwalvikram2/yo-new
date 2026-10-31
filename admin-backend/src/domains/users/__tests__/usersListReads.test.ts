import { after, afterEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from 'graphql'
import { PgDialect } from 'drizzle-orm/pg-core'
import { db, pool } from '@src/db/client.js'
import { players } from '@src/stores/index.js'
import { roles, userRoles, vipTiersTable, vipTierBenefitsTable, vipTierPerksTable } from '@src/db/schema.js'
import { PlayerAuthService } from '@src/domains/players/services/PlayerAuthService.js'
import { usersQueryResolvers } from '../resolvers/queries.js'

afterEach(() => mock.restoreAll())
after(async () => { await pool.end() })
const ctx = { tenant: 'brand-a', whitelabel: { id: 'brand-a' }, user: { type: 'admin' }, permissions: [{ domain: 'all', actions: ['*'] }] }
function info(source: string) {
  const doc = parse(source)
  const operation = doc.definitions.find(node => node.kind === 'OperationDefinition')!
  if (operation.kind !== 'OperationDefinition') throw new Error('Missing operation')
  return { fieldNodes: operation.selectionSet.selections, fragments: Object.fromEntries(doc.definitions.filter(node => node.kind === 'FragmentDefinition').map(node => [node.name.value, node])) }
}
function setup(list = [{ id: '1', name: 'Alice', vipTierId: 'gold' }, { id: '2', name: 'Bob', vipTierId: 'gold' }, { id: '3', name: 'Administrator', vipTierId: 'gold' }], emptyVipName = false) {
  const reads: Array<{ table: unknown; filter: { sql: string; params: unknown[] } }> = []
  mock.method(players, 'listUsers', async () => list as any)
  const wallet = mock.method(players, 'getWallet', async id => ({ userId: id, currency: 'INR', balance: 100, bonus: 2, exposure: 3, referralBalance: 4, referralBonusBalance: 5, updatedAt: '2026-10-01T00:00:00Z' }) as any)
  mock.method(pool as any, 'query', async () => { throw new Error('Unexpected real database read') })
  mock.method(db as any, 'select', (fields?: Record<string, unknown>) => {
    let table: unknown
    let filter: any
    const chain: any = {
      from: (source: unknown) => { table = source; return chain },
      where: (condition: any) => { filter = new PgDialect().sqlToQuery(condition); return chain },
      then: (resolve: any, reject: any) => {
        reads.push({ table, filter })
        let rows: unknown[]
        if (table === userRoles) rows = [{ userId: 1, roleId: 10 }, { userId: 3, roleId: 99 }]
        else if (table === roles) rows = [{ id: 10, name: 'Player' }, { id: 99, name: 'Whitelabel Admin' }]
        else if (table === vipTiersTable) rows = emptyVipName && fields ? [] : [{ id: 'gold', name: emptyVipName ? '' : 'Gold' }]
        else if (table === vipTierBenefitsTable || table === vipTierPerksTable) rows = []
        else throw new Error('Unexpected metadata table')
        return Promise.resolve(rows).then(resolve, reject)
      },
    }
    return chain
  })
  return { reads, wallet }
}

describe('unpaginated Users list metadata', () => {
  it('batches role/VIP reads for many users and never reads wallets when the Casino query omits them', async () => {
    const list = Array.from({ length: 1000 }, (_, index) => ({ id: String(index + 1), name: `Player ${index + 1}`, vipTierId: 'gold' }))
    const { reads, wallet } = setup(list)
    const result = await usersQueryResolvers.users(null, {}, ctx, info('{ users { id createdAt vipTierName status } }'))
    assert.equal(result.length, 999)
    assert.equal(result.some((row: any) => row.id === '3'), false, 'admin exclusion is retained')
    assert.equal(reads.length, 3, 'two tenant-scoped role reads and one VIP-name batch')
    assert.equal(wallet.mock.callCount(), 0)
    assert.ok(result.every((row: any) => row.vipTierName === 'Gold'))
    assert.ok(reads.every(read => read.filter.params.includes('brand-a')))
  })
  it('also skips VIP work for minimal ID/registration-date queries', async () => {
    const { reads, wallet } = setup()
    const result = await usersQueryResolvers.users(null, {}, ctx, info('{ users { id createdAt } }'))
    assert.deepEqual(result.map((row: any) => row.id), ['1', '2'])
    assert.equal(reads.length, 2)
    assert.equal(wallet.mock.callCount(), 0)
  })
  it('retains full wallet output for direct callers and aliases/fragments that request it', async () => {
    const { wallet } = setup()
    const selected = info('{ users { id ...Details } } fragment Details on User { tier:vipTierName ... on User { account:wallet { balance bonus exposure updatedAt } } }')
    const result = await usersQueryResolvers.users(null, {}, ctx, selected)
    assert.equal(wallet.mock.callCount(), 2)
    assert.equal(result[0].wallet.balance, 100)
    assert.equal(result[0].wallet.bonus, 2)
    assert.equal(result[0].wallet.exposure, 3)
    assert.equal(result[0].wallet.referralBalance, 4)
    assert.equal(result[0].vipTierName, 'Gold')
    await usersQueryResolvers.users(null, {}, ctx)
    assert.equal(wallet.mock.callCount(), 4)
  })
  it('keeps agent-player filtering before role/metadata reads', async () => {
    const { wallet } = setup()
    mock.method(PlayerAuthService.prototype, 'getAgentPlayerIds', async () => [2])
    const result = await usersQueryResolvers.users(null, {}, { ...ctx, user: { type: 'agent', agentId: 'a' } }, info('{ users { id } }'))
    assert.deepEqual(result.map((row: any) => row.id), ['2'])
    assert.equal(wallet.mock.callCount(), 0)
  })
  it('preserves empty VIP names through the old per-tier fallback, shared by users of that tier', async () => {
    const { reads } = setup(undefined, true)
    const result = await usersQueryResolvers.users(null, {}, ctx, info('{ users { id vipTierName } }'))
    assert.ok(result.every((row: any) => row.vipTierName === ''))
    assert.equal(reads.filter(read => read.table === vipTiersTable).length, 2, 'one batch and one shared fallback')
  })
  it('refuses callers without player-list read permission before any list/database access', async () => {
    const { reads, wallet } = setup()
    await assert.rejects(() => usersQueryResolvers.users(null, {}, { ...ctx, permissions: [] }), /Forbidden/)
    assert.equal(reads.length, 0)
    assert.equal(wallet.mock.callCount(), 0)
  })
})
