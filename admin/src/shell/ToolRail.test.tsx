import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { IconChartBar, IconCash } from '@tabler/icons-react'
import { useSidebarStore } from '@/state/sidebarStore'
import { useUIStore } from '@/shared/core/uiStore'
import { ToolRail } from './ToolRail'
import type { ShellRow, ShellSection } from './shellTypes'

const harness = vi.hoisted(() => ({
  roles: { showGeneralBell: true, showTaskBell: true },
  isAgent: false,
  taskUnread: 3,
  jobs: [] as Array<Record<string, unknown>>,
  queryOptions: [] as Array<Record<string, unknown>>,
  markAll: vi.fn(async () => undefined),
  viewAll: vi.fn(),
}))
vi.mock('./topbar/useTopbarRoles', () => ({ useTopbarRoles: () => harness.roles }))
vi.mock('@/shared/core/authStore', () => {
  const state = () => ({ user: { id: 'u1' }, isAgent: () => harness.isAgent })
  const useAuthStore = Object.assign((select: (value: unknown) => unknown) => select(state()),
    { getState: state, setState: () => undefined, subscribe: () => () => undefined })
  return { useAuthStore }
})
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `₹${value}` }) }))
vi.mock('@/modules/aiAssistant/AiAssistantPanel', async () => {
  const { useState } = await import('react')
  return {
  ASSISTANT_TITLE: 'Portal assistant',
  ASSISTANT_SUB: 'Answers from live data',
  AiAssistantPanel: ({ open, surface }: { open: boolean; surface?: string }) => {
    const [draft, setDraft] = useState('')
    return open ? <div><p>Assistant panel open ({surface})</p><input aria-label="Assistant draft" value={draft} onChange={event => setDraft(event.target.value)}/></div> : null
  },
  }
})
vi.mock('./topbar/useNotificationBell', async () => {
  const react = await import('react')
  return {
    useNotificationBell: (category: 'general' | 'task') => {
      const [open, setOpen] = react.useState(false)
      return {
        open, setOpen, initialLoading: false, listLoading: false,
        unreadCount: category === 'general' ? 7 : harness.taskUnread,
        notifications: category === 'general'
          ? [{ id: 'n1', type: 'deposit', title: 'Deposit flagged', message: 'vikram_88 · risk rules', createdAt: new Date().toISOString(), metadata: {} }]
          : [],
        onNotificationClick: vi.fn(), onMarkAllAsRead: harness.markAll, onViewAll: harness.viewAll,
      }
    },
  }
})
vi.mock('@apollo/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@apollo/client')>(),
  useApolloClient: () => ({}),
  useQuery: (_query: unknown, options: Record<string, unknown>) => {
    harness.queryOptions.push(options)
    // The shape EXPORT_JOBS_QUERY really returns: a page of jobs.
    return { data: options.skip ? undefined : { exportJobsPage: { items: harness.jobs } }, loading: false, error: undefined, startPolling: vi.fn(), stopPolling: vi.fn() }
  },
}))

const row = (to: string, label: string, sectionKey: string, sectionTitle: string, icon = IconCash): ShellRow =>
  ({ id: `${sectionKey}|${to}`, sectionKey, sectionTitle, to, label, icon, keywords: [], badgeKey: null })
const deposits = row('/finance/deposits', 'Deposit Requests', 'finance', 'Finance')
const exportsRow = row('/reporting/exports', 'Export Center', 'reports', 'Reports', IconChartBar)
const liveChatRow = row('/support/live-chat', 'Live Chat Inbox', 'system', 'System')
const section = (key: string, title: string, rows: ShellRow[]): ShellSection =>
  ({ key, title, subtitle: null, icon: IconCash, badgeKey: null, entries: rows.map((r) => ({ kind: 'row' as const, row: r })), rows })
const SECTIONS = [section('finance', 'Finance', [deposits]), section('reports', 'Reports', [exportsRow])]

function mount(sections: readonly ShellSection[] = SECTIONS, activeTo: string | null = '/finance/deposits') {
  return render(<MemoryRouter><LocationProbe /><div data-shell-root=""><button type="button">Page action</button><ToolRail sections={sections} activeTo={activeTo} /></div><button type="button">Portaled layer</button></MemoryRouter>)
}

function LocationProbe() { return <span data-testid="current-path">{useLocation().pathname}</span> }

beforeEach(() => {
  harness.roles = { showGeneralBell: true, showTaskBell: true }
  harness.isAgent = false
  harness.taskUnread = 3
  harness.jobs = []
  harness.queryOptions = []
  useSidebarStore.setState({ favorites: [] })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('the right tool rail', () => {
  test('the Live Chat shortcut navigates to the permitted inbox and closes the open tool panel', () => {
    mount([...SECTIONS, section('system', 'System', [liveChatRow])])
    const chat = within(screen.getByRole('complementary', { name: 'Tools' })).getByRole('link', { name: 'Live Chat' })
    assert.equal(chat.getAttribute('href'), '/support/live-chat')
    assert.equal(chat.getAttribute('aria-haspopup'), null)
    fireEvent.click(screen.getByRole('button', { name: 'Favourites' }))
    assert.ok(screen.getByRole('dialog', { name: 'Favourites' }))
    fireEvent.click(chat)
    assert.equal(screen.getByTestId('current-path').textContent, '/support/live-chat')
    assert.equal(chat.getAttribute('aria-current'), 'page')
    assert.equal(screen.queryByRole('dialog'), null)
  })

  test('the Live Chat shortcut follows filtered navigation and is unavailable to agents', () => {
    const denied = mount()
    assert.equal(screen.queryByRole('link', { name: 'Live Chat' }), null)
    denied.unmount()
    harness.isAgent = true
    mount([...SECTIONS, section('system', 'System', [liveChatRow])])
    assert.equal(screen.queryByRole('link', { name: 'Live Chat' }), null)
  })

  test('shows the kit tools with their counts, each a dialog trigger', () => {
    mount()
    const rail = screen.getByRole('complementary', { name: 'Tools' })
    const names = within(rail).getAllByRole('button').map((button) => button.getAttribute('aria-label'))
    assert.equal(screen.queryByRole('dialog'), null, 'no panel until a tool is chosen')
    assert.deepEqual(names, ['Assistant', 'Alerts, 7 unread', 'Tasks, 3 unread', 'Favourites', 'Exports'])
    for (const button of within(rail).getAllByRole('button')) {
      assert.equal(button.getAttribute('aria-haspopup'), 'dialog')
      assert.equal(button.getAttribute('aria-expanded'), 'false')
    }
  })

  test('keeps to what the user had: no bells without the roles, no assistant for agents, no exports without the Export Center', () => {
    harness.roles = { showGeneralBell: false, showTaskBell: false }
    harness.isAgent = true
    mount([section('finance', 'Finance', [deposits])])
    const names = within(screen.getByRole('complementary', { name: 'Tools' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    assert.deepEqual(names, ['Favourites'])
  })

  test('Alerts opens the bell list in a drawer, with Clear all and View all', async () => {
    mount()
    const alerts = screen.getByRole('button', { name: 'Alerts, 7 unread' })
    await act(async () => { fireEvent.click(alerts) })
    const drawer = await screen.findByRole('dialog', { name: 'Alerts' })
    assert.ok(within(drawer).getByText('Deposit flagged'))
    assert.equal(alerts.getAttribute('aria-expanded'), 'true')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Clear all' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'View all' }))
    assert.equal(harness.markAll.mock.calls.length, 1)
    assert.equal(harness.viewAll.mock.calls.length, 1)
  })

  test('Tasks offers Clear all while the badge counts unread items its list does not hold', async () => {
    mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tasks, 3 unread' })) })
    const drawer = await screen.findByRole('dialog', { name: 'Tasks' })
    assert.ok(within(drawer).getByText('No new tasks'))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Clear all' }))
    assert.equal(harness.markAll.mock.calls.length, 1)
  })

  test('Tasks has nothing to clear when nothing is unread', async () => {
    harness.taskUnread = 0
    mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tasks' })) })
    const drawer = await screen.findByRole('dialog', { name: 'Tasks' })
    assert.equal(within(drawer).queryByRole('button', { name: 'Clear all' }), null)
    assert.ok(within(drawer).getByRole('button', { name: 'View all' }))
  })

  test('Favourites saves the page in view and lists it', async () => {
    mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Favourites' })) })
    const drawer = await screen.findByRole('dialog', { name: 'Favourites' })
    assert.ok(within(drawer).getByText('No saved pages yet'))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save this page' }))
    assert.deepEqual(useSidebarStore.getState().favorites, ['/finance/deposits'])
    assert.equal(within(drawer).getByRole('button', { name: 'Saved' }).getAttribute('aria-pressed'), 'true')
    assert.ok(within(drawer).getByRole('link', { name: /Deposit Requests/ }))
  })

  test('Exports reads the latest jobs only once opened, with a download for a finished one', async () => {
    harness.jobs = [
      { id: 'j1', reportType: 'pnl', exportFormat: 'csv', status: 'completed', createdAt: new Date().toISOString() },
      { id: 'j2', reportType: 'deposits', exportFormat: 'xlsx', status: 'processing', createdAt: new Date().toISOString() },
    ]
    mount()
    assert.equal(harness.queryOptions.length, 0, 'no export query until the panel opens')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Exports' })) })
    const drawer = await screen.findByRole('dialog', { name: 'Exports' })
    assert.equal(harness.queryOptions.length > 0, true)
    assert.equal(within(drawer).getAllByRole('button', { name: /^Download / }).length, 1)
    assert.ok(within(drawer).getByText('Processing'))
    assert.ok(within(drawer).getByRole('button', { name: 'Open Export Center' }))
  })

  test('Assistant opens the assistant inline in the same rail panel', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))
    const panel = screen.getByRole('dialog', { name: 'Portal assistant' })
    assert.ok(within(panel).getByText('Assistant panel open (inline)'))
    assert.equal(screen.getByRole('button', { name: 'Assistant' }).getAttribute('aria-expanded'), 'true')
  })

  test('minimizing or switching tools preserves the assistant draft, while changing tenant clears it', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Assistant draft' }), { target: { value: 'Remember this question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Minimize Portal assistant' }))
    assert.equal(screen.queryByRole('dialog'), null)
    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))
    assert.equal((screen.getByRole('textbox', { name: 'Assistant draft' }) as HTMLInputElement).value, 'Remember this question')
    fireEvent.click(screen.getByRole('button', { name: 'Favourites' }))
    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }))
    assert.equal((screen.getByRole('textbox', { name: 'Assistant draft' }) as HTMLInputElement).value, 'Remember this question')
    act(() => useUIStore.setState({ selectedWhitelabelId: 'new-assistant-tenant' }))
    assert.equal((screen.getByRole('textbox', { name: 'Assistant draft' }) as HTMLInputElement).value, '')
  })

  test('opens like the player panel: non-modal, one panel that switches, its own button closes it', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Alerts, 7 unread' }))
    const panel = screen.getByRole('dialog', { name: 'Alerts' })
    assert.equal(panel.getAttribute('aria-modal'), 'false')
    // A drawer like every other: square on all four corners, its head, body and foot included.
    assert.deepEqual([panel, ...panel.children].filter((part) => !part.hasAttribute('hidden')).map((part) => part.getAttribute('data-ui-radius')),
      ['square', 'square', 'square', 'square'])
    assert.equal(screen.getByRole('button', { name: 'Alerts, 7 unread' }).getAttribute('aria-controls'), panel.id)
    fireEvent.click(screen.getByRole('button', { name: 'Favourites' }))
    assert.equal(screen.getAllByRole('dialog').length, 1)
    assert.ok(screen.getByRole('dialog', { name: 'Favourites' }))
    assert.equal(screen.getByRole('button', { name: 'Alerts, 7 unread' }).getAttribute('aria-expanded'), 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Favourites' }))
    assert.equal(screen.queryByRole('dialog'), null)
  })

  test('Escape and the close button hand focus back to the rail button; a press in the page closes, one in a portaled layer does not', () => {
    mount()
    const alerts = screen.getByRole('button', { name: 'Alerts, 7 unread' })
    fireEvent.click(alerts)
    const panel = screen.getByRole('dialog', { name: 'Alerts' })
    assert.equal(document.activeElement, panel, 'the panel takes focus as it opens')
    fireEvent.keyDown(panel, { key: 'Escape' })
    assert.equal(screen.queryByRole('dialog'), null)
    assert.equal(document.activeElement, alerts)
    fireEvent.click(alerts)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Alerts' })).getByRole('button', { name: 'Close Alerts' }))
    assert.equal(screen.queryByRole('dialog'), null)
    assert.equal(document.activeElement, alerts)
    fireEvent.click(alerts)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Portaled layer' }))
    assert.ok(screen.getByRole('dialog', { name: 'Alerts' }), 'a press in a layer outside the shell keeps it open')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Page action' }))
    assert.equal(screen.queryByRole('dialog'), null)
  })
})
