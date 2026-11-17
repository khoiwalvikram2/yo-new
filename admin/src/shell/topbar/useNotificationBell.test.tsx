/**
 * The Alerts and Tasks bells list the unread notifications themselves. They read the newest ten rows, read or
 * not, and kept the unread ones, while the badge (notificationStats) counted every unread one: the grandwinn
 * admin's Tasks drawer said "1 unread" over "No new tasks", its one unread task being older than the ten newest
 * (all read). The bell now asks myNotifications for unread rows only, whatever their age.
 */
import { beforeEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { buildSchema, validate, type OperationDefinitionNode } from 'graphql'
import { MY_NOTIFICATIONS_QUERY, NOTIFICATION_STATS_QUERY } from '@/lib/graphql/notifications'
import { useNotificationStore } from '@/state/notificationStore'
import { useNotificationBell } from './useNotificationBell'

/** admin-backend's notifications contract (types/domains/notifications/notifications.graphql), copied here. */
const CONTRACT = buildSchema(/* GraphQL */ `
  scalar JSON
  type Notification {
    id: ID!
    type: String!
    category: String!
    title: String!
    message: String!
    metadata: JSON
    isRead: Boolean!
    actionUrl: String
    createdAt: String!
  }
  type NotificationStats { totalUnread: Int!, generalUnread: Int!, taskUnread: Int! }
  type Query {
    myNotifications(category: String, limit: Int, offset: Int, unreadOnly: Boolean): [Notification!]!
    notificationStats: NotificationStats!
  }
`)

/** The grandwinn admin's one unread task, from 17 Oct, behind newer read ones. */
const OLD_UNREAD_TASK = {
  __typename: 'Notification',
  id: 'bca93134-d989-467e-8200-2c61f5209a38',
  type: 'DEPOSIT',
  category: 'task',
  title: 'Deposit request pending',
  message: 'A deposit request needs review.',
  metadata: null,
  isRead: false,
  actionUrl: '/payments/deposits?depositId=2382',
  createdAt: '2026-10-17T10:00:00.000Z',
}

const MOCKS: MockedResponse[] = [
  {
    request: { query: NOTIFICATION_STATS_QUERY },
    result: { data: { notificationStats: { __typename: 'NotificationStats', totalUnread: 1, generalUnread: 0, taskUnread: 1 } } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  },
  {
    // Answered only for the unread-only request: the old request (no unreadOnly) finds no mock and lists nothing.
    request: { query: MY_NOTIFICATIONS_QUERY, variables: { category: 'task', limit: 10, offset: 0, unreadOnly: true } },
    result: { data: { myNotifications: [OLD_UNREAD_TASK] } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  },
]

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MockedProvider mocks={MOCKS}>
      <MemoryRouter>{children}</MemoryRouter>
    </MockedProvider>
  )
}

beforeEach(() => {
  useNotificationStore.setState({ notifications: [] })
})

describe('useNotificationBell', () => {
  test('lists an unread task older than the ten newest rows, asking the server for unread rows only', async () => {
    const { result } = renderHook(() => useNotificationBell('task'), { wrapper })
    await waitFor(() => assert.equal(result.current.notifications.length, 1, 'the unread task is listed'))
    assert.equal(result.current.notifications[0].id, OLD_UNREAD_TASK.id)
    assert.equal(result.current.unreadCount, 1)
  })

  test('its document passes unreadOnly and validates against the server contract', () => {
    assert.deepEqual(validate(CONTRACT, MY_NOTIFICATIONS_QUERY).map((error) => error.message), [])
    const operation = MY_NOTIFICATIONS_QUERY.definitions[0] as OperationDefinitionNode
    assert.ok(operation.variableDefinitions?.some((definition) => definition.variable.name.value === 'unreadOnly'))
  })
})
