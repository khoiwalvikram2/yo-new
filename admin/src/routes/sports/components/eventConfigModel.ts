export type JsonRecord = Record<string, unknown>
export function configRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}
export function configNumber(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
export function configStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
export const WEIGHTS = [['liability', 'Liability'], ['exposure', 'Exposure'], ['volume', 'Volume'], ['odds', 'Odds']] as const
export const PERCENTILES = [
  ['liability75', 'Liability 75th percentile'], ['liability90', 'Liability 90th percentile'], ['liability95', 'Liability 95th percentile'],
  ['exposure75', 'Exposure 75th percentile'], ['exposure90', 'Exposure 90th percentile'],
  ['betCount75', 'Bet count 75th percentile'], ['betCount90', 'Bet count 90th percentile'],
  ['odds75', 'Odds 75th percentile'], ['odds90', 'Odds 90th percentile'],
] as const
export const AMOUNTS = [
  ['highLiability', 'High liability'], ['mediumLiability', 'Medium liability'], ['highExposure', 'High exposure'], ['mediumExposure', 'Medium exposure'],
  ['highBetCount', 'High bet count'], ['mediumBetCount', 'Medium bet count'], ['highOdds', 'High odds'], ['mediumOdds', 'Medium odds'],
] as const
const ALERT_KEYS = ['enabled', 'triggerLevels', 'notificationEnabled', 'bannerEnabled', 'sidebarIndicatorEnabled', 'cooldownSeconds']
function pick(value: unknown, keys: readonly string[]) {
  const source = configRecord(value)
  return Object.fromEntries(keys.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]))
}
export interface RiskDraft { weights: JsonRecord; percentiles?: JsonRecord; amounts?: JsonRecord; alerts: JsonRecord }
export function riskDraftFrom(value: unknown): RiskDraft {
  if (!value) return { weights: { liability: 40, exposure: 30, volume: 15, odds: 15 }, alerts: { enabled: false, triggerLevels: ['HIGH'], notificationEnabled: true, bannerEnabled: true, sidebarIndicatorEnabled: true, cooldownSeconds: 60 } }
  const source = configRecord(value)
  return { weights: pick(source.weights, WEIGHTS.map(([key]) => key)), percentiles: pick(source.percentiles, PERCENTILES.map(([key]) => key)), amounts: pick(source.amounts, AMOUNTS.map(([key]) => key)), alerts: pick(source.alerts, ALERT_KEYS) }
}
export function weightTotal(draft: RiskDraft) { return WEIGHTS.reduce((sum, [key]) => sum + (configNumber(draft.weights[key]) ?? 0), 0) }
export function riskDraftError(draft: RiskDraft): string | null {
  if (WEIGHTS.some(([key]) => configNumber(draft.weights[key]) === null || Number(draft.weights[key]) < 0 || Number(draft.weights[key]) > 100)) return 'Each risk weight must be a number between 0 and 100.'
  if (weightTotal(draft) !== 100) return 'Risk weights must sum to 100.'
  if ([draft.percentiles, draft.amounts].some(section => Object.values(section ?? {}).some(value => value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)))) return 'Thresholds must be zero or greater, or left blank.'
  if (draft.alerts.enabled && !configStrings(draft.alerts.triggerLevels).length) return 'Select at least one risk level when alerts are enabled.'
  const cooldown = draft.alerts.cooldownSeconds
  if (cooldown != null && (typeof cooldown !== 'number' || !Number.isFinite(cooldown) || cooldown < 0)) return 'Alert cooldown must be zero or greater.'
  return null
}
export interface AutomationDraft { ruleType: string; config: JsonRecord; enabled?: boolean; priority?: number | null }
export function automationDraftFrom(value: unknown): AutomationDraft {
  const source = configRecord(value)
  if (!value) return { ruleType: 'AUTO_VOID', config: { triggers: {}, actions: [], cooldown: 60, notifications: { enabled: true, channels: ['notification'] } }, enabled: false, priority: 0 }
  return { ruleType: String(source.ruleType ?? ''), config: { ...configRecord(source.config) }, enabled: typeof source.enabled === 'boolean' ? source.enabled : undefined, priority: typeof source.priority === 'number' ? source.priority : null }
}
export function automationDraftError(draft: AutomationDraft): string | null {
  if (!draft.ruleType) return 'The loaded rule has no rule type. Reload before saving.'
  const triggers = configRecord(draft.config.triggers)
  if ([triggers.stakeThreshold, triggers.bookBalanceThreshold, triggers.maxExposure, draft.config.cooldown].some(value => value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))) return 'Thresholds and cooldown must be zero or greater, or left blank.'
  return null
}
