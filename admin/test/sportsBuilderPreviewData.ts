import type { Operation } from '@apollo/client'
import type { AutoConfigRow, BuilderAuditRow } from '../src/routes/sports/builder-page-components/types'
export interface BuilderFixtureState { configs: AutoConfigRow[]; refuse?: string; fail?: string; clearedHistory?: boolean }
export function builderFixtureState(): BuilderFixtureState {
  return { configs: [
    { id: 'config-cricket', sportId: 'sport-cricket', leagueCodes: ['platform-ipl'], frequencyHours: 3, active: true, lastRunStatus: 'success', lastRunAt: '2026-10-09T08:00:00Z', nextRunAt: '2026-10-10T08:00:00Z' },
    { id: 'config-football', sportId: 'sport-football', leagueCodes: [], frequencyHours: 6, active: false, lastRunStatus: 'failure', lastRunAt: null, nextRunAt: null },
  ] }
}
const sports = [
  { __typename: 'Sport', id: 'sport-cricket', key: 'cricket', name: 'Cricket', sort: 1, sportCode: '4', status: 'ACTIVE', updatedAt: '2026-10-09T08:00:00Z' },
  { __typename: 'Sport', id: 'sport-football', key: 'football', name: 'Football', sort: 2, sportCode: '1', status: 'ACTIVE', updatedAt: '2026-10-09T08:00:00Z' },
]
const result = { success: true, message: 'Preview action completed', leaguesUpserted: 1, eventsUpserted: 1, marketsUpserted: 3, runnersUpserted: 6, skippedEventsCount: 0, skippedMarketsCount: 0, skippedEvents: [] }
export function builderFixtureResponse(operation: Pick<Operation, 'operationName' | 'variables'>, state: BuilderFixtureState) {
  const name = operation.operationName
  if (state.fail === name) throw new Error(`Preview ${name} unavailable`)
  const success = state.refuse === name ? { ...result, success: false, message: 'Preview action refused' } : result
  switch (name) {
    case 'ListSports': return { data: { sports } }
    case 'ProviderLeagues': return { data: { providerLeagues: operation.variables.sportCode === '4' ? [{ __typename: 'ProviderLeague', id: 'provider-ipl', name: 'Indian Premier League' }, { __typename: 'ProviderLeague', id: 'provider-bbl', name: 'Big Bash League' }] : [{ __typename: 'ProviderLeague', id: 'provider-epl', name: 'Premier League' }] } }
    case 'ExistingLeagues': return { data: { existingLeagueCodes: ['provider-ipl'] } }
    case 'ProviderEvents': return { data: { providerEvents: [{ __typename: 'ProviderEvent', id: `${operation.variables.leagueId}-event-1`, name: 'India v Australia', startTime: '2026-10-10T14:30:00Z' }, { __typename: 'ProviderEvent', id: `${operation.variables.leagueId}-event-2`, name: 'England v New Zealand', startTime: '2026-10-10T16:00:00Z' }] } }
    case 'ExistingEvents': return { data: { existingEventCodes: [`${operation.variables.leagueCode}-event-1`] } }
    case 'ListLeagues': return { data: { leagues: [{ __typename: 'League', id: 'platform-ipl', name: 'Indian Premier League', sportId: operation.variables.sportId, status: 'ACTIVE', updatedAt: '2026-10-09T08:00:00Z' }, { __typename: 'League', id: 'platform-bbl', name: 'Big Bash League', sportId: operation.variables.sportId, status: 'ACTIVE', updatedAt: '2026-10-09T08:00:00Z' }] } }
    case 'ListAutoConfigs': return { data: { autoSportsConfigs: state.configs.map(config => ({ __typename: 'AutoSportsConfig', ...config, updatedAt: '2026-10-09T08:00:00Z' })) } }
    case 'ListAutoFrequencies': return { data: { availableAutoFrequencies: [1, 2, 3, 6, 12, 24] } }
    case 'PersistSelections': return { data: { persistSportsSelections: { __typename: 'PersistSportsSelectionsResult', ...success } } }
    case 'UpsertAutoConfig': {
      if (success.success) { const index = state.configs.findIndex(config => config.sportId === operation.variables.sportId); const row = { id: index >= 0 ? state.configs[index].id : `config-${operation.variables.sportId}`, ...(operation.variables as Omit<AutoConfigRow, 'id'>) }; if (index >= 0) state.configs[index] = { ...state.configs[index], ...row }; else state.configs.push(row) }
      return { data: { upsertAutoSportsConfig: { __typename: 'MutationResult', success: success.success, message: success.message } } }
    }
    case 'RunAutoNow': return { data: { runAutoSportsIngestion: { __typename: 'RunAutoSportsIngestionResult', ...success } } }
    case 'DeleteAutoConfig': { if (success.success) state.configs = state.configs.filter(config => config.sportId !== operation.variables.sportId); return { data: { deleteAutoSportsConfig: { __typename: 'MutationResult', success: success.success, message: success.message } } } }
    case 'DeleteAutoRuns': { if (success.success) state.clearedHistory = true; return { data: { deleteAutoRuns: { __typename: 'MutationResult', success: success.success, message: success.message } } } }
    case 'ListAutoRuns': return { data: { autoRunsPage: { total: state.clearedHistory ? 0 : 12, items: state.clearedHistory ? [] : Array.from({ length: 12 }, (_, index) => ({ __typename: 'AutoRun', id: `run-${index}`, sportId: operation.variables.sportId, startedAt: '2026-10-09T08:00:00Z', finishedAt: '2026-10-09T08:10:00Z', status: index ? 'success' : 'failure', leaguesAdded: 1, eventsAdded: 3, marketsAdded: 6, runnersAdded: 12, skippedEventsCount: index ? 0 : 1, skippedEvents: [], errorMessage: index ? null : 'Preview provider failure' })).slice(operation.variables.offset ?? 0, (operation.variables.offset ?? 0) + (operation.variables.limit ?? 10)) } } }
    case 'ListSportsAudit': {
      const audit: BuilderAuditRow[] = Array.from({ length: 24 }, (_, index) => ({ id: `audit-${index}`, actorId: 'admin-1', domain: 'sports', action: index % 3 === 0 ? 'listSports' : index % 3 === 1 ? 'persistSportsSelections' : 'upsertAutoSportsConfig', resourceType: index % 3 === 2 ? 'autoConfig' : 'selection', resourceId: index % 3 === 2 ? 'sport-cricket' : `selection-${index}`, before: null, after: index % 3 === 2 ? { frequencyHours: 3, leagueCodes: ['platform-ipl'], active: true } : { leaguesUpserted: 1, eventsUpserted: 3, marketsUpserted: 6, runnersUpserted: 12, skippedEventsCount: 0, skippedMarketsCount: 1 }, timestamp: '2026-10-09T08:00:00Z' }))
      return { data: { audit: audit.map(row => ({ __typename: 'AuditEvent', ...row, actor: { __typename: 'AuditActor', name: 'Preview operator', type: 'admin' } })) } }
    }
    default: throw new Error(`Unhandled Builder fixture operation: ${name}`)
  }
}
