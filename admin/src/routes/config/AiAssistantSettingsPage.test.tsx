/**
 * /config/ai-assistant against a mocked GraphQL server (MockedProvider): the two queries and their merge, the
 * route-only guard (the resolver refuses anyone but a Super Admin, and the page says so), the drafts with
 * Save and Undo, the exact SetAiWhitelabelSettings variables, the allowance floor and rounding, the toasts and
 * refetch, and loading and empty.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { InMemoryCache } from '@apollo/client'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { AI_WHITELABEL_SETTINGS, SET_AI_WHITELABEL_SETTINGS, WHITELABELS_FOR_AI } from '@/lib/graphql/aiAssistant'
import AiAssistantSettingsPage from './AiAssistantSettingsPage'

const feedback = vi.hoisted(() => ({ toast: vi.fn(), rbac: vi.fn() }))

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))
vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ children }: { children: ReactNode }) => {
    feedback.rbac()
    return <>{children}</>
  },
}))

interface Setting {
  tenant: string
  enabled: boolean
  chatLimit: number
  limitPeriod: string
  used: number
  remaining: number
  updatedBy: string | null
  updatedAt: string | null
}

interface ServerState {
  settings: Setting[]
  whitelabels: Array<{ id: string; name: string }>
  settingsQueries: number
  whitelabelQueries: number
  saves: Array<Record<string, unknown>>
}

let server: ServerState

function settingsMock(): MockedResponse {
  return {
    request: { query: AI_WHITELABEL_SETTINGS },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      server.settingsQueries += 1
      return { data: { aiWhitelabelSettings: server.settings.map((row) => ({ __typename: 'AiWhitelabelSettings', ...row })) } }
    },
  }
}

function whitelabelsMock(): MockedResponse {
  return {
    request: { query: WHITELABELS_FOR_AI },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      server.whitelabelQueries += 1
      return { data: { whitelabels: server.whitelabels.map((w) => ({ __typename: 'Whitelabel', ...w })) } }
    },
  }
}

function saveMock(): MockedResponse {
  return {
    request: { query: SET_AI_WHITELABEL_SETTINGS },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      server.saves.push(variables)
      const saved: Setting = {
        tenant: variables.tenant as string,
        enabled: variables.enabled as boolean,
        chatLimit: variables.chatLimit as number,
        limitPeriod: variables.limitPeriod as string,
        used: 0,
        remaining: variables.chatLimit as number,
        updatedBy: 'superadmin',
        updatedAt: '2026-10-07T10:00:00.000Z',
      }
      server.settings = [...server.settings.filter((row) => row.tenant !== saved.tenant), saved]
      return { data: { setAiWhitelabelSettings: { __typename: 'AiWhitelabelSettings', ...saved } } }
    },
  }
}

function failingSaveMock(): MockedResponse {
  return {
    request: { query: SET_AI_WHITELABEL_SETTINGS },
    variableMatcher: (variables) => {
      server.saves.push(variables as Record<string, unknown>)
      return true
    },
    error: new Error('Provider budget locked'),
  }
}

function renderPage(mocks: MockedResponse[] = [settingsMock(), whitelabelsMock(), saveMock()], cache?: InMemoryCache) {
  return render(
    <MockedProvider mocks={mocks} cache={cache}>
      <MemoryRouter>
        <PageEyebrowProvider value="System">
          <AiAssistantSettingsPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function loaded() {
  await screen.findByRole('switch', { name: 'Access for floxi' })
  await screen.findByRole('switch', { name: 'Access for nova' })
}

function rowOf(tenant: string): HTMLElement {
  return screen.getByRole('switch', { name: `Access for ${tenant}` }).closest('tr') as HTMLElement
}

function allowance(tenant: string): HTMLInputElement {
  return screen.getByRole('textbox', { name: `Allowance for ${tenant}` }) as HTMLInputElement
}

function typeAllowance(tenant: string, value: string) {
  const input = allowance(tenant)
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

function lastToast() {
  return feedback.toast.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
}

beforeEach(() => {
  server = {
    settings: [
      { tenant: 'floxi', enabled: true, chatLimit: 500, limitPeriod: 'monthly', used: 450, remaining: 50, updatedBy: 'superadmin', updatedAt: '2026-10-01T10:00:00.000Z' },
      { tenant: 'acme', enabled: false, chatLimit: 0, limitPeriod: 'daily', used: 0, remaining: 0, updatedBy: null, updatedAt: null },
    ],
    whitelabels: [
      { id: 'floxi', name: 'Floxi Gaming' },
      { id: 'nova', name: 'Nova Play' },
    ],
    settingsQueries: 0,
    whitelabelQueries: 0,
    saves: [],
  }
  feedback.toast.mockReset()
  feedback.rbac.mockReset()
})

describe('AiAssistantSettingsPage', () => {
  test('lists configured and unconfigured whitelabels, sorted, with the legacy copy and cells', async () => {
    renderPage()
    assert.ok(screen.getByText('Loading Assistant access by whitelabel'))
    await loaded()

    assert.equal(server.settingsQueries, 1)
    assert.equal(server.whitelabelQueries, 1)
    assert.equal(feedback.rbac.mock.calls.length, 0, 'the page adds no RBACGuard; the route guard is adminRoute')
    assert.ok(screen.getByRole('heading', { level: 1, name: 'AI assistant access' }))
    assert.ok(screen.queryByText('System') === null)
    assert.ok(screen.queryByText(
        'Choose which whitelabels may use the portal assistant and how many messages each may send. Every message costs money at the provider, so access is off and the allowance is zero until you grant them.',
      ) === null)
    assert.ok(screen.getByRole('heading', { level: 2, name: 'AI assistant access' }))
    assert.deepStrictEqual(
      screen.getAllByRole('columnheader').map((cell) => cell.textContent),
      ['Whitelabel', 'Access', 'Allowance', 'Renews', 'Used', 'Status', 'Actions'],
    )
    const tenants = screen.getAllByRole('switch').map((toggle) => toggle.getAttribute('aria-label'))
    assert.deepStrictEqual(tenants, ['Access for acme', 'Access for floxi', 'Access for nova'])

    const floxi = rowOf('floxi')
    assert.ok(within(floxi).getByText('last changed by superadmin'))
    assert.equal(within(floxi).getByRole('switch').getAttribute('aria-checked'), 'true')
    assert.equal(allowance('floxi').value, '500')
    assert.equal((within(floxi).getByRole('combobox', { name: 'Renews for floxi' }) as HTMLSelectElement).value, 'monthly')
    assert.deepStrictEqual(
      within(within(floxi).getByRole('combobox', { name: 'Renews for floxi' })).getAllByRole('option').map((o) => o.textContent),
      ['Per month', 'Per day', 'One-off total'],
    )
    assert.ok(within(floxi).getByText('450 of 500 · 50 left'))
    assert.ok(within(floxi).getByText('Active'))

    const acme = rowOf('acme')
    assert.equal(within(acme).queryByText(/last changed by/), null)
    assert.equal((within(acme).getByRole('combobox', { name: 'Renews for acme' }) as HTMLSelectElement).value, 'daily')
    assert.ok(within(acme).getByText('—'))
    assert.ok(within(acme).getByText('Off'))

    const nova = rowOf('nova')
    assert.equal(within(nova).getByRole('switch').getAttribute('aria-checked'), 'false')
    assert.equal(allowance('nova').value, '0')
    assert.equal((within(nova).getByRole('combobox', { name: 'Renews for nova' }) as HTMLSelectElement).value, 'monthly')
    assert.ok(within(nova).getByText('Off'))
  })

  test('a refused read keeps the header and says who manages the settings; another failure is shown as sent', async () => {
    const { unmount } = renderPage([
      { request: { query: AI_WHITELABEL_SETTINGS }, error: new Error('Unauthorized: Super Admin only') },
      whitelabelsMock(),
    ])
    await screen.findByText('Could not load assistant settings')
    assert.ok(screen.getByText('These settings are managed by a Super Admin.'))
    assert.ok(screen.getByRole('heading', { level: 1, name: 'AI assistant access' }))
    assert.equal(screen.queryByRole('table'), null)
    unmount()

    renderPage([{ request: { query: AI_WHITELABEL_SETTINGS }, error: new Error('Network down') }, whitelabelsMock()])
    await screen.findByText('Network down')
  })

  test('no row shows until the settings answer, even when the whitelabel list is already cached', async () => {
    const cache = new InMemoryCache()
    cache.writeQuery({
      query: WHITELABELS_FOR_AI,
      data: { whitelabels: server.whitelabels.map((w) => ({ __typename: 'Whitelabel', ...w })) },
    })
    renderPage([{ ...settingsMock(), delay: 40 }, whitelabelsMock(), saveMock()], cache)
    assert.ok(screen.getByText('Loading Assistant access by whitelabel'))
    assert.equal(screen.queryByRole('switch'), null, 'no placeholder row with live controls')
    assert.equal(screen.queryByText('Off'), null, 'no whitelabel reads as Off before the answer')
    await loaded()
    assert.equal(server.whitelabelQueries, 0, 'the whitelabel list came from the cache')
    assert.equal(screen.getByRole('switch', { name: 'Access for floxi' }).getAttribute('aria-checked'), 'true')
    assert.equal(allowance('floxi').value, '500')
  })

  test('the allowance never goes below 0 with the arrow keys, and a step at 0 leaves the row clean', async () => {
    renderPage()
    await loaded()
    fireEvent.keyDown(allowance('nova'), { key: 'ArrowDown' })
    assert.equal(allowance('nova').value, '0')
    assert.equal(within(rowOf('nova')).queryByRole('button', { name: 'Undo nova' }), null, 'no draft at the floor')
    fireEvent.keyDown(allowance('nova'), { key: 'ArrowUp' })
    assert.equal(allowance('nova').value, '1', 'the kit field takes an in-range step')
    fireEvent.keyDown(allowance('nova'), { key: 'ArrowDown', shiftKey: true })
    assert.equal(allowance('nova').value, '0', 'Shift+ArrowDown stops at 0')
    const input = allowance('floxi')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '-5' } })
    assert.equal(input.value, '0', 'a typed negative is raised at once')
    fireEvent.blur(input)
    fireEvent.click(screen.getByRole('button', { name: 'Save nova' }))
    await waitFor(() => assert.equal(server.saves.length, 1))
    assert.deepStrictEqual(server.saves[0], { tenant: 'nova', enabled: false, chatLimit: 0, limitPeriod: 'monthly' })
  })

  test('says so when there is nothing to list', async () => {
    server.settings = []
    server.whitelabels = []
    renderPage()
    await screen.findByText('No data')
  })

  test('an edit shows Save and Undo; Undo drops it, Save sends the legacy variables, toasts and refetches', async () => {
    renderPage()
    await loaded()
    typeAllowance('floxi', '20')
    fireEvent.change(screen.getByRole('combobox', { name: 'Renews for floxi' }), { target: { value: 'total' } })
    assert.ok(within(rowOf('floxi')).getByRole('button', { name: 'Undo floxi' }))
    assert.ok(within(rowOf('floxi')).getByText('Active'), 'Status keeps the stored state beside the unsaved edit')
    assert.ok(within(rowOf('floxi')).getByText('450 of 500 · 50 left'), 'Used follows the stored allowance')

    fireEvent.click(screen.getByRole('button', { name: 'Undo floxi' }))
    await waitFor(() => assert.equal(allowance('floxi').value, '500'))
    assert.ok(within(rowOf('floxi')).getByText('Active'))
    assert.equal(server.saves.length, 0)

    typeAllowance('floxi', '20')
    fireEvent.change(screen.getByRole('combobox', { name: 'Renews for floxi' }), { target: { value: 'total' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save floxi' }))
    await waitFor(() => assert.equal(server.saves.length, 1))
    assert.deepStrictEqual(server.saves[0], { tenant: 'floxi', enabled: true, chatLimit: 20, limitPeriod: 'total' })
    await waitFor(() =>
      assert.deepStrictEqual(lastToast(), {
        title: 'Settings saved',
        message: 'floxi can send 20 messages in total.',
        tone: 'ok',
        duration: 4500,
      }),
    )
    await waitFor(() => assert.equal(server.settingsQueries, 2))
    await waitFor(() => assert.ok(within(rowOf('floxi')).queryByRole('button', { name: 'Save floxi' }) === null, 'the draft was cleared'))
    assert.ok(within(rowOf('floxi')).getByText('0 of 20 · 20 left'))
  })

  test('granting an unconfigured whitelabel sends its closed defaults with the edits', async () => {
    renderPage()
    await loaded()
    fireEvent.click(screen.getByRole('switch', { name: 'Access for nova' }))
    typeAllowance('nova', '75')
    fireEvent.click(screen.getByRole('button', { name: 'Save nova' }))
    await waitFor(() => assert.equal(server.saves.length, 1))
    assert.deepStrictEqual(server.saves[0], { tenant: 'nova', enabled: true, chatLimit: 75, limitPeriod: 'monthly' })
    await waitFor(() => assert.equal(lastToast()?.message, 'nova can send 75 messages per month.'))
  })

  test('the allowance is a whole number of at least 0, and a cleared field means 0', async () => {
    renderPage()
    await loaded()
    typeAllowance('floxi', '-5')
    await waitFor(() => assert.equal(allowance('floxi').value, '0'))
    typeAllowance('floxi', '2.5')
    await waitFor(() => assert.equal(allowance('floxi').value, '3'))
    typeAllowance('floxi', '')
    await waitFor(() => assert.equal(allowance('floxi').value, '0'))
    typeAllowance('floxi', '12.4')
    fireEvent.click(screen.getByRole('button', { name: 'Save floxi' }))
    await waitFor(() => assert.equal(server.saves.length, 1))
    assert.deepStrictEqual(server.saves[0], { tenant: 'floxi', enabled: true, chatLimit: 12, limitPeriod: 'monthly' })
  })

  test('switching access off saves enabled false; a failed save toasts and keeps the draft', async () => {
    renderPage([settingsMock(), whitelabelsMock(), failingSaveMock()])
    await loaded()
    fireEvent.click(screen.getByRole('switch', { name: 'Access for floxi' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save floxi' }))
    await waitFor(() =>
      assert.deepStrictEqual(lastToast(), {
        title: 'Could not save settings',
        message: 'Provider budget locked',
        tone: 'error',
        duration: 4500,
      }),
    )
    assert.deepStrictEqual(server.saves[0], { tenant: 'floxi', enabled: false, chatLimit: 500, limitPeriod: 'monthly' })
    assert.equal(screen.getByRole('switch', { name: 'Access for floxi' }).getAttribute('aria-checked'), 'false')
    assert.ok(screen.getByRole('button', { name: 'Undo floxi' }))
    assert.equal(server.settingsQueries, 1)
  })
})
