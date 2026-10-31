export type TopbarWallet = 'whitelabel' | 'agentCredit' | 'agentSharing' | 'agentCommission' | null

export interface TopbarRoleInput {
  roles: readonly string[]
  isAgent: boolean
  agentSchemeType: string | null | undefined
  userName: string | null | undefined
  agentUsername: string | null | undefined
}

export interface TopbarRoles {
  isAgent: boolean
  isSuperAdmin: boolean
  isWhitelabelAdmin: boolean
  isCreditAgent: boolean
  isSharingAgent: boolean
  isCommissionAgent: boolean
  userName: string
  userRole: 'Agent' | 'Administrator'
  showGeneralBell: boolean
  showTaskBell: boolean
  showTenantCurrency: boolean
  wallet: TopbarWallet
}

/**
 * Role predicates verbatim from `components/Topbar.tsx:49-66` (R1-old-shell §b.3, R2-topbar-widgets §9).
 * Wallet precedence: whitelabel > agentCredit > agentSharing (not credit) > agentCommission
 * (`components/Topbar.tsx:382-385`).
 */
export function deriveTopbarRoles(input: TopbarRoleInput): TopbarRoles {
  const { roles, isAgent, agentSchemeType, userName, agentUsername } = input

  const isWhitelabelAdmin = roles.some(
    (r) => r === 'Whitelabel Admin' || r.toLowerCase() === 'whitelabel_admin' || r.toLowerCase().includes('whitelabel'),
  )
  const isSuperAdmin = roles.some((r) => {
    const roleLower = r?.toLowerCase() || ''
    return r === 'Super Admin' || roleLower === 'super_admin' || (roleLower.includes('super') && roleLower.includes('admin'))
  })

  const isCreditAgent = isAgent && agentSchemeType === 'CREDIT'
  const isSharingAgent = isAgent && agentSchemeType === 'SHARING'
  const isCommissionAgent = isAgent && agentSchemeType === 'COMMISSION'

  const wallet: TopbarWallet = isWhitelabelAdmin
    ? 'whitelabel'
    : isCreditAgent
      ? 'agentCredit'
      : isSharingAgent && !isCreditAgent
        ? 'agentSharing'
        : isCommissionAgent
          ? 'agentCommission'
          : null

  return {
    isAgent,
    isSuperAdmin,
    isWhitelabelAdmin,
    isCreditAgent,
    isSharingAgent,
    isCommissionAgent,
    userName: userName || agentUsername || 'User',
    userRole: isAgent ? 'Agent' : 'Administrator',
    showGeneralBell: !isSuperAdmin,
    showTaskBell: !isSuperAdmin && !isAgent,
    showTenantCurrency: !isAgent && !isWhitelabelAdmin && !isSuperAdmin,
    wallet,
  }
}
