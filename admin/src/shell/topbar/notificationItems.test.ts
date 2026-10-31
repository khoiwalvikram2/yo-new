/**
 * mergeUnreadNotifications must keep the notification bell's list logic (store-first, then query
 * results not already in the store, unread only, capped at 7) identical to
 * NotificationButton.tsx:80-95, and notificationTypeIcon must map every known notification type to
 * its Tabler icon so a regression here does not silently drop a bell row or its icon.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import {
  IconWallet,
  IconCreditCard,
  IconUser,
  IconAlertCircle,
  IconCurrencyDollar,
  IconSettings,
  IconBell,
} from '@tabler/icons-react'
import { mergeUnreadNotifications, notificationTypeIcon, NOTIFICATION_LIST_LIMIT } from './notificationItems'
import type { Notification } from '@/state/notificationStore'

function makeNotification(overrides: Partial<Notification> & Pick<Notification, 'id'>): Notification {
  return {
    type: 'SYSTEM',
    category: 'general',
    title: 'Title',
    message: 'Message',
    isRead: false,
    createdAt: '2026-09-04T00:00:00.000Z',
    ...overrides,
  }
}

describe('mergeUnreadNotifications', () => {
  test('NOTIFICATION_LIST_LIMIT is 7', () => {
    assert.equal(NOTIFICATION_LIST_LIMIT, 7)
  })

  test('store items come first, then query items not already in the store', () => {
    const store = [makeNotification({ id: 's1' })]
    const query = [makeNotification({ id: 'q1' })]
    const result = mergeUnreadNotifications(store, query, 'general')
    assert.deepEqual(result.map((n) => n.id), ['s1', 'q1'])
  })

  test('a store item already present in the query results is dropped from the store side', () => {
    const store = [makeNotification({ id: '5' }), makeNotification({ id: '6' })]
    const query = [makeNotification({ id: '6' })]
    const result = mergeUnreadNotifications(store, query, 'general')
    assert.deepEqual(result.map((n) => n.id), ['5', '6'])
  })

  test('store items outside the requested category are dropped', () => {
    const store = [makeNotification({ id: 's1', category: 'task' })]
    const result = mergeUnreadNotifications(store, [], 'general')
    assert.deepEqual(result, [])
  })

  test('read notifications are filtered out', () => {
    const store = [makeNotification({ id: 's1', isRead: true })]
    const query = [makeNotification({ id: 'q1', isRead: true }), makeNotification({ id: 'q2', isRead: false })]
    const result = mergeUnreadNotifications(store, query, 'general')
    assert.deepEqual(result.map((n) => n.id), ['q2'])
  })

  test('the merged list is capped at the default limit of 7', () => {
    const query = Array.from({ length: 10 }, (_, i) => makeNotification({ id: `q${i}` }))
    const result = mergeUnreadNotifications([], query, 'general')
    assert.equal(result.length, 7)
    assert.deepEqual(result.map((n) => n.id), query.slice(0, 7).map((n) => n.id))
  })

  test('a custom limit overrides the default', () => {
    const query = Array.from({ length: 5 }, (_, i) => makeNotification({ id: `q${i}` }))
    const result = mergeUnreadNotifications([], query, 'general', 2)
    assert.equal(result.length, 2)
  })

  test('a duplicate id within queryItems itself is not collapsed (inherited from NotificationButton.tsx:84-95)', () => {
    const query = [makeNotification({ id: 'q1', title: 'First' }), makeNotification({ id: 'q1', title: 'Second' })]
    const result = mergeUnreadNotifications([], query, 'general')
    assert.equal(result.length, 2)
  })
})

describe('notificationTypeIcon', () => {
  test('DEPOSIT maps to IconWallet', () => {
    assert.equal(notificationTypeIcon('DEPOSIT'), IconWallet)
  })

  test('WITHDRAWAL maps to IconCreditCard', () => {
    assert.equal(notificationTypeIcon('WITHDRAWAL'), IconCreditCard)
  })

  test('PLAYER maps to IconUser', () => {
    assert.equal(notificationTypeIcon('PLAYER'), IconUser)
  })

  test('AGENT maps to IconUser', () => {
    assert.equal(notificationTypeIcon('AGENT'), IconUser)
  })

  test('SYSTEM maps to IconAlertCircle', () => {
    assert.equal(notificationTypeIcon('SYSTEM'), IconAlertCircle)
  })

  test('COMMISSION maps to IconCurrencyDollar', () => {
    assert.equal(notificationTypeIcon('COMMISSION'), IconCurrencyDollar)
  })

  test('SETTINGS maps to IconSettings', () => {
    assert.equal(notificationTypeIcon('SETTINGS'), IconSettings)
  })

  test('an unknown type falls back to IconBell', () => {
    assert.equal(notificationTypeIcon('UNKNOWN'), IconBell)
  })

  test('lower-case input still matches (case-insensitive)', () => {
    assert.equal(notificationTypeIcon('deposit'), IconWallet)
  })

  test('null and undefined fall back to IconBell', () => {
    assert.equal(notificationTypeIcon(null), IconBell)
    assert.equal(notificationTypeIcon(undefined), IconBell)
  })
})
