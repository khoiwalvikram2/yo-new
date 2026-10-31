export type ReferralAccess = 'unauthenticated' | 'denied' | 'allowed'

export interface ReferralAgentLike {
  id?: string | null
  schemeType?: string | null
}

export interface ReferralLinkLike {
  code?: string | null
}

export function referralAccess(agent?: ReferralAgentLike | null): ReferralAccess {
  if (!agent) return 'unauthenticated'
  return agent.schemeType === 'SHARING' || agent.schemeType === 'COMMISSION'
    ? 'allowed'
    : 'denied'
}

export function userFrontendUrl(configuredUrl: string | undefined, origin: string): string {
  const configured = configuredUrl?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  if (origin.includes('admin.')) return origin.replace('admin.', '').replace(/\/+$/, '')
  return origin.replace(/\/+$/, '')
}

export function referralUrl(
  link: ReferralLinkLike | null | undefined,
  configuredUrl: string | undefined,
  origin: string,
): string {
  const code = link?.code?.trim()
  if (!code) return ''
  return `${userFrontendUrl(configuredUrl, origin)}/r?ref=${encodeURIComponent(code)}`
}

export function qrCodeUrl(link: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(link)}`
}

export function referralQrFilename(code: string): string {
  const safe = code.trim().replace(/[^a-zA-Z0-9_-]+/g, '-') || 'code'
  return `referral-qr-${safe}.png`
}

export function isMissingReferralError(message: string | undefined): boolean {
  return Boolean(message?.toLocaleLowerCase('en-US').includes('not found'))
}
