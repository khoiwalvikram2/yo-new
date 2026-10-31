import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildSchema, graphql } from 'graphql'
import { isRequestedField } from '../requestedFields.js'

describe('Overview profile selection', () => {
  const schema = buildSchema('type Query { overview: Overview! } type Overview { profile: Profile kpis: Kpis } type Profile { id: ID } type Kpis { profile: String ggr: Float }')
  for (const [label, source, expected] of [
    ['stats only', '{ overview { kpis { ggr } } }', false],
    ['nested same name is not the profile', '{ overview { kpis { profile } } }', false],
    ['aliased profile', '{ overview { account:profile { id } } }', true],
    ['named/inline fragments', '{ overview { ...Stats ... on Overview { ...Details } } } fragment Stats on Overview { kpis { ggr } } fragment Details on Overview { profile { id } }', true],
    ['merged root field selections', '{ overview { kpis { ggr } } overview { profile { id } } }', true],
  ] as const) {
    it(label, async () => {
      let selected: boolean | undefined
      const result = await graphql({ schema, source, rootValue: { overview: (_args: unknown, _ctx: unknown, info: any) => {
        selected = isRequestedField(info, 'profile')
        return { profile: { id: '1' }, kpis: { ggr: 20 } }
      } } })
      assert.equal(result.errors, undefined)
      assert.equal(selected, expected)
    })
  }
})
