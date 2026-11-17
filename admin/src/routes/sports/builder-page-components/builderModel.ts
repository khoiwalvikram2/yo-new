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
/** How many of each builder action's newest audit rows the Audits tab reads (ListSportsBuilderAudit), and how many
 *  more each "Load older changes" adds. */
export const BUILDER_AUDIT_LIMIT = 200
/**
 * Whether the history read is cut short (B003): an action answered as many rows as were asked for, so it may have
 * older ones. grandwinn had 213 of one kind, and the pager said "of 200 changes" with nothing to say more existed.
 */
export function builderAuditCut(answers: Record<string, readonly BuilderAuditRow[] | null | undefined> | null | undefined, limit: number): boolean {
  return Object.values(answers ?? {}).some(list => (list?.length ?? 0) >= limit)
}
/** The builder's history from the per-action audit answers: each builder row once, newest first. */
export function builderAuditRows(answers: Record<string, readonly BuilderAuditRow[] | null | undefined> | null | undefined): BuilderAuditRow[] {
  const byId = new Map<string, BuilderAuditRow>()
  for (const list of Object.values(answers ?? {})) for (const row of list ?? []) if (builderMutationActions.has(row.action)) byId.set(row.id, row)
  return [...byId.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
}
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
