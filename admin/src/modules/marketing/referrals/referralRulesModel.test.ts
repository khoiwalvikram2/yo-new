import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  PAYOUT_TYPES,
  RULE_TYPES,
  VISIBLE_RULE_TYPES,
  activeRuleCount,
  buildRuleInput,
  cleanDecimal,
  createRuleFormSchema,
  createRuleInitialValues,
  displayedRules,
  formatRuleValue,
  payoutTypeHue,
  payoutTypeOptions,
  programTiers,
  ruleDrawerCopy,
  ruleFormSummary,
  ruleToFormValues,
  ruleTypeChangePatch,
  ruleTypeHue,
  ruleTypeLabel,
  ruleTypeOptions,
  rulesCountLabel,
  tierCaption,
  tierRatesHelp,
  tierRatesLabel,
  type ReferralRule,
  type RuleFormValues,
} from './referralRulesModel'

const money = (amount: number) => `INR ${Number(amount).toFixed(2)}`

function rule(overrides: Partial<ReferralRule>): ReferralRule {
  return {
    id: '7',
    ruleType: 'SIGNUP_CPA',
    tierRates: null,
    fixedAmounts: null,
    thresholds: null,
    payoutType: 'CASH',
    reloadDepositsCount: null,
    reloadMinDeposit: null,
    isActive: true,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  }
}

function values(overrides: Partial<RuleFormValues>): RuleFormValues {
  return { ...createRuleInitialValues(), ...overrides }
}

async function errorsFor(input: RuleFormValues, tiers = programTiers(1)) {
  const parsed = await createRuleFormSchema(tiers).safeParseAsync(input)
  if (parsed.success) return {}
  return Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]))
}

describe('rule types and table copy', () => {
  test('labels, the offered list and the hue each legacy colour maps to', () => {
    assert.deepEqual(RULE_TYPES.map((type) => type.label), [
      'Signup CPA', 'First Deposit %', 'Reload Deposits %', 'Loss Share', 'Turnover Milestone',
    ])
    assert.deepEqual(VISIBLE_RULE_TYPES.map((type) => type.value), [
      'SIGNUP_CPA', 'FIRST_DEPOSIT_PCT', 'RELOAD_DEPOSITS_PCT',
    ])
    assert.equal(ruleTypeLabel('LOSS_SHARE'), 'Loss Share')
    assert.equal(ruleTypeLabel('DEPOSITS_WINDOW_PCT'), 'DEPOSITS WINDOW PCT')
    assert.deepEqual(
      ['SIGNUP_CPA', 'FIRST_DEPOSIT_PCT', 'RELOAD_DEPOSITS_PCT', 'LOSS_SHARE', 'TURNOVER_MILESTONE', 'COUPON']
        .map(ruleTypeHue),
      ['blu', 'grn', 'ind', 'red', 'amb', 'amb'],
    )
    assert.deepEqual(['CASH', 'BONUS', 'SPLIT', null].map(payoutTypeHue), ['grn', 'blu', 'vio', 'vio'])
    assert.deepEqual(PAYOUT_TYPES.map((type) => type.label), ['Cash Wallet', 'Bonus Wallet', 'Split (Cash + Bonus)'])
  })

  test('REVSHARE is never listed, and the head counts active rules', () => {
    const list = [
      rule({ id: '1', isActive: true }),
      rule({ id: '2', ruleType: 'REVSHARE', isActive: true }),
      rule({ id: '3', ruleType: 'FIRST_DEPOSIT_PCT', isActive: false }),
    ]
    const shown = displayedRules(list)
    assert.deepEqual(shown.map((item) => item.id), ['1', '3'])
    assert.equal(activeRuleCount(shown), 1)
    assert.equal(rulesCountLabel(1, 2), '1 of 2 rules active')
    assert.equal(rulesCountLabel(1, 1), '1 of 1 rule active')
    assert.equal(rulesCountLabel(0, 0), '0 of 0 rules active')
  })

  test('the Config text for every rule type, with the legacy fallbacks', () => {
    assert.equal(formatRuleValue(rule({ fixedAmounts: { 1: 250 } }), money), 'INR 250.00')
    assert.equal(formatRuleValue(rule({ fixedAmounts: null }), money), 'INR 0.00')
    assert.equal(formatRuleValue(rule({ ruleType: 'FIRST_DEPOSIT_PCT', fixedAmounts: { 1: 10 } }), money), '10%')
    assert.equal(formatRuleValue(rule({ ruleType: 'FIRST_DEPOSIT_PCT', tierRates: { 1: 4 } }), money), '4%')
    assert.equal(formatRuleValue(rule({ ruleType: 'FIRST_DEPOSIT_PCT' }), money), '0%')
    assert.equal(
      formatRuleValue(rule({ ruleType: 'RELOAD_DEPOSITS_PCT', fixedAmounts: { 1: 2.5 }, reloadDepositsCount: 0 }), money),
      '2.5% (unlimited)',
    )
    assert.equal(
      formatRuleValue(
        rule({ ruleType: 'RELOAD_DEPOSITS_PCT', fixedAmounts: { 1: 3 }, reloadDepositsCount: 5, reloadMinDeposit: 500 }),
        money,
      ),
      '3% (5 deposits, min INR 500.00)',
    )
    assert.equal(
      formatRuleValue(rule({ ruleType: 'LOSS_SHARE', tierRates: { 1: 10, 2: 0, 3: 2.5 } }), money),
      'L1: 10%, L3: 2.5%',
    )
    assert.equal(formatRuleValue(rule({ ruleType: 'LOSS_SHARE', tierRates: { 1: 0 } }), money), 'Not configured')
    assert.equal(
      formatRuleValue(
        rule({ ruleType: 'TURNOVER_MILESTONE', fixedAmounts: { 1: 1 }, thresholds: { turnoverTarget: 100000 } }),
        money,
      ),
      '1% @ INR 100000.00',
    )
    assert.equal(formatRuleValue(rule({ ruleType: 'COUPON' }), money), '—')
  })
})

describe('program tiers', () => {
  test('tiers are on above depth 1; Loss Share then shows maxDepth fields, otherwise the direct one', () => {
    assert.deepEqual(programTiers(undefined), { enabled: false, count: 1 })
    assert.deepEqual(programTiers(null), { enabled: false, count: 1 })
    assert.deepEqual(programTiers(1), { enabled: false, count: 1 })
    assert.deepEqual(programTiers(3), { enabled: true, count: 3 })
    assert.equal(tierRatesLabel(programTiers(3)), 'Tier Rates (%) - 3 Tiers')
    assert.equal(tierRatesLabel(programTiers(1)), 'Percentage (%) - Direct Only')
    assert.equal(
      tierRatesHelp(programTiers(4)),
      'Configure percentage for each tier (1-4). Tier 1 is direct referral.',
    )
    assert.equal(tierRatesHelp(programTiers(1)), 'Commission percentage for direct referrals only.')
    assert.equal(tierCaption(1), 'Direct referral')
    assert.equal(tierCaption(3), 'Level 3 referral')
  })
})

describe('form values', () => {
  test('a new rule starts from the legacy initial values', () => {
    assert.deepEqual(createRuleInitialValues(), {
      ruleType: '',
      payoutType: 'CASH',
      isActive: true,
      fixedAmount: null,
      firstDepositPercent: null,
      reloadDepositsPercent: null,
      reloadDepositsCount: 0,
      reloadMinDeposit: 0,
      tierRates: [],
      turnoverPercent: null,
      turnoverTarget: null,
    })
  })

  test('changing the rule type clears every rule field and seeds the reload and tier defaults', () => {
    assert.deepEqual(ruleTypeChangePatch('RELOAD_DEPOSITS_PCT', programTiers(1)), {
      ruleType: 'RELOAD_DEPOSITS_PCT',
      fixedAmount: null,
      firstDepositPercent: null,
      reloadDepositsPercent: null,
      reloadDepositsCount: 0,
      reloadMinDeposit: 0,
      tierRates: [],
      turnoverPercent: null,
      turnoverTarget: null,
    })
    assert.deepEqual(ruleTypeChangePatch('LOSS_SHARE', programTiers(4)).tierRates, [0, 0, 0, 0])
    assert.deepEqual(ruleTypeChangePatch('LOSS_SHARE', programTiers(1)).tierRates, [0])
  })

  test('a stored rule fills the form the way handleEdit did', () => {
    const tiers = programTiers(1)
    assert.deepEqual(ruleToFormValues(rule({ fixedAmounts: { 1: '75' }, isActive: null }), tiers), values({
      ruleType: 'SIGNUP_CPA', fixedAmount: 75, isActive: false,
    }))
    assert.equal(
      ruleToFormValues(rule({ ruleType: 'FIRST_DEPOSIT_PCT', tierRates: { 1: 6 } }), tiers).firstDepositPercent,
      6,
    )
    const reload = ruleToFormValues(
      rule({ ruleType: 'RELOAD_DEPOSITS_PCT', fixedAmounts: { 1: 2 }, reloadDepositsCount: null, reloadMinDeposit: 500, payoutType: 'BONUS' }),
      tiers,
    )
    assert.equal(reload.reloadDepositsPercent, 2)
    assert.equal(reload.reloadDepositsCount, 0)
    assert.equal(reload.reloadMinDeposit, 500)
    assert.equal(reload.payoutType, 'BONUS')
    assert.deepEqual(
      ruleToFormValues(rule({ ruleType: 'LOSS_SHARE', tierRates: { 1: 10, 3: 2 } }), programTiers(4)).tierRates,
      [10, 0, 2, 0],
    )
    assert.deepEqual(
      ruleToFormValues(rule({ ruleType: 'LOSS_SHARE', tierRates: { 1: 10, 3: 2 } }), tiers).tierRates,
      [10],
    )
    const turnover = ruleToFormValues(
      rule({ ruleType: 'TURNOVER_MILESTONE', fixedAmounts: null, tierRates: { 1: 1.5 }, thresholds: { turnoverTarget: 50000 } }),
      tiers,
    )
    assert.equal(turnover.turnoverPercent, 1.5)
    assert.equal(turnover.turnoverTarget, 50000)
    assert.equal(ruleToFormValues(rule({ payoutType: null }), tiers).payoutType, 'CASH')
  })

  test('rule type choices: configured types are disabled when adding, an unoffered type is kept when editing', () => {
    const list = [rule({ ruleType: 'SIGNUP_CPA' })]
    assert.deepEqual(ruleTypeOptions(list, false, ''), [
      { value: 'SIGNUP_CPA', label: 'Signup CPA (already configured)', disabled: true },
      { value: 'FIRST_DEPOSIT_PCT', label: 'First Deposit %', disabled: false },
      { value: 'RELOAD_DEPOSITS_PCT', label: 'Reload Deposits %', disabled: false },
    ])
    assert.deepEqual(ruleTypeOptions(list, true, 'SIGNUP_CPA')[0], {
      value: 'SIGNUP_CPA', label: 'Signup CPA', disabled: false,
    })
    assert.deepEqual(ruleTypeOptions(list, true, 'LOSS_SHARE').at(-1), {
      value: 'LOSS_SHARE', label: 'LOSS_SHARE', disabled: true,
    })
    assert.equal(payoutTypeOptions('CASH').length, 3)
    assert.deepEqual(payoutTypeOptions('WALLET').at(-1), { value: 'WALLET', label: 'WALLET', disabled: true })
  })

  test('drawer copy for adding, adding a chosen type and editing', () => {
    assert.deepEqual(ruleDrawerCopy(false, ''), {
      title: 'Create Rule',
      heading: 'New Referral Rule',
      sub: 'Configure a new referral rule',
      mode: 'New',
      hint: 'Configure reward rule for your referral program',
      submitLabel: 'Create Rule',
    })
    const chosen = ruleDrawerCopy(false, 'FIRST_DEPOSIT_PCT')
    assert.equal(chosen.heading, 'New: First Deposit %')
    assert.equal(chosen.sub, 'Configure First Deposit % rule')
    assert.deepEqual(ruleDrawerCopy(true, 'RELOAD_DEPOSITS_PCT'), {
      title: 'Edit Rule',
      heading: 'Editing: Reload Deposits %',
      sub: 'Update rule configuration',
      mode: 'Edit',
      hint: 'Update rule configuration and settings',
      submitLabel: 'Save Changes',
    })
    assert.equal(ruleFormSummary(1), 'Fix 1 highlighted field and submit again.')
    assert.equal(ruleFormSummary(3), 'Fix 3 highlighted fields and submit again.')
  })

  test('decimal steps lose their binary artefacts and nothing else', () => {
    assert.equal(cleanDecimal(0.1 + 0.2), 0.3)
    assert.equal(cleanDecimal(12.5), 12.5)
    assert.equal(cleanDecimal(null), null)
  })
})

describe('validation', () => {
  test('a rule type is required first', async () => {
    assert.deepEqual(await errorsFor(values({})), { ruleType: 'Rule type is required' })
  })

  test('Signup CPA and First Deposit messages', async () => {
    assert.deepEqual(await errorsFor(values({ ruleType: 'SIGNUP_CPA' })), { fixedAmount: 'Fixed amount is required' })
    assert.deepEqual(await errorsFor(values({ ruleType: 'SIGNUP_CPA', fixedAmount: -1 })), {
      fixedAmount: 'Amount must be positive',
    })
    assert.deepEqual(await errorsFor(values({ ruleType: 'SIGNUP_CPA', fixedAmount: 0 })), {})
    assert.deepEqual(await errorsFor(values({ ruleType: 'FIRST_DEPOSIT_PCT' })), {
      firstDepositPercent: 'Percentage is required',
    })
    assert.deepEqual(await errorsFor(values({ ruleType: 'FIRST_DEPOSIT_PCT', firstDepositPercent: 101 })), {
      firstDepositPercent: 'Must be between 0 and 100',
    })
  })

  test('Reload: percentage and count required, count 0-30 and whole, minimum whole and not negative', async () => {
    assert.deepEqual(
      await errorsFor(values({ ruleType: 'RELOAD_DEPOSITS_PCT', reloadDepositsCount: null, reloadMinDeposit: null })),
      { reloadDepositsPercent: 'Percentage is required', reloadDepositsCount: 'Number of deposits is required' },
    )
    assert.deepEqual(
      await errorsFor(values({ ruleType: 'RELOAD_DEPOSITS_PCT', reloadDepositsPercent: 2, reloadDepositsCount: 31 })),
      { reloadDepositsCount: 'Must be between 0 and 30' },
    )
    assert.deepEqual(
      await errorsFor(values({
        ruleType: 'RELOAD_DEPOSITS_PCT', reloadDepositsPercent: 2, reloadDepositsCount: 2.5, reloadMinDeposit: 99.5,
      })),
      { reloadDepositsCount: 'Enter a whole number', reloadMinDeposit: 'Enter a whole number' },
    )
    assert.deepEqual(
      await errorsFor(values({ ruleType: 'RELOAD_DEPOSITS_PCT', reloadDepositsPercent: 2, reloadMinDeposit: -100 })),
      { reloadMinDeposit: 'Must be 0 or greater' },
    )
  })

  test('Loss Share: each tier is required by name when tiers are on, and stays within 0-100', async () => {
    const tiers = programTiers(3)
    assert.deepEqual(
      await errorsFor(values({ ruleType: 'LOSS_SHARE', tierRates: [5, null, 120] }), tiers),
      { 'tierRates.1': 'Tier 2 percentage is required', 'tierRates.2': 'Must be between 0 and 100' },
    )
    assert.deepEqual(await errorsFor(values({ ruleType: 'LOSS_SHARE', tierRates: [] }), programTiers(1)), {
      'tierRates.0': 'Percentage is required',
    })
  })

  test('Turnover Milestone messages', async () => {
    assert.deepEqual(await errorsFor(values({ ruleType: 'TURNOVER_MILESTONE' })), {
      turnoverPercent: 'Percentage is required',
      turnoverTarget: 'Turnover target is required',
    })
    assert.deepEqual(
      await errorsFor(values({ ruleType: 'TURNOVER_MILESTONE', turnoverPercent: 1, turnoverTarget: -5 })),
      { turnoverTarget: 'Target must be positive' },
    )
  })

  test('fields of another rule type never block the submit', async () => {
    assert.deepEqual(
      await errorsFor(values({ ruleType: 'SIGNUP_CPA', fixedAmount: 10, reloadDepositsCount: 99, turnoverTarget: -1 })),
      {},
    )
  })
})

describe('the UpsertReferralRule input', () => {
  test('a new Signup CPA rule: legacy defaults, no ruleId, legacy key order', () => {
    const input = buildRuleInput(values({ ruleType: 'SIGNUP_CPA', fixedAmount: 150 }), null, programTiers(1))
    assert.deepEqual(input, {
      ruleType: 'SIGNUP_CPA',
      payoutType: 'CASH',
      splitRatio: { cash: 100, bonus: 0 },
      escrow: { untilKyc: false, untilFraudClear: false },
      isActive: true,
      fixedAmounts: { 1: 150 },
    })
    assert.deepEqual(Object.keys(input), ['ruleType', 'payoutType', 'splitRatio', 'escrow', 'isActive', 'fixedAmounts'])
  })

  test('an edited rule sends its id as a string, right after isActive', () => {
    const input = buildRuleInput(
      values({ ruleType: 'FIRST_DEPOSIT_PCT', firstDepositPercent: null, payoutType: 'BONUS', isActive: false }),
      42,
      programTiers(1),
    )
    assert.deepEqual(Object.keys(input), [
      'ruleType', 'payoutType', 'splitRatio', 'escrow', 'isActive', 'ruleId', 'fixedAmounts',
    ])
    assert.equal(input.ruleId, '42')
    assert.equal(input.payoutType, 'BONUS')
    assert.equal(input.isActive, false)
    assert.deepEqual(input.fixedAmounts, { 1: 0 })
  })

  test('Reload sends the count and minimum, falling back to 0 outside their ranges', () => {
    assert.deepEqual(
      buildRuleInput(
        values({ ruleType: 'RELOAD_DEPOSITS_PCT', reloadDepositsPercent: 2.5, reloadDepositsCount: 5, reloadMinDeposit: 500 }),
        '9',
        programTiers(1),
      ),
      {
        ruleType: 'RELOAD_DEPOSITS_PCT',
        payoutType: 'CASH',
        splitRatio: { cash: 100, bonus: 0 },
        escrow: { untilKyc: false, untilFraudClear: false },
        isActive: true,
        ruleId: '9',
        fixedAmounts: { 1: 2.5 },
        reloadDepositsCount: 5,
        reloadMinDeposit: 500,
      },
    )
    const fallback = buildRuleInput(
      values({ ruleType: 'RELOAD_DEPOSITS_PCT', reloadDepositsCount: 45, reloadMinDeposit: -1 }),
      null,
      programTiers(1),
    )
    assert.equal(fallback.reloadDepositsCount, 0)
    assert.equal(fallback.reloadMinDeposit, 0)
  })

  test('Loss Share sends every tier (or the direct one) and empty fixed amounts', () => {
    const tiered = buildRuleInput(values({ ruleType: 'LOSS_SHARE', tierRates: [10, null, 2] }), '3', programTiers(3))
    assert.deepEqual(tiered.tierRates, { 1: 10, 2: 0, 3: 2 })
    assert.deepEqual(tiered.fixedAmounts, {})
    assert.deepEqual(Object.keys(tiered).slice(-2), ['tierRates', 'fixedAmounts'])
    assert.deepEqual(
      buildRuleInput(values({ ruleType: 'LOSS_SHARE', tierRates: [7] }), '3', programTiers(1)).tierRates,
      { 1: 7 },
    )
  })

  test('Turnover Milestone sends the percentage and the threshold', () => {
    const input = buildRuleInput(
      values({ ruleType: 'TURNOVER_MILESTONE', turnoverPercent: 1, turnoverTarget: 100000, payoutType: 'SPLIT' }),
      '5',
      programTiers(1),
    )
    assert.deepEqual(input.fixedAmounts, { 1: 1 })
    assert.deepEqual(input.thresholds, { turnoverTarget: 100000 })
    assert.equal(input.payoutType, 'SPLIT')
  })
})
