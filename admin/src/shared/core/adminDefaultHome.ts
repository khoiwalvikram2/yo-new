import { ROUTES } from '@/shared/core/constants'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

export type AdminHomePermission = { domain: string; actions: string[] }

/**
 * First route to open after login (or when visiting `/` / `/overview`) for admins who
 * may not have `overview.dashboard:view` (e.g. support admins with only withdrawals).
 */
export function getAdminDefaultHomePath(permissions: AdminHomePermission[] | undefined): string {
  const p = permissions ?? []
  if (hasPermissionWithNested(p, 'overview.dashboard', 'view')) {
    return ROUTES.OVERVIEW
  }

  const fallbacks: Array<{ path: string; domain: string; actions: string[] }> = [
    {
      path: ROUTES.PAYMENTS_WITHDRAWALS,
      domain: 'payments.withdrawals',
      actions: ['view', 'approve', 'reject'],
    },
    {
      path: ROUTES.PAYMENTS_DEPOSITS,
      domain: 'payments.deposits',
      actions: ['view', 'approve', 'reject'],
    },
    {
      path: ROUTES.PAYMENTS_PAYOUT_APPROVALS,
      domain: 'payments.withdrawals',
      actions: ['view', 'approve'],
    },
    { path: ROUTES.PLAYERS_SEARCH, domain: 'players.list', actions: ['view'] },
    { path: ROUTES.BONUSES_LIST, domain: 'bonuses.list', actions: ['view'] },
    {
      path: '/security/support-admins',
      domain: 'security.support-admins',
      actions: ['view', 'create', 'update'],
    },
    { path: ROUTES.SECURITY_ROLES, domain: 'security.roles', actions: ['view'] },
    { path: ROUTES.SPORTS_EVENTS, domain: 'sports.events', actions: ['view'] },
    { path: ROUTES.CASINO_MANAGEMENT, domain: 'casino.management', actions: ['view'] },
    { path: ROUTES.MATKA_RESULTS, domain: 'matka.results', actions: ['view'] },
    { path: ROUTES.BETS, domain: 'sports.bets', actions: ['view'] },
    { path: ROUTES.BONUS_AWARDS, domain: 'bonuses.list', actions: ['view'] },
    { path: ROUTES.AUDIT_EVENTS, domain: 'audit.events', actions: ['view'] },
  ]

  for (const f of fallbacks) {
    if (f.actions.some((a) => hasPermissionWithNested(p, f.domain, a))) {
      return f.path
    }
  }

  return ROUTES.OVERVIEW
}
