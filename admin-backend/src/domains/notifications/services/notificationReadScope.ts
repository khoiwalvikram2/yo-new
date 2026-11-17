import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import type { NotificationFilters } from '@src/repos/notifications/notificationsRepo.js'

type NotificationRecipient = Pick<NotificationFilters, 'tenant' | 'userId' | 'agentId' | 'whitelabelId'>

/** The task types a whitelabel's admins work: their task list and their task count cover only these. */
const WHITELABEL_TASK_TYPES: NonNullable<NotificationFilters['allowedTypes']> = ['DEPOSIT', 'WITHDRAWAL']

/**
 * Whose notifications the caller reads: a player's or an agent's own, or for an admin the whitelabel's.
 *
 * Refuses a caller without a session. The whitelabel's inbox used to be the fallback for everyone who was not a
 * player or an agent, nobody included, and a request with no token still names its whitelabel in X-Whitelabel-ID,
 * so an anonymous caller read the whitelabel's admin notifications (player names, phones, deposit and withdrawal
 * amounts) and its unread counts. A player or agent session without its own id is refused the same way rather
 * than widened to the whitelabel.
 */
function notificationRecipient(ctx: any): NotificationRecipient {
  if (!ctx?.user) throw new Error('Unauthorized: authentication required')
  const directorTenant = getEffectiveTenantForDirector(ctx)
  const candidate = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
  const tenant = typeof candidate === 'string' && candidate.trim() ? candidate.trim() : 'default'
  if (ctx.user.type === 'user') {
    if (!ctx.user.userId) throw new Error('Forbidden: recipient identity required')
    return { tenant, userId: ctx.user.userId }
  }
  if (ctx.user.type === 'agent') {
    if (!ctx.user.agentId) throw new Error('Forbidden: recipient identity required')
    return { tenant, agentId: ctx.user.agentId }
  }
  return { tenant, whitelabelId: directorTenant || ctx.whitelabel?.id || tenant }
}

/** Shared by the list and by-ID read, including task-type visibility. */
export function notificationReadScope(ctx: any, category?: string): NotificationFilters {
  const filters: NotificationFilters = notificationRecipient(ctx)
  if (category === 'general' || category === 'task') filters.category = category
  if (filters.whitelabelId !== undefined && category === 'task') filters.allowedTypes = [...WHITELABEL_TASK_TYPES]
  return filters
}

/** The unread counts: the same recipient, with a whitelabel's tasks counted over the types its task list shows. */
export function notificationStatsScope(ctx: any): NotificationRecipient & Pick<NotificationFilters, 'allowedTypes'> {
  const recipient = notificationRecipient(ctx)
  return recipient.whitelabelId !== undefined ? { ...recipient, allowedTypes: [...WHITELABEL_TASK_TYPES] } : recipient
}
