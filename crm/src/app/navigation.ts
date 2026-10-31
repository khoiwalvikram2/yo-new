import type { CrmMe } from '@/state/auth'
import { can } from '@/state/auth'

/**
 * The screens, in the order they appear, with the permission each needs.
 *
 * The sidebar and the router both read this. They used to keep their own copies,
 * which drifted: the nav hid "Players" from anyone without `crm.players:view`
 * while the route let them in, so such a user landed on a screen the server
 * would refuse and saw an error with no navigation and no explanation.
 *
 * One list means a screen cannot be offered by one half and refused by the other.
 */
export type NavEntry = {
  path: string
  label: string
  domain: string
  action: string
}

export const NAV: NavEntry[] = [
  { path: '/players', label: 'Players', domain: 'crm.players', action: 'view' },
  { path: '/queue', label: 'Queue', domain: 'crm.tasks', action: 'view' },
  { path: '/live-chat', label: 'Support Inbox', domain: 'crm.chat', action: 'view' },
  // Sits next to the queue on purpose: same permission, opposite question —
  // the queue is "what is on my list", this is "what is going wrong".
  { path: '/desk-health', label: 'Desk health', domain: 'crm.tasks', action: 'view' },
  // Desk health is "what is failing now"; Reports is "how did the period go".
  { path: '/reports', label: 'Reports', domain: 'crm.reports', action: 'view' },
  // Next to Desk health because it answers the question Desk health raises:
  // the breach counts there are measured against these hours.
  { path: '/desk-settings', label: 'Desk settings', domain: 'crm.settings', action: 'view' },
  { path: '/tags', label: 'Tags', domain: 'crm.tags', action: 'apply' },
  { path: '/books', label: 'Books', domain: 'crm.books', action: 'view' },
  { path: '/users', label: 'CRM users', domain: 'crm.users', action: 'view' },
  { path: '/roles', label: 'Roles', domain: 'crm.roles', action: 'view' },
  { path: '/security', label: 'Security', domain: 'crm.security', action: 'view' },
]

/** The entries this user may actually open, in nav order. */
export function visibleNav(me: CrmMe | null): NavEntry[] {
  return NAV.filter((n) => can(me, n.domain, n.action))
}

/**
 * Where to send someone who asked for a screen they cannot open.
 *
 * Always a screen they *can* open, so a redirect can never bounce back into the
 * guard that issued it. `null` means this account has no screens at all, which
 * the router shows as a message rather than a redirect loop.
 */
export function landingPath(me: CrmMe | null): string | null {
  return visibleNav(me)[0]?.path ?? null
}
