/**
 * The notification reads answered a caller with no session at all. Their scope fell through to the whitelabel's
 * inbox for anyone who was not a player or an agent, and the whitelabel comes from the X-Whitelabel-ID header,
 * which an anonymous request still sends: myNotifications returned the admin task notifications (player names,
 * phones, deposit and withdrawal amounts) and notificationStats the unread counts, for any tenant named.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { NotificationsRepo } from '@src/repos/notifications/notificationsRepo.js'
import { buildNotificationsQueryResolvers } from '../resolvers/queries.js'
import { notificationReadScope, notificationStatsScope } from '../services/notificationReadScope.js'

const agentId = '22222222-2222-4222-8222-222222222222'
/** What an anonymous request's context carries: the whitelabel its header named, and no user. */
const anonymous = { tenant: 'grandwinn-com', whitelabel: { id: 'grandwinn-com' } }
const wlAdmin = { ...anonymous, user: { type: 'admin', sub: '2', roles: ['Whitelabel Admin'] }, permissions: [] }
const agent = { ...anonymous, user: { type: 'agent', agentId }, permissions: [] }

afterEach(() => mock.restoreAll())

describe('notification reads require a session', () => {
  it('refuses an anonymous caller before the repository is reached', async () => {
    mock.method(NotificationsRepo.prototype, 'getNotifications', async () => { throw new Error('Repository must not be reached') })
    mock.method(NotificationsRepo.prototype, 'getNotificationStats', async () => { throw new Error('Repository must not be reached') })
    const { myNotifications, notificationStats } = buildNotificationsQueryResolvers()
    for (const ctx of [anonymous, {}, undefined]) {
      await assert.rejects(myNotifications(null, { limit: 200 }, ctx), /^Error: Unauthorized: authentication required$/)
      await assert.rejects(myNotifications(null, { category: 'task' }, ctx), /Unauthorized/)
      await assert.rejects(notificationStats(null, {}, ctx), /^Error: Unauthorized: authentication required$/)
    }
  })

  it('refuses a player or agent session without its own id instead of widening it to the whitelabel', () => {
    for (const user of [{ type: 'agent' }, { type: 'user' }]) {
      assert.throws(() => notificationReadScope({ ...anonymous, user }, 'general'), /Forbidden: recipient identity required/)
      assert.throws(() => notificationStatsScope({ ...anonymous, user }), /Forbidden: recipient identity required/)
    }
  })
})

describe('signed-in readers keep their own inbox', () => {
  it('lists and counts the whitelabel inbox for an admin, tasks narrowed to the types it works', async () => {
    let listed: any
    let counted: any
    mock.method(NotificationsRepo.prototype, 'getNotifications', async (filters: any) => { listed = filters; return [] })
    mock.method(NotificationsRepo.prototype, 'getNotificationStats', async (filters: any) => {
      counted = filters
      return { totalUnread: 3, generalUnread: 2, taskUnread: 1 }
    })
    const { myNotifications, notificationStats } = buildNotificationsQueryResolvers()
    assert.deepEqual(await myNotifications(null, { category: 'task', limit: 10 }, wlAdmin), [])
    assert.deepEqual(listed, { tenant: 'grandwinn-com', whitelabelId: 'grandwinn-com', category: 'task', allowedTypes: ['DEPOSIT', 'WITHDRAWAL'], limit: 10, offset: 0 })
    assert.deepEqual(await notificationStats(null, {}, wlAdmin), { totalUnread: 3, generalUnread: 2, taskUnread: 1 })
    assert.deepEqual(counted, { tenant: 'grandwinn-com', whitelabelId: 'grandwinn-com', allowedTypes: ['DEPOSIT', 'WITHDRAWAL'] })
  })

  it("counts an agent's own notifications only", () => {
    assert.deepEqual(notificationStatsScope(agent), { tenant: 'grandwinn-com', agentId })
    assert.deepEqual(notificationReadScope(agent, 'general'), { tenant: 'grandwinn-com', agentId, category: 'general' })
  })

  it('never reads the whole tenant: an admin without a whitelabel id reads the tenant\'s own whitelabel', () => {
    assert.deepEqual(notificationReadScope({ ...wlAdmin, whitelabel: { id: '' } }, 'general'), { tenant: 'grandwinn-com', whitelabelId: 'grandwinn-com', category: 'general' })
  })
})
