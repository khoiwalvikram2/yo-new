import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
import type { GlobalSearchResult } from '@/lib/graphql/globalSearch'
import { GlobalSearch } from './GlobalSearch'

const harness = vi.hoisted(() => ({ data: undefined as GlobalSearchResult | undefined, loading: false, error: undefined as Error | undefined, search: vi.fn(), matchPages: vi.fn() }))
vi.mock('@apollo/client', async original => ({ ...await original<typeof import('@apollo/client')>(), useLazyQuery: () => [harness.search, { data: harness.data, loading: harness.loading, error: harness.error }] }))
vi.mock('@/shell/usePageMatcher', () => ({ usePageMatcher: () => harness.matchPages }))
const emptyEntities = () => ({ players: [], agents: [], whitelabels: [], casinoGames: [], sports: [], vipMembers: [], matkas: [], referralCodes: [], bets: [], bonuses: [] })
function fixtures(): GlobalSearchResult {
  return { globalSearch: { ...emptyEntities(), players: [{ id: 'u1', type: 'player', label: 'Player One', subtitle: 'one@example.test', route: '/players/u1', status: 'ACTIVE', metadata: { status: 'ACTIVE' }, parentChain: [{ id: 'a1', username: 'Parent Agent', levelIndex: 1, route: '/agents/a1' }] }], agents: [{ id: 'a1', type: 'agent', label: 'Agent One', subtitle: null, route: '/agents/a1', status: null, metadata: null, parentChain: null }] } }
}
beforeEach(() => {
  localStorage.removeItem('gd-global-search-recent')
  harness.data = fixtures(); harness.loading = false; harness.error = undefined
  harness.search.mockReset().mockResolvedValue({ data: harness.data })
  harness.matchPages.mockReset().mockImplementation((query: string) => query.trim().length >= 2 ? [{ type: 'page', id: 'players-page', label: 'Players list', subtitle: 'Players', route: '/players', icon: 'fa-file-lines' }] : [])
  useAuthStore.setState({ user: undefined, agent: undefined, roles: ['Super Admin'], permissions: [{ domain: 'all', actions: ['*'] }] })
})
afterEach(() => { vi.useRealTimers(); document.body.style.overflow = ''; document.documentElement.removeAttribute('data-theme'); vi.restoreAllMocks() })
function Host({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen); const location = useLocation()
  return <><button type="button" onClick={() => setOpen(true)}>Open global search</button><output aria-label="Current path">{location.pathname + location.search}</output><GlobalSearch isOpen={open} onClose={() => setOpen(false)} /></>
}
function mount(initiallyOpen = true) { return render(<MemoryRouter initialEntries={['/dashboard']}><Host initiallyOpen={initiallyOpen} /></MemoryRouter>) }
function query(value: string) { fireEvent.change(screen.getByLabelText('Search anything'), { target: { value } }) }

describe('global search kit migration', () => {
  test('inherits the active dark theme and closes from the input without clearing saved history', async () => {
    document.documentElement.dataset.theme = 'dark'; localStorage.setItem('gd-global-search-recent', JSON.stringify(['saved search']))
    mount()
    assert.equal(Boolean(screen.getByRole('dialog').closest('[data-theme="light"]')), false)
    await waitFor(() => assert.equal(document.activeElement === screen.getByLabelText('Search anything'), true))
    fireEvent.keyDown(screen.getByLabelText('Search anything'), { key: 'Escape' })
    assert.equal(Boolean(screen.queryByRole('dialog')), false)
    assert.equal(localStorage.getItem('gd-global-search-recent'), '["saved search"]')
  })
  test('preserves Pages-first flat selection, combobox references and Enter navigation/history', () => {
    mount(); query('pl')
    const input = screen.getByRole('combobox', { name: 'Search anything' })
    const options = screen.getAllByRole('option')
    assert.equal(options.length, 3); assert.equal(options[0].textContent?.includes('Players list'), true)
    assert.equal(input.getAttribute('aria-activedescendant'), options[0].id)
    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    assert.equal(input.getAttribute('aria-activedescendant'), options[1].id)
    fireEvent.keyDown(input, { key: 'Enter' })
    assert.equal(screen.getByLabelText('Current path').textContent, '/players/u1')
    assert.equal(Boolean(screen.queryByRole('dialog')), false)
    assert.equal(localStorage.getItem('gd-global-search-recent'), '["pl"]')
  })
  test('native result buttons open their own route and parent-chain buttons do not trigger row navigation', () => {
    const first = mount(); query('pl'); fireEvent.click(screen.getByRole('button', { name: 'Parent Agent' }))
    assert.equal(screen.getByLabelText('Current path').textContent, '/agents/a1')
    assert.equal(localStorage.getItem('gd-global-search-recent'), null)
    first.unmount(); mount(); query('pl'); fireEvent.click(screen.getByRole('option', { name: /Agent One/ }))
    assert.equal(screen.getByLabelText('Current path').textContent, '/agents/a1')
    assert.equal(localStorage.getItem('gd-global-search-recent'), '["pl"]')
  })
  test('See all uses the original encoded query and entity category route', () => {
    mount(); query('a & b'); fireEvent.click(screen.getByRole('button', { name: 'See all Players' }))
    // The list page itself: /players redirects to /players/search, and the redirect dropped the query string.
    assert.equal(screen.getByLabelText('Current path').textContent, '/players/search?search=a%20%26%20b')
    assert.equal(Boolean(screen.queryByRole('dialog')), false)
  })
  /* B006: the Bets group is only the generic "Search bets: <term>" shortcut. It was listed, and preselected, above the
     Bonuses, so Enter on a campaign's name opened /bets?search=<name> and "No bets found". */
  const betShortcut = (term: string) => ({ id: `bet-search-${term}`, type: 'bet', label: `Search bets: "${term}"`, subtitle: 'Open bet list with this search', route: `/bets?search=${encodeURIComponent(term)}`, status: null, metadata: null, parentChain: null })
  test('real matches come before the bets shortcut and the first is the default selection (B006)', () => {
    harness.matchPages.mockImplementation(() => [])
    harness.data = { globalSearch: { ...emptyEntities(), bets: [betShortcut('WEDNESDAY 10%')],
      bonuses: [{ id: '6', type: 'bonus', label: 'WEDNESDAY 10%', subtitle: 'sports • percentage', route: '/bonuses/6', status: 'active', metadata: null, parentChain: null }] } }
    mount(); query('WEDNESDAY 10%')
    const input = screen.getByRole('combobox', { name: 'Search anything' })
    const options = screen.getAllByRole('option')
    assert.equal(options.length, 2)
    assert.ok(!options[0].textContent?.includes('Search bets'), `the campaign comes first, not: ${options[0].textContent}`)
    assert.ok(options[1].textContent?.includes('Search bets'), 'the bets shortcut comes after the matches')
    assert.equal(input.getAttribute('aria-activedescendant'), options[0].id)
    input.focus(); fireEvent.keyDown(input, { key: 'Enter' })
    assert.equal(screen.getByLabelText('Current path').textContent, '/bonuses/6')
  })
  test('with nothing else matched, Enter still opens the bet list through the shortcut', () => {
    harness.matchPages.mockImplementation(() => [])
    harness.data = { globalSearch: { ...emptyEntities(), bets: [betShortcut('B-7781')] } }
    mount(); query('B-7781')
    const input = screen.getByRole('combobox', { name: 'Search anything' })
    input.focus(); fireEvent.keyDown(input, { key: 'Enter' })
    assert.equal(screen.getByLabelText('Current path').textContent, '/bets?search=B-7781')
  })
  /* B005: the agents list shows one scheme at a time (?type=, else the last one used, else COMMISSION), so See all
     Agents named only the term and could land on a scheme none of the matches has. */
  test('See all Agents opens the list on the scheme of the matched agents (B005)', () => {
    const agent = (id: string, schemeType: string) => ({ id, type: 'agent', label: `vfysh ${id}`, subtitle: schemeType, route: `/agents/${id}`, status: 'ACTIVE', metadata: { schemeType, levelIndex: 1 }, parentChain: null })
    harness.data = { globalSearch: { ...emptyEntities(), agents: [agent('a1', 'SHARING'), agent('a2', 'SHARING')] } }
    const first = mount(); query('vfysh'); fireEvent.click(screen.getByRole('button', { name: 'See all Agents' }))
    assert.equal(screen.getByLabelText('Current path').textContent, '/agents?search=vfysh&type=SHARING')
    first.unmount()
    // Mixed schemes: the one most of the matches have.
    harness.data = { globalSearch: { ...emptyEntities(), agents: [agent('a1', 'COMMISSION'), agent('a2', 'CREDIT'), agent('a3', 'CREDIT')] } }
    mount(); query('vfy'); fireEvent.click(screen.getByRole('button', { name: 'See all Agents' }))
    assert.equal(screen.getByLabelText('Current path').textContent, '/agents?search=vfy&type=CREDIT')
  })
  test('keeps query threshold, limit ten and agent-only categories on the real search hook', async () => {
    vi.useFakeTimers()
    useAuthStore.setState({ roles: [], permissions: [], agent: { id: 'a1', tenantId: 't1', username: 'agent', phone: null, schemeType: 'SHARING', allowedDomains: ['sports'], status: 'ACTIVE', parentAgentId: null, levelIndex: 1, tallyEnabled: false, tallyDomains: [], createdAt: '2026-10-09' } })
    mount(); query('a')
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    assert.equal(harness.search.mock.calls.length, 0)
    query('ab'); await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    assert.deepEqual(harness.search.mock.calls[0][0], { variables: { query: 'ab', limit: 10, categories: ['players', 'agents'] } })
    assert.equal(Boolean(screen.queryByRole('button', { name: 'Casino Games (1)' })), false)
  })
  test('recent search selection, explicit history clear and input clear retain their existing scope', () => {
    localStorage.setItem('gd-global-search-recent', JSON.stringify(['saved search']))
    mount(); fireEvent.click(screen.getByRole('button', { name: 'saved search' }))
    assert.equal((screen.getByLabelText('Search anything') as HTMLInputElement).value, 'saved search')
    fireEvent.click(screen.getByRole('button', { name: 'Clear search history' }))
    assert.equal(localStorage.getItem('gd-global-search-recent'), null)
    fireEvent.click(screen.getByRole('button', { name: /Clear Search anything/i }))
    assert.equal((screen.getByLabelText('Search anything') as HTMLInputElement).value, '')
  })
  test('focus restores to the actual opener and the shared kit releases its body scroll lock', async () => {
    document.body.style.overflow = ''; mount(false)
    const opener = screen.getByRole('button', { name: 'Open global search' }); opener.focus(); fireEvent.click(opener)
    await waitFor(() => assert.equal(document.activeElement === screen.getByLabelText('Search anything'), true))
    await waitFor(() => assert.equal(document.body.style.overflow, 'hidden'))
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => assert.equal(document.activeElement === opener, true))
    assert.equal(document.body.style.overflow, '')
  })
})
