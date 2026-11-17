/**
 * A database error never reaches a GraphQL caller as SQL (MAT-09, defense in depth).
 *
 * Measured before: mercurius had no errorFormatter, so a resolver that let a driver error through returned
 * "Failed query: insert into "matkas" (...) values (...) params: <tenant>,<creator id>,<settings JSON>" to the
 * browser. The formatter masks database detail and leaves every message thrown on purpose alone, including one whose
 * cause is a driver error. Exercised through a real mercurius instance with the same option index.ts passes.
 * No database.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/common/__tests__/graphqlErrorMasking.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Fastify from 'fastify'
import mercurius from 'mercurius'
import { GraphQLError } from 'graphql'
import { DrizzleQueryError } from 'drizzle-orm'
import {
  DATABASE_ERROR_MESSAGE,
  exposesDatabaseDetail,
  maskDatabaseErrors,
} from '@src/domains/common/graphqlErrorMasking.js'

/** What node-postgres throws: a SQLSTATE code and a severity, with schema names in the message. */
const pgError = (message: string, code = '23505') =>
  Object.assign(new Error(message), { code, severity: 'ERROR', constraint: 'matkas_tenant_code_unique', routine: '_bt_check_unique' })
const SQL = 'insert into "matkas" ("id", "tenant", "name", "code") values ($1, $2, $3, $4)'
const drizzleError = () =>
  new DrizzleQueryError(SQL, ['m1', 'grandwinn-com', 'vfyho Market', 'vfyho-code'], pgError('duplicate key value violates unique constraint "matkas_tenant_code_unique"'))
/** matkaRepo's mapping: its own words, the driver error kept as the cause for the log. */
const friendly = () => Object.assign(new Error('A matka with this code already exists'), { cause: drizzleError() })
const asGraphQL = (error: Error) => new GraphQLError(error.message, { originalError: error, path: ['createMatka'] })

describe('which errors expose database detail', () => {
  it("masks drizzle's Failed query, the driver's own error, and a message quoting either", () => {
    assert.equal(exposesDatabaseDetail(asGraphQL(drizzleError())), true)
    assert.equal(exposesDatabaseDetail(asGraphQL(pgError('column "secret" does not exist', '42703'))), true)
    const wrapped = drizzleError()
    assert.equal(exposesDatabaseDetail(asGraphQL(new Error(`Failed to create matka: ${wrapped.message}`))), true)
    const driver = pgError('invalid input syntax for type integer: "abc"', '22P02')
    assert.equal(exposesDatabaseDetail(asGraphQL(Object.assign(new Error(`Save failed: ${driver.message}`), { cause: driver }))), true)
  })

  it('keeps every message thrown on purpose, a driver error as its cause included', () => {
    assert.equal(exposesDatabaseDetail(asGraphQL(friendly())), false)
    assert.equal(exposesDatabaseDetail(asGraphQL(new Error('Forbidden: insufficient permissions to view commission payouts'))), false)
    assert.equal(exposesDatabaseDetail(asGraphQL(new Error('Invalid registeredFrom date: not-a-date'))), false)
    // An application error code is not a SQLSTATE; without a severity it is not the driver's either.
    assert.equal(exposesDatabaseDetail(asGraphQL(Object.assign(new Error('Player not found'), { code: 'NOT_FOUND' }))), false)
    assert.equal(exposesDatabaseDetail(asGraphQL(Object.assign(new Error('Limit reached'), { code: '12345' }))), false)
    assert.equal(exposesDatabaseDetail(new GraphQLError('Cannot query field "x" on type "Query".')), false)
  })
})

describe('through mercurius, with the option index.ts registers', () => {
  async function serve() {
    // A logger of our own, so what the formatter logs can be read back.
    const logged: unknown[] = []
    const noop = () => {}
    const logger: any = {
      level: 'info',
      info: noop, warn: noop, debug: noop, trace: noop, fatal: noop, silent: noop,
      error: (obj: unknown, msg?: string) => { if (/masked for the caller/.test(String(msg))) logged.push(obj) },
      child: () => logger,
    }
    const app = Fastify({ loggerInstance: logger })
    await app.register(mercurius as any, {
      schema: 'type Query { leaky: String  driver: String  mapped: String  refused: String  fine: String }',
      resolvers: {
        Query: {
          leaky: () => { throw drizzleError() },
          driver: () => { throw pgError('null value in column "tenant" of relation "users" violates not-null constraint', '23502') },
          mapped: () => { throw friendly() },
          refused: () => { throw new Error('Forbidden: insufficient permissions to view settlements') },
          fine: () => 'ok',
        },
      },
      errorFormatter: maskDatabaseErrors,
    })
    return { app, logged }
  }

  it('answers the caller generically at the same path, keeps the rest of the data, and logs the original', async () => {
    const { app, logged } = await serve()
    try {
      const res = await app.inject({ method: 'POST', url: '/graphql', payload: { query: '{ leaky driver mapped refused fine }' } })
      assert.equal(res.statusCode, 200)
      const body = res.json() as { data: Record<string, unknown>; errors: Array<{ message: string; path: string[]; extensions?: Record<string, unknown> }> }
      assert.doesNotMatch(res.body, /Failed query|params:|insert into|grandwinn|violates|relation "users"/, 'database detail reached the caller')
      assert.equal(body.data.fine, 'ok')
      const byPath = Object.fromEntries(body.errors.map((e) => [e.path.join('.'), e]))
      assert.equal(byPath.leaky.message, DATABASE_ERROR_MESSAGE)
      assert.equal(byPath.leaky.extensions?.code, 'INTERNAL_SERVER_ERROR')
      assert.equal(byPath.driver.message, DATABASE_ERROR_MESSAGE)
      assert.equal(byPath.mapped.message, 'A matka with this code already exists')
      assert.equal(byPath.refused.message, 'Forbidden: insufficient permissions to view settlements')
      assert.equal(logged.length, 2, 'the two masked originals are logged for diagnosis')
      assert.match(String((logged[0] as any)?.err?.message ?? ''), /Failed query: insert into "matkas"|violates not-null/)
    } finally {
      await app.close()
    }
  })

  it('leaves a validation error and an all-clear response as mercurius makes them', async () => {
    const { app } = await serve()
    try {
      const bad = await app.inject({ method: 'POST', url: '/graphql', payload: { query: '{ nope }' } })
      assert.match(bad.body, /Cannot query field \\"nope\\" on type \\"Query\\"/)
      const ok = await app.inject({ method: 'POST', url: '/graphql', payload: { query: '{ fine }' } })
      assert.deepEqual(ok.json(), { data: { fine: 'ok' } })
    } finally {
      await app.close()
    }
  })

  it('is the errorFormatter the admin API registers', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'index.ts'), 'utf8')
    assert.match(src, /errorFormatter:\s*maskDatabaseErrors/)
  })
})
