/**
 * The Alerts and Tasks bells read the newest ten notifications and kept the unread ones, while their badge counted
 * every unread notification. An unread task older than the ten newest (read) tasks was counted and never listed:
 * the grandwinn admin's Tasks drawer said "1 unread" over "No new tasks". `unreadOnly` lets the bell ask for the
 * unread rows themselves, whatever their age.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, it, mock } from 'node:test'
import { buildSchema, parse, validate } from 'graphql'
import { NotificationsRepo } from '@src/repos/notifications/notificationsRepo.js'
import { buildNotificationsQueryResolvers } from '../resolvers/queries.js'

const wlAdmin = { tenant: 'grandwinn-com', whitelabel: { id: 'grandwinn-com' }, user: { type: 'admin', sub: '2', roles: ['Whitelabel Admin'] }, permissions: [] }

afterEach(() => mock.restoreAll())

describe('myNotifications(unreadOnly)', () => {
  it('reads unread rows only when asked, and every row otherwise', async () => {
    const reads: any[] = []
    mock.method(NotificationsRepo.prototype, 'getNotifications', async (filters: any) => { reads.push(filters); return [] })
    const { myNotifications } = buildNotificationsQueryResolvers()
    await myNotifications(null, { category: 'task', limit: 10, unreadOnly: true }, wlAdmin)
    await myNotifications(null, { category: 'task', limit: 10, unreadOnly: false }, wlAdmin)
    await myNotifications(null, { category: 'task', limit: 10, unreadOnly: null }, wlAdmin)
    await myNotifications(null, { category: 'task', limit: 10 }, wlAdmin)
    const scope = { tenant: 'grandwinn-com', whitelabelId: 'grandwinn-com', category: 'task', allowedTypes: ['DEPOSIT', 'WITHDRAWAL'], limit: 10, offset: 0 }
    assert.deepEqual(reads, [{ ...scope, isRead: false }, scope, scope, scope])
  })

  it('is declared on the schema, so a bell document asking for it validates', () => {
    const sdl = readFileSync(join(import.meta.dirname, '../../../types/domains/notifications/notifications.graphql'), 'utf8')
    const schema = buildSchema(`scalar JSON\ntype Query { _: Boolean }\ntype Mutation { _: Boolean }\ntype Subscription { _: Boolean }\n${sdl}`)
    const bell = parse(`query MyNotifications($category: String, $limit: Int, $offset: Int, $unreadOnly: Boolean) {
      myNotifications(category: $category, limit: $limit, offset: $offset, unreadOnly: $unreadOnly) { id isRead }
    }`)
    assert.deepEqual(validate(schema, bell).map((e) => e.message), [])
  })
})
