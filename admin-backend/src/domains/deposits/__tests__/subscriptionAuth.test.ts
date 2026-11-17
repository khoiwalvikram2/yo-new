/**
 * Who may open a GraphQL subscription, and whose data they get.
 *
 * This closes a verified hole rather than guarding a hypothetical one. Before
 * these two properties held, a WebSocket opened with no Authorization header
 * received `connection_ack` and was accepted onto any whitelabel's topic:
 *
 *   - mercurius does not run the app-level `context` function for WebSockets.
 *     It builds `{ app, pubsub, request }` and nothing else, so `ctx.user`,
 *     `ctx.crmUser` and `ctx.tenant` were undefined on every subscribe;
 *   - `guardAdminSurface` could not compensate. It is applied to Query and
 *     Mutation only, and subscription resolvers are `{subscribe, resolve}`
 *     objects rather than functions, so it would be a no-op on them anyway;
 *   - `depositRequestUpdated` then preferred `args.tenant`, a plain caller
 *     argument, over the context. Naming another whitelabel returned its live
 *     deposit feed, which the resolver enriches with the player's name, email
 *     and phone and their payment-proof image.
 *
 * Both halves are asserted: the resolver's own behaviour, and the wiring in
 * `index.ts` that authenticates the socket — the latter read from source in the
 * same spirit as `rgEnforcementWiring.test.ts`, because a bootstrap that is
 * only exercised by booting a server is a bootstrap nothing checks.
 *
 * No database required.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('the deposit subscription takes its tenant from the session', () => {
  it('ignores a tenant named in the subscription arguments', async () => {
    const { depositsSubscriptionResolvers } = await import(
      '@src/domains/deposits/resolvers/subscriptions.js'
    )

    const subscribed: string[] = []
    const ctx = {
      tenant: 'brand-a',
      whitelabel: { id: 'brand-a' },
      user: { sub: '1', roles: [] },
      pubsub: {
        subscribe: async (topic: string) => {
          subscribed.push(topic)
          return { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }) }
        },
      },
    }

    await depositsSubscriptionResolvers.depositRequestUpdated.subscribe(
      null,
      { tenant: 'brand-b' },
      ctx as never
    )

    assert.deepEqual(
      subscribed,
      ['DEPOSIT_REQUEST_brand-a'],
      'the argument decided the topic instead of the session'
    )
  })

  it('falls back to the whitelabel on the context, never to the argument', async () => {
    const { depositsSubscriptionResolvers } = await import(
      '@src/domains/deposits/resolvers/subscriptions.js'
    )
    const subscribed: string[] = []
    const ctx = {
      whitelabel: { id: 'brand-c' },
      user: { sub: '1', roles: [] },
      pubsub: {
        subscribe: async (topic: string) => {
          subscribed.push(topic)
          return { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }) }
        },
      },
    }
    await depositsSubscriptionResolvers.depositRequestUpdated.subscribe(
      null,
      { tenant: 'brand-b' },
      ctx as never
    )
    assert.deepEqual(subscribed, ['DEPOSIT_REQUEST_brand-c'])
  })
})

describe('the WebSocket is authenticated at all', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'index.ts'), 'utf8')

  it('registers an onConnect for subscriptions', () => {
    // Without this mercurius accepts every socket and runs no context function.
    assert.match(
      source,
      /subscription:\s*\{[\s\S]*?onConnect:/,
      'the subscription block no longer authenticates the connection'
    )
  })

  it('refuses a connection that names no admin principal', () => {
    assert.match(
      source,
      /if \(!ctx\.user\) \{[\s\S]*?throw new Error\('Unauthorized/,
      'onConnect no longer refuses an unauthenticated or CRM socket'
    )
  })

  it('reads the token from the nested headers the admin client sends', async () => {
    // The admin client's connectionParams are `{ headers: { authorization, … } }`.
    // Reading only top-level strings refused every real socket as unauthenticated.
    const { connectionInitHeaders } = await import('@src/domains/common/guardSubscriptions.js')
    assert.deepEqual(
      connectionInitHeaders({ headers: { authorization: 'Bearer t', 'X-Whitelabel-ID': 'wl-1' } }),
      { authorization: 'Bearer t', 'x-whitelabel-id': 'wl-1' },
    )
    assert.deepEqual(connectionInitHeaders({ Authorization: 'Bearer flat' }), { authorization: 'Bearer flat' })
    assert.deepEqual(
      connectionInitHeaders({ authorization: 'Bearer flat', headers: { authorization: 'Bearer nested' } }),
      { authorization: 'Bearer nested' },
    )
    assert.deepEqual(connectionInitHeaders(undefined), {})
    assert.match(source, /onConnect:[\s\S]*?connectionInitHeaders\(data\?\.payload\)/, 'onConnect no longer reads the nested headers')
  })

  it('builds the subscription context with the same builder as HTTP', () => {
    // Two builders would drift, and the half that drifted would be the one
    // deciding which tenant's topic a socket may join.
    const uses = source.match(/buildGraphqlContext\(/g) ?? []
    assert.ok(
      uses.length >= 3,
      `expected the shared context builder on the HTTP and both WebSocket paths, found ${uses.length}`
    )
  })
})
