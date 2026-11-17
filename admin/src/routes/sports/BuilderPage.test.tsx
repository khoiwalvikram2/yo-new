import assert from 'node:assert/strict'
import { beforeEach, test } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
import { builderFixtureResponse, builderFixtureState, type BuilderFixtureState } from '../../../test/sportsBuilderPreviewData'
import { builderMutationActions } from './builder-page-components/builderModel'
import type { BuilderAuditRow } from './builder-page-components/types'
import SportsBuilderPage from './BuilderPage'
// The first query of the page waits on the provider sports load; the first test in the file also pays
// the module warm-up, which took it past testing-library's 1 s default on a busy machine (a flaky failure).
const FIRST_RENDER = { timeout: 5000 }
let state: BuilderFixtureState
let calls: Array<{ name: string; variables: Record<string, unknown>; uiToast?: unknown }>
let hold: string | null
let release: (() => void) | undefined
/** Answers ListSportsBuilderAudit in place of the fixture when set (it gets the read's variables, so its limit). */
let auditAnswer: ((variables: Record<string, unknown>) => unknown) | null
// The Audits tab asks for each builder action by name (ListSportsBuilderAudit, one alias per action); it is
// answered from the fixture's audit rows, sorted to their actions, so a non-builder row never reaches it.
function builderAuditResponse(config: BuilderFixtureState) {
  const { data } = builderFixtureResponse({ operationName: 'ListSportsAudit', variables: {} }, config) as { data: { audit: BuilderAuditRow[] } }
  return { data: Object.fromEntries([...builderMutationActions].map(action => [action, data.audit.filter(row => row.action === action)])) }
}
function page() {
  const config = state; const operations = calls
  const link = new ApolloLink(operation => new Observable(observer => {
    operations.push({ name: operation.operationName, variables: structuredClone(operation.variables) as Record<string, unknown>, uiToast: operation.getContext().uiToast })
    const respond = () => { try { observer.next(operation.operationName === 'ListSportsBuilderAudit' ? auditAnswer?.(operation.variables) ?? builderAuditResponse(config) : builderFixtureResponse(operation, config)); observer.complete() } catch (error) { observer.error(error) } }
    if (hold === operation.operationName) release = respond
    else queueMicrotask(respond)
  }))
  return render(<MockedProvider cache={new InMemoryCache()} link={link}><MemoryRouter><SportsBuilderPage /></MemoryRouter></MockedProvider>)
}
beforeEach(() => {
  state = builderFixtureState(); calls = []; hold = null; release = undefined; auditAnswer = null
  useAuthStore.setState({ agent: undefined, user: undefined, permissions: [{ domain: 'sports.builder', actions: ['view'] }], roles: [], agentPermissions: [] })
})
async function manualEvents() {
  await screen.findByRole('checkbox', { name: 'Cricket' }, FIRST_RENDER)
  fireEvent.click(screen.getByRole('button', { name: 'Continue to Leagues' }))
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Indian Premier League' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue to Events' }))
  await screen.findByRole('checkbox', { name: 'Select event India v Australia' })
}
async function manualReview() {
  await manualEvents(); fireEvent.click(screen.getByRole('checkbox', { name: 'Select event India v Australia' }))
  fireEvent.click(screen.getByRole('button', { name: 'Review & Continue' }))
  await screen.findByRole('heading', { name: 'Review Selections' })
}
async function auto() {
  await screen.findByRole('checkbox', { name: 'Cricket' }, FIRST_RENDER); fireEvent.click(screen.getByRole('tab', { name: 'Auto' }))
  await screen.findByRole('table', { name: 'Saved auto configurations' })
}
test('view guard starts no query when denied and manual defaults keep Cricket selected', async () => {
  useAuthStore.setState({ permissions: [] }); const denied = page(); screen.getByText('Access denied'); assert.equal(calls.length, 0); denied.unmount()
  useAuthStore.setState({ permissions: [{ domain: 'sports.builder', actions: ['view'] }] }); page()
  const cricket = await screen.findByRole('checkbox', { name: 'Cricket' }, FIRST_RENDER) as HTMLInputElement
  assert.equal(cricket.checked, true); assert.equal((screen.getByRole('checkbox', { name: 'Football' }) as HTMLInputElement).checked, false)
  assert.equal((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled, true)
  fireEvent.click(screen.getByRole('button', { name: 'Clear All' })); assert.equal((screen.getByRole('button', { name: 'Continue to Leagues' }) as HTMLButtonElement).disabled, true)
  fireEvent.click(screen.getByRole('button', { name: 'Select All' })); assert.equal(cricket.checked, true); assert.equal((screen.getByRole('checkbox', { name: 'Football' }) as HTMLInputElement).checked, true)
})
test('manual provider/existing scopes and bulk selection survive back/collapse without premature persistence', async () => {
  page(); await manualEvents()
  assert.ok(calls.some(call => call.name === 'ProviderLeagues' && JSON.stringify(call.variables) === JSON.stringify({ sportCode: '4' })))
  assert.ok(calls.some(call => call.name === 'ExistingLeagues' && JSON.stringify(call.variables) === JSON.stringify({ sportId: 'sport-cricket' })))
  assert.ok(calls.some(call => call.name === 'ProviderEvents' && JSON.stringify(call.variables) === JSON.stringify({ leagueId: 'provider-ipl' })))
  assert.ok(calls.some(call => call.name === 'ExistingEvents' && JSON.stringify(call.variables) === JSON.stringify({ leagueCode: 'provider-ipl' })))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Toggle all events for Indian Premier League' })); assert.equal((screen.getByRole('checkbox', { name: 'Select event England v New Zealand' }) as HTMLInputElement).checked, true)
  fireEvent.click(screen.getByRole('button', { name: 'Collapse all' })); assert.equal(Boolean(screen.queryByRole('checkbox', { name: 'Select event India v Australia' })), false)
  fireEvent.click(screen.getByRole('button', { name: 'Expand all' })); assert.equal((screen.getByRole('checkbox', { name: 'Select event India v Australia' }) as HTMLInputElement).checked, true)
  fireEvent.click(screen.getByRole('button', { name: 'Back' })); assert.equal((screen.getByRole('checkbox', { name: 'Indian Premier League' }) as HTMLInputElement).checked, true)
  assert.equal(calls.some(call => call.name === 'PersistSelections'), false)
})
test('manual addition is explicitly confirmed, single-flight and retains selections on false server success', async () => {
  state.refuse = 'PersistSelections'; page(); await manualReview(); assert.equal(calls.some(call => call.name === 'PersistSelections'), false)
  fireEvent.click(screen.getByRole('button', { name: 'Add to Platform' })); const confirm = await screen.findByRole('alertdialog', { name: 'Confirm Addition' })
  fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' })); assert.equal(calls.some(call => call.name === 'PersistSelections'), false)
  fireEvent.click(screen.getByRole('button', { name: 'Add to Platform' })); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm & Add' })) }); await screen.findByText('Preview action refused')
  assert.ok(screen.getByRole('alertdialog', { name: 'Confirm Addition' }))
  state.refuse = undefined; hold = 'PersistSelections'; await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm & Add' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm & Add' })) })
  assert.equal(calls.filter(call => call.name === 'PersistSelections').length, 2)
  assert.ok(release); await act(async () => { release?.() }); await waitFor(() => assert.equal(Boolean(screen.queryByRole('alertdialog', { name: 'Confirm Addition' })), false))
  assert.deepEqual(calls.find(call => call.name === 'PersistSelections')?.variables, { events: [{ sportId: 'sport-cricket', sportCode: '', leagueCode: 'provider-ipl', leagueName: 'Indian Premier League', eventCode: 'provider-ipl-event-1', eventName: 'India v Australia', startTime: '2026-10-10T14:30:00Z' }] })
  assert.equal((screen.getByRole('checkbox', { name: 'Cricket' }) as HTMLInputElement).checked, true); screen.getByRole('button', { name: 'Continue to Leagues' })
})
test('provider errors render an explicit retry without losing selected sport', async () => {
  state.fail = 'ProviderLeagues'; page(); await screen.findByRole('checkbox', { name: 'Cricket' }, FIRST_RENDER); fireEvent.click(screen.getByRole('button', { name: 'Continue to Leagues' })); await screen.findByText('Preview ProviderLeagues unavailable')
  state.fail = undefined; fireEvent.click(screen.getByRole('button', { name: 'Retry provider data' })); await screen.findByRole('checkbox', { name: 'Indian Premier League' }); assert.ok(calls.filter(call => call.name === 'ProviderLeagues').length >= 2)
})
test('auto editor preserves saved frequency/leagues and sends unchanged Save/Run inputs; refusal keeps edits', async () => {
  page(); await auto(); const configure = screen.getByRole('region', { name: 'Configure Auto Ingestion' }); fireEvent.click(within(configure).getByRole('checkbox', { name: 'Cricket' }))
  const frequency = await screen.findByRole('combobox', { name: 'Frequency for Cricket' }) as HTMLSelectElement; await waitFor(() => assert.equal(frequency.value, '3'))
  fireEvent.change(frequency, { target: { value: '2' } }); fireEvent.click(screen.getByRole('switch', { name: 'Active auto ingestion for Cricket' }))
  state.refuse = 'UpsertAutoConfig'; await act(async () => { fireEvent.click(within(configure).getByRole('button', { name: 'Save' })) }); await screen.findByText('Preview action refused'); assert.equal(frequency.value, '2')
  state.refuse = undefined; await act(async () => { fireEvent.click(within(configure).getByRole('button', { name: 'Save' })) }); await waitFor(() => assert.equal(state.configs[0].frequencyHours, 2))
  assert.deepEqual(calls.find(call => call.name === 'UpsertAutoConfig')?.variables, { sportId: 'sport-cricket', leagueCodes: ['platform-ipl'], frequencyHours: 2, active: false })
  await waitFor(() => assert.equal((within(configure).getByRole('button', { name: 'Run Now' }) as HTMLButtonElement).disabled, false)); await act(async () => { fireEvent.click(within(configure).getByRole('button', { name: 'Run Now' })) })
  assert.deepEqual(calls.find(call => call.name === 'RunAutoNow')?.variables, { sportId: 'sport-cricket', leagueCodes: ['platform-ipl'] })
})
test('saved status toggle retains all configuration fields and its uiToast context', async () => {
  page(); await auto(); await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Active configuration for Cricket' })) }); await waitFor(() => assert.equal(state.configs[0].active, false))
  const call = calls.find(item => item.name === 'UpsertAutoConfig')!; assert.deepEqual(call.variables, { sportId: 'sport-cricket', leagueCodes: ['platform-ipl'], frequencyHours: 3, active: false }); assert.equal(call.uiToast, 'message')
})
test('saved per-sport Run and Run All include inactive configurations exactly as before', async () => {
  page(); await auto(); const table = screen.getByRole('table', { name: 'Saved auto configurations' }); const row = within(table).getAllByRole('row')[1]
  await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Run' })) }); await waitFor(() => assert.equal((screen.getByRole('button', { name: 'Run All Now' }) as HTMLButtonElement).disabled, false))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run All Now' })) }); await waitFor(() => assert.equal(calls.filter(call => call.name === 'RunAutoNow').length, 3))
  assert.deepEqual(calls.filter(call => call.name === 'RunAutoNow').map(call => call.variables), [{ sportId: 'sport-cricket', leagueCodes: ['platform-ipl'] }, { sportId: 'sport-cricket', leagueCodes: ['platform-ipl'] }, { sportId: 'sport-football', leagueCodes: [] }])
})
test('history uses server pages of 10, and requires explicit clear confirmation with refusal/retry', async () => {
  page(); await auto(); fireEvent.click(within(screen.getByRole('table', { name: 'Saved auto configurations' })).getAllByRole('button', { name: 'History' })[0])
  const drawer = await screen.findByRole('dialog', { name: 'Run History · Cricket' }); const table = await within(drawer).findByRole('table', { name: 'Auto run history' })
  assert.equal(within(table).getAllByRole('row').length, 11); assert.deepEqual(calls.find(call => call.name === 'ListAutoRuns')?.variables, { sportId: 'sport-cricket', limit: 10, offset: 0 })
  fireEvent.click(within(drawer).getByRole('button', { name: 'Next page' })); await waitFor(() => assert.equal(within(table).getAllByRole('row').length, 3)); assert.ok(calls.some(call => call.name === 'ListAutoRuns' && call.variables.offset === 10))
  fireEvent.click(within(drawer).getByRole('button', { name: 'Delete History' })); const confirm = await screen.findByRole('alertdialog', { name: 'Clear Run History?' }); assert.equal(Boolean(screen.queryByRole('dialog', { name: 'Run History · Cricket' })), false)
  fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' })); assert.equal(calls.some(call => call.name === 'DeleteAutoRuns'), false)
  assert.equal(within(await screen.findByRole('table', { name: 'Auto run history' })).getAllByRole('row').length, 3)
  fireEvent.click(screen.getByRole('button', { name: 'Delete History' })); state.refuse = 'DeleteAutoRuns'; await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })) }); await screen.findByText('Preview action refused'); assert.equal(state.clearedHistory, undefined)
  state.refuse = undefined; await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })) }); await waitFor(() => assert.equal(state.clearedHistory, true)); await screen.findByRole('dialog', { name: 'Run History · Cricket' })
  assert.deepEqual(calls.find(call => call.name === 'DeleteAutoRuns')?.variables, { sportId: 'sport-cricket' })
})
test('delete configuration stays open on refusal and successful explicit retry removes only selected sport', async () => {
  page(); await auto(); fireEvent.click(screen.getByRole('button', { name: 'Delete configuration for Cricket' })); const confirm = await screen.findByRole('alertdialog', { name: 'Delete Configuration?' }); assert.equal(calls.some(call => call.name === 'DeleteAutoConfig'), false)
  state.refuse = 'DeleteAutoConfig'; await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' })) }); await screen.findByText('Preview action refused'); assert.equal(state.configs.length, 2)
  state.refuse = undefined; await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' })) }); await waitFor(() => assert.equal(Boolean(screen.queryByRole('alertdialog', { name: 'Delete Configuration?' })), false))
  assert.deepEqual(calls.find(call => call.name === 'DeleteAutoConfig')?.variables, { sportId: 'sport-cricket' }); assert.deepEqual(state.configs.map(config => config.sportId), ['sport-football'])
})
test('audit asks for each builder action by name, with fifteen-row paging and client-only manual/auto filters', async () => {
  page(); await screen.findByRole('checkbox', { name: 'Cricket' }, FIRST_RENDER); fireEvent.click(screen.getByRole('tab', { name: 'Audits' })); const table = await screen.findByRole('table', { name: 'Builder audits' })
  // Not every action of the tenant (action: null), which a hundred logins crowded the builder rows out of.
  assert.deepEqual(calls.find(call => call.name === 'ListSportsBuilderAudit')?.variables, { limit: 200 }); assert.equal(calls.some(call => call.name === 'ListSportsAudit'), false)
  assert.equal(within(table).getAllByRole('row').length, 16)
  fireEvent.click(screen.getByRole('button', { name: 'Next page' })); assert.equal(within(table).getAllByRole('row').length, 2)
  const filters = screen.getByRole('group', { name: 'Audit source' }); fireEvent.click(within(filters).getByRole('button', { name: 'Manual' })); assert.equal(within(table).getAllByRole('row').length, 9)
  assert.equal(Boolean(within(table).queryByText('Updated auto config')), false); assert.ok(within(table).getAllByText('Added selections').length > 0)
  fireEvent.click(within(filters).getByRole('button', { name: 'Auto' })); assert.equal(within(table).getAllByRole('row').length, 9); assert.equal(calls.filter(call => call.name === 'ListSportsBuilderAudit').length, 1)
  assert.equal(screen.queryByRole('button', { name: 'Load older changes' }), null, 'a history that fits one read offers nothing older')
})
/* B003: grandwinn's Builder had 213 changes of one kind. The tab read the newest 200 of each and the pager said
   "of 200 changes", with nothing to say the 13 oldest were left out. */
test('a history longer than one read says so, and Load older changes brings the rest', async () => {
  const persisted = Array.from({ length: 213 }, (_, index) => ({ __typename: 'AuditEvent', id: `persist-${index}`, actorId: 'admin-1', domain: 'sports', action: 'persistSportsSelections', resourceType: 'selection', resourceId: `selection-${index}`, before: null,
    after: { leaguesUpserted: 1, eventsUpserted: 1, marketsUpserted: 1, runnersUpserted: 1, skippedEventsCount: 0 }, timestamp: new Date(Date.UTC(2026, 9, 30, 12, 5) - index * 60_000).toISOString(),
    actor: { __typename: 'AuditActor', name: 'Preview operator', type: 'admin' } }))
  auditAnswer = variables => ({ data: Object.fromEntries([...builderMutationActions].map(action => [action, action === 'persistSportsSelections' ? persisted.slice(0, Number(variables.limit)) : []])) })
  page(); await screen.findByRole('checkbox', { name: 'Cricket' }, FIRST_RENDER); fireEvent.click(screen.getByRole('tab', { name: 'Audits' }))
  await screen.findByRole('table', { name: 'Builder audits' })
  await screen.findByText('The newest 200 changes of each kind are shown; older ones are not loaded')
  assert.ok(document.body.textContent?.includes('of 200 changes'))
  fireEvent.click(screen.getByRole('button', { name: 'Load older changes' }))
  await waitFor(() => assert.ok(document.body.textContent?.includes('of 213 changes'), 'the older changes were not loaded'))
  assert.deepEqual(calls.filter(call => call.name === 'ListSportsBuilderAudit').map(call => call.variables), [{ limit: 200 }, { limit: 400 }])
  assert.equal(screen.queryByRole('button', { name: 'Load older changes' }), null, 'nothing older is left to load')
  assert.ok(screen.getByText('Latest activity across Manual and Auto'))
})
