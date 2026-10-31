/**
 * NotificationList is the presentational content of both notification bell popovers: it must render
 * the loading, empty and populated states correctly and call each handler with the right arguments,
 * since the real handlers (T39) close the popover and mark a notification read.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, fireEvent } from '@testing-library/react'
import { NotificationList } from './NotificationList'
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

const noop = () => {}
const formatAmount = (amount: number, currencyCode?: string) => `${currencyCode ?? '$'}${amount.toFixed(2)}`

describe('NotificationList', () => {
  test('shows a loading indicator and no items while loading', () => {
    render(
      <NotificationList
        category="general"
        titleId="t"
        notifications={[makeNotification({ id: '1' })]}
        loading
        formatAmount={formatAmount}
        onNotificationClick={noop}
        onMarkAllAsRead={noop}
        onViewAll={noop}
      />,
    )
    assert.ok(screen.getByRole('img', { name: 'Loading' }))
    assert.equal(screen.queryByText('Title'), null)
  })

  test('shows the empty state text for the general category', () => {
    render(
      <NotificationList
        category="general"
        titleId="t"
        notifications={[]}
        loading={false}
        formatAmount={formatAmount}
        onNotificationClick={noop}
        onMarkAllAsRead={noop}
        onViewAll={noop}
      />,
    )
    assert.ok(screen.getByText('No new notifications'))
    assert.equal(screen.queryByText('Clear all'), null)
  })

  test('shows the empty state text for the task category', () => {
    render(
      <NotificationList
        category="task"
        titleId="t"
        notifications={[]}
        loading={false}
        formatAmount={formatAmount}
        onNotificationClick={noop}
        onMarkAllAsRead={noop}
        onViewAll={noop}
      />,
    )
    assert.ok(screen.getByText('No new tasks'))
  })

  test('renders the header title, the unread count and each notification row', () => {
    const notifications = [
      makeNotification({ id: '1', title: 'Deposit received', message: 'A player deposited', type: 'DEPOSIT' }),
      makeNotification({ id: '2', title: 'Withdrawal pending', message: 'Review needed', type: 'WITHDRAWAL' }),
    ]
    render(
      <NotificationList
        category="general"
        titleId="t"
        notifications={notifications}
        loading={false}
        formatAmount={formatAmount}
        onNotificationClick={noop}
        onMarkAllAsRead={noop}
        onViewAll={noop}
      />,
    )
    const heading = document.getElementById('t')
    assert.ok(heading?.textContent?.startsWith('Notifications'))
    assert.ok(screen.getByText('(2)'))
    assert.ok(screen.getByText('Deposit received'))
    assert.ok(screen.getByText('Withdrawal pending'))
  })

  test('shows "Tasks" as the header title for the task category', () => {
    render(
      <NotificationList
        category="task"
        titleId="t"
        notifications={[makeNotification({ id: '1' })]}
        loading={false}
        formatAmount={formatAmount}
        onNotificationClick={noop}
        onMarkAllAsRead={noop}
        onViewAll={noop}
      />,
    )
    const heading = document.getElementById('t')
    assert.ok(heading?.textContent?.startsWith('Tasks'))
  })

  test('renders the amount for a notification whose metadata has an amount, using formatAmount', () => {
    const notifications = [makeNotification({ id: '1', metadata: { amount: 250, currency: 'USD' } })]
    render(
      <NotificationList
        category="general"
        titleId="t"
        notifications={notifications}
        loading={false}
        formatAmount={formatAmount}
        onNotificationClick={noop}
        onMarkAllAsRead={noop}
        onViewAll={noop}
      />,
    )
    assert.ok(screen.getByText('USD250.00'))
  })

  test('renders no amount for a notification without a metadata amount', () => {
    const notifications = [makeNotification({ id: '1' })]
    render(
      <NotificationList
        category="general"
        titleId="t"
        notifications={notifications}
        loading={false}
        formatAmount={formatAmount}
        onNotificationClick={noop}
        onMarkAllAsRead={noop}
        onViewAll={noop}
      />,
    )
    assert.equal(screen.queryByText(/\$/), null)
  })

  test('clicking a notification row calls onNotificationClick with its id and actionUrl', () => {
    let called: [string, string | null | undefined] | null = null
    const notifications = [makeNotification({ id: '1', title: 'Row', actionUrl: '/players/3' })]
    render(
      <NotificationList
        category="general"
        titleId="t"
        notifications={notifications}
        loading={false}
        formatAmount={formatAmount}
        onNotificationClick={(id, actionUrl) => {
          called = [id, actionUrl]
        }}
        onMarkAllAsRead={noop}
        onViewAll={noop}
      />,
    )
    fireEvent.click(screen.getByText('Row'))
    assert.deepEqual(called, ['1', '/players/3'])
  })

  test('clicking a notification row with no actionUrl passes it through as undefined, not coerced', () => {
    let called: [string, string | null | undefined] | null = null
    const notifications = [makeNotification({ id: '1', title: 'Row' })]
    render(
      <NotificationList
        category="general"
        titleId="t"
        notifications={notifications}
        loading={false}
        formatAmount={formatAmount}
        onNotificationClick={(id, actionUrl) => {
          called = [id, actionUrl]
        }}
        onMarkAllAsRead={noop}
        onViewAll={noop}
      />,
    )
    fireEvent.click(screen.getByText('Row'))
    assert.deepEqual(called, ['1', undefined])
  })

  test('"Clear all" shows only when there are notifications and calls onMarkAllAsRead', () => {
    let calls = 0
    const notifications = [makeNotification({ id: '1' })]
    render(
      <NotificationList
        category="general"
        titleId="t"
        notifications={notifications}
        loading={false}
        formatAmount={formatAmount}
        onNotificationClick={noop}
        onMarkAllAsRead={() => {
          calls += 1
        }}
        onViewAll={noop}
      />,
    )
    fireEvent.click(screen.getByText('Clear all'))
    assert.equal(calls, 1)
  })

  test('"View all" calls onViewAll', () => {
    let calls = 0
    render(
      <NotificationList
        category="general"
        titleId="t"
        notifications={[]}
        loading={false}
        formatAmount={formatAmount}
        onNotificationClick={noop}
        onMarkAllAsRead={noop}
        onViewAll={() => {
          calls += 1
        }}
      />,
    )
    fireEvent.click(screen.getByText('View all'))
    assert.equal(calls, 1)
  })
})
