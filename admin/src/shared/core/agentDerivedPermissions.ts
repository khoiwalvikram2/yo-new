function getAgentDomainPermissions(domain: string): { domain: string; actions: string[] }[] {
  switch (domain) {
    case 'casino':
      return [
        { domain: 'casino', actions: ['read'] },
        { domain: 'casino.live-analysis', actions: ['view'] },
        { domain: 'casino.bets', actions: ['view'] },
      ]
    case 'sports':
      return [
        { domain: 'sports', actions: ['read'] },
        { domain: 'sports.events', actions: ['view'] },
        { domain: 'sports.live-analysis', actions: ['view'] },
        { domain: 'sports.bets', actions: ['view'] },
      ]
    case 'matka':
      return [
        { domain: 'matka', actions: ['read'] },
        { domain: 'matka.results', actions: ['view'] },
        { domain: 'matka.live-analysis', actions: ['view'] },
        { domain: 'matka.bets', actions: ['view'] },
      ]
    default:
      return [{ domain, actions: ['read'] }]
  }
}

/**
 * Derive effective permissions for an agent from their allowedDomains.
 * Mirrors backend AgentPermissionsService.deriveAgentPermissions.
 */
export function deriveAgentPermissionsFromDomains(
  allowedDomains: string[] | null | undefined,
): { domain: string; actions: string[] }[] {
  const domainPerms: { domain: string; actions: string[] }[] = []
  if (allowedDomains && Array.isArray(allowedDomains)) {
    for (const d of allowedDomains) {
      domainPerms.push(...getAgentDomainPermissions(d))
    }
  }

  return [
    ...domainPerms,
    { domain: 'reporting', actions: ['read', 'view'] },
    { domain: 'players', actions: ['view', 'manage'] },
    { domain: 'users', actions: ['read', 'write'] },
    { domain: 'agents', actions: ['view', 'manage', 'read'] },
    { domain: 'bonuses', actions: ['read', 'view'] },
  ]
}
