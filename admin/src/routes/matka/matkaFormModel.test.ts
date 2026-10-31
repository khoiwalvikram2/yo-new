import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  DEFAULT_STATUS_REASON,
  MATKA_LIST_PATH,
  MATKA_STEPS,
  SAVE_FAILURE,
  buildCreateMatkaInput,
  buildUpdateMatkaInput,
  createMatkaInitialValues,
  matkaFormSchema,
  matkaStepFields,
  matkaValuesFromRecord,
  needsStatusReason,
  pageSubtitle,
  pageTitle,
  sameDays,
  sanitizeMatkaInput,
  selectedDaysSummary,
  slugFromMatkaName,
  statusChangeVariables,
  toggleDay,
  type MatkaFormValues,
} from './matkaFormModel'

function values(patch: Partial<MatkaFormValues> = {}): MatkaFormValues {
  const initial = createMatkaInitialValues()
  return {
    ...initial,
    ...patch,
    schedule: { ...initial.schedule, ...patch.schedule },
    limits: { ...initial.limits, ...patch.limits },
    visibility: { ...initial.visibility, ...patch.visibility },
    settings: { ...initial.settings, ...patch.settings },
  }
}

function errors(isEdit: boolean, input: MatkaFormValues): Record<string, string> {
  const parsed = matkaFormSchema(isEdit).safeParse(input)
  if (parsed.success) return {}
  const found: Record<string, string> = {}
  for (const issue of parsed.error.issues) found[issue.path.join('.')] ??= issue.message
  return found
}

describe('matka form copy and defaults', () => {
  test('keeps the legacy route, three steps, titles and subtitles', () => {
    assert.equal(MATKA_LIST_PATH, '/matka/list')
    assert.deepEqual(MATKA_STEPS, [
      { title: 'Basic Info', description: 'Name & schedule', footer: 'Basic Info' },
      { title: 'Betting Configuration', description: 'Limits & settings', footer: 'Betting Configuration' },
      { title: 'Review', description: 'Confirm & create', footer: 'Review & Create' },
    ])
    assert.equal(pageTitle(false), 'Create Matka')
    assert.equal(pageTitle(true), 'Edit Matka')
    assert.equal(pageSubtitle(false), 'Configure new matka with schedule and betting limits')
    assert.equal(pageSubtitle(true), 'Update matka configuration')
    assert.equal(SAVE_FAILURE, 'Failed to save matka. Please check the form and try again.')
  })

  test('starts with the same timezone, schedule, limits, status, visibility and settings', () => {
    assert.deepEqual(createMatkaInitialValues(), {
      name: '', code: '', description: '', timezone: 'Asia/Kolkata', status: 'ACTIVE',
      schedule: { openTime: '09:00', closeTime: '21:00', daysOfWeek: [1, 2, 3, 4, 5, 6], closesNextDay: false },
      limits: { minBet: 10, maxBet: 10000 }, visibility: { featured: false }, priority: 0,
      settings: {
        matkaType: 'worli', openSuspended: false, closeSuspended: false, message: '',
        autoPauseOnLiabilityThreshold: null,
        betWindowMinsBeforeOpen: 15,
        betWindowMinsBeforeClose: 10,
        notes: '',
      },
    })
  })

  test('hydrates an edit while preserving unknown schedule, limit, visibility and setting keys', () => {
    assert.deepEqual(matkaValuesFromRecord({
      name: 'Milan Day', code: 'milan-day', description: null, timezone: 'UTC', status: 'INACTIVE', priority: 4,
      schedule: { openTime: '10:15', closeTime: '16:45', daysOfWeek: [0, 6], market: 'DAY', closesNextDay: false },
      limits: { minBet: 50, maxBet: 50000, exposureCap: 100000 },
      visibility: { featured: true, lobby: false },
      settings: { betWindowMinsBeforeOpen: 5, betWindowMinsBeforeClose: 8, notes: 'Desk', risk: 'LOW' },
    }), {
      name: 'Milan Day', code: 'milan-day', description: '', timezone: 'UTC', status: 'INACTIVE', priority: 4,
      schedule: { openTime: '10:15', closeTime: '16:45', daysOfWeek: [0, 6], market: 'DAY', closesNextDay: false },
      limits: { minBet: 50, maxBet: 50000, exposureCap: 100000 },
      visibility: { featured: true, lobby: false },
      settings: {
        matkaType: 'worli', openSuspended: false, closeSuspended: false, message: '',
        autoPauseOnLiabilityThreshold: null,
        betWindowMinsBeforeOpen: 5,
        betWindowMinsBeforeClose: 8,
        notes: 'Desk',
        risk: 'LOW',
      },
    })
  })
})

describe('matka form validation and day helpers', () => {
  test('step zero validates the legacy fields; betting Next intentionally validates none', () => {
    assert.deepEqual(matkaStepFields(0, false), [
      'name', 'code', 'schedule.openTime', 'schedule.closeTime', 'schedule.daysOfWeek',
    ])
    assert.deepEqual(matkaStepFields(0, true), [
      'name', 'schedule.openTime', 'schedule.closeTime', 'schedule.daysOfWeek',
    ])
    assert.deepEqual(matkaStepFields(1, false), [])
    assert.deepEqual(matkaStepFields(2, true), [])
  })

  test('create requires name, kebab-case code, both times and at least one day; edit does not require code', () => {
    const invalid = values({
      name: '',
      code: 'Bad Code',
      schedule: { openTime: '', closeTime: '', daysOfWeek: [] },
    })
    assert.deepEqual(errors(false, invalid), {
      name: 'Please enter name',
      code: 'kebab-case only (a-z, 0-9, - )',
      'schedule.openTime': 'Required',
      'schedule.closeTime': 'Required',
      'schedule.daysOfWeek': 'Select at least one day',
    })
    assert.equal(errors(true, { ...invalid, name: 'Milan' }).code, undefined)
  })

  test('full submit requires limits, status and cutoffs, and keeps all legacy non-negative rules', () => {
    const invalid = values({
      name: 'Milan', code: 'milan', status: '', priority: -1,
      limits: { minBet: null, maxBet: -1 },
      settings: {
        autoPauseOnLiabilityThreshold: -1,
        betWindowMinsBeforeOpen: null,
        betWindowMinsBeforeClose: -2,
        notes: '',
      },
    })
    assert.deepEqual(errors(false, invalid), {
      'limits.minBet': 'Please enter min bet amount',
      'limits.maxBet': 'Value must be at least 0',
      status: 'Required',
      priority: 'Value must be at least 0',
      'settings.autoPauseOnLiabilityThreshold': 'Value must be at least 0',
      'settings.betWindowMinsBeforeOpen': 'Please enter betting cutoff before open',
      'settings.betWindowMinsBeforeClose': 'Value must be at least 0',
    })
    assert.deepEqual(errors(false, values({ name: 'Milan', code: 'milan' })), {})
  })

  test('slugging, toggles, quick-set comparison and selection summaries match the legacy UI', () => {
    assert.equal(slugFromMatkaName('  Kalyan Morning++  '), 'kalyan-morning')
    assert.equal(slugFromMatkaName('---'), '')
    assert.deepEqual(toggleDay([1, 2], 2), [1])
    assert.deepEqual(toggleDay([1, 2], 0), [1, 2, 0])
    assert.equal(sameDays([1, 2, 3], [3, 1, 2]), true)
    assert.equal(sameDays([1, 2], [1, 2, 3]), false)
    assert.equal(selectedDaysSummary([]), 'No days selected')
    assert.equal(selectedDaysSummary([0, 1, 2, 3, 4, 5, 6]), 'Operating all week')
    assert.equal(selectedDaysSummary([0]), '1 day selected')
    assert.equal(selectedDaysSummary([0, 6]), '2 days selected')
  })
})

describe('matka form payloads', () => {
  test('recursive sanitation removes null/undefined fields while preserving arrays and false/zero/empty strings', () => {
    assert.deepEqual(sanitizeMatkaInput({
      a: null, b: undefined, c: 0, d: false, e: '', f: { x: 1, y: null }, g: [1, null, { z: undefined }],
    }), { c: 0, d: false, e: '', f: { x: 1 }, g: [1, undefined, {}] })
  })

  test('create sends the exact legacy key order, trims description and removes the absent threshold', () => {
    const input = buildCreateMatkaInput(values({
      name: 'Milan Day', code: 'milan-day', description: '  desk note  ', priority: null,
      settings: {
        matkaType: 'worli', openSuspended: false, closeSuspended: false, message: '',
        autoPauseOnLiabilityThreshold: null,
        betWindowMinsBeforeOpen: 15,
        betWindowMinsBeforeClose: 10,
        notes: '',
        retained: true,
      },
    }))
    assert.deepEqual(Object.keys(input), [
      'name', 'code', 'description', 'timezone', 'status', 'schedule', 'limits', 'visibility', 'priority', 'settings',
    ])
    assert.equal(input.description, 'desk note')
    assert.equal(input.priority, 0)
    assert.deepEqual(input.settings, {
      matkaType: 'worli', openSuspended: false, closeSuspended: false, message: '', betWindowMinsBeforeOpen: 15, betWindowMinsBeforeClose: 10, notes: '', retained: true,
    })
  })

  test('an empty description disappears; unchanged edit includes status and changed edit omits it', () => {
    const unchanged = buildUpdateMatkaInput('m1', values({
      name: 'Milan', code: 'ignored', description: '   ', status: 'ACTIVE',
    }), 'ACTIVE')
    assert.deepEqual(Object.keys(unchanged), [
      'id', 'name', 'timezone', 'status', 'schedule', 'limits', 'visibility', 'priority', 'settings',
    ])
    assert.equal(unchanged.status, 'ACTIVE')
    assert.equal('code' in unchanged, false)
    assert.equal('description' in unchanged, false)

    const changed = buildUpdateMatkaInput('m1', values({ status: 'SUSPEND' }), 'ACTIVE')
    assert.equal('status' in changed, false)
    assert.equal(needsStatusReason(values({ status: 'SUSPEND' }), 'ACTIVE'), true)
    assert.equal(needsStatusReason(values({ status: 'ACTIVE' }), 'ACTIVE'), false)
  })

  test('the dedicated status mutation keeps the entered reason and defaults an empty one', () => {
    assert.deepEqual(statusChangeVariables('m1', 'INACTIVE', 'Operator review'), {
      id: 'm1', toStatus: 'INACTIVE', reason: 'Operator review',
    })
    assert.deepEqual(statusChangeVariables('m1', 'SUSPEND', ''), {
      id: 'm1', toStatus: 'SUSPEND', reason: DEFAULT_STATUS_REASON,
    })
    assert.deepEqual(Object.keys(statusChangeVariables('m1', 'ACTIVE')), ['id', 'toStatus', 'reason'])
  })
})
