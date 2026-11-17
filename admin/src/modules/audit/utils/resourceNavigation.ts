interface NavigationResult {
  available: boolean
  path: string
}

/** The event a resource comes from: its domain and action tell an admin account from a player. */
export interface ResourceEventContext {
  domain?: string | null
  action?: string | null
  /** The row's after data: admin-backend records the kind of account a "user" is there as accountKind. */
  after?: unknown
}

/**
 * users.security events whose "user" is an admin account: admin-backend's sign-in and session checks, an admin
 * changing its own password (a player's change is recorded under 'players') and the Support Admins page's
 * create/delete. An admin has no profile of its own (the player profile answered "Player not found"); its
 * account is on Support Admins, as for an admin actor. Status, password-reset and force-logout events name a
 * player or a support admin alike, so they keep the profile link. This is the rule for rows written before
 * admin-backend recorded after.accountKind; a row that records it is routed by it (recordedAccountKind).
 */
const ADMIN_ACCOUNT_ACTIONS = new Set([
  'login', 'login_failed', 'unauthorized_admin_mode_header', 'invalid_user_tenant', 'cross_tenant_access_blocked',
  'tenant_switch_blocked', 'ip_blocked', 'change_password', 'create_support_admin', 'delete_support_admin',
])

/**
 * The kind of account a "user" row names, when the row records it (after.accountKind, 'admin' or 'player'): the
 * status, password-reset and force-logout actions, the admin sign-in (which can name a player's account) and a
 * whitelabel admin's password reset. Null for an older row, which keeps the action rule above.
 */
function recordedAccountKind(event?: ResourceEventContext): 'admin' | 'player' | null {
  const after = event?.after
  if (!after || typeof after !== 'object') return null
  const kind = (after as { accountKind?: unknown }).accountKind
  return kind === 'admin' || kind === 'player' ? kind : null
}

/** The player a row records as after.userId (a revoked bonus names its award's player there), or null. */
function recordedUserId(event?: ResourceEventContext): string | null {
  const after = event?.after
  if (!after || typeof after !== 'object') return null
  const userId = (after as { userId?: unknown }).userId
  const text = typeof userId === 'number' || typeof userId === 'string' ? String(userId) : ''
  return /^[1-9]\d*$/.test(text) ? text : null
}

/** What a bulk or set-wide event records in place of one resource's id ('*' for a matka reorder, 'bulk' for a
 *  permanent delete or a saved selection). It names no resource, so it gets no link. */
const BULK_IDS = new Set(['*', 'bulk', 'all'])

const NUMERIC_ID = /^\d+$/
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A whitelabel is named by its slug: grandwinn-com, kondareddi-com, default. */
const SLUG_ID = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i

/**
 * The shape of id each page that opens by id takes (the tables' keys: serial for players, roles and bonus awards,
 * uuid for agents, sports events and matkas). Any other id gets no link: the page could only fail to load it, as
 * Matka Details did for /matka/* and the agent page for the username a failed agent sign-in records. A type whose link
 * opens a list (App Configuration, Advertisements, the payment queues, results, bonus awards) carries no id.
 */
const ID_SHAPES: Record<string, RegExp> = {
  user: NUMERIC_ID,
  player: NUMERIC_ID,
  role: NUMERIC_ID,
  bonus: NUMERIC_ID,
  agent: UUID_ID,
  event: UUID_ID,
  matka: UUID_ID,
  whitelabel: SLUG_ID,
}

/**
 * Returns a navigation path for a resource based on its type and ID (and, for a "user", the event it is from).
 */
export function getResourceNavigationPath(resourceType: string, resourceId: string, event?: ResourceEventContext): NavigationResult {
  // No id, a blank one, or a bulk event's marker: there is no one resource to open (N005).
  if (!resourceType || !resourceId || !String(resourceId).trim() || BULK_IDS.has(String(resourceId).trim().toLowerCase())) {
    return { available: false, path: '' }
  }

  /* Each target is a page the router serves (resourceNavigation.test.ts checks every one against the route
     table); a type with no page of its own opens its list, and a type with neither gets no link. The old map
     pointed most types at addresses nothing served (/whitelabels/:id, /sports/events/:id, /transactions/...),
     and each opened "Something went wrong". */
  const id = encodeURIComponent(resourceId)
  const resourceRoutes: Record<string, string> = {
    user: `/players/profile/${id}`,
    player: `/players/profile/${id}`,
    agent: `/agents/${id}`,
    event: `/sports/event/${id}`,
    matka: `/matka/${id}`,
    role: `/security/roles/${id}/edit`,
    // A whitelabel's settings and branding, managed from its App Configuration.
    whitelabel: `/config/app-configuration?whitelabelId=${id}`,
    // An app-config event is about the trail's own tenant, the one this page edits.
    appconfig: '/config/app-configuration',
    advertisement: '/config/advertisements',
    deposit_request: '/payments/deposits',
    withdrawal_request: '/payments/withdrawal-requests',
    sports_result: '/sports/manual-results',
    matkaresult: '/matka/results',
    bonus_award: '/bonus-awards',
  }

  const normalizedType = resourceType.toLowerCase().replace(/\s+/g, '_')
  if (normalizedType === 'user') {
    const kind = recordedAccountKind(event)
    if (kind === 'admin') return { available: true, path: '/security/support-admins' }
    if (kind === null && event?.domain === 'users.security' && ADMIN_ACCOUNT_ACTIONS.has(event.action ?? '')) {
      return { available: true, path: '/security/support-admins' }
    }
  }
  // A page that opens by id takes only an id of its type's shape: a profile opens by the player's numeric id (a failed
  // sign-in names "unknown" or the email that was typed), an agent by its uuid (a failed agent sign-in names the
  // username that was typed), and so on (ID_SHAPES).
  const idShape = ID_SHAPES[normalizedType]
  if (idShape && !idShape.test(resourceId)) {
    return { available: false, path: '' }
  }
  // A "bonus" row is a revoked bonus award (players.revoke_bonus is its only writer): its id is the AWARD's, not a
  // campaign's, so /bonuses/:id opened the wrong campaign or none. The award is listed on its player's profile
  // (Bonuses tab), and the row records that player as after.userId; a row without it gets no link.
  if (normalizedType === 'bonus') {
    const userId = recordedUserId(event)
    return userId ? { available: true, path: `/players/profile/${encodeURIComponent(userId)}` } : { available: false, path: '' }
  }
  const path = resourceRoutes[normalizedType]

  if (path) {
    return { available: true, path }
  }

  return { available: false, path: '' }
}

/**
 * Returns a navigation path for an actor based on their type and ID.
 */
export function getActorNavigationPath(actorType: string, actorId: string): NavigationResult {
  if (!actorType || !actorId) {
    return { available: false, path: '' }
  }

  // An admin has no profile page; its account is on Support Admins. A deleted, system or unknown actor has
  // nowhere to go (a deleted admin was typed "agent" and linked to /agents/<id>, which refused it).
  const id = encodeURIComponent(actorId)
  const actorRoutes: Record<string, string> = {
    admin: '/security/support-admins',
    user: `/players/profile/${id}`,
    player: `/players/profile/${id}`,
    agent: `/agents/${id}`,
    system: '',
    api: '',
    deleted: '',
    unknown: '',
  }

  const normalizedType = actorType.toLowerCase().replace(/\s+/g, '_')
  const path = actorRoutes[normalizedType]

  if (path) {
    return { available: true, path }
  }

  return { available: false, path: '' }
}
