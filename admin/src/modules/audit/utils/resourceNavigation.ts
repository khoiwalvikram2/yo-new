interface NavigationResult {
  available: boolean
  path: string
}

/**
 * Returns a navigation path for a resource based on its type and ID.
 */
export function getResourceNavigationPath(resourceType: string, resourceId: string): NavigationResult {
  if (!resourceType || !resourceId) {
    return { available: false, path: '' }
  }

  const resourceRoutes: Record<string, string> = {
    user: `/players/profile/${resourceId}`,
    player: `/players/profile/${resourceId}`,
    agent: `/agents/${resourceId}`,
    sport: `/sports/${resourceId}`,
    league: `/sports/leagues/${resourceId}`,
    event: `/sports/events/${resourceId}`,
    market: `/sports/markets/${resourceId}`,
    casino_game: `/casino/games/${resourceId}`,
    casino_provider: `/casino/providers/${resourceId}`,
    matka: `/matka/${resourceId}`,
    bonus: `/bonuses/${resourceId}`,
    promotion: `/marketing/promotions/${resourceId}`,
    banner: `/marketing/banners/${resourceId}`,
    advertisement: `/config/advertisements/${resourceId}`,
    whitelabel: `/whitelabels/${resourceId}`,
    tenant: `/tenants/${resourceId}`,
    deposit: `/transactions/deposits/${resourceId}`,
    withdrawal: `/transactions/withdrawals/${resourceId}`,
    transaction: `/transactions/${resourceId}`,
    wallet: `/wallets/${resourceId}`,
    referral: `/marketing/referrals/${resourceId}`,
  }

  const normalizedType = resourceType.toLowerCase().replace(/\s+/g, '_')
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

  const actorRoutes: Record<string, string> = {
    admin: `/admins/${actorId}`,
    user: `/players/profile/${actorId}`,
    player: `/players/profile/${actorId}`,
    agent: `/agents/${actorId}`,
    system: '',
    api: '',
  }

  const normalizedType = actorType.toLowerCase().replace(/\s+/g, '_')
  const path = actorRoutes[normalizedType]

  if (path) {
    return { available: true, path }
  }

  return { available: false, path: '' }
}
