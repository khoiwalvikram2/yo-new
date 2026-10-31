import { z } from 'zod'

export interface AgentRate { domain: string; rate: number }
export interface AgentParentOption {
  id: string; username: string | null; levelIndex: number | null; schemeType: string
  allowedDomains?: string[]; sharingRates?: AgentRate[]; commissionRates?: AgentRate[]
  status?: string | null; creditAvailable?: number | null
}
export interface AgentRecord extends AgentParentOption {
  phone?: string | null; status: string; parentAgentId?: string | null; tallyEnabled?: boolean; tallyDomains?: string[] | null
}
/** SHARING and CREDIT hierarchies stop at level 4; COMMISSION has no depth cap. */
export const MAX_AGENT_LEVEL = 4
/** Agents that may be chosen as a new agent's parent: same scheme, ACTIVE, and (SHARING/CREDIT) below level 4. */
export function eligibleParentAgents<T extends AgentParentOption>(options: readonly T[], schemeType: string): T[] {
  return options.filter((option) => option.schemeType === schemeType && (option.status == null || option.status.toUpperCase() === 'ACTIVE') &&
    (schemeType === 'COMMISSION' || (option.levelIndex ?? 1) < MAX_AGENT_LEVEL))
}
export interface RateCaps { limits: Record<string, number | null>; blocked: boolean; missingWhitelabelDomains: string[] }
const capsSchema = z.object({ limits: z.record(z.string(), z.number().nullable()), blocked: z.boolean(), missingWhitelabelDomains: z.array(z.string()) })
const base = z.object({
  id: z.string(), username: z.string(), password: z.string(), phone: z.string(),
  schemeType: z.enum(['COMMISSION', 'SHARING', 'CREDIT']), allowedDomains: z.array(z.string()),
  status: z.string().min(1, 'Please select account status'), parentAgentId: z.string().nullable(), levelIndex: z.number().nullable(),
  tallyEnabled: z.boolean(), tallyDomains: z.array(z.string()), currency: z.string().min(1, 'Currency is required'),
  commissionRates: z.record(z.string(), z.number().nullable()), sharingRates: z.record(z.string(), z.number().nullable()),
  // Credit limit at creation (CREDIT only). Blank means "not set": the field is then left out of the input.
  creditLimit: z.number().min(0, 'Credit limit cannot be negative').nullable(),
  _usernameError: z.string(), _parentLevel: z.number(), _caps: capsSchema,
})
export type AgentEditorValues = z.infer<typeof base>
export function agentEditorSchema(isEdit: boolean) {
  return base.superRefine((value, context) => {
    const issue = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message })
    if (!isEdit) {
      if (!value.allowedDomains.length) issue(['allowedDomains'], 'Select at least one domain')
      if (!value.username.trim()) issue(['username'], 'Please enter username')
      else if (value.username.length < 3) issue(['username'], 'Username must be at least 3 characters')
      else if (!/^[a-z0-9_]+$/.test(value.username)) issue(['username'], 'Spaces, uppercase, and special characters are not allowed. Use only lowercase letters, numbers, and underscore.')
      else if (value._usernameError) issue(['username'], value._usernameError)
      if (!value.password.trim()) issue(['password'], 'Please enter password')
      else if (value.password.length < 6) issue(['password'], 'Password must be at least 6 characters')
    }
    if (!isEdit && value.phone && !/^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/.test(value.phone)) issue(['phone'], 'Please enter a valid phone number')
    if (value.schemeType !== 'COMMISSION' && value.levelIndex == null) issue(['levelIndex'], 'Hierarchy level is required')
    if (value.schemeType !== 'COMMISSION' && value.levelIndex != null && value._parentLevel > 0 && value.levelIndex <= value._parentLevel) issue(['levelIndex'], `Level must be greater than parent's level (L${value._parentLevel})`)
    const key = value.schemeType === 'COMMISSION' ? 'commissionRates' : 'sharingRates'
    for (const domain of value.allowedDomains) {
      const rate = value[key][domain]
      const cap = value._caps.limits[domain] ?? 100
      if (rate == null) issue([key, domain], `Please enter ${domain} ${value.schemeType === 'COMMISSION' ? 'commission' : 'sharing'} rate`)
      else if (!Number.isFinite(rate) || rate < 0 || rate > 100) issue([key, domain], 'Rate must be between 0 and 100')
      else if (value._caps.blocked) issue([key, domain], 'Waiting for parent rate limits')
      else if (rate > cap) issue([key, domain], `Rate cannot exceed parent's rate (${cap.toFixed(2)}%) for ${domain}`)
      else if (value._caps.missingWhitelabelDomains.includes(domain)) issue([key, domain], `Whitelabel has no sharing configured for ${domain}. Cannot assign.`)
    }
  })
}
export function agentEditorValues(record?: AgentRecord): AgentEditorValues {
  // Agent field resolvers already return percentage units (persisted decimal ×100).
  const rates = (source?: AgentRate[]) => Object.fromEntries((source || []).map(({ domain, rate }) => [domain, Number(Number(rate).toFixed(2))]))
  return { id: record?.id || '', username: record?.username || '', password: '', phone: record?.phone || '',
    schemeType: (record?.schemeType || 'COMMISSION') as AgentEditorValues['schemeType'], allowedDomains: record?.allowedDomains || [], status: record?.status || 'ACTIVE',
    // A new agent starts with cross-domain tally on (it only applies to COMMISSION); an edit keeps the stored value.
    parentAgentId: record?.parentAgentId || null, levelIndex: record?.levelIndex ?? null, tallyEnabled: record ? Boolean(record.tallyEnabled) : true,
    tallyDomains: record?.tallyDomains || [], currency: 'INR', commissionRates: rates(record?.commissionRates), sharingRates: rates(record?.sharingRates),
    creditLimit: null, _usernameError: '', _parentLevel: 0, _caps: { limits: {}, blocked: false, missingWhitelabelDomains: [] } }
}
export function createAgentInput(values: AgentEditorValues, creator?: { id: string; schemeType: string; levelIndex: number | null }) {
  const isAgent = creator && ['SHARING', 'CREDIT', 'COMMISSION'].includes(creator.schemeType)
  const parentAgentId = isAgent ? creator.id : values.parentAgentId || null
  const parentLevel = creator?.levelIndex || 1
  const levelIndex = isAgent && (!values.levelIndex || values.levelIndex <= parentLevel) ? parentLevel + 1 : values.levelIndex || null
  const commission = values.schemeType === 'COMMISSION'
  return { username: values.username.trim().toLowerCase(), password: values.password.trim(), phone: values.phone.trim() || null,
    schemeType: values.schemeType, allowedDomains: values.allowedDomains, status: values.status.toUpperCase(), parentAgentId, levelIndex,
    // Tally is a COMMISSION setting; other schemes never send it on.
    tallyEnabled: commission && Boolean(values.tallyEnabled), tallyDomains: commission ? values.tallyDomains : [], currency: values.currency || 'INR',
    ...(values.schemeType === 'CREDIT' && values.creditLimit != null && Number.isFinite(values.creditLimit) ? { creditLimit: values.creditLimit } : {}) }
}
/**
 * The updateAgent input. An agent editing one of its sub-agents may change the domains (within the
 * parent's) and the status only: the hierarchy level, the parent and the tally stay as they are, so
 * they are not sent at all.
 */
export function updateAgentInput(id: string, values: AgentEditorValues, options: { agentCaller?: boolean } = {}) {
  if (options.agentCaller) return { id, allowedDomains: values.allowedDomains, status: values.status.toUpperCase() }
  return { id, allowedDomains: values.allowedDomains, status: values.status.toUpperCase(), parentAgentId: values.parentAgentId || null,
    levelIndex: values.levelIndex || null, tallyEnabled: Boolean(values.tallyEnabled), tallyDomains: values.tallyDomains }
}
/** A setCommissionConfig input (commissionRate) or a setSharingConfig input (shareRate), as a fraction. */
export interface AgentRateInput { agentId: string; domain: string; effectiveFrom: string; commissionRate?: number; shareRate?: number }
/** One rate input per allowed domain with a rate. 0 is a real rate (it can lower a rate to zero); blank is "not set". */
export function agentRateInputs(agentId: string, values: AgentEditorValues, effectiveFrom: string): AgentRateInput[] {
  const commission = values.schemeType === 'COMMISSION'
  return Object.entries(commission ? values.commissionRates : values.sharingRates)
    .filter(([domain, rate]) => values.allowedDomains.includes(domain) && rate != null && Number.isFinite(Number(rate)) && Number(rate) >= 0)
    .map(([domain, rate]) => commission ? { agentId, domain, commissionRate: Number(rate) / 100, effectiveFrom } : { agentId, domain, shareRate: Number(rate) / 100, effectiveFrom })
}
