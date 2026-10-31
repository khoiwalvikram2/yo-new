import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import {
  findTaskById,
  hasExtraTaskMetadata,
  isMetadataObject,
  isTaskCompleted,
  isValidDate,
  taskAmountText,
  taskCreatedAt,
  taskCreatedAtLabel,
  taskCreatedAtRelative,
  taskDetailErrorText,
  taskMetadataJson,
  taskMetadataLines,
  taskStatus,
  taskStatusTag,
  taskSteps,
  taskTypeHue,
} from './taskDetailModel'

const formatAmount = (amount: number) => `INR ${amount.toFixed(2)}`
const formatDateTime = (date: Date, format: string) => `tenant ${date.toISOString()} as ${format}`

afterEach(() => {
  vi.useRealTimers()
})

describe('taskDetailModel', () => {
  test('finds the route id among the rows by strict equality', () => {
    const rows = [{ id: '1' }, { id: '22' }]
    assert.equal(findTaskById(rows, '22'), rows[1])
    assert.equal(findTaskById([{ id: 22 }], '22'), undefined)
    assert.equal(findTaskById(null, '1'), undefined)
  })

  test('reads createdAt as a Date, a string, or now when absent, and labels it', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T06:30:00.000Z'))
    const now = new Date()
    const date = new Date('2026-10-07T04:30:00.000Z')

    assert.equal(taskCreatedAt(date, now), date)
    assert.equal(taskCreatedAt('2026-10-07T04:30:00.000Z', now).getTime(), date.getTime())
    assert.equal(taskCreatedAt(undefined, now), now)
    assert.equal(isValidDate(taskCreatedAt('nope', now)), false)

    assert.equal(taskCreatedAtLabel(date, formatDateTime), 'tenant 2026-10-07T04:30:00.000Z as dd MMM yyyy, HH:mm:ss')
    assert.equal(taskCreatedAtRelative(date), '(about 2 hours ago)')
    assert.equal(taskCreatedAtLabel(new Date('nope'), formatDateTime), 'Invalid date')
    assert.equal(taskCreatedAtRelative(new Date('nope')), null)
  })

  test('maps the legacy type colours onto the decorative hues, exact case only', () => {
    assert.deepEqual(
      ['DEPOSIT', 'WITHDRAWAL', 'KYC', 'SYSTEM', 'AGENT', 'PLAYER', 'SETTLEMENT', 'COMMISSION', 'kyc', undefined].map(taskTypeHue),
      ['grn', 'amb', 'blu', 'vio', 'ind', 'red', 'amb', 'grn', 'neutral', 'neutral'],
    )
  })

  test('takes the status from the metadata when it has one, otherwise from the read flag', () => {
    assert.equal(taskStatus({ metadata: { status: 'completed' }, isRead: false }), 'completed')
    assert.equal(taskStatus({ metadata: { status: 'approved' }, isRead: true }), 'approved')
    assert.equal(taskStatus({ metadata: { status: undefined }, isRead: true }), undefined)
    assert.equal(taskStatus({ metadata: { amount: 5 }, isRead: true }), 'completed')
    assert.equal(taskStatus({ metadata: null, isRead: false }), 'pending')
    assert.equal(taskStatus({ metadata: 'status', isRead: false }), 'pending')

    assert.equal(isTaskCompleted('completed'), true)
    assert.equal(isTaskCompleted('Completed'), false)
    assert.deepEqual(taskStatusTag('completed'), { label: 'Completed', tone: 'ok' })
    assert.deepEqual(taskStatusTag('approved'), { label: 'Pending', tone: 'warn' })
    assert.deepEqual(taskStatusTag(undefined), { label: 'Pending', tone: 'warn' })
  })

  test('builds the two steps: Created, then Completed or In Progress', () => {
    const created = new Date('2026-10-07T04:30:00.000Z')
    assert.deepEqual(taskSteps(created, 'completed', formatDateTime), [
      { key: 'created', title: 'Created', description: 'tenant 2026-10-07T04:30:00.000Z as dd MMM yyyy, HH:mm:ss', state: 'finish' },
      { key: 'progress', title: 'Completed', description: 'Task has been completed', state: 'finish' },
    ])
    assert.deepEqual(taskSteps(new Date('nope'), 'pending', formatDateTime), [
      { key: 'created', title: 'Created', description: 'Invalid date', state: 'finish' },
      { key: 'progress', title: 'In Progress', description: 'Task is currently in progress', state: 'process' },
    ])
  })

  test('lists User, Phone, Amount and Method only when present, Phone never as N/A', () => {
    assert.equal(isMetadataObject({}), true)
    assert.equal(isMetadataObject(null), false)
    assert.deepEqual(
      taskMetadataLines({ userName: 'ravi_77', userPhone: '98765', amount: 500, currency: 'USD', method: 'UPI' }, formatAmount),
      [
        { key: 'user', label: 'User:', value: 'ravi_77' },
        { key: 'phone', label: 'Phone:', value: '98765' },
        { key: 'amount', label: 'Amount:', value: 'INR 500.00 USD' },
        { key: 'method', label: 'Method:', value: 'UPI' },
      ],
    )
    assert.deepEqual(taskMetadataLines({ userPhone: 'N/A', amount: 0, method: '' }, formatAmount), [])
    assert.equal(taskAmountText('7,500', null, formatAmount), '7,500 ')
  })

  test('offers all metadata when a key beyond the listed ones exists, method included in the list', () => {
    assert.equal(hasExtraTaskMetadata({ userName: 'a', userPhone: 'b', amount: 1, currency: 'INR', method: 'UPI' }), false)
    assert.equal(hasExtraTaskMetadata({ status: 'completed' }), true)
    assert.equal(taskMetadataJson({ requestId: 4 }), '{\n  "requestId": 4\n}')
  })

  test('states a failed lookup with the server message when there is one', () => {
    assert.equal(taskDetailErrorText({ message: 'Timeout' }), 'Failed to load task: Timeout')
    assert.equal(taskDetailErrorText(null), 'Failed to load task')
  })
})
