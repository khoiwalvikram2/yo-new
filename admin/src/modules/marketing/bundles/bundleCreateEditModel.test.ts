import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  BUNDLE_DOMAINS,
  EMPTY_BUNDLE_VALUES,
  buildBundleInput,
  bundleErrorToast,
  bundleFormValues,
  bundleSaveToast,
  bundleSchema,
  bundleSelectionToast,
  selectedBundleGameIds,
  type BundleFormValues,
} from './bundleCreateEditModel'

function firstErrors(values: BundleFormValues): Record<string, string> {
  const parsed = bundleSchema.safeParse(values)
  if (parsed.success) return {}
  return Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]))
}

describe('bundleCreateEditModel — values and validation', () => {
  test('the three legacy domains and create defaults stay exact', () => {
    assert.deepEqual([...BUNDLE_DOMAINS], ['casino', 'sports', 'matka'])
    assert.deepEqual(EMPTY_BUNDLE_VALUES, { name: '', description: '', domain: 'casino' })
    assert.deepEqual(bundleFormValues(), EMPTY_BUNDLE_VALUES)
  })

  test('a stored record maps to form values and selected string ids', () => {
    const record = {
      id: 'bundle-1',
      name: 'Weekend Picks',
      description: null,
      domain: 'matka',
      gameIds: [11, '22'] as unknown as string[],
    }
    assert.deepEqual(bundleFormValues(record), {
      name: 'Weekend Picks',
      description: '',
      domain: 'matka',
    })
    assert.deepEqual(selectedBundleGameIds(record), ['11', '22'])
  })

  test('an unknown stored domain falls back to casino without losing other values', () => {
    assert.deepEqual(bundleFormValues({
      id: 'b2',
      name: 'Legacy',
      description: 'Old domain',
      domain: 'virtuals',
    }), {
      name: 'Legacy',
      description: 'Old domain',
      domain: 'casino',
    })
  })

  test('the name keeps the exact required and length messages', () => {
    assert.equal(firstErrors({ ...EMPTY_BUNDLE_VALUES }).name, 'Bundle name is required')
    assert.equal(firstErrors({ ...EMPTY_BUNDLE_VALUES, name: 'a'.repeat(257) }).name, 'Bundle name must be between 1 and 256 characters')
    assert.equal(firstErrors({ ...EMPTY_BUNDLE_VALUES, name: 'a'.repeat(256) }).name, undefined)
  })

  test('description accepts 1000 characters and refuses 1001 with the legacy message', () => {
    assert.equal(firstErrors({ ...EMPTY_BUNDLE_VALUES, name: 'Bundle', description: 'x'.repeat(1000) }).description, undefined)
    assert.equal(firstErrors({ ...EMPTY_BUNDLE_VALUES, name: 'Bundle', description: 'x'.repeat(1001) }).description, 'Description must be less than 1000 characters')
  })
})

describe('bundleCreateEditModel — mutation input and feedback', () => {
  const values: BundleFormValues = { name: 'Hot Games', description: 'Chosen games', domain: 'casino' }

  test('the input keeps the legacy key order and gives every selected id weight one', () => {
    const input = buildBundleInput(values, ['g2', 'g1', 'g2'], null, true)
    assert.deepEqual(Object.keys(input), ['name', 'description', 'domain', 'gameIds', 'gameWeights'])
    assert.deepEqual(input, {
      name: 'Hot Games',
      description: 'Chosen games',
      domain: 'casino',
      gameIds: ['g2', 'g1', 'g2'],
      gameWeights: { g2: 1, g1: 1 },
    })
  })

  test('an untouched blank description preserves null or undefined from the record', () => {
    const blank = { ...values, description: '' }
    assert.equal(buildBundleInput(blank, ['g1'], null, false).description, null)
    assert.equal(buildBundleInput(blank, ['g1'], undefined, false).description, undefined)
  })

  test('an intentionally cleared description sends the empty string', () => {
    assert.equal(buildBundleInput({ ...values, description: '' }, ['g1'], 'Old', true).description, '')
  })

  test('success and refused responses use the server message and the 4.5-second legacy timing', () => {
    assert.deepEqual(bundleSaveToast({ success: true, message: 'Created' }, 'create'), {
      title: 'Success', message: 'Created', tone: 'ok', duration: 4500,
    })
    assert.deepEqual(bundleSaveToast({ success: false, message: 'Name taken' }, 'edit'), {
      title: 'Error', message: 'Name taken', tone: 'error', duration: 4500,
    })
  })

  test('save feedback has mode-specific fallbacks', () => {
    assert.equal(bundleSaveToast({ success: true }, 'create').message, 'Bundle created successfully')
    assert.equal(bundleSaveToast({ success: true }, 'edit').message, 'Bundle updated successfully')
    assert.equal(bundleSaveToast(null, 'create').message, 'Failed to create bundle')
    assert.equal(bundleSaveToast(undefined, 'edit').message, 'Failed to update bundle')
  })

  test('selection and thrown failures keep the exact legacy copy', () => {
    assert.deepEqual(bundleSelectionToast(), {
      title: 'Error', message: 'Please select at least one game', tone: 'error', duration: 4500,
    })
    assert.equal(bundleErrorToast(new Error('Network unavailable')).message, 'Network unavailable')
    assert.equal(bundleErrorToast('bad response').message, 'Failed to save bundle')
  })
})

