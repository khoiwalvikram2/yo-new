/**
 * probe:admin-authz sees every root field the schema declares, the `extend type` ones included (T066, SCO-02).
 *
 * Measured before: the probe enumerated root fields from src/types/operations/*.graphql alone. Sixteen domain files
 * add Query and Mutation fields with `extend type`, about ninety in all, so neither of its passes ever called them:
 * the anonymous pass could not see myNotifications, notificationStats or myNotification, although it reported that
 * no Query answers without a session. scripts/schemaExtensionFields.ts reads those blocks with the probe's own line
 * regex; graphql's parser is the oracle here, so a docstring that hides a field (memory
 * gw-probe-regex-docstring-trap) fails this test instead of silently shrinking the probe. No database.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/common/__tests__/probeSchemaCoverage.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSchema, Kind, parse, print, type ObjectTypeExtensionNode } from 'graphql'
import { typeDefs } from '@src/types/graphql.js'
import { blockFields, extensionBlocks, extensionFields } from '../../../../scripts/schemaExtensionFields.js'

const SRC = join(process.cwd(), 'src')
const signature = (f: { name: string; args: Array<{ name: string; type: string }> }) =>
  `${f.name}(${f.args.map((a) => `${a.name}: ${a.type}`).join(', ')})`

function sdlFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) sdlFiles(p, out)
    else if (e.name.endsWith('.graphql')) out.push(p)
  }
  return out
}

/** What graphql itself reads from the same files: every extension field of the root, the namespace roots aside. */
function parsedExtensionFields(kind: 'Query' | 'Mutation'): string[] {
  const out: string[] = []
  for (const file of sdlFiles(join(SRC, 'types', 'domains'))) {
    for (const def of parse(readFileSync(file, 'utf8')).definitions) {
      if (def.kind !== Kind.OBJECT_TYPE_EXTENSION || def.name.value !== kind) continue
      for (const f of (def as ObjectTypeExtensionNode).fields ?? []) {
        if (f.name.value === 'agents') continue
        out.push(signature({ name: f.name.value, args: (f.arguments ?? []).map((a) => ({ name: a.name.value, type: print(a.type) })) }))
      }
    }
  }
  return out.sort()
}

describe('the extend-type root fields the probe enumerates', () => {
  for (const kind of ['Query', 'Mutation'] as const) {
    it(`sees every ${kind} field a domain file adds, with the argument types graphql reads`, () => {
      const seen = extensionFields(kind).map(signature).sort()
      assert.ok(seen.length > 20, `only ${seen.length} ${kind} extension fields found`)
      assert.deepEqual(seen, parsedExtensionFields(kind))
    })
  }

  it('includes the notification reads the anonymous pass could not see', () => {
    const queries = new Map(extensionFields('Query').map((f) => [f.name, signature(f)]))
    assert.equal(queries.get('myNotifications'), 'myNotifications(category: String, limit: Int, offset: Int, unreadOnly: Boolean)')
    assert.equal(queries.get('notificationStats'), 'notificationStats()')
    // Declared on one line: `extend type Query { myNotification(id: ID!, category: String): Notification }`.
    assert.equal(queries.get('myNotification'), 'myNotification(id: ID!, category: String)')
  })

  it('every field it reports is a root field of the schema the server builds', () => {
    const schema = buildSchema(typeDefs)
    for (const kind of ['Query', 'Mutation'] as const) {
      const root = kind === 'Query' ? schema.getQueryType()! : schema.getMutationType()!
      for (const f of extensionFields(kind)) assert.ok(root.getFields()[f.name], `${kind}.${f.name} is not in the schema`)
    }
  })

  it('reads one-line blocks and multi-line arguments, and passes over docstrings', () => {
    const sdl = [
      'extend type Query { single(id: ID!): Thing }',
      'extend type Query {',
      '  "A docstring: it names no field"',
      '  multi(',
      '    agentId: ID',
      '    limit: Int',
      '  ): [Thing!]!',
      '}',
      'extend type Mutation {',
      '  write(input: WriteInput!): Boolean!',
      '}',
    ].join('\n')
    assert.deepEqual(extensionBlocks(sdl, 'Query').flatMap(blockFields).map(signature), ['single(id: ID!)', 'multi(agentId: ID, limit: Int)'])
    assert.deepEqual(extensionBlocks(sdl, 'Mutation').flatMap(blockFields).map(signature), ['write(input: WriteInput!)'])
  })
})

describe('the probe and the unprobed audit use it', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), 'scripts', file), 'utf8')

  it('probe:admin-authz adds the extension fields to both passes', () => {
    assert.match(read('probeAdminAuthz.ts'), /extensionFields\(kind\)\.map\(/)
  })

  it('audit:unprobed reads the extension mutations the probe declines to run', () => {
    assert.match(read('auditUnprobedOperations.ts'), /extensionFields\('Mutation'\)/)
  })

  it("the probe's lists name real root fields", () => {
    const schema = buildSchema(typeDefs)
    const roots = new Set([...Object.keys(schema.getQueryType()!.getFields()), ...Object.keys(schema.getMutationType()!.getFields())])
    const src = read('probeAdminAuthz.ts')
    for (const list of ['KNOWN_UNGATED', 'ANONYMOUS_BY_DESIGN']) {
      const start = src.indexOf(`const ${list}`)
      const body = src.slice(src.indexOf('{', src.indexOf('=', start)) + 1, src.indexOf('\n}', start))
      const names = [...body.matchAll(/^ {2}([a-zA-Z][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1])
      // KNOWN_UNGATED is meant to empty out as the gates land (it did on 2026-11-03); empty, it must still be read
      // as the list itself and not run on into the next declaration.
      if (list === 'KNOWN_UNGATED') assert.ok(start >= 0 && !body.includes('const '), `${list} is unreadable`)
      else assert.ok(names.length > 0, `${list} is empty or unreadable`)
      for (const name of names) assert.ok(roots.has(name), `${list} names ${name}, which is not a root field`)
    }
  })

  it('the SCO-09 settlement reads are gated now, so neither list excuses them any more', () => {
    const src = read('probeAdminAuthz.ts')
    const listBody = (list: string) => {
      const start = src.indexOf(`const ${list}`)
      return src.slice(src.indexOf('{', src.indexOf('=', start)) + 1, src.indexOf('\n}', start))
    }
    const entries = (list: string) => [...listBody(list).matchAll(/^ {2}([a-zA-Z][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1])
    for (const name of ['agentSettlementTransactions', 'agentSettlementTransactionsPage', 'commissionCyclesForAgent', 'commissionCycleReadiness']) {
      assert.ok(!entries('KNOWN_UNGATED').includes(name), `${name} is still listed as KNOWN_UNGATED`)
    }
    assert.ok(!entries('OPEN_BY_DESIGN').includes('myWhitelabelSettlements'), 'myWhitelabelSettlements is still listed as open by design')
  })
})
