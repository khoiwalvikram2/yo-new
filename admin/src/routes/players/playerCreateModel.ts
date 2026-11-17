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
  // Credit players only (AGENT_CREDIT / WHITELABEL_CREDIT, spec 2026-11-02 §4.4). creditLimit is the input's name
  // for the credit reference: a reference only, which moves no chips. Blank is sent as 0: it can be set later.
  creditLimit: amount,
  // Chips deposited to the new player from its parent. Blank or 0: none. Offered only when the creator may give them
  // (givesOpeningChips).
  openingChips: amount,
  // The parent's free chips, read by the form; null while unknown (the server checks it then).
  _chipsFree: z.number().nullable(),
})
export type PlayerCreateValues = z.infer<typeof base>
export function isCreditPlayer(type: string) { return type === 'AGENT_CREDIT' || type === 'WHITELABEL_CREDIT' }
export function isAgentPlayer(type: string) { return ['AGENT_CREDIT', 'SHARING_AGENT_PLAYER', 'COMMISSION_AGENT_PLAYER'].includes(type) }
export function playerTypeForScheme(scheme: string) {
  return scheme === 'CREDIT' ? 'AGENT_CREDIT' : scheme === 'SHARING' ? 'SHARING_AGENT_PLAYER' : scheme === 'COMMISSION' ? 'COMMISSION_AGENT_PLAYER' : 'REGULAR'
}
/**
 * Whether the creator may give the new credit player opening chips. They come only from its direct parent (spec
 * 2026-11-02 decision 3), at creation too: a CREDIT agent gives them to its own AGENT_CREDIT player; an admin gives a
 * WHITELABEL_CREDIT player chips from the whitelabel pool and, once its CREDIT agent is chosen, an AGENT_CREDIT player
 * chips from that agent's own free chips (owner decision 2026-11-04). In the admin form this also decides when the
 * Credit Reference and Opening Chips fields show. A player an agent creates for a sub-agent gets its chips from that
 * sub-agent after the account exists; the server refuses them from anyone else.
 */
export function givesOpeningChips(value: Pick<PlayerCreateValues, 'playerType' | 'targetAgentId' | 'agentId'>, agentMode: boolean): boolean {
  if (agentMode) return value.playerType === 'AGENT_CREDIT' && value.targetAgentId === 'self'
  return value.playerType === 'WHITELABEL_CREDIT' || (value.playerType === 'AGENT_CREDIT' && Boolean(value.agentId))
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
    // Every player needs a password of at least 8 characters, surrounding spaces not counted: the server refuses
    // anything else. The admin form called it optional and the agent form accepted 6, so both were refused only
    // after the last step.
    const password = value.password.trim()
    if (!password) issue('password', 'Password is required')
    else if (password.length < 8) issue('password', 'Password must be at least 8 characters')
    if (agentMode) {
      if (!value.username) issue('username', 'Username is required')
      else if (value.username.length < 3) issue('username', 'Username must be at least 3 characters')
      else if (value.username.length > 50) issue('username', 'Username must not exceed 50 characters')
      else if (!/^[a-zA-Z0-9_]+$/.test(value.username)) issue('username', 'Username can only contain letters, numbers, and underscores')
    } else {
      if (isAgentPlayer(value.playerType) && !value.agentId) issue('agentId', 'Please select an agent')
    }
    // The opening deposit cannot take more than the parent's free chips (spec 2026-11-02 decision 4), when the
    // creator gives them at all (givesOpeningChips).
    if (givesOpeningChips(value, agentMode) && value.openingChips != null && value._chipsFree != null && value.openingChips > value._chipsFree) {
      issue('openingChips', `Not enough chips: ${Math.max(0, value._chipsFree).toFixed(2)} free`)
    }
  })
}

/** Opening chips go on the input only when there are some (spec 2026-11-02 §4.4: openingChips > 0). */
function openingChipsInput(value: PlayerCreateValues): { openingChips?: number } {
  const chips = value.openingChips
  return chips != null && Number.isFinite(chips) && chips > 0 ? { openingChips: chips } : {}
}
export function playerCreateValues(tenant?: string | null, scheme?: string, currency = 'INR'): PlayerCreateValues {
  const agentMode = scheme !== undefined
  return { name: '', username: '', password: '', phone: '', email: '', dialCode: getDefaultDialCodeForWhitelabel(tenant),
    playerType: agentMode ? playerTypeForScheme(scheme) : 'REGULAR', agentId: '', targetAgentId: 'self',
    currency: agentMode && scheme === 'COMMISSION' ? 'INR' : currency, status: 'active', riskType: '', vipTier: '', vipTierName: '',
    requirePasswordReset: false, bonusAllowed: scheme !== 'CREDIT', sportsVisible: true, sportsBetAllowed: true,
    casinoVisible: true, casinoBetAllowed: true, matkaVisible: false, matkaBetAllowed: false,
    ...Object.fromEntries(PLAYER_LIMITS.map(({ key }) => [key, agentMode ? undefined : null])),
    exposureCapOverride: undefined, cooldownSeconds: undefined, _phoneError: '', creditLimit: null, openingChips: null, _chipsFree: null }
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
    riskType: value.riskType ? value.riskType.toUpperCase() : undefined, vipTierId: credit ? undefined : value.vipTier || undefined,
    // From the whitelabel pool for a whitelabel credit player, from the chosen agent's chips for an agent credit player.
    ...(givesOpeningChips(value, false) ? openingChipsInput(value) : {}) }
}
/**
 * createPlayerForAgent input. No playerType: the API derives it (and the betting flags) from the owning
 * agent, and ignores a type sent by an agent. The owner is the agent itself or one of its ACTIVE sub-agents.
 * A CREDIT agent's own player gets the credit reference and opening chips it was given; a sub-agent's player
 * starts at zero, because only its direct parent (the sub-agent) moves its chips (spec 2026-11-02 decision 3,
 * givesOpeningChips).
 */
export function agentPlayerInput(value: PlayerCreateValues, creator: { id: string; schemeType: string }, baseCurrency: string) {
  const credit = creator.schemeType === 'CREDIT'
  const own = value.targetAgentId === 'self'
  return { username: value.username, password: value.password, name: value.name, phone: value.phone, email: value.email || undefined,
    agentId: own ? creator.id : value.targetAgentId,
    creditLimit: credit ? own ? value.creditLimit ?? 0 : 0 : undefined, initialBalance: 0, currency: credit || creator.schemeType === 'SHARING' ? baseCurrency : value.currency || baseCurrency,
    bonusAllowed: ['SHARING', 'COMMISSION'].includes(creator.schemeType) ? value.bonusAllowed : false,
    maxBetSports: value.maxBetSports, maxBetCasino: value.maxBetCasino, maxBetMatka: value.maxBetMatka, dailyStakeLimit: value.dailyStakeLimit,
    ...(credit && own ? openingChipsInput(value) : {}) }
}
