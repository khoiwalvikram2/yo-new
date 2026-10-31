/**
 * Every write tool must send arguments the mutation will actually accept.
 *
 * This is not hypothetical. The first version of these tools invented its own
 * parameter names and passed them flat, while most of these mutations take a
 * single `input` object — eight of ten would have thrown the moment an operator
 * confirmed them. The lifecycle tests missed it because they stubbed `execute`,
 * so the one thing that was broken was the one thing never exercised.
 *
 * The check here compares each tool against the live GraphQL schema, so a
 * renamed input field breaks a test rather than a confirmation.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSchema,
  isInputObjectType,
  isNonNullType,
  isListType,
  type GraphQLInputObjectType,
  type GraphQLNamedType,
} from 'graphql'
import { typeDefs } from '@src/schema.js'
import { listTools } from '../tools/registry.js'
import { ALLOWED_QUERIES, ALLOWED_MUTATIONS } from '../tools/resolverBridge.js'
import type { WriteTool } from '../tools/types.js'

const schema = buildSchema(typeDefs)
const mutationFields = schema.getMutationType()!.getFields()
const queryFields = schema.getQueryType()!.getFields()

const unwrap = (type: any): GraphQLNamedType =>
  isNonNullType(type) || isListType(type) ? unwrap(type.ofType) : type

/** A payload shaped like the model would produce, filled from the tool's own schema. */
function sampleArgs(tool: WriteTool): Record<string, unknown> {
  const properties = (tool.parameters as any).properties ?? {}
  const sample: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries<any>(properties)) {
    sample[key] =
      spec.type === 'number' ? 1
      : spec.type === 'boolean' ? true
      : spec.type === 'array' ? ['x']
      : spec.type === 'object' ? { k: 1 }
      : 'x'
  }
  return sample
}

const writeTools = listTools().filter((t): t is WriteTool => t.kind === 'write')

describe('write tool argument contracts', () => {
  it('finds write tools to check', () => {
    assert.ok(writeTools.length > 0)
  })

  for (const tool of writeTools) {
    describe(tool.name, () => {
      it('names a mutation that exists', () => {
        assert.ok(mutationFields[tool.mutation], `${tool.mutation} is not in the schema`)
      })

      it('sends only arguments the mutation declares', () => {
        const field = mutationFields[tool.mutation]
        const shaped = tool.buildArgs(sampleArgs(tool))
        const declared = field.args.map((a) => a.name)
        const unknown = Object.keys(shaped).filter((k) => !declared.includes(k))
        assert.deepEqual(unknown, [], `sends arguments the mutation does not accept`)
      })

      it('supplies every required argument', () => {
        const field = mutationFields[tool.mutation]
        const shaped = tool.buildArgs(sampleArgs(tool))
        const missing = field.args
          .filter((a) => isNonNullType(a.type) && !(a.name in shaped))
          .map((a) => a.name)
        assert.deepEqual(missing, [], `omits required arguments`)
      })

      it('fills the input object correctly when the mutation takes one', () => {
        const field = mutationFields[tool.mutation]
        const inputArg = field.args.find((a) => a.name === 'input')
        if (!inputArg) return

        const inputType = unwrap(inputArg.type)
        assert.ok(isInputObjectType(inputType))
        const inputFields = (inputType as GraphQLInputObjectType).getFields()

        const shaped = tool.buildArgs(sampleArgs(tool)) as { input?: Record<string, unknown> }
        assert.ok(shaped.input, 'must wrap its arguments in `input`')

        const unknown = Object.keys(shaped.input).filter((k) => !(k in inputFields))
        assert.deepEqual(unknown, [], 'input carries fields the type does not define')

        const missing = Object.values(inputFields)
          .filter((f) => isNonNullType(f.type))
          .map((f) => f.name)
          .filter((name) => !(name in shaped.input!))
        assert.deepEqual(missing, [], 'input omits fields the type requires')
      })

      it('marks as required every argument the mutation cannot do without', () => {
        const field = mutationFields[tool.mutation]
        if (field.args.some((a) => a.name === 'input')) return // covered by the input check above

        const required: string[] = ((tool.parameters as any).required ?? []) as string[]
        for (const arg of field.args.filter((a) => isNonNullType(a.type))) {
          assert.ok(
            required.includes(arg.name),
            `${arg.name} is required by the mutation but optional in the tool schema, so the model may omit it`
          )
        }
      })

      it('declares the permission a caller must hold', () => {
        // Most of these mutations perform no permission check of their own — a
        // platform-wide gap that predates the assistant. Without a gate here,
        // asking the assistant would be an easier route to a change than the
        // screen that normally guards it.
        assert.ok(tool.requiredPermission, `${tool.name} declares no required permission`)
        assert.ok(tool.requiredPermission.domain, `${tool.name} permission needs a domain`)
        assert.ok(tool.requiredPermission.action, `${tool.name} permission needs an action`)
      })
    })
  }
})

describe('read tool contracts', () => {
  it('every allowlisted query exists in the schema', () => {
    // Read tools hold their resolver name in a closure, so this checks the
    // allowlist instead — the same guarantee, one level up.
    const missing = [...ALLOWED_QUERIES].filter((name) => !queryFields[name])
    assert.deepEqual(missing, [], 'allowlisted queries must exist in the schema')
  })

  it('every allowlisted mutation exists in the schema', () => {
    const missing = [...ALLOWED_MUTATIONS].filter((name) => !mutationFields[name])
    assert.deepEqual(missing, [], 'allowlisted mutations must exist in the schema')
  })
})
