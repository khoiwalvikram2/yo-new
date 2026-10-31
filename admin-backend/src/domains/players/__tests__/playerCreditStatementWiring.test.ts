/**
 * Query.playerCreditStatement is reachable: the schema declares it with its
 * arguments and types, the players resolver map delegates to
 * resolvePlayerCreditStatement, and probe:admin-authz's line regex sees the
 * field (memory gw-probe-regex-docstring-trap). No database.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/players/__tests__/playerCreditStatementWiring.test.ts
 */
import { describe, it, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSchema, type GraphQLObjectType } from 'graphql'
import { typeDefs } from '@src/types/graphql.js'
import { playersQueryResolvers } from '@src/domains/players/resolvers/queries.js'
import { CreditStatementRepo } from '@src/repos/players/creditStatementRepo.js'

afterEach(() => {
  mock.restoreAll()
})

describe('Query.playerCreditStatement wiring', () => {
  it('the schema declares the field, its arguments and the statement types', () => {
    const schema = buildSchema(typeDefs)
    const field = schema.getQueryType()!.getFields().playerCreditStatement
    assert.ok(field, 'Query.playerCreditStatement is missing')
    assert.deepEqual(field.args.map((a) => `${a.name}:${String(a.type)}`), ['playerId:ID!', 'dateFrom:String!', 'dateTo:String!', 'limit:Int', 'offset:Int'])
    assert.equal(String(field.type), 'PlayerCreditStatement')
    const row = schema.getType('CreditStatementRow') as GraphQLObjectType
    assert.deepEqual(Object.keys(row.getFields()).sort(), ['affectsBalance', 'amount', 'balanceAfter', 'details', 'domain', 'id', 'occurredAt', 'reference', 'type', 'valueAfter', 'valueBefore'])
    const statement = schema.getType('PlayerCreditStatement') as GraphQLObjectType
    assert.deepEqual(Object.keys(statement.getFields()).sort(), ['closingBalance', 'dateFrom', 'dateTo', 'limit', 'offset', 'openingBalance', 'playerId', 'playerType', 'rows', 'summary', 'totalRows', 'totals'])
  })

  it('the players resolver map delegates to the statement resolver (its permission gate answers first)', async () => {
    let timezoneReads = 0
    mock.method(CreditStatementRepo.prototype as any, 'getTimezone', async () => { timezoneReads++; return 'Asia/Kolkata' })
    const resolver = (playersQueryResolvers as any).playerCreditStatement
    assert.equal(typeof resolver, 'function')
    await assert.rejects(
      () => resolver(null, { playerId: '1', dateFrom: '2026-10-01', dateTo: '2026-10-02' }, { tenant: 't', user: { sub: '7', type: 'admin', roles: [] }, permissions: [] }),
      /Forbidden: insufficient permissions for players.credit:view/,
    )
    assert.equal(timezoneReads, 0)
  })

  it('is visible to probe:admin-authz, which finds Query fields with a line regex', () => {
    // Copied from parseFields in scripts/probeAdminAuthz.ts; keep the two in step.
    const src = readFileSync(join(process.cwd(), 'src', 'types', 'operations', 'queries.graphql'), 'utf8')
    const re = /^ {2}([a-zA-Z][A-Za-z0-9_]*)\s*(\(([\s\S]*?)\))?\s*:\s*[A-Za-z[]/gm
    const names: string[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) names.push(m[1])
    assert.ok(names.includes('playerCreditStatement'), 'probe:admin-authz cannot see Query.playerCreditStatement')
    assert.ok(names.includes('playerCreditTransactions'), 'the field before it is still seen')
  })
})
