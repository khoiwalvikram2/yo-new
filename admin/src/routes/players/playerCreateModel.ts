import { z } from 'zod'
import { getDefaultDialCodeForWhitelabel } from '@/shared/config/phoneCodes'
export const PLAYER_TYPES = [
  { value: 'REGULAR', label: 'Regular Player' }, { value: 'AGENT_CREDIT', label: 'Agent Credit Player' },
  { value: 'WHITELABEL_CREDIT', label: 'Whitelabel Credit Player' }, { value: 'SHARING_AGENT_PLAYER', label: 'Sharing Agent Player' },
  { value: 'COMMISSION_AGENT_PLAYER', label: 'Commission Agent Player' },
]
export const PLAYER_LIMITS = [
  { key: 'dailyStakeLimit', label: 'Daily Stake Limit' }, { key: 'weeklyStakeLimit', label: 'Weekly Stake Limit' },
  { key: 'maxBetSports', label: 'Max Bet - Sports' }, { key: 'maxBetCasino', label: 'Max Bet - Casino' }, { key: 'maxBetMatka', label: 'Max Bet - Matka' },
] as const
const amount = z.number().min(0, 'Must be zero or greater').nullable().optional()
const base = z.object({
  name: z.string(), username: z.string(), password: z.string(), phone: z.string(), dialCode: z.string(), email: z.string(),
  playerType: z.string(), agentId: z.string(), targetAgentId: z.string(), currency: z.string().min(1, 'Please select currency'),
  status: z.string().min(1, 'Please select account status'), riskType: z.string(), vipTier: z.string(), vipTierName: z.string(),
  requirePasswordReset: z.boolean(), bonusAllowed: z.boolean(), sportsVisible: z.boolean(), sportsBetAllowed: z.boolean(),
  casinoVisible: z.boolean(), casinoBetAllowed: z.boolean(), matkaVisible: z.boolean(), matkaBetAllowed: z.boolean(),
  dailyStakeLimit: amount, weeklyStakeLimit: amount, exposureCapOverride: amount, cooldownSeconds: amount,
  maxBetSports: amount, maxBetCasino: amount, maxBetMatka: amount, _phoneError: z.string(),
  // Admin credit players only (AGENT_CREDIT / WHITELABEL_CREDIT). Blank is sent as 0: credit can be given later.
  creditLimit: amount,
})
export type PlayerCreateValues = z.infer<typeof base>
export function isCreditPlayer(type: string) { return type === 'AGENT_CREDIT' || type === 'WHITELABEL_CREDIT' }
export function isAgentPlayer(type: string) { return ['AGENT_CREDIT', 'SHARING_AGENT_PLAYER', 'COMMISSION_AGENT_PLAYER'].includes(type) }
export function playerTypeForScheme(scheme: string) {
  return scheme === 'CREDIT' ? 'AGENT_CREDIT' : scheme === 'SHARING' ? 'SHARING_AGENT_PLAYER' : scheme === 'COMMISSION' ? 'COMMISSION_AGENT_PLAYER' : 'REGULAR'
}
export function playerCreateSchema(agentMode: boolean) {
  return base.superRefine((value, context) => {
    const issue = (path: keyof PlayerCreateValues, message: string) => context.addIssue({ code: 'custom', path: [path], message })
    if (!value.name.trim()) issue('name', agentMode ? 'Full name is required' : 'Please enter full name')
    else if (!agentMode && value.name.length < 2) issue('name', 'Name must be at least 2 characters')
    if (!value.phone) issue('phone', agentMode ? 'Phone number is required' : 'Please enter phone number')
    else if (!new RegExp(agentMode ? '^[0-9]{10}$' : '^[0-9]{6,15}$').test(value.phone)) issue('phone', agentMode ? 'Please enter a valid 10-digit phone number' : 'Please enter a valid phone number')
    else if (value._phoneError) issue('phone', value._phoneError)
    if (value.email && !z.email().safeParse(value.email).success) issue('email', 'Please enter a valid email')
    if (agentMode) {
      if (!value.username) issue('username', 'Username is required')
      else if (value.username.length < 3) issue('username', 'Username must be at least 3 characters')
      else if (value.username.length > 50) issue('username', 'Username must not exceed 50 characters')
      else if (!/^[a-zA-Z0-9_]+$/.test(value.username)) issue('username', 'Username can only contain letters, numbers, and underscores')
      if (!value.password) issue('password', 'Password is required')
      else if (value.password.length < 6) issue('password', 'Password must be at least 6 characters')
    } else {
      // The old admin validator permits an omitted password, but requires eight
      // characters when supplied. Preserve that rule, not its contradictory help.
      if (value.password.trim() && value.password.trim().length < 8) issue('password', 'Password must be at least 8 characters')
      if (isAgentPlayer(value.playerType) && !value.agentId) issue('agentId', 'Please select an agent')
    }
  })
}
export function playerCreateValues(tenant?: string | null, scheme?: string, currency = 'INR'): PlayerCreateValues {
  const agentMode = scheme !== undefined
  return { name: '', username: '', password: '', phone: '', email: '', dialCode: getDefaultDialCodeForWhitelabel(tenant),
    playerType: agentMode ? playerTypeForScheme(scheme) : 'REGULAR', agentId: '', targetAgentId: 'self',
    currency: agentMode && scheme === 'COMMISSION' ? 'INR' : currency, status: 'active', riskType: '', vipTier: '', vipTierName: '',
    requirePasswordReset: false, bonusAllowed: scheme !== 'CREDIT', sportsVisible: true, sportsBetAllowed: true,
    casinoVisible: true, casinoBetAllowed: true, matkaVisible: false, matkaBetAllowed: false,
    ...Object.fromEntries(PLAYER_LIMITS.map(({ key }) => [key, agentMode ? undefined : null])),
    exposureCapOverride: undefined, cooldownSeconds: undefined, _phoneError: '', creditLimit: null }
}
export function phoneAvailabilityValue(phone: string, dialCode?: string) {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return ''
  if (dialCode && !digits.startsWith(dialCode)) return `+${dialCode}${digits}`
  return digits.length >= 6 ? digits : ''
}
export function adminPlayerInput(value: PlayerCreateValues, baseCurrency: string) {
  const credit = isCreditPlayer(value.playerType)
  const password = value.password.trim()
  return { name: value.name, email: value.email || undefined, phone: value.dialCode ? `+${value.dialCode}${value.phone.replace(/\D/g, '')}` : value.phone.replace(/\D/g, ''),
    username: value.username || undefined, ...(password ? { password } : {}), playerType: value.playerType || 'REGULAR',
    agentId: isAgentPlayer(value.playerType) ? value.agentId : undefined, creditLimit: credit ? value.creditLimit ?? 0 : undefined,
    status: (value.status || 'active').toUpperCase(), requirePasswordReset: value.requirePasswordReset, bonusAllowed: credit ? false : value.bonusAllowed,
    sportsVisible: value.sportsVisible, sportsBetAllowed: value.sportsBetAllowed, casinoVisible: value.casinoVisible, casinoBetAllowed: value.casinoBetAllowed,
    matkaVisible: value.matkaVisible, matkaBetAllowed: value.matkaBetAllowed, initialBalance: 0, currency: credit ? baseCurrency || 'INR' : value.currency || baseCurrency || 'INR',
    dailyStakeLimit: value.dailyStakeLimit ?? null, weeklyStakeLimit: value.weeklyStakeLimit ?? null, exposureCapOverride: value.exposureCapOverride ?? null,
    cooldownSeconds: value.cooldownSeconds ?? null, maxBetSports: value.maxBetSports ?? null, maxBetCasino: value.maxBetCasino ?? null, maxBetMatka: value.maxBetMatka ?? null,
    riskType: value.riskType ? value.riskType.toUpperCase() : undefined, vipTierId: credit ? undefined : value.vipTier || undefined }
}
/**
 * createPlayerForAgent input. No playerType: the API derives it (and the betting flags) from the owning
 * agent, and ignores a type sent by an agent. The owner is the agent itself or one of its ACTIVE sub-agents.
 */
export function agentPlayerInput(value: PlayerCreateValues, creator: { id: string; schemeType: string }, baseCurrency: string) {
  const credit = creator.schemeType === 'CREDIT'
  return { username: value.username, password: value.password, name: value.name, phone: value.phone, email: value.email || undefined,
    agentId: value.targetAgentId === 'self' ? creator.id : value.targetAgentId,
    creditLimit: credit ? 0 : undefined, initialBalance: 0, currency: credit || creator.schemeType === 'SHARING' ? baseCurrency : value.currency || baseCurrency,
    bonusAllowed: ['SHARING', 'COMMISSION'].includes(creator.schemeType) ? value.bonusAllowed : false,
    maxBetSports: value.maxBetSports, maxBetCasino: value.maxBetCasino, maxBetMatka: value.maxBetMatka, dailyStakeLimit: value.dailyStakeLimit }
}
