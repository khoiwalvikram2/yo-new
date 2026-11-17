/**
 * Query.depositRequestProof is on the audited surface like the deposit list it serves (owner decision 2026-11-04:
 * deposit screenshots are base64 in the database; a list row carries only hasProof).
 * - The schema serves depositRequestProof(id: ID!): String, and DepositRequest.hasProof: Boolean!.
 * - probe:admin-authz sees the field with its line regex (memory gw-probe-regex-docstring-trap) and executes it:
 *   its name matches none of the patterns the probe declines to run.
 * - audit:admin counts its gate (requireDepositRequestsRead) as enforcement, and validatePermissionMap maps it to
 *   payments.deposits:view, the list's permission.
 * - A caller without that permission, or with no session, is refused before anything is read, with a message the
 *   probe reads as a refusal.
 *
 * Unit, no database.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/deposits/__tests__/depositProofSurface.test.ts
 */
import { after, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSchema, GraphQLNonNull, GraphQLObjectType } from 'graphql'
import { typeDefs } from '@src/types/graphql.js'
import { db, pool } from '@src/db/client.js'
import { depositsQueryResolvers } from '../resolvers/queries.js'

after(async () => {
  mock.restoreAll()
  await pool.end().catch(() => {})
})

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8')

describe('the depositRequestProof schema', () => {
  const schema = buildSchema(typeDefs)

  it('answers one request id with a nullable string', () => {
    const field = schema.getQueryType()!.getFields().depositRequestProof
    assert.ok(field, 'Query.depositRequestProof is not in the schema')
    assert.deepEqual(field.args.map((a) => `${a.name}: ${String(a.type)}`), ['id: ID!'])
    assert.equal(String(field.type), 'String')
  })

  it('gives every DepositRequest a non-null hasProof, and keeps proofUrl for old documents', () => {
    const type = schema.getType('DepositRequest') as GraphQLObjectType
    const hasProof = type.getFields().hasProof
    assert.ok(hasProof && hasProof.type instanceof GraphQLNonNull, 'DepositRequest.hasProof must be Boolean!')
    assert.equal(String(hasProof.type), 'Boolean!')
    assert.equal(String(type.getFields().proofUrl?.type), 'String')
  })
})

describe('the audits see it', () => {
  it('probe:admin-authz finds it with its line regex, and runs it (no side-effect pattern matches)', () => {
    // Copied from parseFields and EXTERNALLY_EFFECTFUL in scripts/probeAdminAuthz.ts; keep them in step.
    const re = /^ {2}([a-zA-Z][A-Za-z0-9_]*)\s*(\(([\s\S]*?)\))?\s*:\s*[A-Za-z[]/gm
    const src = read('src', 'types', 'operations', 'queries.graphql')
    const fields = new Map<string, string>()
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) fields.set(m[1], m[3] ?? '')
    assert.equal(fields.get('depositRequestProof'), 'id: ID!', 'probe:admin-authz cannot see Query.depositRequestProof')
    assert.ok(fields.has('adminDepositRequests') && fields.has('whitelabelPaymentMethods'), 'its comment line swallowed a neighbour')
    const effectful = [
      /otp|sms|email|mail|notify|notification|webhook|push/i,
      /payout|withdraw|refund|settle|approve|reject|capture|charge|transfer/i,
      /provider|gateway|ingest|sync|import|seed|migrate|backfill|reconcile/i,
      /delete|purge|reset|truncate|rollback|void|cancel/i,
      /login|logout|password|token|impersonate/i,
    ]
    assert.ok(!effectful.some((p) => p.test('depositRequestProof')), 'the probe would never execute it')
  })

  it('audit:admin counts its gate as enforcement, and the resolver goes through that gate', () => {
    assert.match(read('scripts', 'auditAdminSurface.ts'), /'requireDepositRequestsRead\('/)
    const src = read('src', 'domains', 'deposits', 'resolvers', 'queries.ts')
    const start = src.indexOf('  depositRequestProof: async')
    assert.ok(start > 0, 'depositRequestProof is not a two-space key of the Query map')
    const body = src.slice(start, src.indexOf('\n  whitelabelPaymentMethods:', start))
    assert.match(body, /await requireDepositRequestsRead\(ctx\)/)
    // The same tenant as the list: director mode first, then the session's tenant.
    assert.match(body, /getEffectiveTenantForDirector\(ctx\)[\s\S]*ctx\?\.tenant \?\? ctx\?\.whitelabel\?\.id \?\? 'default'/)
  })

  it('validatePermissionMap maps it to the deposit list permission', () => {
    assert.match(read('scripts', 'validatePermissionMap.ts'), /^ {2}depositRequestProof: \['payments\.deposits', 'view'\],$/m)
  })
})

describe('depositRequestProof refuses before reading', () => {
  const REFUSAL = /forbidden|insufficient permission|unauthorized|not permitted|access denied|only a super admin|permission/i

  it('a caller without payments.deposits:view, or with no session at all, gets no proof and no read', async () => {
    const select = mock.method(db, 'select', () => {
      throw new Error('read before the permission check')
    })
    const callers = [
      { tenant: 'vfyog2-brand', whitelabel: { id: 'vfyog2-brand' }, user: { sub: '987001', type: 'admin', roles: [] }, permissions: [] },
      { tenant: 'vfyog2-brand', whitelabel: { id: 'vfyog2-brand' }, user: { sub: '987001', type: 'admin', roles: [] }, permissions: [{ domain: 'payments.withdrawals', actions: ['view'] }] },
      { tenant: 'vfyog2-brand', whitelabel: { id: 'vfyog2-brand' } },
    ]
    for (const ctx of callers) {
      await assert.rejects(
        depositsQueryResolvers.depositRequestProof(null, { id: '1' }, ctx),
        (error: Error) => /^Forbidden: insufficient permissions for deposit requests$/.test(error.message) && REFUSAL.test(error.message),
      )
    }
    assert.equal(select.mock.callCount(), 0)
    select.mock.restore()
  })
})
