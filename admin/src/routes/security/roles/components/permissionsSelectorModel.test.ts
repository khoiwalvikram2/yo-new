import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import type { Permission } from '@/state/rbacStore'
import {
  CATEGORY_META,
  DEFAULT_META,
  actionLabel,
  activeCategoryCount,
  buildCategories,
  categoryMeta,
  categoryStats,
  categoryToggleTooltip,
  fillPercent,
  filterCategoryKeys,
  filterResources,
  getResourceLabel,
  grantAll,
  isFull,
  matchedLabel,
  progressPercent,
  resolveActiveCategory,
  resourceDescription,
  resourceSelection,
  revokeAll,
  toggleAction,
  toggleCategory,
  toggleResource,
  totalStats,
} from './permissionsSelectorModel'

/** The server's list, grouped by domain, in arrival order (flat and odd domains included). */
const BY_DOMAIN: Record<string, string[]> = {
  'players.list': ['view', 'export'],
  roles: ['read', 'write'],
  'zeta.widgets': ['view'],
  'security.roles': ['view', 'create', 'update', 'delete'],
  'players.notes': ['view', 'create'],
  'alpha.custom-thing': ['view-secret'],
  '.hidden': ['view'],
  'overview.dashboard': ['view'],
}

const categories = buildCategories(BY_DOMAIN)

describe('buildCategories', () => {
  test('groups nested domains by category, skipping flat and leading-dot domains', () => {
    assert.deepEqual([...categories.categoryMap.keys()].sort(), ['alpha', 'overview', 'players', 'security', 'zeta'])
    assert.deepEqual(
      categories.categoryMap.get('players')?.map((r) => [r.domain, r.resource, r.label, r.actions]),
      [
        ['players.list', 'list', 'List', ['view', 'export']],
        ['players.notes', 'notes', 'Notes', ['view', 'create']],
      ],
    )
  })

  test('orders the known categories as the taxonomy, then the others alphabetically', () => {
    assert.deepEqual(categories.orderedKeys, ['overview', 'players', 'security', 'alpha', 'zeta'])
    assert.deepEqual(buildCategories({}).orderedKeys, [])
  })

  test('labels resources from the table or by title-casing the key', () => {
    assert.equal(getResourceLabel('pnl'), 'P&L')
    assert.equal(getResourceLabel('custom-thing'), 'Custom Thing')
    assert.equal(getResourceLabel('constructor'), 'Constructor')
    assert.equal(categories.categoryMap.get('alpha')?.[0].label, 'Custom Thing')
  })

  test('copy helpers: category meta with its default, descriptions, action labels, matches', () => {
    assert.deepEqual(categoryMeta('players'), CATEGORY_META.players)
    assert.deepEqual(categoryMeta('zeta'), DEFAULT_META)
    assert.deepEqual(categoryMeta('toString'), DEFAULT_META)
    assert.equal(resourceDescription('players.list'), 'View and search player directory')
    assert.equal(resourceDescription('zeta.widgets'), undefined)
    assert.equal(actionLabel('view-secret'), 'view secret')
    assert.equal(actionLabel('toggle-master-switch'), 'toggle master switch')
    assert.equal(matchedLabel(1), '1 category matched')
    assert.equal(matchedLabel(0), '0 categories matched')
  })
})

describe('search', () => {
  test('an empty search keeps every category', () => {
    assert.equal(filterCategoryKeys('', categories), categories.orderedKeys)
  })

  test('matches a category label or key, or a resource label, key or action, case-insensitively', () => {
    assert.deepEqual(filterCategoryKeys('PLAY', categories), ['players'])
    assert.deepEqual(filterCategoryKeys('secur', categories), ['security'])
    assert.deepEqual(filterCategoryKeys('Notes', categories), ['players'])
    assert.deepEqual(filterCategoryKeys('widgets', categories), ['zeta'])
    assert.deepEqual(filterCategoryKeys('DELETE', categories), ['security'])
    // categories outside the taxonomy are labelled Other, and that label is searched too
    assert.deepEqual(filterCategoryKeys('other', categories), ['alpha', 'zeta'])
    assert.deepEqual(filterCategoryKeys('nothing here', categories), [])
    assert.deepEqual(filterCategoryKeys('view', categories), ['overview', 'players', 'security', 'alpha', 'zeta'])
  })

  test('filters the shown category resources the same way', () => {
    const players = categories.categoryMap.get('players') ?? []
    assert.deepEqual(filterResources(players, 'EXPORT').map((r) => r.domain), ['players.list'])
    assert.deepEqual(filterResources(players, '').map((r) => r.domain), ['players.list', 'players.notes'])
    assert.deepEqual(filterResources(players, 'zzz'), [])
  })
})

describe('resolveActiveCategory', () => {
  const ordered = categories.orderedKeys

  test('shows the first category until one is chosen, and the chosen one while it exists', () => {
    assert.equal(resolveActiveCategory(null, ordered, ordered), 'overview')
    assert.equal(resolveActiveCategory('security', ordered, ordered), 'security')
    assert.equal(resolveActiveCategory('gone', ordered, ordered), 'overview')
    assert.equal(resolveActiveCategory(null, [], []), null)
  })

  test('a search that hides it moves to the first match; a search matching nothing keeps it', () => {
    assert.equal(resolveActiveCategory('security', ordered, ['players', 'zeta']), 'players')
    assert.equal(resolveActiveCategory('security', ordered, []), 'security')
    assert.equal(resolveActiveCategory(null, ordered, ['zeta']), 'zeta')
  })
})

describe('figures', () => {
  const value: Permission[] = [
    { domain: 'players.list', actions: ['view'] },
    { domain: 'security.roles', actions: ['view', 'create', 'update', 'delete'] },
    { domain: 'roles', actions: ['read'] },
  ]

  test('counts granted entries in full against the offered actions', () => {
    assert.deepEqual(categoryStats(categories.categoryMap.get('players') ?? [], value), { selected: 1, total: 4 })
    assert.deepEqual(categoryStats(categories.categoryMap.get('security') ?? [], value), { selected: 4, total: 4 })
    assert.deepEqual(totalStats(categories, value), { selected: 5, total: 11 })
    assert.equal(activeCategoryCount(categories, value), 2)
    // a stale action the server no longer offers still counts, as before
    const stale = [{ domain: 'overview.dashboard', actions: ['view', 'export'] }]
    assert.deepEqual(categoryStats(categories.categoryMap.get('overview') ?? [], stale), { selected: 2, total: 1 })
  })

  test('percentages, fullness and the select-all tooltip', () => {
    assert.equal(progressPercent({ selected: 5, total: 11 }), 45)
    assert.equal(progressPercent({ selected: 0, total: 0 }), 0)
    assert.equal(fillPercent({ selected: 1, total: 4 }), 25)
    assert.equal(fillPercent({ selected: 3, total: 2 }), 150)
    assert.equal(fillPercent({ selected: 0, total: 0 }), 0)
    assert.equal(isFull({ selected: 4, total: 4 }), true)
    assert.equal(isFull({ selected: 0, total: 0 }), false)
    assert.equal(isFull({ selected: 2, total: 1 }), false)
    assert.equal(categoryToggleTooltip({ selected: 4, total: 4 }), 'Revoke all permissions in this category')
    assert.equal(categoryToggleTooltip({ selected: 1, total: 4 }), 'Grant all permissions in this category')
    assert.equal(categoryToggleTooltip({ selected: 0, total: 0 }), 'Grant all permissions in this category')
  })

  test('a resource is all on, partly on or off', () => {
    const list = categories.categoryMap.get('players')![0]
    assert.deepEqual(resourceSelection(list, value), { selected: ['view'], allOn: false, partial: true })
    assert.deepEqual(resourceSelection(list, []), { selected: [], allOn: false, partial: false })
    assert.deepEqual(resourceSelection(list, [{ domain: 'players.list', actions: ['export', 'view'] }]), {
      selected: ['export', 'view'],
      allOn: true,
      partial: false,
    })
  })
})

describe('toggles', () => {
  const typed = { __typename: 'Permission', domain: 'players.list', actions: ['view'] } as Permission
  const base: Permission[] = [typed, { domain: 'roles', actions: ['read'] }]

  test('an action is appended to its entry, or a new entry is appended at the end', () => {
    assert.deepEqual(toggleAction(base, 'players.list', 'export', true), [
      { __typename: 'Permission', domain: 'players.list', actions: ['view', 'export'] },
      { domain: 'roles', actions: ['read'] },
    ])
    assert.deepEqual(toggleAction(base, 'players.notes', 'create', true), [
      typed,
      { domain: 'roles', actions: ['read'] },
      { domain: 'players.notes', actions: ['create'] },
    ])
  })

  test('removing the last action drops the entry; removing one not granted changes nothing', () => {
    assert.deepEqual(toggleAction(base, 'players.list', 'view', false), [{ domain: 'roles', actions: ['read'] }])
    assert.deepEqual(
      toggleAction([{ domain: 'players.list', actions: ['view', 'export'] }], 'players.list', 'view', false),
      [{ domain: 'players.list', actions: ['export'] }],
    )
    assert.equal(toggleAction(base, 'players.notes', 'view', false), null)
  })

  test('Grant All on a resource replaces its entry at the end; Revoke removes it', () => {
    assert.deepEqual(toggleResource(base, 'players.list', ['view', 'export']), [
      { domain: 'roles', actions: ['read'] },
      { domain: 'players.list', actions: ['view', 'export'] },
    ])
    assert.deepEqual(
      toggleResource([{ domain: 'players.list', actions: ['export', 'view', 'stale'] }, ...base.slice(1)], 'players.list', ['view', 'export']),
      [{ domain: 'roles', actions: ['read'] }],
    )
  })

  test('the category select-all grants every resource in full, or revokes them all when everything is granted', () => {
    const players = categories.categoryMap.get('players') ?? []
    assert.deepEqual(toggleCategory(base, players), [
      { domain: 'roles', actions: ['read'] },
      { domain: 'players.list', actions: ['view', 'export'] },
      { domain: 'players.notes', actions: ['view', 'create'] },
    ])
    const full = toggleCategory(base, players)
    assert.deepEqual(toggleCategory(full, players), [{ domain: 'roles', actions: ['read'] }])
    // a category with no actions offered is "all granted": the toggle removes nothing it does not hold
    assert.deepEqual(toggleCategory(base, [{ domain: 'x.y', resource: 'y', label: 'Y', actions: [] }]), base)
  })

  test('Grant All takes every dotted domain in full and drops everything else; Revoke All empties the list', () => {
    assert.deepEqual(grantAll(BY_DOMAIN), [
      { domain: 'players.list', actions: ['view', 'export'] },
      { domain: 'zeta.widgets', actions: ['view'] },
      { domain: 'security.roles', actions: ['view', 'create', 'update', 'delete'] },
      { domain: 'players.notes', actions: ['view', 'create'] },
      { domain: 'alpha.custom-thing', actions: ['view-secret'] },
      { domain: '.hidden', actions: ['view'] },
      { domain: 'overview.dashboard', actions: ['view'] },
    ])
    assert.notEqual(grantAll(BY_DOMAIN)[0].actions, BY_DOMAIN['players.list'])
    assert.deepEqual(revokeAll(), [])
  })
})

