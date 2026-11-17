import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  autoSlugEnabled,
  categoryCountLabel,
  categoryFormInitialValues,
  categoryFormSchema,
  categoryOrderAfterMove,
  categoryReorderInputs,
  categoryStats,
  categoryStatusLabel,
  categorySubmitValues,
  categoryUpdatePatch,
  drawerHint,
  drawerTitle,
  filterCategories,
  gameStatusLabel,
  gamesCountLabel,
  iconErrorMessage,
  initialIconState,
  isCategoryType,
  isImageType,
  isMainCategory,
  isTypeFilter,
  mainCategoryLabel,
  moveId,
  orderedGameIds,
  reorderAnnouncement,
  rowsInOrder,
  saveErrorToast,
  saveSuccessToast,
  slugify,
  submitLabel,
  typeLabel,
  type CasinoCategory,
} from './categoriesManagementModel'

const categories: CasinoCategory[] = [
  {
    id: 'late',
    mainCategory: 'LIVE_CASINO',
    type: 'GENERAL',
    name: 'Tables',
    slug: 'tables',
    order: null,
    isActive: false,
    gameCount: 3,
  },
  {
    id: 'top',
    mainCategory: 'LIVE_CASINO',
    type: 'TOP',
    name: 'Top games',
    slug: 'top-games',
    order: 2,
    isActive: true,
    gameCount: 4,
  },
  {
    id: 'featured',
    mainCategory: 'LIVE_CASINO',
    type: 'FEATURED',
    name: 'Featured',
    slug: 'featured',
    order: 1,
    isActive: true,
    gameCount: undefined,
  },
]

describe('casino categories model', () => {
  test('recognises category enums including the home lounge and their filter superset', () => {
    assert.equal(isMainCategory('LIVE_CASINO'), true)
    assert.equal(isMainCategory('SPORTS'), false)
    assert.equal(isCategoryType('FEATURED'), true)
    assert.equal(isCategoryType('LOUNGE'), true)
    assert.equal(isCategoryType('ALL'), false)
    assert.equal(isTypeFilter('ALL'), true)
    assert.equal(isTypeFilter('TOP'), true)
    assert.equal(isTypeFilter('LOUNGE'), true)
    assert.equal(isTypeFilter('UNKNOWN'), false)
  })

  test('keeps the legacy labels and count copy', () => {
    assert.equal(typeLabel('GENERAL'), 'General')
    assert.equal(typeLabel('TOP'), 'Top')
    assert.equal(typeLabel('FEATURED'), 'Featured')
    assert.equal(typeLabel('LOUNGE'), 'Casino lounge')
    assert.equal(categoryStatusLabel(true), 'Active')
    assert.equal(categoryStatusLabel(false), 'Inactive')
    assert.equal(gameStatusLabel(undefined), 'Enabled')
    assert.equal(gameStatusLabel(false), 'Disabled')
    assert.equal(gamesCountLabel(undefined), '0 games')
    assert.equal(categoryCountLabel(1), '1 category · Click a category to see its games')
    assert.equal(categoryCountLabel(2), '2 categories · Click a category to see its games')
  })

  test('filters by type and sorts a missing order as 999 without mutating input', () => {
    assert.deepEqual(filterCategories(categories, 'ALL').map((row) => row.id), ['featured', 'top', 'late'])
    assert.deepEqual(filterCategories(categories, 'TOP').map((row) => row.id), ['top'])
    assert.deepEqual(categories.map((row) => row.id), ['late', 'top', 'featured'])
  })

  test('projects rows through the current drag order and drops stale ids', () => {
    assert.deepEqual(rowsInOrder(['top', 'missing', 'featured'], categories).map((row) => row.id), ['top', 'featured'])
  })

  test('keeps Casino lounge separate from featured and top categories', () => {
    const lounge: CasinoCategory = {
      id: 'lounge', mainCategory: 'CASINO', type: 'LOUNGE', name: 'Casino lounge',
      slug: 'casino-lounge', isActive: true, gameCount: 2,
    }
    assert.deepEqual(filterCategories([...categories, lounge], 'LOUNGE'), [lounge])
    const values = categoryFormInitialValues(lounge)
    assert.equal(categoryFormSchema.safeParse(values).success, true)
    const submission = categorySubmitValues(values, null)
    assert.equal(submission.type, 'LOUNGE')
    assert.equal(categoryUpdatePatch(submission).type, 'LOUNGE')
  })

  test('moves ids and produces the mutation\'s one-based reorder inputs', () => {
    assert.deepEqual(moveId(['a', 'b', 'c'], 'a', 'c'), ['b', 'c', 'a'])
    assert.equal(moveId(['a', 'b'], 'a', 'a'), null)
    assert.equal(moveId(['a', 'b'], 'missing', 'a'), null)
    assert.equal(moveId(['a', 'b'], 'a', null), null)
    assert.deepEqual(categoryReorderInputs(['b', 'c', 'a']), [
      { id: 'b', order: 1 },
      { id: 'c', order: 2 },
      { id: 'a', order: 3 },
    ])
  })

  test('a drag under a Type filter is saved in the whole order, so hidden categories keep their numbers', () => {
    // Live Casino: General g1..g5, Featured 6, Top 7, two new Generals (no order), then the lounge at 90.
    const all = ['g1', 'g2', 'g3', 'g4', 'g5', 'featured', 'top', 'alpha', 'beta', 'lounge']
    const generals = ['g1', 'g2', 'g3', 'g4', 'g5', 'alpha', 'beta']
    // Beta dragged above Alpha with Type = General: it used to send the 7 Generals as 1..7, giving Alpha and Beta
    // the 6 and 7 of Featured and Top.
    const whole = categoryOrderAfterMove(all, generals, 'beta', 'alpha')
    assert.deepEqual(whole, ['g1', 'g2', 'g3', 'g4', 'g5', 'featured', 'top', 'beta', 'alpha', 'lounge'])
    const numbers = categoryReorderInputs(whole ?? []).map((input) => input.order)
    assert.equal(new Set(numbers).size, all.length, 'every number is used once')
    // Moving up past hidden rows lands before the target; moving down lands after it.
    assert.deepEqual(categoryOrderAfterMove(all, generals, 'alpha', 'g5'), ['g1', 'g2', 'g3', 'g4', 'alpha', 'g5', 'featured', 'top', 'beta', 'lounge'])
    assert.deepEqual(categoryOrderAfterMove(all, generals, 'g5', 'beta'), ['g1', 'g2', 'g3', 'g4', 'featured', 'top', 'alpha', 'beta', 'g5', 'lounge'])
    // The shown rows keep the order already on screen (a drag not yet refetched).
    assert.deepEqual(categoryOrderAfterMove(['a', 'x', 'b', 'c'], ['c', 'a', 'b'], 'b', 'c'), ['b', 'c', 'x', 'a'])
    // Unfiltered it is the plain move; a drop on itself changes nothing.
    assert.deepEqual(categoryOrderAfterMove(['a', 'b', 'c'], ['a', 'b', 'c'], 'a', 'c'), moveId(['a', 'b', 'c'], 'a', 'c'))
    assert.equal(categoryOrderAfterMove(all, generals, 'alpha', 'alpha'), null)
  })

  test('keeps the saved game order and ignores games no longer returned', () => {
    const games = [
      { id: 'g2', name: 'Two', slug: 'two' },
      { id: 'g1', name: 'One', slug: 'one' },
    ]
    assert.deepEqual(orderedGameIds(['g1', 2, 'missing'], games), ['g1'])
  })

  test('supplies meaningful keyboard drag announcements', () => {
    assert.equal(reorderAnnouncement('start', 'Roulette'), 'Picked up Roulette.')
    assert.equal(reorderAnnouncement('over', 'Roulette', 'Blackjack'), 'Roulette is over Blackjack.')
    assert.equal(reorderAnnouncement('end', 'Roulette', null), 'Roulette was dropped.')
    assert.equal(reorderAnnouncement('cancel', 'Roulette'), 'Moving Roulette was cancelled.')
  })

  test('computes all statistics after applying the type filter', () => {
    assert.deepEqual(categoryStats(categories, 'ALL'), {
      totalCategories: 3,
      activeCategories: 2,
      inactiveCategories: 1,
      totalGames: 7,
      topCount: 1,
      featuredCount: 1,
      activeRate: 67,
    })
    assert.deepEqual(categoryStats(categories, 'TOP'), {
      totalCategories: 1,
      activeCategories: 1,
      inactiveCategories: 0,
      totalGames: 4,
      topCount: 1,
      featuredCount: 0,
      activeRate: 100,
    })
    assert.equal(categoryStats([], 'ALL').activeRate, 0)
  })

  test('derives drawer labels and defaults from the opening category', () => {
    assert.equal(mainCategoryLabel('LIVE_CASINO'), 'Live Casino')
    assert.equal(drawerTitle('create', { mainCategory: 'SLOTS' }), 'New Slots Category')
    assert.equal(drawerTitle('create'), 'New Casino Category')
    assert.equal(drawerTitle('edit', { name: 'Top picks' }), 'Edit Category - Top picks')
    assert.equal(drawerHint('edit'), 'Update category configuration and settings')
    assert.equal(submitLabel('create'), 'Create Category')
    assert.deepEqual(categoryFormInitialValues({ mainCategory: 'CASINO', name: 'A', isActive: false }), {
      mainCategory: 'CASINO',
      type: 'GENERAL',
      name: 'A',
      slug: '',
      subtitle: '',
      iconData: null,
      isActive: false,
    })
  })

  test('matches the legacy slug generation and auto-slug decision', () => {
    assert.equal(slugify('  Teen Patti & More!  '), 'teen-patti-more')
    assert.equal(autoSlugEnabled({ slug: 'kept' }), false)
    assert.equal(autoSlugEnabled({ slug: '' }), true)
  })

  test('validates the same required fields and minimum name length', () => {
    const invalid = categoryFormSchema.safeParse({
      mainCategory: 'bad',
      type: 'bad',
      name: 'x',
      slug: '',
      subtitle: '',
      iconData: null,
      isActive: true,
    })
    assert.equal(invalid.success, false)
    if (!invalid.success) {
      assert.deepEqual(invalid.error.issues.map((issue) => issue.message), [
        'Select a main category',
        'Select a category type',
        'Name must be at least 2 characters',
        'Enter category slug',
      ])
    }
  })

  test('classifies icon values and image MIME types', () => {
    assert.deepEqual(initialIconState(undefined), { preview: null, value: null })
    assert.deepEqual(initialIconState('https://cdn.test/icon.png'), {
      preview: 'https://cdn.test/icon.png',
      value: null,
    })
    assert.deepEqual(initialIconState('data:image/png;base64,AAAA'), { preview: 'data:image/png;base64,AAAA', value: null })
    // A legacy storage key (the server now answers null for one) is neither shown nor sent back on a save.
    assert.deepEqual(initialIconState('folder/icon.png'), { preview: null, value: null })
    assert.equal(isImageType('image/png'), true)
    assert.equal(isImageType('text/plain'), false)
  })

  test('builds create values and the exact update patch; an emptied subtitle is cleared, not skipped', () => {
    const values = categorySubmitValues({
      mainCategory: 'CASINO',
      type: 'FEATURED',
      name: 'Featured',
      slug: 'featured',
      subtitle: '',
      iconData: 'old-key',
      isActive: true,
    }, 'data:image/png;base64,new')
    assert.deepEqual(values, {
      mainCategory: 'CASINO',
      type: 'FEATURED',
      subtitle: undefined,
      name: 'Featured',
      slug: 'featured',
      iconData: 'data:image/png;base64,new',
      isActive: true,
    })
    // A missing key leaves the stored subtitle; the emptied field used to save nothing and say "Category Updated".
    assert.deepEqual(categoryUpdatePatch(values), {
      mainCategory: 'CASINO',
      name: 'Featured',
      slug: 'featured',
      subtitle: null,
      iconData: 'data:image/png;base64,new',
      isActive: true,
      type: 'FEATURED',
    })
    assert.equal(categoryUpdatePatch({ ...values, subtitle: 'Lobby picks' }).subtitle, 'Lobby picks')
    assert.equal(categoryUpdatePatch({ ...values, subtitle: '   ' }).subtitle, null)
  })

  test('sends the icon only when it changed: null when removed, nothing when kept', () => {
    const form = {
      mainCategory: 'CASINO', type: 'GENERAL', name: 'Live', slug: 'live', subtitle: 'Sub', isActive: true,
      // A stored icon reaches the drawer as its data URI: only the preview, never sent back unchanged.
      iconData: 'data:image/png;base64,c3RvcmVk',
    }
    const kept = categorySubmitValues(form, null)
    assert.equal(kept.iconData, undefined)
    assert.equal('iconData' in JSON.parse(JSON.stringify(categoryUpdatePatch(kept))), false, 'no icon key on the wire')
    const removed = categorySubmitValues({ ...form, iconData: null }, null, true)
    assert.equal(removed.iconData, null)
    assert.equal(categoryUpdatePatch(removed).iconData, null)
    // A freshly compressed icon travels as the icon value.
    assert.equal(categorySubmitValues(form, 'data:image/png;base64,new').iconData, 'data:image/png;base64,new')
  })

  test('keeps success/error toast copy and timings', () => {
    assert.deepEqual(saveSuccessToast('create', 'VIP'), {
      title: 'Category Created',
      message: 'Category "VIP" has been created successfully.',
      tone: 'ok',
      duration: 4500,
    })
    assert.equal(saveErrorToast('edit', new Error('Nope')).title, 'Failed to Update Category')
    assert.equal(saveErrorToast('edit', new Error('Nope')).message, 'Nope')
    assert.equal(iconErrorMessage(null), 'Failed to process icon')
  })
})
