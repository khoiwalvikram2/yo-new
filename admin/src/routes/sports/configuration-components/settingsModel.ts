import { z } from 'zod'
export type ConfigValue = string | number | boolean | null | undefined
export type ConfigValues = Record<string, ConfigValue>
export type SettingsVariant = 'sport' | 'league' | 'event'
export type SettingsTab = 'stake' | 'delays' | 'odds' | 'cashout' | 'commission' | 'exposure' | 'risk'
export const configSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()]))
export const DOMAINS = ['exchange','bookmaker','fancy'] as const
export const tabFields: Record<SettingsTab, string[]> = {
  stake: DOMAINS.flatMap(domain => [domain + 'MinStake', domain + 'MaxStake']),
  delays: DOMAINS.flatMap(domain => [domain + 'Delay', domain + 'Cooldown']),
  odds: ['exchangeMinOdds', 'exchangeMaxOdds'], cashout: ['cashoutActive'],
  commission: DOMAINS.map(domain => domain + 'Commission'),
  exposure: DOMAINS.flatMap(domain => [domain + 'ExposureDaily', domain + 'ExposureWeekly', domain + 'ExposureCap']),
  risk: ['riskLevel', 'riskThreshold', 'volatilityThreshold', 'alertOnBreach', 'alertChannel', 'alertRateLimit'],
}
export function tabsFor(variant: SettingsVariant): SettingsTab[] { return variant === 'sport' ? ['stake','delays','odds','cashout','commission','exposure','risk'] : ['stake','delays','odds','exposure','risk'] }
export function valuesForVisitedTabs(values: ConfigValues, visited: ReadonlySet<SettingsTab>, variant: SettingsVariant) {
  const fields = tabsFor(variant).filter(tab => visited.has(tab)).flatMap(tab => tabFields[tab])
  // rc-field-form validates/returns registered fields only. Unvisited panels must not be written.
  const result: ConfigValues = {}
  for (const field of fields) if (values[field] !== undefined) result[field] = values[field]
  if (variant !== 'league') result.mode = values.mode ?? 'overwrite'
  if (variant === 'sport') result.tier = values.tier ?? 'default'
  return result
}
export function hydrateSettings(source: Record<string, ConfigValue>, variant: SettingsVariant): ConfigValues {
  const fields = variant === 'league' ? [...tabFields.stake, ...tabFields.delays, ...tabFields.commission] : tabsFor(variant).flatMap(tab => tabFields[tab])
  const result: ConfigValues = {}
  for (const field of fields) result[field] = source[field]
  for (const field of tabFields.delays) result[field] = source[field] ?? undefined
  if (variant !== 'league') {
    if (variant === 'sport') result.cashoutActive = source.cashoutActive ?? false
    result.riskLevel = source.riskLevel ?? undefined
    result.alertOnBreach = source.alertOnBreach ?? false
    result.alertChannel = source.alertChannel ?? 'email'
    result.alertRateLimit = source.alertRateLimit ?? 10
  }
  return result
}
export interface SportRecord { id: string; key: string; name: string; sort?: number; status?: string; updatedAt?: string | null }
export interface LeagueRecord { id: string; name: string; sportId: string; sort?: number; status?: string; updatedAt?: string | null }
export interface EventRecord { id: string; name: string; leagueId: string; startTime?: string | null; status?: string; updatedAt?: string | null }
export interface MarketRecord { id: string; name: string; eventId: string; type?: string; status?: string; updatedAt?: string | null }
