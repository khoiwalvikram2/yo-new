import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { toast } from '@/ui/components/toast'
import { useSportsEventsStore } from '@/state/sportsEventsStore'
import { MarketHeader } from './MarketHeader'
import { MarketTabs } from './MarketTabs'
import { RiskAlertBanner } from './RiskAlertBanner'
import { RiskAlertList } from './RiskAlertList'
import { RiskAlertSidebarIndicator } from './RiskAlertSidebarIndicator'
import { ProfitCalculator } from './ProfitCalculator'
import { PriceAlertModal } from './PriceAlertModal'
import { AnalyticsDrawer } from './AnalyticsDrawer'
import { useRiskAlerts } from './hooks/useRiskAlerts'
import type { RiskAlert } from './types/riskAlerts'

vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `$${value.toFixed(2)}`, convertFromWhitelabelCurrency: (value: number) => value * 2 }) }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDateTime: (value: string) => value, formatTime: () => '12:30:45' }) }))
vi.mock('@/shared/core/useFormatLocale', () => ({ useFormatLocale: () => 'en-US' }))
beforeEach(() => { toast.clear(); useSportsEventsStore.setState({ priceAlerts: [] }) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); toast.clear() })
const alert = (riskLevel: RiskAlert['riskLevel'], id: string = riskLevel): RiskAlert => ({ id, entityId: id, entityName: `Entity ${id}`, entityType: 'player', riskLevel, riskScore: 0, metrics: { liability: 125, exposure: 50, betCount: 3, odds: 2.5 }, timestamp: new Date('2026-10-10T07:00:00Z') })

describe('event detail kit surfaces', () => {
  test('market header remains a keyboard-native expansion control and preserves exposure/conversion signs', () => {
    const toggle = vi.fn()
    const { rerender } = render(<MarketHeader market={{ name: 'Match Odds', kind: 'exchange', state: 'active' }} isExpanded={false} onToggle={toggle} betCount={5} liquidity={25} exposure={150} />)
    assert.ok(screen.getByRole('heading', { name: 'Match Odds' }))
    const control = screen.getByRole('button')
    assert.equal(control.getAttribute('aria-label'), 'Unfold Match Odds')
    assert.equal(control.getAttribute('aria-expanded'), 'false')
    assert.ok(screen.getByText('−$300.00'))
    assert.ok(screen.getByText('$50.00'))
    fireEvent.click(control); assert.equal(toggle.mock.calls.length, 1)
    rerender(<MarketHeader market={{ name: 'Match Odds', state: 'suspended' }} isExpanded onToggle={toggle} exposure={-150} />)
    assert.equal(screen.getByRole('button', { name: 'Fold Match Odds' }).getAttribute('aria-expanded'), 'true')
    assert.ok(screen.getByText('+$300.00'))
    assert.ok(screen.getByText('SUSPENDED'))
  })
  test('market filters derive from kind/type and react when a same-id market changes category', () => {
    const change = vi.fn()
    const { rerender } = render(<MarketTabs markets={[{ id: 'm1', kind: 'exchange' }, { id: 'm2', type: 'fancy' }]} activeTab="exchange" onTabChange={change} />)
    assert.equal(screen.getByRole('tab', { name: 'Match odds, 1' }).getAttribute('aria-selected'), 'true')
    assert.ok(screen.getByRole('tab', { name: 'All, 2' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Fancy, 1' })); assert.equal(change.mock.calls[0][0], 'fancy')
    rerender(<MarketTabs markets={[{ id: 'm1', kind: 'bookmaker' }, { id: 'm2', type: 'fancy' }]} activeTab="exchange" onTabChange={change} />)
    assert.ok(screen.getByRole('tab', { name: 'Bookmaker, 1' }))
    assert.equal(Boolean(screen.queryByRole('tab', { name: /Match odds/ })), false)
    assert.equal(change.mock.calls[1][0], 'all')
  })
  test('risk banner preserves mixed counts, view and local dismissal behavior', () => {
    const view = vi.fn(); const dismiss = vi.fn()
    render(<RiskAlertBanner alerts={[alert('HIGH'), alert('MEDIUM')]} onViewAll={view} onDismiss={dismiss} />)
    assert.ok(screen.getByText('1 HIGH risk and 1 MEDIUM risk alerts active'))
    fireEvent.click(screen.getByRole('button', { name: 'View All' })); assert.equal(view.mock.calls.length, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss risk alerts banner' }))
    assert.equal(dismiss.mock.calls.length, 1)
    assert.equal(Boolean(screen.queryByText('1 HIGH risk and 1 MEDIUM risk alerts active')), false)
  })
  test('risk indicator preserves actual count in accessible name even when its visual count is capped', () => {
    const click = vi.fn()
    const { rerender } = render(<RiskAlertSidebarIndicator alerts={Array.from({ length: 100 }, (_, index) => alert('HIGH', String(index)))} onClick={click} />)
    assert.ok(screen.getByText('99+'))
    fireEvent.click(screen.getByRole('button', { name: '100 HIGH risk alerts' }))
    assert.equal(click.mock.calls.length, 1)
    rerender(<RiskAlertSidebarIndicator alerts={[]} />)
    assert.equal(screen.queryAllByRole('button').length, 0)
  })
  test('risk drawer preserves raw metrics and formatted time rather than applying an extra currency conversion', () => {
    render(<RiskAlertList open onClose={() => {}} alerts={[alert('HIGH')]} />)
    assert.ok(screen.getByRole('dialog', { name: 'Risk Alerts' }))
    assert.ok(screen.getByText('$125.00'))
    assert.ok(screen.getByText('12:30:45'))
    assert.ok(screen.getByText('2.50'))
    assert.equal(Boolean(screen.queryByText('$250.00')), false)
  })
  test('calculator preserves back/lay outputs, quick stakes, optional zero commission and coherent reset', () => {
    render(<ProfitCalculator visible onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }))
    let results = screen.getByRole('region', { name: 'Calculation Results' })
    assert.ok(within(results).getByText('$98.00'))
    assert.ok(within(results).getByText('$198.00'))
    fireEvent.click(screen.getByRole('button', { name: 'Lay (Bet Against)' }))
    assert.equal(Boolean(screen.queryByRole('region', { name: 'Calculation Results' })), false)
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }))
    results = screen.getByRole('region', { name: 'Calculation Results' })
    assert.ok(within(results).getByText('Liability'))
    assert.ok(within(results).getByText('98.00%'))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    assert.equal(screen.getByRole('button', { name: 'Back (Bet For)' }).getAttribute('aria-pressed'), 'true')
    fireEvent.change(screen.getByLabelText('Quick Stakes'), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText('Commission (%)'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }))
    const quickResults = within(screen.getByRole('region', { name: 'Calculation Results' }))
    assert.equal(quickResults.getAllByText('$25.00').length, 2)
    assert.ok(quickResults.getByText('$50.00'))
  })
  test('price alert form scopes persisted local alerts, preserves target/condition and removal', () => {
    useSportsEventsStore.setState({ priceAlerts: [{ id: 'other', marketId: 'other', marketName: 'Other market', targetPrice: 2, condition: 'above', createdAt: '2026-10-09' }] })
    render(<PriceAlertModal visible marketId="market-1" marketName="Match Odds" onClose={() => {}} />)
    assert.equal(Boolean(screen.queryByText('Other market')), false)
    fireEvent.change(screen.getByLabelText(/Target Price/), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Below Target' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Alert' }))
    const created = useSportsEventsStore.getState().priceAlerts.find(item => item.marketId === 'market-1')!
    assert.equal(created.targetPrice, 2.5)
    assert.equal(created.condition, 'below')
    assert.equal(created.marketName, 'Match Odds')
    assert.ok(screen.getByText('Target: 2.5'))
    assert.equal(screen.getByRole('button', { name: 'Above Target' }).getAttribute('aria-pressed'), 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    assert.deepEqual(useSportsEventsStore.getState().priceAlerts.map(item => item.id), ['other'])
  })
  test('sample analytics stays explicitly illustrative, keeps its data and does not pretend trends exist', () => {
    render(<AnalyticsDrawer visible onClose={() => {}} eventData={{ id: 'event-1' }} />)
    assert.ok(screen.getByText('Illustrative preview only'))
    assert.ok(screen.getByText('$120,000'))
    assert.equal(within(screen.getByRole('table', { name: 'Sample volume over time' })).getAllByRole('row').length, 6)
    fireEvent.click(screen.getByRole('tab', { name: 'Distribution' }))
    assert.ok(screen.getByText('45%'))
    assert.ok(screen.getByText('$110k'))
    fireEvent.click(screen.getByRole('tab', { name: 'Trends' }))
    assert.ok(screen.getByText('Trend analysis coming soon'))
  })
  test('risk hook keeps trigger levels, absolute exposure, numeric metrics and five-second notifications', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T07:00:00Z'))
    const players = [{ id: 'p1', name: 'Player One', type: 'player' as const, risk: { color: 'ignored', text: 'HIGH' as const }, metrics: { betCount: 4, totalLiability: 125, netExposure: -50, avgOdds: 2.5 } }]
    const config = { enabled: true, triggerLevels: ['HIGH'], notificationEnabled: true, bannerEnabled: true, sidebarIndicatorEnabled: true, cooldownSeconds: 60 }
    const { result, rerender } = renderHook(({ entities }) => useRiskAlerts(entities, [], config), { initialProps: { entities: players } })
    assert.deepEqual(result.current.alertCounts, { high: 1, medium: 0, low: 0, minimal: 0, total: 1 })
    assert.equal(result.current.activeAlerts[0].metrics.exposure, 50)
    assert.equal(toast.peek()[0].duration, 5000)
    assert.ok(toast.peek()[0].message.includes('Liability: 125.00, Exposure: 50.00, Bets: 4'))
    act(() => { rerender({ entities: [...players] }) })
    assert.equal(result.current.activeAlerts.length, 0)
    assert.equal(toast.peek().length, 1)
  })
})
