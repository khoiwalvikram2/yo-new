/**
 * The assistant's safety rests on three properties of the tool layer:
 *
 *   - every tool it can name maps to a resolver that exists, so a call cannot
 *     fail halfway through a turn on a typo in an allowlist;
 *   - a write tool describes a change without performing one;
 *   - nothing outside the allowlists is reachable, whatever the model asks for.
 *
 * These are checked here rather than through a live model, which would make the
 * suite depend on an API key and a credit balance.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getTool, listTools, openAiToolDefinitions, isWriteTool } from '../tools/registry.js'
import { ALLOWED_QUERIES, ALLOWED_MUTATIONS, ResolverNotAllowedError, callQuery, callMutation, truncateForModel } from '../tools/resolverBridge.js'
import { domainResolvers } from '@src/domains/index.js'

describe('tool registry', () => {
  it('registers both read and write tools', () => {
    const tools = listTools()
    assert.ok(tools.length > 0)
    assert.ok(tools.some((t) => t.kind === 'read'), 'reads exist')
    assert.ok(tools.some((t) => t.kind === 'write'), 'writes exist')
  })

  it('gives every tool a unique name', () => {
    const names = listTools().map((t) => t.name)
    assert.equal(new Set(names).size, names.length)
  })

  it('emits OpenAI definitions that are structurally complete', () => {
    for (const def of openAiToolDefinitions()) {
      assert.equal(def.type, 'function')
      assert.ok(def.function.name, 'name')
      assert.ok(def.function.description.length > 10, `${def.function.name} needs a usable description`)
      assert.equal((def.function.parameters as any).type, 'object')
    }
  })

  it('describes every tool, so the model can pick between them', () => {
    for (const tool of listTools()) {
      assert.ok(tool.description.length > 10, `${tool.name} has no meaningful description`)
    }
  })
})

describe('resolver allowlists', () => {
  it('names only queries that actually exist', () => {
    const missing = [...ALLOWED_QUERIES].filter(
      (name) => typeof (domainResolvers.Query as Record<string, unknown>)[name] !== 'function'
    )
    assert.deepEqual(missing, [], 'an allowlisted query with no resolver fails at runtime, not at boot')
  })

  it('names only mutations that actually exist', () => {
    const missing = [...ALLOWED_MUTATIONS].filter(
      (name) => typeof (domainResolvers.Mutation as Record<string, unknown>)[name] !== 'function'
    )
    assert.deepEqual(missing, [])
  })

  it('excludes anything that moves money directly', () => {
    // These belong to a different risk class than changing a limit and are
    // deliberately outside the assistant's reach.
    const forbidden = [
      'adjustPlayerCredit',
      'adjustAgentCredit',
      'postSettlement',
      'payoutJackpot',
      'approveWithdrawal',
      'approveDepositRequest',
      'transferCredit',
    ]
    for (const name of forbidden) {
      assert.ok(!ALLOWED_MUTATIONS.has(name), `${name} must not be reachable by the assistant`)
    }
  })

  it('refuses a query outside the allowlist', async () => {
    await assert.rejects(
      () => callQuery('someQueryNobodyAllowed', {}, {}),
      (err: Error) => err instanceof ResolverNotAllowedError
    )
  })

  it('refuses a mutation outside the allowlist', async () => {
    await assert.rejects(
      () => callMutation('deleteEverything', {}, {}),
      (err: Error) => err instanceof ResolverNotAllowedError
    )
  })

  it('refuses an allowlisted-looking name that is really a money mutation', async () => {
    await assert.rejects(
      () => callMutation('adjustPlayerCredit', { userId: 1, amount: 1e9 }, {}),
      (err: Error) => err instanceof ResolverNotAllowedError
    )
  })
})

describe('write tools', () => {
  it('propose a change without performing it', async () => {
    const tool = getTool('set_limit')
    assert.ok(tool && isWriteTool(tool))

    // A context that throws if touched: proposing must not reach a resolver.
    const hostileCtx = new Proxy(
      {},
      {
        get() {
          throw new Error('propose() must not touch the request context')
        },
      }
    )

    // Parameter names come from the mutation's own input type, not invention;
    // toolSchemaContract.test.ts is what keeps them honest.
    const args = { scope: 'whitelabel', scopeId: 'wl-1', maxStake: 100, maxPayout: 50_000, currency: 'INR' }
    const proposal = await tool.propose(args, hostileCtx)
    assert.match(proposal.summary, /whitelabel/i)
    assert.match(proposal.summary, /100/)
    assert.match(proposal.summary, /50000|50,000/)
    assert.deepEqual(proposal.args, args)
  })

  it('produce a summary an operator can judge without reading JSON', async () => {
    for (const tool of listTools().filter(isWriteTool)) {
      // A payload built from each tool's own declared parameters, so the
      // summary is exercised with the fields it actually receives.
      const properties: Record<string, any> = (tool.parameters as any).properties ?? {}
      const args: Record<string, unknown> = {}
      for (const [key, spec] of Object.entries(properties)) {
        args[key] =
          spec.type === 'number' ? 1
          : spec.type === 'boolean' ? true
          : spec.type === 'array' ? ['x']
          : spec.type === 'object' ? { sample: 1 }
          : `${key}-value`
      }
      const proposal = await tool.propose(args, {})
      assert.ok(proposal.summary.length > 15, `${tool.name} produced too thin a summary`)
      assert.ok(!proposal.summary.includes('undefined'), `${tool.name} summary leaked "undefined"`)
    }
  })
})

describe('truncateForModel', () => {
  it('passes small results through untouched', () => {
    const value = { total: 3, items: [1, 2, 3] }
    assert.deepEqual(truncateForModel(value), { data: value })
  })

  it('caps a long array and says so', () => {
    const result = truncateForModel(Array.from({ length: 500 }, (_, i) => i), 40)
    assert.equal((result.data as unknown[]).length, 40)
    assert.match(result.note ?? '', /first 40 of 500/)
  })

  it('caps a long nested collection while keeping its siblings', () => {
    const result = truncateForModel({ total: 900, items: Array.from({ length: 900 }, (_, i) => i) }, 40)
    const data = result.data as { total: number; items: unknown[] }
    assert.equal(data.total, 900, 'the real total must survive so the answer stays correct')
    assert.equal(data.items.length, 40)
    assert.match(result.note ?? '', /900 items/)
  })
})
