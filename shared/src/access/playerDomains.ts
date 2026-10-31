import { sql } from 'drizzle-orm'

export const PLAYER_DOMAINS = ['sports', 'casino', 'matka'] as const
export type PlayerDomain = typeof PLAYER_DOMAINS[number]
const labels = { sports: 'Sports', casino: 'Casino', matka: 'Matka' }
export type DomainAccess = { visible: boolean; betAllowed: boolean; canBet: boolean; agentAllowed: boolean; message: string | null }
export type PlayerDomainAccess = Record<PlayerDomain, DomainAccess>
export type PlayerDomainRow = {
  user_id: number; player_type: string; player_tenant: string; user_status: string
  sports_visible: boolean; casino_visible: boolean; matka_visible: boolean
  sports_bet_allowed: boolean; casino_bet_allowed: boolean; matka_bet_allowed: boolean
  sports_enabled: boolean | null; casino_enabled: boolean | null; matka_enabled: boolean | null
  require_password_reset: boolean; rg_blocked_until: Date | string | null; maintenance: boolean | null
  owner_agent_id: string | null; agent_id: string | null; agent_tenant: string | null; agent_status: string | null; allowed_domains: string[] | string | null
}
function domains(value: PlayerDomainRow['allowed_domains']): string[] {
  return (Array.isArray(value) ? value : String(value || '').replace(/[{}"]+/g, '').split(',')).map(item => item.trim().toLowerCase())
}

/** Identical policy for cash, whitelabel credit, all agent schemes and referral-linked players. */
export function evaluatePlayerDomains(rows: PlayerDomainRow[], now = new Date()): PlayerDomainAccess {
  const player = rows[0]
  const chain = rows.filter(row => row.agent_id)
  const agentPlayer = !!player && ['AGENT_CREDIT', 'SHARING_AGENT_PLAYER', 'COMMISSION_AGENT_PLAYER'].includes(player.player_type)
  const validChain = !!player && (player.owner_agent_id
    ? chain.some(row => row.agent_id === player.owner_agent_id) && chain.every(row => row.agent_tenant === player.player_tenant)
    : !agentPlayer)
  const activeChain = validChain && chain.every(row => row.agent_status?.toUpperCase() === 'ACTIVE')
  return Object.fromEntries(PLAYER_DOMAINS.map(domain => {
    const agentAllowed = validChain && chain.every(row => domains(row.allowed_domains).includes(domain))
    const siteEnabled = !!player && player[`${domain}_enabled`] !== false
    const visible = siteEnabled && !!player?.[`${domain}_visible`] && agentAllowed
    const betAllowed = !!player?.[`${domain}_bet_allowed`]
    const label = labels[domain]
    const message = !player ? 'Account not found.'
      : !siteEnabled ? `${label} is unavailable on this site.`
        : !agentAllowed ? `${label} is unavailable for your agent branch.`
          : !player[`${domain}_visible`] ? `${label} is hidden for this account. Contact your administrator.`
            : !betAllowed ? `${label} betting is disabled for this account.`
              : player.user_status !== 'active' ? 'This account is not active.'
                : !activeChain ? 'Betting is suspended for your agent branch.'
                  : player.require_password_reset ? 'Change your password before placing a bet.'
                    : player.rg_blocked_until && new Date(player.rg_blocked_until) > now ? 'Betting is blocked by your responsible gaming settings.'
                      : player.maintenance ? 'Betting is unavailable during site maintenance.' : null
    return [domain, { visible, betAllowed, canBet: !message, agentAllowed, message }]
  })) as PlayerDomainAccess
}

/** One scoped query includes a direct or confirmed-referral owner and its ancestor caps. */
export async function loadPlayerDomains(executor: { execute: (query: any) => Promise<any> }, tenant: string, userId: number): Promise<PlayerDomainAccess> {
  const result = await executor.execute(sql`
    WITH player AS (
      SELECT u.*, COALESCE(u.agent_id, (
        SELECT ru.agent_id FROM referral_attributions ra
        JOIN users ru ON ru.id=ra.referrer_id AND ru.tenant=u.tenant
        WHERE ra.referee_id=u.id AND ra.tenant=u.tenant AND ra.status='confirmed' LIMIT 1
      )) AS owner_agent_id FROM users u WHERE u.id=${userId} AND u.tenant=${tenant}
    )
    SELECT p.id AS user_id,p.tenant AS player_tenant,p.player_type,p.status AS user_status,
      p.sports_visible,p.casino_visible,p.matka_visible,p.sports_bet_allowed,p.casino_bet_allowed,p.matka_bet_allowed,
      p.require_password_reset,p.rg_blocked_until,c.sports_enabled,c.casino_enabled,c.matka_enabled,c.maintenance,
      p.owner_agent_id::text,a.id::text AS agent_id,a.tenant_id AS agent_tenant,a.status AS agent_status,a.allowed_domains
    FROM player p LEFT JOIN app_configs c ON c.whitelabel_id=p.tenant
    LEFT JOIN agents a ON p.owner_agent_id IS NOT NULL AND (a.id=p.owner_agent_id OR a.id IN (
      SELECT ancestor_id FROM agent_hierarchy_closure WHERE descendant_id=p.owner_agent_id
    ))
  `)
  return evaluatePlayerDomains(Array.isArray(result?.rows) ? result.rows : Array.isArray(result) ? result : [])
}

export async function assertPlayerDomainBetting(executor: Parameters<typeof loadPlayerDomains>[0], tenant: string, userId: number, domain: PlayerDomain): Promise<void> {
  const access = (await loadPlayerDomains(executor, tenant, userId))[domain]
  if (!access.canBet) throw new Error(access.message || `${labels[domain]} betting is unavailable.`)
}
