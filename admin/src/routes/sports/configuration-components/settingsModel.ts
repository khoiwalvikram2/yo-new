import { z } from 'zod'
export type ConfigValue = string | number | boolean | null | undefined
export type ConfigValues = Record<string, ConfigValue>
export type SettingsVariant = 'sport' | 'league' | 'event'
export type SettingsTab = 'stake' | 'delays' | 'odds' | 'cashout' | 'commission' | 'exposure' | 'risk'
export const DOMAINS = ['exchange','bookmaker','fancy'] as const
/* The stake and odds limits a record must keep, as the server checks them (admin-backend
 * domains/sports/settingsLimits.ts): a Min Stake not above its Max Stake, odds from 1.01 and a Min Odds not
 * above the Max Odds. They were saved with a success toast, and every bet on the event then failed. An
 * empty field is not checked; the error sits on the field to change. */
export const MIN_DECIMAL_ODDS = 1.01
const setNumber = (value: ConfigValue): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const domainLabel = (domain: string) => domain.charAt(0).toUpperCase() + domain.slice(1)
export function limitErrors(values: ConfigValues): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const domain of DOMAINS) {
    const min = setNumber(values[domain + 'MinStake']); const max = setNumber(values[domain + 'MaxStake'])
    if (min !== null && max !== null && min > max) errors[domain + 'MinStake'] = `${domainLabel(domain)} Min Stake cannot exceed the Max Stake (${max})`
  }
  const minOdds = setNumber(values.exchangeMinOdds); const maxOdds = setNumber(values.exchangeMaxOdds)
  if (minOdds !== null && minOdds < MIN_DECIMAL_ODDS) errors.exchangeMinOdds = `Min Odds must be at least ${MIN_DECIMAL_ODDS}`
  else if (minOdds !== null && maxOdds !== null && minOdds > maxOdds) errors.exchangeMinOdds = `Min Odds cannot exceed the Max Odds (${maxOdds})`
  if (maxOdds !== null && maxOdds < MIN_DECIMAL_ODDS) errors.exchangeMaxOdds = `Max Odds must be at least ${MIN_DECIMAL_ODDS}`
  return errors
}
export const configSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()]))
  .superRefine((values, ctx) => { for (const [field, message] of Object.entries(limitErrors(values))) ctx.addIssue({ code: 'custom', path: [field], message }) })
/** The Default Settings drawer's stake limits (`exchangeMin`/`exchangeMax`, ...): the first contradiction, or null. */
export function defaultStakeLimitsError(values: ConfigValues): string | null {
  for (const domain of DOMAINS) {
    const min = setNumber(values[domain + 'Min']); const max = setNumber(values[domain + 'Max'])
    if (min !== null && max !== null && min > max) return `${domainLabel(domain)} Min Stake cannot exceed the ${domainLabel(domain)} Max Stake (${max})`
  }
  return null
}
export const tabFields: Record<SettingsTab, string[]> = {
  stake: DOMAINS.flatMap(domain => [domain + 'MinStake', domain + 'MaxStake']),
  delays: DOMAINS.flatMap(domain => [domain + 'Delay', domain + 'Cooldown']),
  odds: ['exchangeMinOdds', 'exchangeMaxOdds'], cashout: ['cashoutActive'],
  commission: DOMAINS.map(domain => domain + 'Commission'),
  exposure: DOMAINS.flatMap(domain => [domain + 'ExposureDaily', domain + 'ExposureWeekly', domain + 'ExposureCap']),
  risk: ['riskLevel', 'riskThreshold', 'volatilityThreshold', 'alertOnBreach', 'alertChannel', 'alertRateLimit'],
}
export function tabsFor(variant: SettingsVariant): SettingsTab[] { return variant === 'sport' ? ['stake','delays','odds','cashout','commission','exposure','risk'] : ['stake','delays','odds','exposure','risk'] }
/** The tab that holds a field, so a refused save can show the field it names. */
export function tabOfField(field: string): SettingsTab | undefined { return (Object.keys(tabFields) as SettingsTab[]).find(tab => tabFields[tab].includes(field)) }
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
