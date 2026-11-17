/**
 * User.access on the User field resolvers the schema actually uses (domains/index.ts maps User to
 * commonResolvers.User). The access resolver used to sit only in users/resolvers/index.ts, which is not wired, so
 * any `user { access { ... } }` selection, such as on setUserStatus's reply, failed with "Cannot return null for
 * non-nullable field User.access" (reverify players/PLA-09). The rule is PlayerProfile.access's: only an active
 * player may log in, as the player API enforces. No database: the schema is executed with a root value.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/common/resolvers/__tests__/userAccessField.test.ts
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSchema, graphql, type GraphQLObjectType } from 'graphql'
import { typeDefs } from '@src/types/graphql.js'
import { commonResolvers } from '../index.js'
import { playerAccess } from '@src/domains/players/services/playerAccess.js'
import { createUserAccessField, userAccessField, type PlayerAccessReader } from '@src/domains/players/services/userAccessField.js'
import { usersResolvers } from '@src/domains/users/resolvers/index.js'

after(async () => {
	// Importing the resolvers loads the db client and the realtime module; close what they may have opened.
	const { pool } = await import('@src/db/client.js')
	const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
	await closeRedisEmitter().catch(() => {})
	await pool.end().catch(() => {})
})

/** The schema as the server serves it for User: each field resolver of the live map attached to its field. */
function schemaWithUserResolvers() {
	const schema = buildSchema(typeDefs)
	const fields = (schema.getType('User') as GraphQLObjectType).getFields()
	for (const [name, resolve] of Object.entries(commonResolvers.User as Record<string, any>)) fields[name].resolve = resolve
	return schema
}

/** What setUserStatus returns as its user (users/resolvers/mutations.ts): the mapper's fields, no access. */
const userReply = (status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED', extra: Record<string, unknown> = {}) => ({
	id: '2055', tenant: 'grandwinn-com', name: 'Lane player', email: null, phone: '9000000000', username: 'lane', status,
	bonusAllowed: true, requirePasswordReset: false, sportsVisible: true, sportsBetAllowed: true, casinoVisible: true,
	casinoBetAllowed: true, matkaVisible: true, matkaBetAllowed: true, withdrawalLock: false, riskType: null, vipTierId: null,
	createdAt: '2026-11-03T10:00:00.000Z', ...extra,
})

const ACCESS = 'access { canLogin canDeposit canWithdraw bonusEligible sports { visible canBet } casino { visible canBet } matka { visible canBet } }'

describe('User.access on the live User type resolvers', () => {
	it('domains/index.ts maps User to the users map with commonResolvers.User last, so the common access wins', () => {
		const src = readFileSync(join(process.cwd(), 'src', 'domains', 'index.ts'), 'utf8')
		// B105: the users map (vipDepositAccess, vipTierName, parentAgent) was not wired; it now is, under the common one.
		assert.match(src, /^\s*User: \{ \.\.\.usersResolvers\.User, \.\.\.commonResolvers\.User \},/m)
		assert.equal(typeof (commonResolvers.User as any).access, 'function')
	})

	it("setUserStatus's reply answers user { access }, and only an active player may log in", async () => {
		const schema = schemaWithUserResolvers()
		const source = `mutation($status: PlayerStatus!) { setUserStatus(id: "2055", status: $status) { success user { id status ${ACCESS} } } }`
		for (const status of ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const) {
			const result = await graphql({ schema, source, variableValues: { status },
				rootValue: { setUserStatus: () => ({ success: true, message: 'Status updated', user: userReply(status) }) } })
			assert.equal(result.errors, undefined, `${status}: ${result.errors?.map((e) => e.message).join('; ')}`)
			const access = (result.data as any).setUserStatus.user.access
			const active = status === 'ACTIVE'
			assert.deepEqual(JSON.parse(JSON.stringify(access)), {
				canLogin: active, canDeposit: active, canWithdraw: active, bonusEligible: active,
				sports: { visible: true, canBet: active }, casino: { visible: true, canBet: active }, matka: { visible: true, canBet: active },
			}, status)
		}
	})

	it('any User a resolver returns answers access: user(id) and the usersPage rows', async () => {
		const schema = schemaWithUserResolvers()
		const locked = userReply('ACTIVE', { id: '7', withdrawalLock: true, bonusAllowed: false, casinoBetAllowed: false, matkaVisible: false })
		const result = await graphql({ schema,
			source: `{ user(id: "7") { ${ACCESS} } usersPage(limit: 2) { total items { id ${ACCESS} } } }`,
			rootValue: { user: () => locked, usersPage: () => ({ total: 2, items: [locked, userReply('INACTIVE', { id: '8' })] }) } })
		assert.equal(result.errors, undefined, result.errors?.map((e) => e.message).join('; '))
		const data = JSON.parse(JSON.stringify(result.data))
		const lockedAccess = { canLogin: true, canDeposit: true, canWithdraw: false, bonusEligible: false,
			sports: { visible: true, canBet: true }, casino: { visible: true, canBet: false }, matka: { visible: false, canBet: true } }
		assert.deepEqual(data.user.access, lockedAccess)
		assert.deepEqual(data.usersPage.items[0].access, lockedAccess)
		assert.equal(data.usersPage.items[1].access.canLogin, false, 'an inactive player cannot log in')
	})

	it("one rule for a users row ('active') and a User mapper ('ACTIVE'); a missing status grants nothing", () => {
		const row = { status: 'active', withdrawalLock: false, bonusAllowed: true, sportsVisible: true, sportsBetAllowed: true,
			casinoVisible: false, casinoBetAllowed: true, matkaVisible: true, matkaBetAllowed: false }
		assert.deepEqual(playerAccess(row), playerAccess({ ...row, status: 'ACTIVE' }))
		assert.deepEqual(playerAccess({ ...row, status: 'inactive' }), playerAccess({ ...row, status: 'INACTIVE' }))
		const none = playerAccess({ ...row, status: undefined })
		assert.deepEqual([none.canLogin, none.canDeposit, none.canWithdraw, none.bonusEligible, none.sports.canBet], [false, false, false, false, false])
	})
})

/** What referralReferees and ReferrerProfile.referees answer for a player (Deposit.user is alike): no status, no switches. */
const lookup = (id: string) => ({ id, name: `Player ${id}`, phone: '9000000000', username: `p${id}` })
/** A stored users row's access fields. */
const stored = (status: string, extra: Record<string, unknown> = {}) => ({ status, withdrawalLock: false, bonusAllowed: true, sportsVisible: true,
	sportsBetAllowed: true, casinoVisible: true, casinoBetAllowed: true, matkaVisible: true, matkaBetAllowed: true, ...extra })
/** A reader standing in for the users table (tenant -> id -> row); it records every read. */
function fakeReader(rows: Record<string, Record<number, Record<string, unknown>>>) {
	const reads: Array<{ tenant: string; ids: number[] }> = []
	const read: PlayerAccessReader = async (tenant, ids) => {
		reads.push({ tenant, ids: [...ids] })
		return new Map(ids.filter((id) => rows[tenant]?.[id]).map((id) => [id, rows[tenant][id] as any]))
	}
	return { read, reads }
}
/** The live User field resolvers, with access answered over the given reader. */
function schemaWithAccessReader(read: PlayerAccessReader) {
	const schema = schemaWithUserResolvers()
	;(schema.getType('User') as GraphQLObjectType).getFields().access.resolve = createUserAccessField(read)
	return schema
}
const adminCtx = (tenant: string) => ({ tenant, whitelabel: { id: tenant }, user: { sub: '1', roles: ['Whitelabel Admin'] }, permissions: [] })
const ALL = { canLogin: true, canDeposit: true, canWithdraw: true, bonusEligible: true,
	sports: { visible: true, canBet: true }, casino: { visible: true, canBet: true }, matka: { visible: true, canBet: true } }
const NONE = (visible: boolean) => ({ canLogin: false, canDeposit: false, canWithdraw: false, bonusEligible: false,
	sports: { visible, canBet: false }, casino: { visible, canBet: false }, matka: { visible, canBet: false } })

// E102: since User.access was wired it resolves wherever a User is returned, but a User built from a lookup carries no
// status or switches, so access said an active referee could not log in, deposit or withdraw.
describe('User.access on a User built from a lookup (E102)', () => {
	it('both User maps answer access with the one batched resolver', () => {
		assert.equal((commonResolvers.User as any).access, userAccessField)
		assert.equal((usersResolvers.User as any).access, userAccessField)
	})

	it("referralReferees rows read their access fields once for the whole list, in the caller's tenant", async () => {
		const { read, reads } = fakeReader({
			'grandwinn-com': { 11: stored('active'), 12: stored('inactive'), 13: stored('suspended'),
				14: stored('active', { withdrawalLock: true, bonusAllowed: false, casinoBetAllowed: false, matkaVisible: false }) },
			'other-com': { 15: stored('active') },
		})
		const result = await graphql({ schema: schemaWithAccessReader(read), contextValue: adminCtx('grandwinn-com'),
			source: `{ referralReferees(referrerId: "10") { id username ${ACCESS} } }`,
			rootValue: { referralReferees: () => ['11', '12', '13', '14', '15'].map(lookup) } })
		assert.equal(result.errors, undefined, result.errors?.map((e) => e.message).join('; '))
		assert.deepEqual(reads, [{ tenant: 'grandwinn-com', ids: [11, 12, 13, 14, 15] }], 'one read for the whole list, in the caller tenant')
		const access = Object.fromEntries(JSON.parse(JSON.stringify(result.data)).referralReferees.map((row: any) => [row.id, row.access]))
		assert.deepEqual(access['11'], ALL, 'an active referee may log in, deposit and withdraw (all three read false)')
		assert.deepEqual(access['12'], NONE(true), 'an inactive referee may not log in')
		assert.deepEqual(access['13'], NONE(true))
		assert.deepEqual(access['14'], { ...ALL, canWithdraw: false, bonusEligible: false, casino: { visible: true, canBet: false }, matka: { visible: false, canBet: true } },
			"the referee's own withdrawal lock and switches")
		assert.deepEqual(access['15'], NONE(false), "another whitelabel's player is not read there: nothing is granted")
	})

	it("a Super Admin's read is in the whitelabel it works in, once per request however often the player appears", async () => {
		const { read, reads } = fakeReader({ 'wl-b': { 21: stored('active') } })
		const schema = schemaWithAccessReader(read)
		const superAdmin = { tenant: 'default', user: { sub: '1', roles: ['Super Admin'] }, directorMode: 'whitelabel', directorWhitelabelId: 'wl-b', permissions: [] }
		for (const request of [1, 2]) {
			const result = await graphql({ schema, contextValue: { ...superAdmin }, source: `{ user(id: "21") { ${ACCESS} } users { id ${ACCESS} } }`,
				rootValue: { user: () => lookup('21'), users: () => [lookup('21'), lookup('21')] } })
			assert.equal(result.errors, undefined, result.errors?.map((e) => e.message).join('; '))
			const data = JSON.parse(JSON.stringify(result.data))
			assert.deepEqual([data.user.access, ...data.users.map((row: any) => row.access)], [ALL, ALL, ALL])
			assert.equal(reads.length, request, 'each request reads once, for its own context')
		}
		assert.deepEqual(reads, [{ tenant: 'wl-b', ids: [21] }, { tenant: 'wl-b', ids: [21] }])
	})

	it('the fields a row states win; a whole row, a row without a usable id, or no context reads nothing', async () => {
		const { read, reads } = fakeReader({ t1: { 31: stored('active', { withdrawalLock: true }) } })
		const access = createUserAccessField(read), ctx = adminCtx('t1')
		// SportsPlayerProfile.user states the status (from the same read) and none of the switches.
		assert.equal((await access({ id: '31', status: 'INACTIVE' }, {}, ctx)).canLogin, false, "the row's own status")
		const stated = await access({ id: '31', status: 'ACTIVE' }, {}, ctx)
		assert.deepEqual([stated.canLogin, stated.canWithdraw, stated.casino.canBet], [true, false, true], 'the stored lock and switches fill the rest')
		assert.deepEqual(reads, [{ tenant: 't1', ids: [31] }, { tenant: 't1', ids: [31] }], 'each pass reads afresh')
		reads.length = 0
		const whole = userReply('ACTIVE', { id: '31' })
		assert.deepEqual(access(whole, {}, ctx), playerAccess(whole), 'a whole row answers at once, without a read')
		for (const id of [undefined, null, '', 'abc', '0', '-4', '1.5', '2147483648']) {
			assert.deepEqual(access({ id, name: 'x' }, {}, ctx), NONE(false), JSON.stringify(id))
		}
		assert.deepEqual(access(lookup('31'), {}, undefined), NONE(false), 'no context: nothing read, nothing granted')
		assert.equal(reads.length, 0)
	})

	it('a subscription keeps its context while it runs, and each event still reads the current status', async () => {
		const rows: Record<string, Record<number, Record<string, unknown>>> = { t1: { 41: stored('active') } }
		const { read, reads } = fakeReader(rows)
		const access = createUserAccessField(read), ctx = adminCtx('t1')
		assert.equal((await access(lookup('41'), {}, ctx)).canLogin, true)
		rows.t1[41] = stored('suspended') // the player is suspended between two deposit events of the same subscription
		assert.equal((await access(lookup('41'), {}, ctx)).canLogin, false, 'not the status of the first event')
		assert.equal(reads.length, 2)
	})
})
