/**
 * Does the admin surface refuse a signed-in user who holds nothing?
 *
 * This is the regression guard for a measured hole, not a hypothetical one.
 * Probed against live data before these gates existed, an authenticated admin
 * with an **empty permission set** could:
 *
 *   - list all 648 players of a whitelabel with their names, usernames and
 *     phone numbers, and open any one of them;
 *   - read every wallet, limit, bet, transaction, device and session;
 *   - read the audit trail, and delete annotations from it;
 *   - read every financial report — liquidity, exposure, P&L, all KPIs;
 *   - suspend, block, unblock and lock any player;
 *   - delete an RBAC role, delete a support admin, remove an IP allowlist entry;
 *   - mark a settlement settled and export the settlement CSV;
 *   - publish matka rates and approve results.
 *
 * 109 operations were reachable in total. The cause was structural rather than
 * an oversight in any one place: `requirePermission` throws but was used five
 * times in the whole backend, while almost everything else called
 * `hasPermission`, which returns a boolean each call site was free to ignore.
 *
 * The list below is deliberately concrete. A wrapper asserting "everything is
 * gated" would pass while naming nothing, and would have to be weakened every
 * time a legitimately open operation was added. These are the operations whose
 * exposure was actually demonstrated.
 *
 * Requires DATABASE_URL. Writes nothing: every mutation is called with an id
 * that cannot exist, so a missing gate reports "not found" and a present one
 * refuses before looking.
 */
import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

/** An id no row can have. */
const ABSENT = '987654321'

type Case = { kind: 'Query' | 'Mutation'; name: string; args: Record<string, unknown> }

const MUST_REFUSE: Case[] = [
  // Player identity and money.
  { kind: 'Query', name: 'users', args: {} },
  { kind: 'Query', name: 'usersPage', args: { page: 1, limit: 1 } },
  { kind: 'Query', name: 'user', args: { id: ABSENT } },
  { kind: 'Query', name: 'usersByIds', args: { ids: [ABSENT] } },
  { kind: 'Query', name: 'wallet', args: { userId: ABSENT } },
  { kind: 'Query', name: 'playerLimits', args: { userId: ABSENT } },
  { kind: 'Query', name: 'playersListStats', args: {} },
  { kind: 'Query', name: 'playerProfile', args: { id: ABSENT } },
  { kind: 'Query', name: 'playerBets', args: { id: ABSENT } },
  { kind: 'Query', name: 'playerTransactions', args: { id: ABSENT } },
  { kind: 'Query', name: 'playerDevices', args: { id: ABSENT } },
  { kind: 'Query', name: 'playerSessions', args: { id: ABSENT } },

  // The audit trail, including the ability to edit it.
  { kind: 'Query', name: 'auditEvents', args: {} },
  { kind: 'Query', name: 'auditAnnotations', args: {} },
  { kind: 'Mutation', name: 'deleteAuditAnnotation', args: { id: ABSENT } },

  // Aggregate financial reporting.
  { kind: 'Query', name: 'liquidity', args: {} },
  { kind: 'Query', name: 'exposure', args: {} },
  { kind: 'Query', name: 'exposureByMarket', args: {} },
  { kind: 'Query', name: 'pnl', args: {} },
  { kind: 'Query', name: 'casinoKPIs', args: {} },
  { kind: 'Query', name: 'sportsKPIs', args: {} },
  { kind: 'Query', name: 'savedReports', args: {} },

  // Account control.
  { kind: 'Mutation', name: 'suspendPlayer', args: { id: ABSENT } },
  { kind: 'Mutation', name: 'blockPlayer', args: { id: ABSENT } },
  { kind: 'Mutation', name: 'unblockPlayer', args: { id: ABSENT } },
  { kind: 'Mutation', name: 'forceLogoutUser', args: { id: ABSENT } },
  { kind: 'Mutation', name: 'setUserVipTier', args: { id: ABSENT } },

  // The permission system itself.
  { kind: 'Mutation', name: 'deleteRBACRole', args: { id: ABSENT } },
  { kind: 'Mutation', name: 'deleteSupportAdmin', args: { id: ABSENT } },
  { kind: 'Mutation', name: 'removeIpFromAllowlist', args: { id: ABSENT } },

  // Money and odds.
  { kind: 'Mutation', name: 'markSettlementSettled', args: { id: ABSENT } },
  { kind: 'Mutation', name: 'publishRates', args: { id: ABSENT } },
  { kind: 'Mutation', name: 'approveResult', args: { id: ABSENT } },

  // Writes that were observed to *succeed* for a caller holding nothing, not
  // merely to be reachable: a bonus was granted, a whitelabel renamed, a
  // player's limits changed and their sessions terminated. `adjustWallet` was
  // stopped only by the whitelabel running out of credit.
  { kind: 'Mutation', name: 'grantPlayerBonus', args: { input: { playerId: ABSENT, amount: 1 } } },
  { kind: 'Mutation', name: 'adjustWallet', args: { userId: ABSENT, amount: 1, reason: 'test' } },
  { kind: 'Mutation', name: 'updateWhitelabel', args: { input: { id: 'authz-test-tenant', name: 'x' } } },
  { kind: 'Mutation', name: 'createWhitelabel', args: { input: { id: 'authz-test-new', name: 'x', domain: 'x.test' } } },
  { kind: 'Mutation', name: 'setPlayerLimits', args: { input: { playerId: ABSENT } } },
  { kind: 'Mutation', name: 'terminatePlayerSessions', args: { input: { playerId: ABSENT } } },
  { kind: 'Mutation', name: 'setUserStatus', args: { id: ABSENT, status: 'suspended' } },
  { kind: 'Mutation', name: 'createSupportAdmin', args: { input: { name: 'x', username: 'x', password: 'Str0ng-Passw0rd!', roleId: ABSENT } } },
  { kind: 'Mutation', name: 'createAuditAnnotation', args: { input: { auditEventId: ABSENT, note: 'x' } } },

  // The escalation chain. `createRBACRole` and `assignRoleToAdmin` — the nested
  // RBAC API — were always gated. The flat mutations sitting beside them on the
  // same schema were not, and two calls took a caller from nothing to `all:*`:
  //
  //     upsertRole({ name: 'x', permissions: [{ domain: 'all', actions: ['*'] }] })
  //     assignRole({ userId: <self>, role: 'x' })
  //
  // after which `getUserPermissions` returned `[{ domain: 'all', action: '*' }]`.
  // Demonstrated end to end before these gates existed.
  { kind: 'Mutation', name: 'upsertRole', args: { input: { name: 'x', permissions: [{ domain: 'all', actions: ['*'] }] } } },
  { kind: 'Mutation', name: 'assignRole', args: { userId: ABSENT, role: 'Viewer' } },
  { kind: 'Mutation', name: 'removeRole', args: { userId: ABSENT, role: 'Viewer' } },

  // Matka results decide what a bet pays.
  { kind: 'Mutation', name: 'postResult', args: { drawId: ABSENT, value: '123' } },
  { kind: 'Mutation', name: 'submitResultForApproval', args: { drawId: ABSENT, value: '123' } },
  { kind: 'Mutation', name: 'createDraw', args: { type: 'OPEN', openAt: '2026-01-01T00:00:00Z', cutoffAt: '2026-01-01T01:00:00Z', timezone: 'UTC' } },

  // Matka and betting data.
  { kind: 'Query', name: 'draws', args: {} },
  { kind: 'Query', name: 'rates', args: {} },
  { kind: 'Query', name: 'matkaBets', args: {} },
  { kind: 'Query', name: 'betsPageTotals', args: {} },
]

let Query: Record<string, unknown> = {}
let Mutation: Record<string, unknown> = {}

/** A signed-in admin whose role grants nothing. */
const nobody = () =>
  ({
    user: { sub: '1', name: 'Nobody', roles: ['Nothing'], type: 'admin' },
    permissions: [],
    tenant: 'authz-test-tenant',
    whitelabel: { id: 'authz-test-tenant' },
    request: { headers: {} },
    loaders: {},
  }) as never

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { domainResolvers } = await import('@src/domains/index.js')
  Query = (domainResolvers as Record<string, Record<string, unknown>>).Query
  Mutation = (domainResolvers as Record<string, Record<string, unknown>>).Mutation
})

describe('an authenticated admin holding no permissions', () => {
  for (const c of MUST_REFUSE) {
    it(`is refused by ${c.kind === 'Query' ? 'query' : 'mutation'} ${c.name}`, async () => {
      const map = c.kind === 'Query' ? Query : Mutation
      const fn = map[c.name]
      assert.equal(typeof fn, 'function', `${c.name} has no resolver — has it been renamed?`)

      let error: string | null = null
      try {
        await (fn as (p: unknown, a: unknown, x: unknown, i: unknown) => Promise<unknown>)(
          undefined,
          c.args,
          nobody(),
          undefined
        )
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }

      assert.ok(
        error !== null,
        `${c.name} ran to completion for a caller holding nothing — the gate is gone`
      )
      assert.match(
        error,
        /Forbidden|insufficient permission|Unauthorized/i,
        `${c.name} failed, but not on authorisation: ${error}`
      )
    })
  }
})
