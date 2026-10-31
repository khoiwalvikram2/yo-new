import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import {
  createdAtLabel,
  createdAtRelative,
  findNotificationById,
  hasExtraMetadata,
  isMetadataObject,
  isValidDate,
  metadataAmountText,
  metadataJson,
  notificationCategoryTag,
  notificationCreatedAt,
  notificationDetailErrorText,
  notificationMetadataLines,
  notificationTypeHue,
} from './notificationDetailModel'

const formatAmount = (amount: number) => `INR ${amount.toFixed(2)}`

afterEach(() => {
  vi.useRealTimers()
})

describe('notificationDetailModel', () => {
  test('finds the route id among the rows by strict equality', () => {
    const rows = [{ id: '1' }, { id: '22' }, { id: 22 }]
    assert.equal(findNotificationById(rows, '22'), rows[1])
    assert.equal(findNotificationById(rows, '3'), undefined)
    assert.equal(findNotificationById([{ id: 7 }], '7'), undefined)
    assert.equal(findNotificationById(undefined, '1'), undefined)
    assert.equal(findNotificationById(rows, undefined), undefined)
  })

  test('reads createdAt as a Date, a string, or now when absent', () => {
    const now = new Date('2026-10-07T06:30:00.000Z')
    const date = new Date('2026-10-01T00:00:00.000Z')
    assert.equal(notificationCreatedAt(date, now), date)
    assert.equal(notificationCreatedAt('2026-10-02T10:00:00.000Z', now).toISOString(), '2026-10-02T10:00:00.000Z')
    assert.equal(notificationCreatedAt(null, now), now)
    assert.equal(notificationCreatedAt('', now), now)
    assert.equal(isValidDate(notificationCreatedAt('garbage', now)), false)
  })

  test('labels the created time in the tenant zone with its age, or says the date is invalid', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T06:30:00.000Z'))
    const calls: Array<[string, string]> = []
    const formatDateTime = (date: Date, format: string) => {
      calls.push([date.toISOString(), format])
      return '07 Oct 2026, 11:30:00'
    }
    const created = new Date('2026-10-07T06:00:00.000Z')

    assert.equal(createdAtLabel(created, formatDateTime), '07 Oct 2026, 11:30:00')
    assert.deepEqual(calls, [['2026-10-07T06:00:00.000Z', 'dd MMM yyyy, HH:mm:ss']])
    assert.equal(createdAtRelative(created), '(30 minutes ago)')
    assert.equal(createdAtLabel(new Date('x'), formatDateTime), 'Invalid date')
    assert.equal(createdAtRelative(new Date('x')), null)
    assert.equal(calls.length, 1)
  })

  test('maps the legacy type colours onto the decorative hues, exact case only', () => {
    assert.deepEqual(
      ['DEPOSIT', 'WITHDRAWAL', 'KYC', 'SYSTEM', 'AGENT', 'PLAYER', 'SETTLEMENT', 'COMMISSION', 'deposit', 'OTHER', null].map(
        notificationTypeHue,
      ),
      ['grn', 'amb', 'blu', 'vio', 'ind', 'red', 'amb', 'grn', 'neutral', 'neutral', 'neutral'],
    )
    assert.deepEqual(notificationCategoryTag('task'), { label: 'Task', hue: 'amb' })
    assert.deepEqual(notificationCategoryTag('general'), { label: 'General', hue: 'blu' })
    assert.deepEqual(notificationCategoryTag(null), { label: 'General', hue: 'blu' })
  })

  test('accepts only object metadata', () => {
    assert.equal(isMetadataObject({ a: 1 }), true)
    assert.equal(isMetadataObject({}), true)
    assert.equal(isMetadataObject(null), false)
    assert.equal(isMetadataObject('text'), false)
    assert.equal(isMetadataObject(5), false)
  })

  test('lists User, Phone and Amount only when present, Phone never as N/A', () => {
    assert.deepEqual(
      notificationMetadataLines({ userName: 'ravi_77', userPhone: '9876543210', amount: 25000, currency: 'INR' }, formatAmount),
      [
        { key: 'user', label: 'User:', value: 'ravi_77' },
        { key: 'phone', label: 'Phone:', value: '9876543210' },
        { key: 'amount', label: 'Amount:', value: 'INR 25000.00 INR' },
      ],
    )
    assert.deepEqual(notificationMetadataLines({ userPhone: 'N/A', amount: 0 }, formatAmount), [])
    assert.deepEqual(notificationMetadataLines({ amount: '1,200' }, formatAmount), [
      { key: 'amount', label: 'Amount:', value: '1,200 ' },
    ])
  })

  test('writes the amount as the legacy span did', () => {
    assert.equal(metadataAmountText(500, 'USD', formatAmount), 'INR 500.00 USD')
    assert.equal(metadataAmountText('500', undefined, formatAmount), '500 ')
    assert.equal(metadataAmountText('500', '', formatAmount), '500 ')
  })

  test('offers all metadata when a key beyond the listed ones exists', () => {
    assert.equal(hasExtraMetadata({ userName: 'a', userPhone: 'b', amount: 1, currency: 'INR' }), false)
    assert.equal(hasExtraMetadata({ userName: 'a', depositId: 9 }), true)
    assert.equal(hasExtraMetadata({}), false)
    assert.equal(metadataJson({ depositId: 9, nested: { ok: true } }), '{\n  "depositId": 9,\n  "nested": {\n    "ok": true\n  }\n}')
  })

  test('states a failed lookup with the server message when there is one', () => {
    assert.equal(notificationDetailErrorText({ message: 'Timeout' }), 'Failed to load notification: Timeout')
    assert.equal(notificationDetailErrorText(undefined), 'Failed to load notification')
  })
})
