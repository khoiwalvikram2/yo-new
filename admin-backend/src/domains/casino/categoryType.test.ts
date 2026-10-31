import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { parse } from 'graphql'
import { toCasinoCategoryDbType, toCasinoCategoryType, type CasinoCategoryType } from './categoryType.js'

describe('Casino category type contract', () => {
  const types: CasinoCategoryType[] = ['GENERAL', 'TOP', 'FEATURED', 'LOUNGE']

  it('round-trips Casino lounge and existing category types for create, update and queries', () => {
    for (const type of types) {
      assert.equal(toCasinoCategoryType(toCasinoCategoryDbType(type)), type)
    }
    assert.equal(toCasinoCategoryDbType('LOUNGE'), 'lounge')
  })

  it('keeps the existing general default when create omits the category type', () => {
    assert.equal(toCasinoCategoryDbType(undefined), 'general')
    assert.equal(toCasinoCategoryDbType(null), 'general')
    assert.equal(toCasinoCategoryType(null), 'GENERAL')
  })

  it('accepts the same category types in the GraphQL create and update contract', () => {
    const schema = parse(readFileSync(new URL('../../types/domains/casino/casino.graphql', import.meta.url), 'utf8'))
    const type = schema.definitions.find(definition => definition.kind === 'EnumTypeDefinition' && definition.name.value === 'CasinoCategoryType')
    assert.ok(type?.kind === 'EnumTypeDefinition')
    assert.deepEqual(type.values?.map(value => value.name.value), types)
    for (const name of ['CreateCasinoCategoryInput', 'UpdateCasinoCategoryInput']) {
      const input = schema.definitions.find(definition => definition.kind === 'InputObjectTypeDefinition' && definition.name.value === name)
      assert.ok(input?.kind === 'InputObjectTypeDefinition')
      const field = input.fields?.find(value => value.name.value === 'type')
      assert.ok(field?.type.kind === 'NamedType')
      assert.equal(field.type.name.value, 'CasinoCategoryType')
    }
  })
})
