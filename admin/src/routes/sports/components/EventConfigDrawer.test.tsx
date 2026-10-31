import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DocumentNode } from 'graphql'
import { toast } from '@/ui/components/toast'
import { RiskConfigDrawer } from './RiskConfigDrawer'
import { AutomationConfigDrawer } from './AutomationConfigDrawer'
import { automationDraftError, automationDraftFrom, riskDraftError, riskDraftFrom } from './eventConfigModel'

const harness = vi.hoisted(() => ({
  risk: undefined as unknown, rules: [] as unknown[], loading: false, error: undefined as Error | undefined,
  calls: [] as { name: string; options: Record<string, unknown> }[],
  save: vi.fn(), refetch: vi.fn(),
}))
vi.mock('@apollo/client', async importOriginal => ({ ...await importOriginal<typeof import('@apollo/client')>(),
  useQuery: (document: DocumentNode, options: Record<string, unknown>) => {
    const definition = document.definitions.find(item => item.kind === 'OperationDefinition')
    const name = definition?.kind === 'OperationDefinition' ? definition.name?.value || '' : ''
    harness.calls.push({ name, options })
    return { data: name === 'EventRiskConfig' ? { eventRiskConfig: harness.risk } : { automationRules: harness.rules }, loading: harness.loading, error: harness.error, refetch: harness.refetch }
  },
  useMutation: () => [harness.save, { loading: false }],
}))
beforeEach(() => {
  harness.risk = undefined; harness.rules = []; harness.loading = false; harness.error = undefined; harness.calls = []
  harness.refetch.mockReset().mockResolvedValue({ data: {} })
  harness.save.mockReset().mockResolvedValue({ data: { upsertEventRiskConfig: { id: 'risk-1', eventId: 'event-1' }, upsertAutomationRule: { success: true } } })
  toast.clear()
})
afterEach(() => { cleanup(); toast.clear(); vi.restoreAllMocks() })
const loadedRisk = () => ({ id: 'risk-1', eventId: 'event-1',
  weights: { __typename: 'RiskWeights', liability: 40, exposure: 30, volume: 15, odds: 15 },
  percentiles: { __typename: 'RiskPercentiles', liability75: 0, odds90: 12 },
  amounts: { highLiability: 1000, mediumExposure: 0 },
  alerts: { enabled: true, triggerLevels: ['HIGH'], notificationEnabled: false, bannerEnabled: true, sidebarIndicatorEnabled: false, cooldownSeconds: 0 },
})
function change(label: RegExp | string, value: string) { fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } }) }
function apply() { fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' })) }
function tab(name: string) { fireEvent.click(screen.getByRole('tab', { name })) }

describe('event configuration contracts', () => {
  test('preserves numeric zero/defaults while stripping only transport fields from schema-typed risk sections', () => {
    const draft = riskDraftFrom(loadedRisk())
    assert.deepEqual(draft.weights, { liability: 40, exposure: 30, volume: 15, odds: 15 })
    assert.deepEqual(draft.percentiles, { liability75: 0, odds90: 12 })
    assert.equal(riskDraftError(draft), null)
    assert.equal(riskDraftError({ ...draft, weights: { ...draft.weights, liability: 39 } }), 'Risk weights must sum to 100.')
    assert.equal(automationDraftError({ ...automationDraftFrom(null), config: { cooldown: -1 } }), 'Thresholds and cooldown must be zero or greater, or left blank.')
  })
  test('risk save retains unvisited sections, raw values and the exact existing input keys', async () => {
    harness.risk = loadedRisk(); const close = vi.fn()
    render(<RiskConfigDrawer open onClose={close} eventId="event-1" />)
    change(/^Liability/, '45'); change(/^Exposure/, '25')
    tab('Thresholds'); change('High liability', '1250')
    tab('Alerts'); fireEvent.click(screen.getByRole('switch', { name: 'In-app notifications' }))
    apply()
    await waitFor(() => assert.equal(close.mock.calls.length, 1))
    assert.deepEqual(harness.save.mock.calls[0][0], { variables: { input: { eventId: 'event-1', weights: { liability: 45, exposure: 25, volume: 15, odds: 15 }, percentiles: { liability75: 0, odds90: 12 }, amounts: { highLiability: 1250, mediumExposure: 0 }, alerts: { enabled: true, triggerLevels: ['HIGH'], notificationEnabled: true, bannerEnabled: true, sidebarIndicatorEnabled: false, cooldownSeconds: 0 } } } })
    assert.equal(harness.refetch.mock.calls.length, 1)
    assert.ok(harness.calls.every(call => call.options.errorPolicy === 'all' && call.options.skip === false && (call.options.variables as { eventId: string }).eventId === 'event-1'))
  })
  test('invalid weights and enabled alerts with no levels cannot issue mutations', () => {
    harness.risk = loadedRisk(); render(<RiskConfigDrawer open onClose={() => {}} eventId="event-1" />)
    change(/^Liability/, '39'); apply()
    assert.equal(screen.getByRole('alert').textContent, 'Risk weights must sum to 100.')
    change(/^Liability/, '40'); tab('Alerts'); fireEvent.click(screen.getByRole('checkbox', { name: 'High' })); apply()
    assert.equal(screen.getByRole('alert').textContent, 'Select at least one risk level when alerts are enabled.')
    assert.equal(harness.save.mock.calls.length, 0)
  })
  test('risk rejected save retains the draft and never claims success/refetches/closes', async () => {
    harness.risk = loadedRisk(); harness.save.mockResolvedValue({ data: { upsertEventRiskConfig: null } }); const close = vi.fn()
    render(<RiskConfigDrawer open onClose={close} eventId="event-1" />)
    change(/^Liability/, '45'); change(/^Exposure/, '25'); apply()
    await waitFor(() => assert.match(screen.getByRole('alert').textContent || '', /did not confirm/))
    assert.equal((screen.getByRole('textbox', { name: /^Liability/ }) as HTMLInputElement).value, '45')
    assert.equal(close.mock.calls.length, 0); assert.equal(harness.refetch.mock.calls.length, 0); assert.equal(toast.peek().length, 0)
  })
  test('risk single-flight protects pending saves and loaded reset/cancel never persist', async () => {
    harness.risk = loadedRisk()
    let resolve!: (value: unknown) => void
    harness.save.mockReturnValue(new Promise(done => { resolve = done }))
    const close = vi.fn(); render(<RiskConfigDrawer open onClose={close} eventId="event-1" />)
    change(/^Liability/, '45'); fireEvent.click(screen.getByRole('button', { name: 'Reset edits' }))
    assert.equal((screen.getByRole('textbox', { name: /^Liability/ }) as HTMLInputElement).value, '40')
    await act(async () => { apply(); apply() })
    assert.equal(harness.save.mock.calls.length, 1)
    assert.equal((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled, true)
    await act(async () => resolve({ data: { upsertEventRiskConfig: { id: 'risk-1', eventId: 'event-1' } } }))
    assert.equal(close.mock.calls.length, 1)
  })
  test('loading/query errors cannot seed defaults or save; closed and missing-ID drawers do not send requests', () => {
    harness.loading = true
    const { rerender } = render(<RiskConfigDrawer open onClose={() => {}} eventId="event-1" />)
    assert.equal((screen.getByRole('button', { name: 'Apply Changes' }) as HTMLButtonElement).disabled, true)
    harness.loading = false; harness.error = new Error('Preview unavailable')
    rerender(<RiskConfigDrawer open onClose={() => {}} eventId="event-1" />)
    assert.match(screen.getByRole('alert').textContent || '', /Preview unavailable/)
    assert.equal(Boolean(screen.queryByRole('textbox')), false)
    rerender(<RiskConfigDrawer open={false} onClose={() => {}} eventId="event-1" />)
    assert.equal(Boolean(screen.queryByRole('dialog')), false)
    harness.error = undefined; rerender(<RiskConfigDrawer open onClose={() => {}} eventId="" />)
    assert.equal(harness.calls.at(-1)?.options.skip, true); assert.equal(harness.save.mock.calls.length, 0)
  })
  test('automation keeps first-rule type/status/priority, unknown JSON and edits across all three sections', async () => {
    const config = { advanced: { preserve: true }, triggers: { stakeThreshold: 0, riskLevel: 'HIGH', retainedTrigger: 19 }, cooldown: 0, actions: ['ORIGINAL'], notifications: { enabled: true, channels: ['notification'] }, enabledPatterns: ['CUSTOM'], actionsOnDetection: ['CUSTOM_ACTION'] }
    harness.rules = [{ eventId: 'event-1', ruleType: 'MARKET_MAKER', config, enabled: false, priority: 7 }, { ruleType: 'AUTO_VOID', config: { never: 'edit second rule' }, enabled: true }]
    render(<AutomationConfigDrawer open onClose={() => {}} eventId="event-1" />)
    change('Stake threshold', '250'); tab('Market Maker'); change('Minimum book balance', '1000'); fireEvent.click(screen.getByRole('switch', { name: 'Enable Market Maker' }))
    tab('Pattern Detection'); fireEvent.click(screen.getByRole('checkbox', { name: 'Odd Timing' })); fireEvent.click(screen.getByRole('checkbox', { name: 'Flag Player' })); apply()
    await waitFor(() => assert.equal(harness.refetch.mock.calls.length, 1))
    assert.deepEqual(harness.save.mock.calls[0][0], { variables: { input: { eventId: 'event-1', ruleType: 'MARKET_MAKER', enabled: false, priority: 7, config: { ...config, enabled: true, triggers: { ...config.triggers, stakeThreshold: 250, bookBalanceThreshold: 1000 }, enabledPatterns: ['CUSTOM', 'ODD_TIMING'], actionsOnDetection: ['CUSTOM_ACTION', 'FLAG'] } } } })
    assert.ok(screen.getByRole('dialog')); assert.equal(toast.peek().at(-1)?.tone, 'ok')
  })
  test('automation defaults retain disabled root rule and nested notifications without inventing delete actions', async () => {
    render(<AutomationConfigDrawer open onClose={() => {}} eventId="event-1" />)
    apply(); await waitFor(() => assert.equal(harness.refetch.mock.calls.length, 1))
    assert.deepEqual(harness.save.mock.calls[0][0], { variables: { input: { eventId: 'event-1', ruleType: 'AUTO_VOID', config: { triggers: {}, actions: [], cooldown: 60, notifications: { enabled: true, channels: ['notification'] } }, enabled: false, priority: 0 } } })
    assert.equal(Boolean(screen.queryByRole('button', { name: /Delete/ })), false)
  })
  test('automation rejection retains edits and scopes are reseeded when event changes', async () => {
    harness.save.mockResolvedValue({ data: { upsertAutomationRule: { success: false, message: 'Operator refused save' } } })
    const { rerender } = render(<AutomationConfigDrawer open onClose={() => {}} eventId="event-1" />)
    change('Stake threshold', '250'); apply()
    await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'Operator refused save'))
    assert.equal((screen.getByRole('textbox', { name: 'Stake threshold' }) as HTMLInputElement).value, '250'); assert.equal(harness.refetch.mock.calls.length, 0)
    harness.rules = [{ eventId: 'event-2', ruleType: 'AUTO_VOID', config: { triggers: { stakeThreshold: 0 } }, enabled: true, priority: 0 }]
    rerender(<AutomationConfigDrawer open onClose={() => {}} eventId="event-2" />)
    assert.equal((screen.getByRole('textbox', { name: 'Stake threshold' }) as HTMLInputElement).value, '0')
    assert.equal(Boolean(screen.queryByRole('alert')), false)
  })
  test('automation single-flight/negative guard and cancel prevent unintended mutations', async () => {
    let resolve!: (value: unknown) => void
    harness.save.mockReturnValue(new Promise(done => { resolve = done }))
    const close = vi.fn(); render(<AutomationConfigDrawer open onClose={close} eventId="event-1" />)
    change('Stake threshold', '-1'); apply(); assert.equal(harness.save.mock.calls.length, 0)
    change('Stake threshold', '0'); await act(async () => { apply(); apply() }); assert.equal(harness.save.mock.calls.length, 1)
    await act(async () => resolve({ data: { upsertAutomationRule: { success: true } } }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); assert.equal(close.mock.calls.length, 1)
    assert.equal(harness.save.mock.calls.length, 1)
  })
})
