import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  BULK_ERROR_FALLBACK,
  CATEGORY_OPTIONS,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  TOGGLE_ERROR_FALLBACK,
  buildBulkVariables,
  buildToggleVariables,
  bulkButtonLabel,
  bulkConfirmCopy,
  bulkEmptySelectionWarning,
  clampPage,
  countVendorFilters,
  filterVendors,
  isVendorCategory,
  isVendorEnabled,
  isWhitelabelAdminRoles,
  mutationErrorMessage,
  pageCount,
  pageSlice,
  providerOptions,
  rowToggleLabel,
  rowToggleTarget,
  selectAllState,
  statusSwitchLabel,
  toggleAllVendors,
  toggleVendorSelection,
  vendorCountLabel,
  vendorStats,
  vendorStatusLabel,
  type VendorWithSettings,
} from './vendorManagementModel'

function vendor(id: string, name: string, slug: string, enabled: boolean | null): VendorWithSettings {
  return { id, name, slug, enabled, gamesCount: 10, enabledGamesCount: 4, displayOrder: null }
}

const VENDORS: VendorWithSettings[] = [
  vendor('v1', 'Evolution Gaming', 'evolution', true),
  vendor('v2', 'Ezugi', 'ezugi', null),
  vendor('v3', 'Pragmatic Play', 'pragmatic-play', false),
  vendor('v4', 'Spribe', 'spribe', true),
]

describe('vendorManagementModel', () => {
  test('whitelabel admins are recognised by a whitelabel or tenant role, case-insensitively', () => {
    assert.equal(isWhitelabelAdminRoles(['WHITELABEL_ADMIN']), true)
    assert.equal(isWhitelabelAdminRoles(['ops', 'Tenant Owner']), true)
    assert.equal(isWhitelabelAdminRoles(['SUPER_ADMIN', 'admin']), false)
    assert.equal(isWhitelabelAdminRoles([]), false)
    assert.equal(isWhitelabelAdminRoles(undefined), false)
    assert.equal(isWhitelabelAdminRoles(null), false)
  })

  test('the local search matches name or slug, case-insensitive and untrimmed', () => {
    assert.deepStrictEqual(filterVendors(VENDORS, '').map((v) => v.id), ['v1', 'v2', 'v3', 'v4'])
    assert.deepStrictEqual(filterVendors(VENDORS, 'EVO').map((v) => v.id), ['v1'])
    assert.deepStrictEqual(filterVendors(VENDORS, 'play').map((v) => v.id), ['v3'])
    assert.deepStrictEqual(filterVendors(VENDORS, 'pragmatic-').map((v) => v.id), ['v3'])
    // the legacy search did not trim: a trailing space only matches a name with that space
    assert.deepStrictEqual(filterVendors(VENDORS, 'ezugi ').map((v) => v.id), [])
    assert.deepStrictEqual(filterVendors(VENDORS, 'zzz'), [])
  })

  test('a null enabled flag counts as enabled everywhere', () => {
    assert.equal(isVendorEnabled(true), true)
    assert.equal(isVendorEnabled(null), true)
    assert.equal(isVendorEnabled(undefined), true)
    assert.equal(isVendorEnabled(false), false)
    assert.equal(vendorStatusLabel(null), 'Enabled')
    assert.equal(vendorStatusLabel(true), 'Enabled')
    assert.equal(vendorStatusLabel(false), 'Disabled')
    assert.deepStrictEqual(vendorStats(VENDORS), { total: 4, enabled: 3, disabled: 1 })
    assert.deepStrictEqual(vendorStats([]), { total: 0, enabled: 0, disabled: 0 })
  })

  test('the row action flips the state and the controls are named for it', () => {
    assert.equal(rowToggleTarget(false), true)
    assert.equal(rowToggleTarget(true), false)
    assert.equal(rowToggleTarget(null), false)
    assert.equal(rowToggleLabel('Ezugi', null), 'Disable Ezugi')
    assert.equal(rowToggleLabel('Pragmatic Play', false), 'Enable Pragmatic Play')
    assert.equal(statusSwitchLabel('Spribe'), 'Spribe enabled')
  })

  test('row selection keeps tick order, never duplicates, and removes only the unticked id', () => {
    let selected = toggleVendorSelection([], 'v3', true)
    selected = toggleVendorSelection(selected, 'v1', true)
    assert.deepStrictEqual(selected, ['v3', 'v1'])
    assert.deepStrictEqual(toggleVendorSelection(selected, 'v1', true), ['v3', 'v1'])
    assert.deepStrictEqual(toggleVendorSelection(selected, 'v3', false), ['v1'])
    assert.deepStrictEqual(toggleVendorSelection(selected, 'v9', false), ['v3', 'v1'])
  })

  test('the header box selects every searched vendor and clears the whole selection', () => {
    const searched = filterVendors(VENDORS, 'e') // Evolution, Ezugi and Spribe; not Pragmatic Play
    assert.deepStrictEqual(toggleAllVendors(searched, true), ['v1', 'v2', 'v4'])
    assert.deepStrictEqual(toggleAllVendors(searched, false), [])

    assert.deepStrictEqual(selectAllState(VENDORS, []), { checked: false, indeterminate: false })
    assert.deepStrictEqual(selectAllState(VENDORS, ['v2']), { checked: false, indeterminate: true })
    assert.deepStrictEqual(selectAllState(VENDORS, ['v1', 'v2', 'v3', 'v4']), { checked: true, indeterminate: false })
    // ids outside the searched list do not count towards it
    assert.deepStrictEqual(selectAllState([VENDORS[0]], ['v2']), { checked: false, indeterminate: false })
    // an empty list is never checked
    assert.deepStrictEqual(selectAllState([], ['v1']), { checked: false, indeterminate: false })
  })

  test('mutation variables keep the legacy shapes and key order', () => {
    assert.deepStrictEqual(buildToggleVariables('v3', true), { vendorId: 'v3', enabled: true })
    assert.deepStrictEqual(Object.keys(buildToggleVariables('v3', false)), ['vendorId', 'enabled'])
    const bulk = buildBulkVariables(['v3', 'v1'], false)
    assert.deepStrictEqual(bulk, { vendorIds: ['v3', 'v1'], enabled: false })
    assert.deepStrictEqual(Object.keys(bulk), ['vendorIds', 'enabled'])
  })

  test('bulk copy, warnings and error fallbacks are the legacy text', () => {
    assert.deepStrictEqual(bulkConfirmCopy(true), {
      title: 'Enable selected vendors?',
      confirmLabel: 'Yes',
      cancelLabel: 'No',
    })
    assert.deepStrictEqual(bulkConfirmCopy(false), {
      title: 'Disable selected vendors?',
      confirmLabel: 'Yes',
      cancelLabel: 'No',
    })
    assert.equal(bulkEmptySelectionWarning(true), 'Please select vendors to enable')
    assert.equal(bulkEmptySelectionWarning(false), 'Please select vendors to disable')
    assert.equal(bulkButtonLabel(true, 3), 'Enable Selected (3)')
    assert.equal(bulkButtonLabel(false, 1), 'Disable Selected (1)')
    assert.equal(mutationErrorMessage(new Error('Vendor locked'), TOGGLE_ERROR_FALLBACK), 'Vendor locked')
    assert.equal(mutationErrorMessage({ message: '' }, TOGGLE_ERROR_FALLBACK), 'Failed to update vendor')
    assert.equal(mutationErrorMessage(undefined, BULK_ERROR_FALLBACK), 'Failed to update vendors')
  })

  test('filter options and counts', () => {
    assert.deepStrictEqual(CATEGORY_OPTIONS.map((o) => [o.value, o.label]), [
      ['LIVE_CASINO', 'Live Casino'],
      ['CASINO', 'Casino'],
      ['SLOTS', 'Slots'],
    ])
    assert.equal(isVendorCategory('SLOTS'), true)
    assert.equal(isVendorCategory(''), false)
    assert.equal(isVendorCategory('slots'), false)
    assert.deepStrictEqual(
      providerOptions([{ id: 'p1', name: 'QTech' }, { id: 'p2', name: 'Evolution Direct', key: 'evo' }]),
      [{ value: 'p1', label: 'QTech' }, { value: 'p2', label: 'Evolution Direct' }],
    )
    assert.equal(countVendorFilters('', undefined, undefined), 0)
    assert.equal(countVendorFilters(' ', undefined, undefined), 1)
    assert.equal(countVendorFilters('evo', 'p1', 'CASINO'), 3)
    assert.equal(vendorCountLabel(0), '0 vendors')
    assert.equal(vendorCountLabel(1), '1 vendor')
    assert.equal(vendorCountLabel(12), '12 vendors')
  })

  test('client paging: legacy sizes, 20 by default, and a page past the end shows the last page', () => {
    assert.deepStrictEqual([...PAGE_SIZE_OPTIONS], [10, 20, 50, 100])
    assert.equal(DEFAULT_PAGE_SIZE, 20)
    assert.equal(pageCount(0, 20), 1)
    assert.equal(pageCount(41, 20), 3)
    assert.equal(clampPage(3, 41, 20), 3)
    assert.equal(clampPage(3, 5, 20), 1)
    assert.equal(clampPage(0, 5, 20), 1)
    const rows = Array.from({ length: 45 }, (_, index) => index + 1)
    assert.deepStrictEqual(pageSlice(rows, 1, 20), rows.slice(0, 20))
    assert.deepStrictEqual(pageSlice(rows, 3, 20), [41, 42, 43, 44, 45])
    assert.deepStrictEqual(pageSlice(rows, 9, 20), [41, 42, 43, 44, 45])
    assert.deepStrictEqual(pageSlice([], 2, 10), [])
  })
})
