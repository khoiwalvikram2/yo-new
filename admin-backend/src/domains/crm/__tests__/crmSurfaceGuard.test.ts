/**
 * The admin panel and the CRM share one GraphQL endpoint, so both resolver maps
 * are reachable by either token. These assert the separation holds structurally
 * rather than resolver by resolver — the failure mode is a new admin field that
 * simply forgets to check, which no per-resolver test would ever catch.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { guardAdminSurface } from '../../crmSurfaceGuard.js'

const crmCtx = { crmUser: { id: 'u1', name: 'Agent', tenant: 't', status: 'ACTIVE' } }
const adminCtx = { user: { sub: '1', name: 'Root', roles: ['Super Admin'] } }

describe('the admin surface refuses CRM sessions', () => {
  it('throws for a CRM caller and says where to go instead', () => {
    const guarded = guardAdminSurface({ deletePlayer: () => 'ran' })
    assert.throws(() => guarded.deletePlayer(undefined, {}, crmCtx, {}), /Forbidden.*crm\* fields/)
  })

  it('leaves an admin caller alone', () => {
    const guarded = guardAdminSurface({ deletePlayer: () => 'ran' })
    assert.equal(guarded.deletePlayer(undefined, {}, adminCtx, {}), 'ran')
  })

  it('leaves an unauthenticated caller to the resolver, which has its own answer', () => {
    // The guard separates two principals; it is not the authentication check.
    const guarded = guardAdminSurface({ health: () => 'ok' })
    assert.equal(guarded.health(undefined, {}, {}, {}), 'ok')
  })

  it('does not guard the CRM fields themselves', () => {
    const guarded = guardAdminSurface({ crmPlayers: () => 'ran' })
    assert.equal(guarded.crmPlayers(undefined, {}, crmCtx, {}), 'ran')
  })

  it('lets Super Admin reach the CRM settings field from the admin panel', () => {
    // setCrmWhitelabelSettings is a crm* operation by name only — it is run by
    // Super Admin from the admin panel, not by a CRM session.
    const guarded = guardAdminSurface({ setCrmWhitelabelSettings: () => 'ran' })
    assert.equal(guarded.setCrmWhitelabelSettings(undefined, {}, adminCtx, {}), 'ran')
  })

  it('passes non-function entries through untouched', () => {
    const guarded = guardAdminSurface({ notAResolver: 42 as unknown as () => void })
    assert.equal(guarded.notAResolver, 42)
  })
})

describe('the real resolver map is guarded', () => {
  it('refuses a CRM caller on an admin field, and admits one on a crm field', async () => {
    const { domainResolvers } = await import('@src/domains/index.js')
    const Query = domainResolvers.Query as Record<string, any>

    const adminField = Object.keys(Query).find((k) => !k.startsWith('crm') && k !== 'health')
    assert.ok(adminField, 'expected the schema to have admin query fields')
    await assert.rejects(
      async () => Query[adminField](undefined, {}, crmCtx, {}),
      /Forbidden/,
      `${adminField} should refuse a CRM session`
    )

    // A crm* field is not blocked by the guard; it applies its own checks.
    await assert.rejects(
      async () => Query.crmUsers(undefined, {}, {}, {}),
      /Unauthorized|Forbidden/,
      'crmUsers should reach its own guard rather than the surface guard'
    )
  })

  it('guards every admin field, not a sample', async () => {
    const { domainResolvers } = await import('@src/domains/index.js')
    const unguarded: string[] = []
    for (const map of [domainResolvers.Query, domainResolvers.Mutation] as Record<string, any>[]) {
      for (const [name, fn] of Object.entries(map)) {
        if (typeof fn !== 'function') continue
        if (name.startsWith('crm') || name === 'setCrmWhitelabelSettings') continue
        try {
          await fn(undefined, {}, crmCtx, {})
          unguarded.push(name)
        } catch (e) {
          if (!/Forbidden/.test(String(e))) unguarded.push(`${name} (threw something else)`)
        }
      }
    }
    assert.deepEqual(unguarded, [], 'every admin field must refuse a CRM session')
  })
})

describe('the assistant cannot read player notes', () => {
  it('keeps playerNotes out of the allow-list', async () => {
    const bridge = await import('@src/domains/aiAssistant/tools/resolverBridge.js')
    const allowed = (bridge as Record<string, unknown>).ALLOWED_QUERIES as Set<string> | string[]
    const has = Array.isArray(allowed) ? allowed.includes('playerNotes') : allowed?.has?.('playerNotes')
    assert.equal(has, false, 'notes are the most sensitive free text in the system')
  })
})
