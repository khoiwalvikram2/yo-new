import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  EDIT_BONUS_TYPE_OPTIONS,
  EDIT_DEPOSIT_CONDITION_OPTIONS,
  EDIT_DOMAIN_OPTIONS,
  EDIT_RELEASE_TYPE_OPTIONS,
  EDIT_STATUS_OPTIONS,
  LOSING_DISTRIBUTION_OPTIONS,
  bonusEditInitialValues,
  bonusEditSchema,
  bonusEditTypeChangePatch,
  createBonusEditBaseline,
  editChoices,
  editDistributionOptions,
  getBonusEditVisibility,
  istDateTimeOf,
  serializeBonusEdit,
  type BonusCampaignRecord,
  type BonusEditValues,
} from './bonusEditModel'

function record(overrides: Partial<BonusCampaignRecord> = {}): BonusCampaignRecord {
  return {
    id: '42',
    name: 'Weekend reload',
    domain: 'global',
    type: 'deposit',
    status: 'active',
    currency: 'INR',
    budgetNumeric: 250000,
    depositConditionType: 'greater_than',
    depositConditionAmount: 1000,
    distributionType: 'roll_over',
    amountType: 'percentage',
    depositRequired: null,
    releaseType: 'total_bonus_wallet',
    amount: null,
    percentage: 25,
    numberOfPlayers: 500,
    usagePerPlayer: 2,
    startDate: '2026-09-22T09:00:30.000Z',
    endDate: '2026-10-22T18:29:59.000Z',
    wagering: 3,
    expiryBonusDays: 7,
    ...overrides,
  }
}

async function issues(values: BonusEditValues): Promise<Record<string, string>> {
  const result = await bonusEditSchema.safeParseAsync(values)
  if (result.success) return {}
  const found: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const path = issue.path.join('.')
    if (found[path] === undefined) found[path] = issue.message
  }
  return found
}

describe('bonusEditModel', () => {
  test('keeps the legacy option lists, Referral Deposit offered on edit', () => {
    assert.deepEqual(EDIT_BONUS_TYPE_OPTIONS.map((option) => [option.value, option.label]), [
      ['deposit', 'Deposit'],
      ['daily_first_deposit', 'First Day First Time Deposit'],
      ['signup', 'Signup'],
      ['direct_amount', 'Direct Bonus'],
      ['referral_deposit', 'Referral Deposit'],
      ['losing_bonus', 'Losing Bonus'],
      ['special', 'Special Bonus'],
    ])
    assert.deepEqual(EDIT_STATUS_OPTIONS.map((option) => option.value), ['draft', 'active', 'paused', 'ended'])
    assert.deepEqual(EDIT_DOMAIN_OPTIONS.map((option) => option.label), ['All', 'Sports', 'Casino', 'Matka'])
    assert.deepEqual(EDIT_DEPOSIT_CONDITION_OPTIONS.map((option) => option.value), ['greater_than', 'equal_to'])
    assert.deepEqual(EDIT_RELEASE_TYPE_OPTIONS.map((option) => option.label), [
      'Bonus Amount Only',
      'Total Amount in Bonus Wallet',
    ])
    assert.deepEqual(LOSING_DISTRIBUTION_OPTIONS, [{ label: 'Roll Over', value: 'roll_over' }])
  })

  test('offers the legacy distributions per type and keeps a held value no option names', () => {
    assert.deepEqual(editDistributionOptions('deposit'), [
      { label: 'Instant OTP', value: 'instant_otp' },
      { label: 'Instant Cash', value: 'instant_cash' },
      { label: 'Roll Over', value: 'roll_over', disabled: false },
    ])
    assert.equal(editDistributionOptions('signup')[2].disabled, true)
    assert.equal(editDistributionOptions('referral_deposit')[2].disabled, true)
    assert.deepEqual(editDistributionOptions('special').map((option) => option.value), ['instant_otp', 'roll_over'])
    assert.deepEqual(editChoices(EDIT_BONUS_TYPE_OPTIONS, 'deposit_match').at(-1), {
      value: 'deposit_match',
      label: 'deposit_match',
      disabled: true,
    })
    assert.equal(editChoices(EDIT_BONUS_TYPE_OPTIONS, 'signup'), EDIT_BONUS_TYPE_OPTIONS)
  })

  test('shows the release type for Losing Bonus itself, since nothing forced Roll Over on this page', () => {
    const losing = getBonusEditVisibility({ bonusType: 'losing_bonus', distributionType: 'instant_otp', amountType: 'fixed' })
    assert.equal(losing.isLosingBonus, true)
    assert.equal(losing.showReleaseType, true)
    assert.equal(losing.showWagering, true)
    assert.equal(losing.showPercentage, true)
    assert.equal(losing.showAmount, false)
    assert.equal(losing.showAmountType, false)

    const deposit = getBonusEditVisibility({ bonusType: 'deposit', distributionType: 'instant_otp', amountType: 'fixed' })
    assert.deepEqual(
      [deposit.showReleaseType, deposit.showWagering, deposit.showDepositConditions, deposit.showAmount],
      [false, false, true, true],
    )
    // A legacy BonusType matches none of the families: amount type and amount show, nothing else forced.
    const legacy = getBonusEditVisibility({ bonusType: 'deposit_match', distributionType: 'roll_over', amountType: 'percentage' })
    assert.deepEqual(
      [legacy.showAmountType, legacy.showPercentage, legacy.showAmount, legacy.showDepositConditions, legacy.showReleaseType],
      [true, true, false, false, true],
    )
  })

  test('forces Fixed for Signup and Direct and nothing for Losing Bonus, as the legacy effect ran', () => {
    assert.deepEqual(bonusEditTypeChangePatch('signup'), { bonusType: 'signup', amountType: 'fixed' })
    assert.deepEqual(bonusEditTypeChangePatch('direct_amount'), { bonusType: 'direct_amount', amountType: 'fixed' })
    assert.deepEqual(bonusEditTypeChangePatch('losing_bonus'), { bonusType: 'losing_bonus' })
    assert.deepEqual(bonusEditTypeChangePatch('special'), { bonusType: 'special' })
    assert.deepEqual(bonusEditTypeChangePatch('deposit'), { bonusType: 'deposit' })
  })

  test('reads stored instants as IST calendar minutes', () => {
    assert.equal(istDateTimeOf('2026-09-22T09:00:30.000Z'), '2026-09-22T14:30')
    // Both sides of IST midnight.
    assert.equal(istDateTimeOf('2026-09-21T18:29:00.000Z'), '2026-09-21T23:59')
    assert.equal(istDateTimeOf('2026-09-21T18:30:00.000Z'), '2026-09-22T00:00')
    assert.equal(istDateTimeOf(null), '')
    assert.equal(istDateTimeOf(''), '')
    assert.equal(istDateTimeOf('not a date'), '')
  })

  test('loads the campaign with the legacy fallbacks', () => {
    assert.deepEqual(bonusEditInitialValues(record()), {
      campaignName: 'Weekend reload',
      currency: 'INR',
      bonusType: 'deposit',
      status: 'active',
      domain: 'global',
      depositRequired: false,
      depositConditionType: 'greater_than',
      depositConditionAmount: 1000,
      distributionType: 'roll_over',
      wagering: 3,
      releaseType: 'total_bonus_wallet',
      amountType: 'percentage',
      amount: null,
      percentage: 25,
      numberOfPlayers: 500,
      usagePerPlayer: 2,
      expiryBonusDays: 7,
      startDate: '2026-09-22T14:30',
      endDate: '2026-10-22T23:59',
      budgetNumeric: 250000,
    })
    const sparse = bonusEditInitialValues(record({
      domain: null,
      currency: null,
      depositConditionType: null,
      distributionType: null,
      amountType: null,
      releaseType: null,
      budgetNumeric: null,
      startDate: null,
      endDate: null,
    }))
    assert.deepEqual(
      [sparse.domain, sparse.currency, sparse.depositConditionType, sparse.distributionType, sparse.amountType,
        sparse.releaseType, sparse.budgetNumeric, sparse.startDate, sparse.endDate],
      ['global', '', '', 'roll_over', 'percentage', 'bonus_amount_only', null, '', ''],
    )
    // Special loaded as Fixed; Signup and Direct were forced to Fixed by the type effect.
    for (const type of ['special', 'signup', 'direct_amount']) {
      assert.equal(bonusEditInitialValues(record({ type, amountType: 'percentage' })).amountType, 'fixed', type)
    }
    assert.equal(bonusEditInitialValues(record({ type: 'signup', depositRequired: true })).depositRequired, true)
  })

  test('validates the mounted controls with the legacy messages', async () => {
    const loaded = bonusEditInitialValues(record())
    assert.deepEqual(await issues(loaded), {})
    assert.deepEqual(await issues({ ...loaded, campaignName: '', status: '' }), {
      campaignName: 'Campaign name is required',
      status: 'Status is required',
    })
    assert.equal((await issues({ ...loaded, campaignName: 'ab' })).campaignName, 'Campaign name must be at least 3 characters')
    assert.equal((await issues({ ...loaded, depositConditionAmount: null })).depositConditionAmount, 'Deposit condition amount is required')
    assert.equal((await issues({ ...loaded, percentage: 120 })).percentage, 'Percentage must be between 0 and 100')
    assert.equal((await issues({ ...loaded, numberOfPlayers: 2.5 })).numberOfPlayers, 'Enter a whole number')
    assert.equal((await issues({ ...loaded, budgetNumeric: -1 })).budgetNumeric, 'Budget must be zero or greater')
    assert.equal(
      (await issues({ ...loaded, endDate: '2026-09-22T14:00' })).endDate,
      'End date must be after start date',
    )
    assert.deepEqual(await issues({ ...loaded, endDate: '2026-09-22T14:30' }), {}, 'an equal end is allowed')

    // Losing Bonus with an emptied release type and domain, and no wagering or percentage.
    const losing = { ...loaded, bonusType: 'losing_bonus', distributionType: 'instant_otp', releaseType: '', domain: '', wagering: null, percentage: null }
    assert.deepEqual(await issues(losing), {
      domain: 'Domain is required for Losing Bonus',
      wagering: 'Wagering requirement is required for Losing Bonus',
      releaseType: 'Release type is required',
      percentage: 'Percentage is required for Losing Bonus',
    })
    // A hidden control's value blocks nothing; a legacy type and condition still save.
    assert.deepEqual(await issues({ ...loaded, bonusType: 'signup', depositConditionAmount: null, usagePerPlayer: 0.5 }), {
      amount: 'Amount is required',
    })
    assert.deepEqual(await issues({ ...loaded, bonusType: 'deposit_match', depositConditionType: 'less_than' }), {})
    assert.equal((await issues({ ...loaded, bonusType: 'special', distributionType: '', amount: null })).distributionType,
      'Distribution type is required for Special Bonus')
  })

  test('sends the legacy update input: untouched dates as stored, every key in order', () => {
    const baseline = createBonusEditBaseline('42', record())
    const input = serializeBonusEdit(baseline.values, baseline)
    assert.deepEqual(Object.keys(input), [
      'id', 'name', 'domain', 'type', 'status', 'currency', 'budgetNumeric', 'depositConditionType',
      'depositConditionAmount', 'distributionType', 'amountType', 'amount', 'percentage', 'numberOfPlayers',
      'usagePerPlayer', 'startDate', 'endDate', 'wagering', 'expiryBonusDays', 'releaseType',
    ])
    assert.deepEqual(input, {
      id: '42',
      name: 'Weekend reload',
      domain: 'global',
      type: 'deposit',
      status: 'active',
      currency: 'INR',
      budgetNumeric: 250000,
      depositConditionType: 'greater_than',
      depositConditionAmount: 1000,
      distributionType: 'roll_over',
      amountType: 'percentage',
      amount: undefined,
      percentage: 25,
      numberOfPlayers: 500,
      usagePerPlayer: 2,
      startDate: '2026-09-22T09:00:30.000Z',
      endDate: '2026-10-22T18:29:59.000Z',
      wagering: 3,
      expiryBonusDays: 7,
      releaseType: 'total_bonus_wallet',
    })
  })

  test('sends changed dates as IST minutes, cleared numbers as null and never-filled ones not at all', () => {
    const baseline = createBonusEditBaseline('42', record({ numberOfPlayers: null }))
    const input = serializeBonusEdit({
      ...baseline.values,
      startDate: '2026-09-23T10:00',
      endDate: '',
      budgetNumeric: null,
      usagePerPlayer: null,
      numberOfPlayers: null,
      expiryBonusDays: null,
      distributionType: 'instant_otp',
    }, baseline)
    assert.equal(input.startDate, '2026-09-23T04:30:00.000Z')
    assert.equal(input.endDate, undefined)
    assert.equal(input.budgetNumeric, null)
    assert.equal(input.usagePerPlayer, null)
    assert.equal(input.numberOfPlayers, undefined)
    assert.equal(input.expiryBonusDays, null)
    // Not roll over and not losing: no release type, and the hidden wagering is left out.
    assert.equal('releaseType' in input, false)
    assert.equal(input.wagering, undefined)
    assert.equal(serializeBonusEdit({ ...baseline.values, expiryBonusDays: 7.9 }, baseline).expiryBonusDays, 7)
  })

  test('forces the legacy values per type and leaves hidden controls out', () => {
    const baseline = createBonusEditBaseline('42', record())
    const losing = serializeBonusEdit({
      ...baseline.values,
      bonusType: 'losing_bonus',
      domain: 'casino',
      distributionType: 'instant_otp',
      releaseType: 'bonus_amount_only',
    }, baseline)
    assert.deepEqual(
      [losing.domain, losing.distributionType, losing.amountType, losing.amount, losing.percentage, losing.wagering,
        losing.releaseType, losing.depositConditionType, losing.depositConditionAmount],
      ['casino', 'roll_over', 'percentage', undefined, 25, 3, 'bonus_amount_only', undefined, undefined],
    )

    const signup = serializeBonusEdit({ ...baseline.values, bonusType: 'signup', amountType: 'fixed', amount: 100, depositRequired: true }, baseline)
    assert.equal(signup.amountType, 'fixed')
    assert.equal(signup.amount, 100)
    assert.equal(signup.depositRequired, true)
    assert.equal('usagePerPlayer' in signup, false)
    assert.equal(signup.percentage, undefined)

    const special = serializeBonusEdit({ ...baseline.values, bonusType: 'special', amountType: 'fixed', amount: null }, baseline)
    assert.equal(special.amount, 0)
    assert.equal(special.amountType, 'fixed')
    assert.equal(special.domain, 'global')

    const legacy = serializeBonusEdit({ ...baseline.values, bonusType: 'deposit_match', amountType: 'fixed', amount: 40 }, baseline)
    assert.deepEqual([legacy.type, legacy.amountType, legacy.amount, legacy.percentage], ['deposit_match', 'fixed', 40, undefined])
  })
})
