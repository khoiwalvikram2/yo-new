/**
 * Route configuration for dynamic breadcrumb generation
 * Maps URL patterns to breadcrumb labels and parent relationships
 */

export interface RouteConfig {
  label: string
  parent?: string
  segment?: string // For dynamic segments like :id, :eventId
  defaultRoute?: string // Default route for parent labels (e.g., Sports Exchange -> /sports/events)
}

export type RouteConfigMap = Record<string, RouteConfig>

/**
 * Default routes for parent labels (used when parent is just a label, not a route)
 */
export const parentDefaultRoutes: Record<string, string> = {
  'Sports Exchange': '/sports/events',
  'Casino': '/casino/management',
  'Matka': '/matka/results',
  'Players': '/players/search',
  'Agents': '/agents',
  'Reporting': '/reporting/exposure',
  'Bonuses': '/bonuses',
  'Referrals': '/referrals',
  'VIP Tiers': '/vip/tiers',
  'Security': '/security/roles',
  'Configuration': '/config/app-configuration',
  'Payments': '/payments/deposits',
  'Audit Trail': '/audit/events',
  'Commission': '/commission/overview',
  'Settlement': '/settlement',
  'Categories': '/casino/categories',
  'Payment Methods': '/payments/methods',
  'Roles Management': '/security/roles',
  'Whitelabels': '/config/whitelabels',
  'Worli Running Markets': '/matka/worli',
}

/**
 * Comprehensive route configuration mapping
 * Routes are ordered from most specific to least specific for proper matching
 */
export const routeConfig: RouteConfigMap = {
  // Overview/Dashboard
  '/overview': { label: 'Dashboard' },
  '/': { label: 'Dashboard' },

  // Agent Dashboard
  '/agent': { label: 'Agent Dashboard' },

  // Notifications (for agents)
  '/notifications': { label: 'Notifications', parent: 'Agent Dashboard' },
  '/notifications/:id': { label: 'Notification Details', parent: 'Notifications' },
  '/notifications/tasks/:id': { label: 'Task Details', parent: 'Notifications' },

  // Commission routes (for commission agents)
  '/commission/overview': { label: 'Overview', parent: 'Commission' },
  '/commission/history': { label: 'Commission History', parent: 'Commission' },
  '/commission/report': { label: 'Reports', parent: 'Commission' },
  '/commission/payments': { label: 'Payment Requests', parent: 'Commission' },

  // Settlement routes (unified page for both agents and admins)
  '/settlement': { label: 'Settlement Center', parent: 'Settlement' },
  '/settlement/overview': { label: 'Settlement Center', parent: 'Settlement' },
  '/settlement/ledger': { label: 'Settlement Center', parent: 'Settlement' },
  '/settlement/history': { label: 'Settlement Center', parent: 'Settlement' },
  '/settlement/report': { label: 'Settlement Center', parent: 'Settlement' },
  '/settlement/reports': { label: 'Settlement Center', parent: 'Settlement' },
  '/settlement/request': { label: 'Settlement Center', parent: 'Settlement' },
  '/settlement/dashboard': { label: 'Settlement Center', parent: 'Settlement' },
  // Bet List (Trading Operations)
  '/bets': { label: 'Bet List', parent: 'Trading Operations' },
  '/bonus-awards': { label: 'Bonus cards', parent: 'Trading Operations' },

  // Sports Exchange routes
  '/sports/events': { label: 'Sports Running Events', parent: 'Sports Exchange' },
  '/sports/event/:eventId': { label: 'Event Details', parent: 'Sports Running Events' },
  '/sports-exchange/builder': { label: 'Sports Builder', parent: 'Sports Exchange' },
  '/sports-exchange/configuration': { label: 'Configuration', parent: 'Sports Exchange' },
  '/sports/live-analysis': { label: 'Live Analysis', parent: 'Sports Exchange' },
  '/sports/manual-results': { label: 'Results', parent: 'Sports Exchange' },

  // Casino routes
  '/casino/management': { label: 'Management', parent: 'Casino' },
  '/casino/providers': { label: 'Providers', parent: 'Casino' },
  '/casino/categories': { label: 'Categories', parent: 'Casino' },
  '/casino/categories/:categoryId/add-games': { label: 'Add Games', parent: 'Categories' },
  '/casino/live': { label: 'Live Analysis', parent: 'Casino' },

  // Matka routes
  '/matka/running': { label: 'Running Markets', parent: 'Matka' },
  '/matka/results': { label: 'Results', parent: 'Matka' },
  '/matka/live': { label: 'Live Analysis', parent: 'Matka' },
  '/matka/list': { label: 'Matka Management', parent: 'Matka' },
  '/matka/management': { label: 'Matka Management', parent: 'Matka' },
  '/matka/create': { label: 'Create Matka', parent: 'Matka' },
  '/matka/edit/:id': { label: 'Edit Matka', parent: 'Matka' },
  '/matka/settings/:id': { label: 'Edit Matka Settings', parent: 'Matka' },
  '/matka/:id': { label: 'Matka Details', parent: 'Matka' },
  '/matka/worli': { label: 'Worli Running Markets', parent: 'Matka' },
  '/matka/worli/:id': { label: 'Market Details', parent: 'Worli Running Markets' },

  // Player routes
  '/players': { label: 'Players' },
  '/players/search': { label: 'Search Players', parent: 'Players' },
  '/players/create': { label: 'Create Player', parent: 'Players' },
  '/players/profile/:playerId': { label: 'Player Profile', parent: 'Players' },

  // Agent routes
  '/agents': { label: 'Agents' },
  '/agents/hierarchy': { label: 'Hierarchy', parent: 'Agents' },
  '/agents/create': { label: 'Create Agent', parent: 'Agents' },
  '/agents/:id': { label: 'Agent Profile', parent: 'Agents' },
  '/agents/:id/edit': { label: 'Edit Agent', parent: 'Agents' },

  // Reporting routes
  '/reporting': { label: 'Reporting' },
  '/reporting/exposure': { label: 'Exposure', parent: 'Reporting' },
  '/reporting/pnl': { label: 'P&L', parent: 'Reporting' },
  '/reporting/sports': { label: 'Sports Overview', parent: 'Reporting' },
  '/reporting/casino': { label: 'Casino Overview', parent: 'Reporting' },
  '/reporting/sports/contributors/:kind/:id': { label: 'Contributor', parent: 'Sports Overview' },
  '/reporting/casino/contributors/:kind/:id': { label: 'Contributor', parent: 'Casino Overview' },
  '/reporting/matka': { label: 'Matka Risk', parent: 'Reporting' },
  '/reporting/agent-overview': { label: 'Agent Overview', parent: 'Reporting' },
  '/reporting/players': { label: 'Player Reports', parent: 'Reporting' },
  '/reporting/players/nth-dw': { label: 'Nth D/W', parent: 'Player Reports' },
  '/reporting/exports': { label: 'Export Center', parent: 'Reporting' },
  '/reporting/agents': { label: 'Agent Performance', parent: 'Reporting' },

  // Bonuses routes
  '/bonuses': { label: 'Bonuses' },
  '/bonuses/new': { label: 'Create Bonus', parent: 'Bonuses' },
  '/bonuses/:id': { label: 'Bonus Details', parent: 'Bonuses' },
  '/bonuses/:id/edit': { label: 'Edit Bonus', parent: 'Bonuses' },
  '/bonuses/bundles': { label: 'Bundles', parent: 'Bonuses' },
  '/bonuses/bundles/new': { label: 'Create Bundle', parent: 'Bonuses' },
  '/bonuses/bundles/:id/edit': { label: 'Edit Bundle', parent: 'Bonuses' },

  // Referrals routes
  '/referrals': { label: 'Overview', parent: 'Referrals' },
  '/referrals/program': { label: 'Program Settings', parent: 'Referrals' },
  '/referrals/rules': { label: 'Rules', parent: 'Referrals' },
  '/referrals/earnings': { label: 'Earnings', parent: 'Referrals' },
  '/referrals/top-referrers': { label: 'Top Referrers', parent: 'Referrals' },
  '/referrals/referrers/:referrerId': { label: 'Referrer Stats', parent: 'Referrals' },

  // VIP routes
  '/vip': { label: 'VIP Tiers' },
  '/vip/tiers': { label: 'Tiers', parent: 'VIP Tiers' },
  '/vip/tiers/create': { label: 'Create Tier', parent: 'VIP Tiers' },
  '/vip/tiers/:id': { label: 'Tier Details', parent: 'VIP Tiers' },
  '/vip/tiers/:id/edit': { label: 'Edit Tier', parent: 'VIP Tiers' },

  // Security routes
  '/security/roles': { label: 'Roles Management', parent: 'Security' },
  '/security/roles/new': { label: 'Create Role', parent: 'Roles Management' },
  '/security/roles/:id/edit': { label: 'Edit Role', parent: 'Roles Management' },
  '/security/support-admins': { label: 'Support Admins', parent: 'Security' },

  // Configuration routes
  '/config/app-configuration': { label: 'App Configuration', parent: 'Configuration' },
  '/config/whitelabels': { label: 'Whitelabels', parent: 'Configuration' },
  '/config/whitelabels/create': { label: 'Create Whitelabel', parent: 'Whitelabels' },
  '/config/whitelabels/:id/edit': { label: 'Edit Whitelabel', parent: 'Whitelabels' },
  '/config/otp-providers': { label: 'OTP Providers', parent: 'Configuration' },
  '/config/advertisements': { label: 'Advertisements', parent: 'Configuration' },

  // Currency routes
  '/currency': { label: 'Currency Management' },

  // The whitelabel's and a CREDIT agent's Chips pages (Deposit/Withdraw chips, spec 2026-11-02 §8)
  '/credit': { label: 'Chips' },
  '/agent/credit': { label: 'Chips', parent: 'Agent' },
  '/agent/referral': { label: 'Invite Players', parent: 'Agent' },

  // Payment routes
  '/payments/deposits': { label: 'Deposit Requests', parent: 'Payments' },
  '/payments/withdrawal-requests': { label: 'Withdrawal Requests', parent: 'Payments' },
  '/payments/payout-approvals': { label: 'Payout Account Approvals', parent: 'Payments' },
  '/payments/methods': { label: 'Payment Methods', parent: 'Payments' },
  '/payments/methods/create': { label: 'Create Payment Method', parent: 'Payment Methods' },
  '/payments/methods/edit/:type/:id': { label: 'Edit Payment Method', parent: 'Payment Methods' },

  // Audit routes
  '/audit/events': { label: 'Audit Events', parent: 'Audit Trail' },
  '/audit/events/:id': { label: 'Event Detail', parent: 'Audit Events' },
  '/audit': { label: 'Audit Trail' },

}

/**
 * Helper function to match a pathname against route patterns
 * Handles dynamic segments like :id, :eventId, etc.
 */
export function matchRoute(pathname: string): RouteConfig | null {
  // Try exact match first
  if (routeConfig[pathname]) {
    return routeConfig[pathname]
  }

  // Try pattern matching for dynamic routes
  const routeKeys = Object.keys(routeConfig)
  
  for (const routePattern of routeKeys) {
    // Convert route pattern to regex
    const regexPattern = routePattern
      .replace(/\//g, '\\/')
      .replace(/:[^/]+/g, '([^/]+)')
    
    const regex = new RegExp(`^${regexPattern}$`)
    
    if (regex.test(pathname)) {
      return routeConfig[routePattern]
    }
  }

  // Fallback: try to infer from path segments
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) {
    return { label: 'Dashboard' }
  }

  // Try to find a parent route
  const parentPath = '/' + segments.slice(0, -1).join('/')
  if (routeConfig[parentPath]) {
    const lastSegment = segments[segments.length - 1]
    return {
      label: formatLabel(lastSegment),
      parent: routeConfig[parentPath].label,
    }
  }

  // Default fallback
  return {
    label: formatLabel(segments[segments.length - 1]),
  }
}

/**
 * Format a URL segment into a readable label
 */
function formatLabel(segment: string): string {
  return segment
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Get parent route path for a given route
 */
export function getParentRoutePath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean)
  
  if (segments.length <= 1) {
    return null
  }

  // Remove the last segment to get parent path
  const parentPath = '/' + segments.slice(0, -1).join('/')
  
  // Check if parent path exists in config
  if (routeConfig[parentPath]) {
    return parentPath
  }

  // Try to find a matching parent pattern
  for (const routePattern of Object.keys(routeConfig)) {
    const regexPattern = routePattern
      .replace(/\//g, '\\/')
      .replace(/:[^/]+/g, '([^/]+)')
    
    const regex = new RegExp(`^${regexPattern}$`)
    
    if (regex.test(parentPath)) {
      return routePattern
    }
  }

  return null
}

