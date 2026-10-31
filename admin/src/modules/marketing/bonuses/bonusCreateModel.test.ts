import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  CREATE_BONUS_BUDGET,
  CREATE_BONUS_STATUS,
  OFFERED_BONUS_TYPES,
  bonusCreateSchema,
  bonusTypeChangePatch,
  createBonusInitialValues,
  getBonusCreateVisibility,
  serializeBonusCreate,
  withRetainedOption,
  type BonusCreateValues,
  type BonusCreateVisibility,
  type BonusType,
  type OfferedBonusType,
} from './bonusCreateModel'

function directValues(overrides: Partial<BonusCreateValues> = {}): BonusCreateValues {
  return {
    ...createBonusInitialValues('INR'),
    campaignName: 'Welcome reward',
    bonusType: 'direct_amount',
    amount: 500,
    ...overrides,
  }
}

function issues(values: BonusCreateValues): Record<string, string> {
  const result = bonusCreateSchema.safeParse(values)
  if (result.success) return {}
  const firstByPath: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const path = issue.path.join('.')
    if (firstByPath[path] === undefined) firstByPath[path] = issue.message
  }
  return firstByPath
}

/** Applies a bonus-type change the way the page does: the type and its forced values in one update. */
function changeType(values: BonusCreateValues, bonusType: BonusType): BonusCreateValues {
  return { ...values, ...bonusTypeChangePatch(values, bonusType) }
}

type TypeFamily = Pick<
  BonusCreateVisibility,
  'isLosingBonus' | 'hideUsagePerPlayer' | 'showDepositRequired' | 'showDepositConditions' | 'showAmountType'
>

/* The controls a bonus type alone decides (the legacy JSX conditions on bonusType). */
const FAMILY: Record<OfferedBonusType, TypeFamily> = {
  deposit: {
    isLosingBonus: false,
    hideUsagePerPlayer: false,
    showDepositRequired: false,
    showDepositConditions: true,
    showAmountType: true,
  },
  daily_first_deposit: {
    isLosingBonus: false,
    hideUsagePerPlayer: false,
    showDepositRequired: false,
    showDepositConditions: true,
    showAmountType: true,
  },
  signup: {
    isLosingBonus: false,
    hideUsagePerPlayer: true,
    showDepositRequired: true,
    showDepositConditions: false,
    showAmountType: false,
  },
  direct_amount: {
    isLosingBonus: false,
    hideUsagePerPlayer: true,
    showDepositRequired: false,
    showDepositConditions: false,
    showAmountType: false,
  },
  losing_bonus: {
    isLosingBonus: true,
    hideUsagePerPlayer: false,
    showDepositRequired: false,
    showDepositConditions: false,
    showAmountType: false,
  },
  special: {
    isLosingBonus: false,
    hideUsagePerPlayer: false,
    showDepositRequired: false,
    showDepositConditions: false,
    showAmountType: false,
  },
}

describe('bonus create model', () => {
  test('creates the legacy defaults with the supplied whitelabel currency and a draft, zero-budget input', () => {
    assert.equal(CREATE_BONUS_STATUS, 'draft')
    assert.equal(CREATE_BONUS_BUDGET, 0)
    assert.deepEqual(createBonusInitialValues('AED'), {
      campaignName: '',
      currency: 'AED',
      bonusType: '',
      domain: '',
      depositConditionType: '',
      depositConditionAmount: null,
      distributionType: '',
      amountType: 'fixed',
      amount: null,
      percentage: null,
      numberOfPlayers: null,
      usagePerPlayer: 1,
      startDate: '',
      endDate: '',
      wagering: null,
      expiryBonusDays: null,
      depositRequired: false,
      releaseType: '',
    })
  })

  test('offers the same six types and keeps the dormant referral branch out of the list', () => {
    assert.deepEqual(OFFERED_BONUS_TYPES, [
      'deposit',
      'daily_first_deposit',
      'signup',
      'direct_amount',
      'losing_bonus',
      'special',
    ])
    assert.equal(OFFERED_BONUS_TYPES.includes('referral_deposit' as never), false)
    assert.equal(getBonusCreateVisibility({
      bonusType: 'referral_deposit',
      amountType: 'fixed',
      distributionType: '',
    }).showDepositConditions, true)
  })

  test('applies only the legacy forced values when the bonus type changes', () => {
    const stale = directValues({
      releaseType: 'total_bonus_wallet',
      distributionType: 'instant_cash',
      amountType: 'percentage',
      percentage: 25,
    })

    assert.deepEqual(bonusTypeChangePatch(stale, 'signup'), {
      bonusType: 'signup',
      amountType: 'fixed',
    })
    assert.deepEqual(bonusTypeChangePatch(stale, 'direct_amount'), {
      bonusType: 'direct_amount',
      amountType: 'fixed',
    })
    assert.deepEqual(bonusTypeChangePatch(stale, 'losing_bonus'), {
      bonusType: 'losing_bonus',
      distributionType: 'roll_over',
      amountType: 'percentage',
      releaseType: 'total_bonus_wallet',
    })
    assert.deepEqual(bonusTypeChangePatch({ releaseType: '' }, 'losing_bonus'), {
      bonusType: 'losing_bonus',
      distributionType: 'roll_over',
      amountType: 'percentage',
      releaseType: 'bonus_amount_only',
    })

    for (const type of ['deposit', 'daily_first_deposit', 'special', 'referral_deposit'] as BonusType[]) {
      assert.deepEqual(bonusTypeChangePatch(stale, type), { bonusType: type })
    }
  })

  test('walks all 30 offered bonus-type transitions with only the legacy forced values', () => {
    const filled: BonusCreateValues = {
      ...createBonusInitialValues('INR'),
      campaignName: 'Transition matrix',
      domain: 'sports',
      depositConditionType: 'greater_than',
      depositConditionAmount: 1_000,
      distributionType: 'instant_otp',
      amountType: 'fixed',
      amount: 500,
      percentage: 10,
      wagering: 2,
      expiryBonusDays: 7,
      depositRequired: true,
    }
    let transitions = 0

    for (const from of OFFERED_BONUS_TYPES) {
      const before = changeType(filled, from)
      for (const to of OFFERED_BONUS_TYPES) {
        if (to === from) continue
        transitions += 1
        const label = `${from} -> ${to}`
        const after = changeType(before, to)
        const visibility = getBonusCreateVisibility(after)
        const input = serializeBonusCreate(after)

        assert.equal(after.bonusType, to, label)
        // Nothing the type does not force changes: no value is cleared on a type change.
        for (const key of [
          'campaignName', 'currency', 'domain', 'depositConditionType', 'depositConditionAmount',
          'amount', 'percentage', 'numberOfPlayers', 'usagePerPlayer', 'startDate', 'endDate',
          'wagering', 'expiryBonusDays', 'depositRequired',
        ] as const) {
          assert.equal(after[key], before[key], `${label} keeps ${key}`)
        }

        if (to === 'signup' || to === 'direct_amount') {
          assert.equal(after.amountType, 'fixed', label)
          assert.equal(after.distributionType, before.distributionType, label)
          assert.equal(after.releaseType, before.releaseType, label)
        } else if (to === 'losing_bonus') {
          assert.equal(after.distributionType, 'roll_over', label)
          assert.equal(after.amountType, 'percentage', label)
          assert.equal(after.releaseType, before.releaseType || 'bonus_amount_only', label)
        } else {
          assert.equal(after.amountType, before.amountType, label)
          assert.equal(after.distributionType, before.distributionType, label)
          assert.equal(after.releaseType, before.releaseType, label)
        }

        const family = FAMILY[to]
        for (const key of Object.keys(family) as (keyof TypeFamily)[]) {
          assert.equal(visibility[key], family[key], `${label} ${key}`)
        }
        if (to === 'signup' || to === 'direct_amount' || to === 'special') {
          assert.equal(visibility.showAmount, true, label)
          assert.equal(visibility.showPercentage, false, `${label} hides Percentage`)
          assert.equal(input.amountType, 'fixed', label)
        } else if (to === 'losing_bonus') {
          assert.equal(visibility.showAmount, false, label)
          assert.equal(visibility.showPercentage, true, label)
          assert.equal(input.amountType, 'percentage', label)
          assert.equal(input.distributionType, 'roll_over', label)
          assert.equal(input.domain, 'sports', label)
        } else {
          assert.equal(visibility.showAmount, after.amountType === 'fixed', label)
          assert.equal(visibility.showPercentage, after.amountType === 'percentage', label)
          assert.equal(input.amountType, after.amountType, label)
        }
        if (to !== 'losing_bonus') assert.equal(input.domain, 'global', label)
        assert.equal(input.type, to, label)
      }
    }
    assert.equal(transitions, 30)
  })

  test('reports each conditional form family from the controls the legacy page mounted', () => {
    const base = { amountType: 'fixed', distributionType: '' } as const
    assert.deepEqual(getBonusCreateVisibility({ ...base, bonusType: 'deposit' }), {
      isLosingBonus: false,
      hideUsagePerPlayer: false,
      showDepositRequired: false,
      showDepositConditions: true,
      showWagering: false,
      showReleaseType: false,
      showAmountType: true,
      showAmount: true,
      showPercentage: false,
    })
    // No type chosen yet: the legacy page already showed Amount Type and the Fixed amount.
    assert.equal(getBonusCreateVisibility({ ...base, bonusType: '' }).showAmount, true)
    assert.equal(getBonusCreateVisibility({ ...base, bonusType: '' }).showAmountType, true)

    const losing = getBonusCreateVisibility({
      bonusType: 'losing_bonus',
      amountType: 'percentage',
      distributionType: 'roll_over',
    })
    assert.equal(losing.showWagering, true)
    assert.equal(losing.showReleaseType, true)
    assert.equal(losing.showPercentage, true)
    assert.equal(losing.showAmount, false)

    const special = getBonusCreateVisibility({ ...base, bonusType: 'special' })
    assert.equal(special.showWagering, true, 'Special always asks for wagering')
    assert.equal(special.showReleaseType, false)
    assert.equal(special.showAmount, true)

    // Roll Over alone brings wagering and the release type to any family.
    const rollOverDeposit = getBonusCreateVisibility({ ...base, bonusType: 'deposit', distributionType: 'roll_over' })
    assert.equal(rollOverDeposit.showWagering, true)
    assert.equal(rollOverDeposit.showReleaseType, true)
    // A Roll Over retained from another type still shows them for Signup, whose option is disabled.
    const rollOverSignup = getBonusCreateVisibility({ ...base, bonusType: 'signup', distributionType: 'roll_over' })
    assert.equal(rollOverSignup.showWagering, true)
    assert.equal(rollOverSignup.showReleaseType, true)

    const losingThenDeposit = getBonusCreateVisibility({
      bonusType: 'deposit',
      amountType: 'percentage',
      distributionType: 'roll_over',
    })
    assert.equal(losingThenDeposit.showWagering, true)
    assert.equal(losingThenDeposit.showReleaseType, true)
    assert.equal(losingThenDeposit.showPercentage, true)
    assert.equal(losingThenDeposit.showAmount, false)

    // A retained Percentage never shows for Special: the hidden radio group reported no amount type.
    const percentageThenSpecial = getBonusCreateVisibility({
      bonusType: 'special',
      amountType: 'percentage',
      distributionType: 'instant_otp',
    })
    assert.equal(percentageThenSpecial.showPercentage, false)
    assert.equal(percentageThenSpecial.showAmount, true)
  })

  test('validates all six offered bonus families and the dormant referral family', () => {
    const validByType: Record<BonusType, BonusCreateValues> = {
      deposit: directValues({
        bonusType: 'deposit',
        depositConditionType: 'greater_than',
        depositConditionAmount: 1_000,
      }),
      daily_first_deposit: directValues({
        bonusType: 'daily_first_deposit',
        depositConditionType: 'equal_to',
        depositConditionAmount: 2_000,
      }),
      signup: directValues({ bonusType: 'signup', depositRequired: true }),
      direct_amount: directValues(),
      losing_bonus: directValues({
        bonusType: 'losing_bonus',
        domain: 'sports',
        distributionType: 'roll_over',
        amountType: 'percentage',
        amount: null,
        percentage: 10,
        wagering: 2,
        releaseType: 'bonus_amount_only',
      }),
      special: directValues({
        bonusType: 'special',
        distributionType: 'instant_otp',
        amount: null,
        wagering: 1,
      }),
      referral_deposit: directValues({
        bonusType: 'referral_deposit',
        depositConditionType: 'greater_than',
        depositConditionAmount: 100,
      }),
    }

    for (const [type, values] of Object.entries(validByType)) {
      assert.equal(bonusCreateSchema.safeParse(values).success, true, `${type} should be valid`)
    }
  })

  test('enforces conditional required fields while ignoring invalid dormant fields', () => {
    assert.equal(issues(directValues({ campaignName: '' })).campaignName, 'Campaign name is required')
    assert.equal(
      issues(directValues({ campaignName: 'ab' })).campaignName,
      'Campaign name must be at least 3 characters',
    )
    // antd's required/min rules counted characters, so three spaces passed; that stays true.
    assert.equal(issues(directValues({ campaignName: '   ' })).campaignName, undefined)
    assert.equal(issues(directValues({ currency: '' })).currency, 'Currency is required')
    assert.equal(issues(directValues({ bonusType: '' })).bonusType, 'Bonus type is required')
    assert.equal(issues(directValues({ amount: null })).amount, 'Amount is required')
    assert.equal(
      issues(directValues({ bonusType: 'deposit', amountType: '' })).amountType,
      'Amount type is required',
    )

    const depositErrors = issues(directValues({
      bonusType: 'deposit',
      depositConditionType: '',
      depositConditionAmount: null,
    }))
    assert.equal(depositErrors.depositConditionType, 'Deposit condition type is required')
    assert.equal(depositErrors.depositConditionAmount, 'Deposit condition amount is required')

    const losingErrors = issues(changeType(directValues({
      amount: null,
      domain: '',
      percentage: null,
      wagering: null,
      releaseType: '',
    }), 'losing_bonus'))
    // The patch supplies Bonus Amount Only, so a cleared release type is the only way to lose it.
    const clearedRelease = issues({ ...changeType(directValues(), 'losing_bonus'), releaseType: '' })
    assert.equal(losingErrors.domain, 'Domain is required for Losing Bonus')
    assert.equal(losingErrors.distributionType, undefined, 'the legacy page had no Losing Bonus distribution rule')
    assert.equal(losingErrors.percentage, 'Percentage is required for Losing Bonus')
    assert.equal(losingErrors.wagering, 'Wagering requirement is required for Losing Bonus')
    assert.equal(losingErrors.amount, undefined, 'Amount is hidden for Losing Bonus')
    assert.equal(clearedRelease.releaseType, 'Release type is required')
    assert.equal(
      issues(directValues({ bonusType: 'deposit', depositConditionType: 'equal_to', depositConditionAmount: 1, amountType: 'percentage', percentage: null })).percentage,
      'Percentage is required',
    )

    const specialErrors = issues(directValues({
      bonusType: 'special',
      distributionType: '',
      amount: null,
      wagering: null,
    }))
    assert.equal(specialErrors.distributionType, 'Distribution type is required for Special Bonus')
    assert.equal(specialErrors.wagering, 'Wagering requirement is required')
    assert.equal(specialErrors.amount, undefined, 'special campaign amount stays optional')

    // Invalid values behind hidden controls never block the submit.
    const staleHidden = directValues({
      bonusType: 'signup',
      depositConditionAmount: -5,
      percentage: 150,
      usagePerPlayer: 0,
      wagering: -1,
    })
    assert.equal(bonusCreateSchema.safeParse(staleHidden).success, true)
  })

  test('enforces number boundaries only where the control is shown', () => {
    const percentageValues = directValues({
      bonusType: 'deposit',
      depositConditionType: 'greater_than',
      depositConditionAmount: 0,
      amountType: 'percentage',
      amount: null,
      percentage: 0,
    })
    assert.equal(bonusCreateSchema.safeParse(percentageValues).success, true)
    assert.equal(bonusCreateSchema.safeParse({ ...percentageValues, percentage: 100 }).success, true)
    assert.equal(issues({ ...percentageValues, percentage: -0.01 }).percentage, 'Percentage must be between 0 and 100')
    assert.equal(issues({ ...percentageValues, percentage: 100.01 }).percentage, 'Percentage must be between 0 and 100')
    assert.equal(
      issues({ ...percentageValues, depositConditionAmount: -1 }).depositConditionAmount,
      'Deposit condition amount must be zero or greater',
    )

    assert.equal(bonusCreateSchema.safeParse(directValues({ amount: 0 })).success, true)
    assert.equal(issues(directValues({ amount: -1 })).amount, 'Amount must be zero or greater')
    const rollOver = directValues({ distributionType: 'roll_over', releaseType: 'bonus_amount_only', wagering: 0 })
    assert.equal(bonusCreateSchema.safeParse(rollOver).success, true)
    assert.equal(issues({ ...rollOver, wagering: -0.1 }).wagering, 'Wagering requirement must be zero or greater')

    const limits = directValues({
      bonusType: 'deposit',
      depositConditionType: 'greater_than',
      depositConditionAmount: 100,
    })
    for (const path of ['numberOfPlayers', 'usagePerPlayer'] as const) {
      assert.equal(bonusCreateSchema.safeParse({ ...limits, [path]: 1 }).success, true, path)
      assert.equal(bonusCreateSchema.safeParse({ ...limits, [path]: null }).success, true, path)
      assert.equal(issues({ ...limits, [path]: 1.5 })[path], 'Enter a whole number', path)
      assert.equal(issues({ ...limits, [path]: 0 })[path], 'Value must be at least 1', path)
    }
    // Expiry days keep the legacy floor instead of a whole-number rule: 7.5 is accepted, sent as 7.
    assert.equal(bonusCreateSchema.safeParse({ ...limits, expiryBonusDays: 7.5 }).success, true)
    assert.equal(serializeBonusCreate({ ...limits, expiryBonusDays: 7.5 }).expiryBonusDays, 7)
    assert.equal(issues({ ...limits, expiryBonusDays: 0.5 }).expiryBonusDays, 'Value must be at least 1')
    assert.equal(Object.hasOwn(serializeBonusCreate({ ...limits, expiryBonusDays: 0.5 }), 'expiryBonusDays'), false)
    assert.equal(Object.hasOwn(serializeBonusCreate({ ...limits, expiryBonusDays: null }), 'expiryBonusDays'), false)
    assert.equal(serializeBonusCreate({ ...limits, expiryBonusDays: 1 }).expiryBonusDays, 1)
  })

  test('validates optional IST calendar values and the cross-date relationship', () => {
    const scheduled = directValues({
      startDate: '2026-09-22T14:30',
      endDate: '2026-09-22T15:30',
    })
    assert.equal(bonusCreateSchema.safeParse(scheduled).success, true)
    assert.equal(bonusCreateSchema.safeParse({ ...scheduled, endDate: scheduled.startDate }).success, true)
    assert.equal(bonusCreateSchema.safeParse({ ...scheduled, endDate: '' }).success, true)
    assert.equal(bonusCreateSchema.safeParse({ ...scheduled, startDate: '' }).success, true)
    assert.equal(
      issues({ ...scheduled, endDate: '2026-09-22T14:29' }).endDate,
      'End date must be after start date',
    )
    assert.equal(
      issues({ ...scheduled, endDate: '2026-09-21T23:59' }).endDate,
      'End date must be after start date',
    )
    assert.equal(
      issues({ ...scheduled, startDate: '2026-02-29T10:00' }).startDate,
      'Enter a valid start date and time',
    )
    assert.equal(
      issues({ ...scheduled, endDate: '2026-09-22T24:00' }).endDate,
      'Enter a valid end date and time',
    )
  })

  test('serializes the exact mutation input for every offered family (W1-S3 IST dates)', () => {
    const deposit = directValues({
      bonusType: 'deposit',
      depositConditionType: 'greater_than',
      depositConditionAmount: 10_00_000,
      distributionType: 'instant_otp',
      numberOfPlayers: 100,
      usagePerPlayer: 2,
      expiryBonusDays: 30,
      startDate: '2026-10-01T00:00',
      endDate: '2026-10-31T23:59',
    })
    assert.deepEqual(serializeBonusCreate(deposit), {
      name: 'Welcome reward',
      domain: 'global',
      type: 'deposit',
      status: 'draft',
      currency: 'INR',
      budgetNumeric: 0,
      depositConditionType: 'greater_than',
      depositConditionAmount: 10_00_000,
      distributionType: 'instant_otp',
      amountType: 'fixed',
      amount: 500,
      percentage: undefined,
      numberOfPlayers: 100,
      usagePerPlayer: 2,
      startDate: '2026-09-30T18:30:00.000Z',
      endDate: '2026-10-31T18:29:00.000Z',
      wagering: undefined,
      expiryBonusDays: 30,
    })

    const daily = directValues({
      bonusType: 'daily_first_deposit',
      depositConditionType: 'equal_to',
      depositConditionAmount: 2_000,
      distributionType: 'roll_over',
      wagering: 1.5,
      releaseType: 'total_bonus_wallet',
      amountType: 'percentage',
      percentage: 15,
      usagePerPlayer: null,
    })
    assert.deepEqual(serializeBonusCreate(daily), {
      name: 'Welcome reward',
      domain: 'global',
      type: 'daily_first_deposit',
      status: 'draft',
      currency: 'INR',
      budgetNumeric: 0,
      depositConditionType: 'equal_to',
      depositConditionAmount: 2_000,
      distributionType: 'roll_over',
      amountType: 'percentage',
      amount: undefined,
      percentage: 15,
      numberOfPlayers: undefined,
      usagePerPlayer: 1,
      startDate: undefined,
      endDate: undefined,
      wagering: 1.5,
      releaseType: 'total_bonus_wallet',
    })

    const signup = directValues({
      bonusType: 'signup',
      distributionType: 'instant_cash',
      amount: 750,
      numberOfPlayers: 25,
      usagePerPlayer: 9,
      startDate: '2026-09-22T14:30',
      expiryBonusDays: 7.9,
      depositRequired: true,
    })
    assert.deepEqual(serializeBonusCreate(signup), {
      name: 'Welcome reward',
      domain: 'global',
      type: 'signup',
      status: 'draft',
      currency: 'INR',
      budgetNumeric: 0,
      depositConditionType: undefined,
      depositConditionAmount: undefined,
      distributionType: 'instant_cash',
      amountType: 'fixed',
      amount: 750,
      percentage: undefined,
      numberOfPlayers: 25,
      startDate: '2026-09-22T09:00:00.000Z',
      endDate: undefined,
      wagering: undefined,
      expiryBonusDays: 7,
      depositRequired: true,
    })

    assert.deepEqual(serializeBonusCreate(directValues()), {
      name: 'Welcome reward',
      domain: 'global',
      type: 'direct_amount',
      status: 'draft',
      currency: 'INR',
      budgetNumeric: 0,
      depositConditionType: undefined,
      depositConditionAmount: undefined,
      distributionType: undefined,
      amountType: 'fixed',
      amount: 500,
      percentage: undefined,
      numberOfPlayers: undefined,
      startDate: undefined,
      endDate: undefined,
      wagering: undefined,
    })

    const losing = changeType(directValues({
      domain: 'casino',
      percentage: 12.5,
      wagering: 2,
    }), 'losing_bonus')
    assert.deepEqual(serializeBonusCreate(losing), {
      name: 'Welcome reward',
      domain: 'casino',
      type: 'losing_bonus',
      status: 'draft',
      currency: 'INR',
      budgetNumeric: 0,
      depositConditionType: undefined,
      depositConditionAmount: undefined,
      distributionType: 'roll_over',
      amountType: 'percentage',
      amount: undefined,
      percentage: 12.5,
      numberOfPlayers: undefined,
      usagePerPlayer: 1,
      startDate: undefined,
      endDate: undefined,
      wagering: 2,
      releaseType: 'bonus_amount_only',
    })

    const special = directValues({
      bonusType: 'special',
      distributionType: 'instant_otp',
      amount: null,
      wagering: 1,
    })
    assert.deepEqual(serializeBonusCreate(special), {
      name: 'Welcome reward',
      domain: 'global',
      type: 'special',
      status: 'draft',
      currency: 'INR',
      budgetNumeric: 0,
      depositConditionType: undefined,
      depositConditionAmount: undefined,
      distributionType: 'instant_otp',
      amountType: 'fixed',
      amount: 0,
      percentage: undefined,
      numberOfPlayers: undefined,
      usagePerPlayer: 1,
      startDate: undefined,
      endDate: undefined,
      wagering: 1,
    })
    assert.equal(serializeBonusCreate({ ...special, amount: 250 }).amount, 250)
  })

  test('forces the Losing Bonus distribution and release even from inconsistent state', () => {
    const losing = serializeBonusCreate(directValues({
      bonusType: 'losing_bonus',
      domain: 'matka',
      distributionType: 'instant_cash',
      amountType: 'fixed',
      percentage: 5,
      wagering: 1,
      releaseType: 'total_bonus_wallet',
    }))
    assert.equal(losing.distributionType, 'roll_over')
    assert.equal(losing.amountType, 'percentage')
    // The release control is mounted only under Roll Over, so the legacy default applies here.
    assert.equal(losing.releaseType, 'bonus_amount_only')
  })

  test('keeps hidden values in state for their return but never submits them (W1-S4)', () => {
    const deposit = directValues({
      bonusType: 'deposit',
      depositConditionType: 'equal_to',
      depositConditionAmount: 1_000,
      distributionType: 'roll_over',
      wagering: 3,
      releaseType: 'total_bonus_wallet',
      amountType: 'percentage',
      amount: 250,
      percentage: 12.5,
    })

    const special = changeType(deposit, 'special')
    assert.equal(special.percentage, 12.5, 'the retained percentage stays in form state')
    assert.equal(special.depositConditionAmount, 1_000)
    assert.equal(special.amountType, 'percentage')
    const specialInput = serializeBonusCreate(special)
    assert.equal(specialInput.percentage, undefined)
    assert.equal(specialInput.depositConditionType, undefined)
    assert.equal(specialInput.depositConditionAmount, undefined)
    assert.equal(specialInput.amountType, 'fixed')
    // Controls Special still shows submit their retained values, as the legacy page did.
    assert.equal(specialInput.amount, 250)
    assert.equal(specialInput.wagering, 3)
    assert.equal(specialInput.releaseType, 'total_bonus_wallet')

    const signup = changeType(deposit, 'signup')
    const signupInput = serializeBonusCreate(signup)
    assert.equal(signupInput.percentage, undefined)
    assert.equal(signupInput.depositConditionAmount, undefined)
    assert.equal(Object.hasOwn(signupInput, 'usagePerPlayer'), false)

    const losing = changeType(deposit, 'losing_bonus')
    assert.equal(serializeBonusCreate(losing).amount, undefined)
    assert.equal(serializeBonusCreate(losing).depositConditionAmount, undefined)

    const back = changeType(special, 'deposit')
    const backInput = serializeBonusCreate(back)
    assert.equal(getBonusCreateVisibility(back).showPercentage, true, 'the retained percentage returns')
    assert.equal(backInput.percentage, 12.5)
    assert.equal(backInput.depositConditionAmount, 1_000)
    assert.equal(backInput.amount, undefined, 'Amount is hidden again under Percentage')
  })

  test('keeps a retained select value visible and unselectable', () => {
    const options = [
      { value: 'INR', label: '₹ INR - Indian Rupee' },
      { value: 'AED', label: 'د.إ AED - UAE Dirham' },
    ]
    assert.equal(withRetainedOption(options, 'INR'), options)
    assert.equal(withRetainedOption(options, ''), options)
    assert.deepEqual(withRetainedOption(options, 'USD'), [
      ...options,
      { value: 'USD', label: 'USD', disabled: true },
    ])
  })
})
