import { z } from 'zod'
import type { VIPTier } from '@/modules/vip/types'

export const VIP_ICON_OPTIONS = ['wallet', 'gift', 'star', 'crown', 'rocket', 'lightning', 'trophy', 'diamond', 'reload', 'calendar', 'mail', 'message'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))
/** Every deposit method a tier can allow, in the server's order (shared/src/vip/depositPolicy.ts). */
export const VIP_DEPOSIT_METHODS = ['BANK_TRANSFER', 'UPI', 'GATEWAY', 'CRYPTO'] as const
export const vipTierSchema = z.object({
  depositPolicy: z.object({ enabled: z.boolean(), methods: z.array(z.enum(VIP_DEPOSIT_METHODS)),
    min: z.number().min(0).nullable(), max: z.number().min(0).nullable(), daily: z.number().min(0).nullable(), monthly: z.number().min(0).nullable(),
  }).superRefine((value, ctx) => {
    if (value.enabled && !value.methods.length) ctx.addIssue({ code: 'custom', path: ['methods'], message: 'Choose at least one method' })
    if (value.min != null && value.max != null && value.max < value.min) ctx.addIssue({ code: 'custom', path: ['max'], message: 'Maximum must be at least minimum' })
    for (const key of ['daily', 'monthly'] as const) if (value[key] != null && value.min != null && value[key]! < value.min)
      ctx.addIssue({ code: 'custom', path: [key], message: 'Limit must be at least the minimum deposit' })
  }).optional(),
  name: z.string().min(1, 'Please enter tier name'),
  level: z.number().nullable().refine((value) => value !== null && value >= 1, 'Please enter level'),
  minMonthlyDeposit: z.number().nullable().refine((value) => value !== null && value >= 0, 'Please enter minimum deposit'),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Please select a color'),
  benefits: z.array(z.string().min(1, 'Enter benefit')),
  perks: z.array(z.object({ name: z.string().min(1, 'Required'), description: z.string().min(1, 'Required'), icon: z.string().optional() })),
})
export type VIPTierValues = z.infer<typeof vipTierSchema>
export function vipTierValues(tier: VIPTier | undefined, defaultColor: string): VIPTierValues {
  return {
    depositPolicy: tier?.depositPolicy ? { ...tier.depositPolicy, methods: [...tier.depositPolicy.methods] } : { enabled: true, methods: [...VIP_DEPOSIT_METHODS], min: null, max: null, daily: null, monthly: null },
    name: tier?.name || '', level: tier?.level ?? null, minMonthlyDeposit: tier?.minMonthlyDeposit ?? null,
    color: tier?.color || defaultColor, benefits: [...(tier?.benefits || [])],
    perks: (tier?.perks || []).map((perk) => ({ ...perk })),
  }
}
export function vipTierInput(values: VIPTierValues) {
  return {
    depositPolicy: values.depositPolicy ?? { enabled: true, methods: [...VIP_DEPOSIT_METHODS], min: null, max: null, daily: null, monthly: null },
    name: values.name, level: Math.max(1, Math.round(Number(values.level))),
    minMonthlyDeposit: Math.max(0, Math.round(Number(values.minMonthlyDeposit))), color: values.color,
    benefits: values.benefits.map((benefit) => String(benefit).trim()).filter(Boolean),
    perks: values.perks.map((perk) => ({ name: String(perk.name || '').trim(), description: String(perk.description || '').trim(), icon: perk.icon }))
      .filter((perk) => perk.name.length > 0 && perk.description.length > 0),
  }
}
