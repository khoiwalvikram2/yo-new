import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import {
  groupNotificationsByDate,
  hasUnreadNotifications,
  isPlainPrimaryClick,
  mergeNotifications,
  notificationAmount,
  notificationDateGroup,
  notificationDetailPath,
  notificationIconKey,
  notificationsErrorText,
  notificationTabLabel,
  notificationTimeAgo,
  notificationUserName,
  unreadForTab,
  type NotificationItem,
} from './notificationsModel'

function item(id: string, patch: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id,
    type: 'DEPOSIT',
    category: 'general',
    title: `Title ${id}`,
    message: `Message ${id}`,
    metadata: null,
    isRead: false,
    actionUrl: null,
    createdAt: '2026-10-07T04:00:00.000Z',
    ...patch,
  }
}

const plainClick = {
  button: 0,
  metaKey: false,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  defaultPrevented: false,
}

afterEach(() => {
  vi.useRealTimers()
})

describe('notificationsModel', () => {
  test('maps every legacy type to its glyph, case-insensitively, and anything else to the bell', () => {
    assert.deepEqual(
      ['DEPOSIT', 'withdrawal', 'Player', 'AGENT', 'SYSTEM', 'COMMISSION', 'SETTINGS', 'KYC', '', null, undefined].map(
        notificationIconKey,
      ),
      ['wallet', 'card', 'user', 'user', 'alert', 'currency', 'settings', 'bell', 'bell', 'bell', 'bell'],
    )
  })

  test('puts unseen realtime rows of the shown category first and drops ones the query already returned', () => {
    const store = [
      item('9', { category: 'general' }),
      item('8', { category: 'task' }),
      item('2', { category: 'general' }),
    ]
    const query = [item('2'), item('1')]

    assert.deepEqual(mergeNotifications(store, query, false, 'general').map((n) => n.id), ['9', '2', '1'])
    assert.deepEqual(mergeNotifications(store, query, false, 'task').map((n) => n.id), ['8', '2', '1'])
    // An agent sees the general category whatever tab state says.
    assert.deepEqual(mergeNotifications(store, query, true, 'task').map((n) => n.id), ['9', '2', '1'])
    // Ids compare as strings: a numeric query id still hides its realtime copy.
    assert.deepEqual(
      mergeNotifications([item('5')], [{ ...item('5'), id: 5 }], false, 'general').map((n) => n.id),
      [5],
    )
  })

  test('labels a day Today, Yesterday, the tenant date, or Other', () => {
    const calls: Array<[string, string]> = []
    const deps = {
      isToday: (date: Date) => date.toISOString().startsWith('2026-10-07'),
      isYesterday: (date: Date) => date.toISOString().startsWith('2026-10-06'),
      formatDate: (date: string, format: string) => {
        calls.push([date, format])
        return 'Oct 1, 2026'
      },
    }

    assert.equal(notificationDateGroup('2026-10-07T04:00:00.000Z', deps), 'Today')
    assert.equal(notificationDateGroup('2026-10-06T04:00:00.000Z', deps), 'Yesterday')
    assert.equal(notificationDateGroup('2026-10-01T04:00:00.000Z', deps), 'Oct 1, 2026')
    assert.deepEqual(calls, [['2026-10-01T04:00:00.000Z', 'MMM d, yyyy']])
    assert.equal(notificationDateGroup('not a date', deps), 'Other')
    assert.equal(
      notificationDateGroup('2026-10-01T04:00:00.000Z', {
        ...deps,
        formatDate: () => {
          throw new Error('bad zone')
        },
      }),
      'Other',
    )
  })

  test('groups in first-seen order and leaves out rows without a date', () => {
    const rows = [
      item('1', { createdAt: 'a' }),
      item('2', { createdAt: 'b' }),
      item('3', { createdAt: null }),
      item('4', { createdAt: 'a' }),
      item('5', { createdAt: '' }),
    ]
    const groups = groupNotificationsByDate(rows, (createdAt) => (createdAt === 'a' ? 'Today' : 'Other'))
    assert.deepEqual(
      groups.map((group) => [group.label, group.items.map((n) => n.id)]),
      [
        ['Today', ['1', '4']],
        ['Other', ['2']],
      ],
    )
    assert.deepEqual(groupNotificationsByDate([], () => 'Today'), [])
  })

  test('routes a task to the task page, anything else to the notification page, and an id-less row nowhere', () => {
    assert.equal(notificationDetailPath(item('7', { category: 'task' })), '/notifications/tasks/7')
    assert.equal(notificationDetailPath(item('7')), '/notifications/7')
    assert.equal(notificationDetailPath(item('7', { category: null })), '/notifications/7')
    assert.equal(notificationDetailPath({ ...item('x'), id: 12 }), '/notifications/12')
    assert.equal(notificationDetailPath({ ...item('x'), id: '' }), null)
    assert.equal(notificationDetailPath({ ...item('x'), id: 0 }), null)
    assert.equal(notificationDetailPath(null), null)
  })

  test('reads unread state, the tab count and the tab label', () => {
    assert.equal(hasUnreadNotifications([item('1', { isRead: true }), item('2', { isRead: false })]), true)
    assert.equal(hasUnreadNotifications([item('1', { isRead: true })]), false)
    assert.equal(hasUnreadNotifications([item('1', { isRead: null })]), true)
    assert.equal(hasUnreadNotifications([]), false)

    assert.equal(unreadForTab('general', 4, 2), 4)
    assert.equal(unreadForTab('task', 4, 2), 2)

    assert.equal(notificationTabLabel('General', 0), 'General')
    assert.equal(notificationTabLabel('Tasks', 3), 'Tasks (3)')
    assert.equal(notificationTabLabel('General', 120), 'General (120)')
  })

  test('formats the amount only when the metadata carries one, with its currency', () => {
    const calls: Array<[number, string | undefined]> = []
    const formatAmount = (amount: number, currency?: string) => {
      calls.push([amount, currency])
      return `${currency ?? 'base'} ${amount.toFixed(2)}`
    }

    assert.equal(notificationAmount(item('1', { metadata: { amount: '2500', currency: 'USD' } }), formatAmount), 'USD 2500.00')
    assert.equal(notificationAmount(item('2', { metadata: { amount: 0 } }), formatAmount), 'base 0.00')
    assert.equal(notificationAmount(item('3', { metadata: { amount: null } }), formatAmount), null)
    assert.equal(notificationAmount(item('4', { metadata: {} }), formatAmount), null)
    assert.equal(notificationAmount(item('5', { metadata: null }), formatAmount), null)
    assert.deepEqual(calls, [
      [2500, 'USD'],
      [0, undefined],
    ])
  })

  test('reads the user name and the age, and survives an unreadable date', () => {
    assert.equal(notificationUserName(item('1', { metadata: { userName: 'ravi_77' } })), 'ravi_77')
    assert.equal(notificationUserName(item('2', { metadata: { userName: '' } })), null)
    assert.equal(notificationUserName(item('3')), null)

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T06:30:00.000Z'))
    assert.equal(notificationTimeAgo('2026-10-07T04:30:00.000Z'), 'about 2 hours ago')
    assert.equal(notificationTimeAgo('not a date'), '')
    assert.equal(notificationTimeAgo(undefined), '')
  })

  test('only a plain primary click runs the in-page handler', () => {
    assert.equal(isPlainPrimaryClick(plainClick), true)
    assert.equal(isPlainPrimaryClick({ ...plainClick, button: 1 }), false)
    assert.equal(isPlainPrimaryClick({ ...plainClick, ctrlKey: true }), false)
    assert.equal(isPlainPrimaryClick({ ...plainClick, metaKey: true }), false)
    assert.equal(isPlainPrimaryClick({ ...plainClick, shiftKey: true }), false)
    assert.equal(isPlainPrimaryClick({ ...plainClick, altKey: true }), false)
    assert.equal(isPlainPrimaryClick({ ...plainClick, defaultPrevented: true }), false)
  })

  test('states the failure with the server message when there is one', () => {
    assert.equal(notificationsErrorText({ message: 'Network down' }), 'Failed to load notifications: Network down')
    assert.equal(notificationsErrorText({ message: '  ' }), 'Failed to load notifications')
    assert.equal(notificationsErrorText(null), 'Failed to load notifications')
  })
})
