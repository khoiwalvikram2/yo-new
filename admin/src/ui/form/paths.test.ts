import assert from 'node:assert/strict'
import { describe, expectTypeOf, test } from 'vitest'
import {
  deepClone,
  deepEqual,
  getAtPath,
  pathIntersects,
  setAtPath,
  splitPath,
} from './paths'
import type { Path, PathValue } from './paths'

interface ExampleValues {
  title: string
  settings: {
    enabled: boolean
    nested?: { limit: number }
  }
  tiers: Array<{ name: string; amount: number }>
}

type UnionValues =
  | { kind: 'amount'; config: { amount: number }; rows: Array<{ cents: number }> }
  | { kind: 'code'; config: { code: string }; rows: Array<{ label: string }> }

function assertRejectedPathTypes(values: ExampleValues): void {
  // @ts-expect-error unsafe segments are not valid typed paths
  getAtPath(values, 'settings.__proto__')
  // @ts-expect-error an amount cannot be replaced with text
  setAtPath(values, 'tiers.0.amount', '100')
}

void assertRejectedPathTypes

describe('form paths', () => {
  test('types object and numeric array paths through to their values', () => {
    expectTypeOf<'settings.enabled'>().toMatchTypeOf<Path<ExampleValues>>()
    expectTypeOf<'tiers.0.amount'>().toMatchTypeOf<Path<ExampleValues>>()
    expectTypeOf<PathValue<ExampleValues, 'tiers.0.amount'>>().toEqualTypeOf<number>()
  })

  test('distributes paths and resolved values across discriminated unions', () => {
    expectTypeOf<'config.amount'>().toMatchTypeOf<Path<UnionValues>>()
    expectTypeOf<'config.code'>().toMatchTypeOf<Path<UnionValues>>()
    expectTypeOf<'rows.0.cents'>().toMatchTypeOf<Path<UnionValues>>()
    expectTypeOf<'rows.0.label'>().toMatchTypeOf<Path<UnionValues>>()
    expectTypeOf<PathValue<UnionValues, 'config.amount'>>().toEqualTypeOf<number>()
    expectTypeOf<PathValue<UnionValues, 'config.code'>>().toEqualTypeOf<string>()
    expectTypeOf<PathValue<UnionValues, 'config.amount' | 'config.code'>>().toEqualTypeOf<number | string>()
  })

  test('reads own nested properties without walking the prototype chain', () => {
    const inherited = { inherited: 'blocked' }
    const values = Object.assign(Object.create(inherited) as { own: { value: number } }, {
      own: { value: 4 },
    })

    assert.equal(getAtPath(values, 'own.value'), 4)
    assert.equal(getAtPath(values, 'inherited' as Path<typeof values>), undefined)
  })

  test('updates nested objects and arrays without mutating any source container', () => {
    const values: ExampleValues = {
      title: 'Welcome',
      settings: { enabled: true, nested: { limit: 2 } },
      tiers: [
        { name: 'Bronze', amount: 100 },
        { name: 'Gold', amount: 500 },
      ],
    }

    const next = setAtPath(values, 'tiers.1.amount', 750)
    assert.equal(next.tiers[1]?.amount, 750)
    assert.equal(values.tiers[1]?.amount, 500)
    assert.notEqual(next, values)
    assert.notEqual(next.tiers, values.tiers)
    assert.notEqual(next.tiers[1], values.tiers[1])
    assert.equal(next.tiers[0], values.tiers[0])
    assert.equal(next.settings, values.settings)
  })

  test('creates missing optional object containers', () => {
    const values: ExampleValues = {
      title: 'Welcome',
      settings: { enabled: true },
      tiers: [],
    }
    const next = setAtPath(values, 'settings.nested.limit', 8)
    assert.equal(next.settings.nested?.limit, 8)
    assert.equal(values.settings.nested, undefined)
  })

  test('rejects malformed and prototype-polluting paths at runtime', () => {
    const values = { profile: { name: 'A' } }
    for (const path of ['', 'profile..name', '__proto__.polluted', 'profile.constructor.x', 'prototype.x']) {
      assert.throws(
        () => setAtPath(values, path as Path<typeof values>, true as never),
        /form path|Unsafe form path segment/,
      )
    }
    assert.equal(({} as { polluted?: boolean }).polluted, undefined)
    assert.throws(() => splitPath('profile.__proto__.x'), /Unsafe form path segment/)
  })

  test('identifies exact, ancestor and descendant scopes without matching siblings', () => {
    assert.equal(pathIntersects('tiers', 'tiers.0.amount'), true)
    assert.equal(pathIntersects('tiers.0', 'tiers.0.amount'), true)
    assert.equal(pathIntersects('tiers.0.name', 'tiers.0.amount'), false)
    assert.equal(pathIntersects('tier', 'tiers.0'), false)
  })

  test('deep-clones reset baselines and compares nested values structurally', () => {
    const source = {
      when: new Date('2026-10-03T00:00:00.000Z'),
      tiers: [{ amount: 100 }],
    }
    const copy = deepClone(source)

    assert.notEqual(copy, source)
    assert.notEqual(copy.tiers, source.tiers)
    assert.notEqual(copy.when, source.when)
    assert.equal(deepEqual(copy, source), true)
    copy.tiers[0]!.amount = 200
    assert.equal(source.tiers[0]?.amount, 100)
    assert.equal(deepEqual(copy, source), false)
  })
})
