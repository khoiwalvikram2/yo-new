import { z } from 'zod'

export const VIP_DEPOSIT_METHODS = ['BANK_TRANSFER', 'UPI', 'GATEWAY', 'CRYPTO'] as const
const amount = z.number().finite().nonnegative().max(1_000_000_000).nullable()
export const vipDepositPolicySchema = z.object({
  enabled: z.boolean(), methods: z.array(z.enum(VIP_DEPOSIT_METHODS)).refine(values => new Set(values).size === values.length, 'Duplicate deposit method'),
  min: amount, max: amount, daily: amount, monthly: amount,
}).superRefine((policy, ctx) => {
  if (policy.min !== null && policy.max !== null && policy.min > policy.max)
    ctx.addIssue({ code: 'custom', path: ['max'], message: 'Maximum must be at least minimum' })
  for (const key of ['daily', 'monthly'] as const) if (policy[key] !== null && policy.min !== null && policy[key]! < policy.min)
    ctx.addIssue({ code: 'custom', path: [key], message: 'Limit must be at least the minimum deposit' })
  if (policy.enabled && !policy.methods.length) ctx.addIssue({ code: 'custom', path: ['methods'], message: 'Choose at least one deposit method' })
})
export type VipDepositPolicy = z.infer<typeof vipDepositPolicySchema>
export type VipDepositMethod = typeof VIP_DEPOSIT_METHODS[number]
export const defaultVipDepositPolicy = (): VipDepositPolicy => ({ enabled: true, methods: [...VIP_DEPOSIT_METHODS], min: null, max: null, daily: null, monthly: null })
export const vipEligiblePlayer = (type?: string | null, owningScheme?: string | null) =>
  !['AGENT_CREDIT', 'WHITELABEL_CREDIT'].includes(String(type || '').toUpperCase()) && owningScheme !== 'CREDIT'

/** null/absent = all eligible tiers; [] = none. Never treat an empty selection as public. */
export function accountAllowsTier(ids: string[] | null | undefined, tierId: string) {
  return ids == null || (Array.isArray(ids) && ids.includes(tierId))
}

export function intersectDepositLimits(limits: Array<{ min?: number | null; max?: number | null }>) {
  const min = Math.max(0.01, ...limits.map(limit => limit.min ?? 0))
  const max = Math.min(Number.MAX_SAFE_INTEGER, ...limits.map(limit => limit.max ?? Number.MAX_SAFE_INTEGER))
  return { min, max, available: Number.isFinite(min) && Number.isFinite(max) && max >= min }
}
