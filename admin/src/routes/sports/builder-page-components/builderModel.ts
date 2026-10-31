import type { BuilderAuditRow, Event, League, Sport } from './types'

export function builderEventPayload(selectedSports: Sport[], leagues: League[], events: Event[], sportIdByKey: Record<string, string>) {
  return events.filter(event => event.selected && selectedSports.some(sport => sport.key === event.sportKey) && leagues.some(league => league.key === event.leagueKey && league.selected)).map(event => {
    const league = leagues.find(item => item.key === event.leagueKey)!
    return { sportId: sportIdByKey[event.sportKey], sportCode: '', leagueCode: league.id, leagueName: league.name, eventCode: event.id, eventName: event.name, startTime: event.startTime ?? null }
  })
}
export const builderAutoActions = new Set(['upsertAutoSportsConfig', 'createAutoSportsConfig', 'deleteAutoSportsConfig', 'runAutoSportsIngestion', 'deleteAutoRuns'])
export function builderRequireSuccess(result: unknown, field: string) {
  const data = typeof result === 'object' && result !== null && 'data' in result ? result.data : null
  const response = typeof data === 'object' && data !== null && field in data ? (data as Record<string, unknown>)[field] : null
  if (typeof response !== 'object' || response === null || !('success' in response) || response.success !== true) {
    const message = typeof response === 'object' && response !== null && 'message' in response && typeof response.message === 'string' ? response.message : 'The server did not confirm this action'
    throw new Error(message)
  }
}
export const builderMutationActions = new Set(['persistSportsSelections', ...builderAutoActions, 'seedSportsFromProvider'])
export const builderActionLabels: Record<string, string> = { persistSportsSelections: 'Added selections', upsertAutoSportsConfig: 'Updated auto config', createAutoSportsConfig: 'Created auto config', deleteAutoSportsConfig: 'Deleted auto config', runAutoSportsIngestion: 'Ran auto ingestion', deleteAutoRuns: 'Cleared run history', seedSportsFromProvider: 'Seeded sports from provider' }
export function builderAuditChange(row: BuilderAuditRow): string {
  const data = row.after ?? {}
  const count = (key: string) => String(data[key] ?? 0)
  const skippedMarkets = Number(data.skippedMarketsCount ?? 0)
  const suffix = skippedMarkets > 0 ? ` · markets skipped (not in allowlist) ${skippedMarkets}` : ''
  if (row.action === 'persistSportsSelections') return `${count('leaguesUpserted')} leagues · ${count('eventsUpserted')} events · ${count('marketsUpserted')} markets · ${count('runnersUpserted')} runners · skipped events ${count('skippedEventsCount')}${suffix}`
  if (row.action === 'upsertAutoSportsConfig' || row.action === 'createAutoSportsConfig') return [typeof data.frequencyHours === 'number' ? `every ${data.frequencyHours}h` : null, `${Array.isArray(data.leagueCodes) ? data.leagueCodes.length : 0} leagues`, typeof data.active === 'boolean' ? data.active ? 'active' : 'inactive' : null].filter(Boolean).join(' · ')
  if (row.action === 'runAutoSportsIngestion') return `added ${count('eventsUpserted')} events (${count('leaguesUpserted')} leagues) · markets ${count('marketsUpserted')} · runners ${count('runnersUpserted')} · skipped events ${count('skippedEventsCount')}${suffix}`
  if (row.action === 'deleteAutoSportsConfig') return 'removed configuration'
  if (row.action === 'deleteAutoRuns') return 'cleared run history'
  if (row.action === 'seedSportsFromProvider') return `inserted ${count('inserted')} · updated ${count('updated')}`
  return '—'
}
