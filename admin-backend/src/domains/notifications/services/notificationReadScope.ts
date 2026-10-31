import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import type { NotificationFilters } from '@src/repos/notifications/notificationsRepo.js'

/** Shared by the list and by-ID read, including task-type visibility. */
export function notificationReadScope(ctx: any, category?: string): NotificationFilters {
  const directorTenant = getEffectiveTenantForDirector(ctx)
  const candidate = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
  const tenant = typeof candidate === 'string' && candidate.trim() ? candidate.trim() : 'default'
  const filters: NotificationFilters = { tenant }
  if (category === 'general' || category === 'task') filters.category = category
  if (ctx?.user?.type === 'user' && ctx.user.userId) filters.userId = ctx.user.userId
  else if (ctx?.user?.type === 'agent' && ctx.user.agentId) filters.agentId = ctx.user.agentId
  else if (directorTenant || ctx?.whitelabel?.id) {
    filters.whitelabelId = directorTenant ?? ctx?.whitelabel?.id
    if (category === 'task') filters.allowedTypes = ['DEPOSIT', 'WITHDRAWAL']
  }
  return filters
}
