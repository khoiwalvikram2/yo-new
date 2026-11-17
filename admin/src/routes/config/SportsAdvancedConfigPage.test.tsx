/**
 * /config/sports-advanced in a MockedProvider whose link plays the server: every operation is recorded with its
 * name, variables and printed document, and answered a tick later. Covers the RBAC requirement (and that a
 * denied caller starts no query), the two tabs and their pickers, a settings form mounted only once its record
 * has loaded, the exact upsert variables, the legacy rules, Reset, the failure toasts and a failed load.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider } from '@apollo/client/testing'
import { ApolloLink, Observable, type FetchResult } from '@apollo/client'
import { print } from 'graphql'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import SportsAdvancedConfigPage from './SportsAdvancedConfigPage'

interface GuardCall {
  required: Array<{ domain: string; actions: string[] }>
}

const feedback = vi.hoisted(() => ({
  toast: vi.fn(),
  guard: { allowed: true, calls: [] as GuardCall[] },
}))

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))
vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: GuardCall & { children: ReactNode }) => {
    feedback.guard.calls.push({ required })
    return feedback.guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))
vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({ getCurrencySymbol: () => 'â‚¹' }),
}))

type Vars = Record<string, unknown>

interface Call {
  name: string
  variables: Vars
  document: string
}

type Responder = (variables: Vars) => FetchResult | Error

let calls: Call[]
let respond: Record<string, Responder>
let heldOperations: Set<string>
let releaseResponse: Partial<Record<string, () => void>>

function serverLink() {
  return new ApolloLink(
    (operation) =>
      new Observable<FetchResult>((observer) => {
        const call = { name: operation.operationName, variables: { ...operation.variables }, document: print(operation.query) }
        calls.push(call)
        const deliver = () => {
          const responder = respond[call.name]
          const result = responder ? responder(call.variables) : { errors: [{ message: `no responder for ${call.name}` }] }
          if (result instanceof Error) {
            observer.error(result)
            return
          }
          observer.next(result)
          observer.complete()
        }
        if (heldOperations.has(call.name)) {
          releaseResponse[call.name] = deliver
          return () => {
            if (releaseResponse[call.name] === deliver) delete releaseResponse[call.name]
          }
        }
        const timer = setTimeout(deliver, 0)
        return () => clearTimeout(timer)
      }),
  )
}

const named = (name: string) => calls.filter((call) => call.name === name)

const SPORTS = [
  { __typename: 'Sport', id: '1', key: 'cricket', name: 'Cricket', sort: 1, sportCode: '4', status: 'ACTIVE', updatedAt: null },
  { __typename: 'Sport', id: '2', key: 'soccer', name: 'Soccer', sort: 2, sportCode: '1', status: 'ACTIVE', updatedAt: null },
]

const LEAGUES = [
  { __typename: 'League', id: '21', name: 'Premier League', sportId: '2', status: 'ACTIVE', updatedAt: null },
  { __typename: 'League', id: '22', name: 'La Liga', sportId: '2', status: 'ACTIVE', updatedAt: null },
]

/** A stored record: the 33 settings, some of them null, as the server returns them. */
function storedSettings(): Record<string, unknown> {
  return {
    exchangeMinStake: 100,
    exchangeMaxStake: 50000,
    bookmakerMinStake: 50,
    bookmakerMaxStake: 25000,
    fancyMinStake: 10,
    fancyMaxStake: 10000,
    exchangeDelay: 5,
    bookmakerDelay: 2,
    fancyDelay: 0,
    exchangeCooldown: 1,
    bookmakerCooldown: null,
    fancyCooldown: null,
    exchangeMinOdds: 1.01,
    exchangeMaxOdds: 1000,
    exchangeCommission: 2.5,
    bookmakerCommission: 0,
    fancyCommission: null,
    exchangeExposureDaily: 1000000,
    exchangeExposureWeekly: null,
    exchangeExposureCap: 10000000,
    bookmakerExposureDaily: null,
    bookmakerExposureWeekly: null,
    bookmakerExposureCap: null,
    fancyExposureDaily: null,
    fancyExposureWeekly: null,
    fancyExposureCap: null,
    cashoutActive: true,
    riskLevel: 'medium',
    riskThreshold: 0.5,
    volatilityThreshold: null,
    alertOnBreach: false,
    alertChannel: 'telegram',
    alertRateLimit: 10,
  }
}

let sportRecord: Record<string, unknown> | null
let leagueRecord: Record<string, unknown> | null
let sportResult: { success: boolean; message: string | null } | Error

beforeEach(() => {
  calls = []
  heldOperations = new Set()
  releaseResponse = {}
  sportRecord = storedSettings()
  leagueRecord = { ...storedSettings(), exchangeCommission: 1, riskLevel: 'low' }
  sportResult = { success: true, message: 'Settings saved for 1 sport(s)' }
  respond = {
    ListSports: () => ({ data: { sports: SPORTS } }),
    ListLeagues: () => ({ data: { leagues: LEAGUES } }),
    GetSportSettings: (variables) => ({
      data: {
        sportSettings: sportRecord
          ? { __typename: 'SportSettings', sportId: variables.sportId, tierId: variables.tierId, ...sportRecord }
          : null,
      },
    }),
    GetLeagueSettings: (variables) => ({
      data: {
        leagueSettings: leagueRecord
          ? {
              __typename: 'LeagueSettings',
              id: '900',
              leagueId: variables.leagueId,
              tierId: variables.tierId,
              ...leagueRecord,
            }
          : null,
      },
    }),
    UpsertSportSettings: () =>
      sportResult instanceof Error
        ? { errors: [{ message: sportResult.message }] }
        : { data: { upsertSportSettings: { __typename: 'MessageResponse', ...sportResult } } },
    UpsertLeagueSettings: () => ({
      data: { upsertLeagueSettings: { __typename: 'MessageResponse', success: true, message: null } },
    }),
  }
  feedback.toast.mockReset()
  feedback.guard.allowed = true
  feedback.guard.calls = []
})

function renderPage() {
  return render(
    <MockedProvider link={serverLink()}>
      <MemoryRouter>
        <PageEyebrowProvider value="System">
          <SportsAdvancedConfigPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

function lastToast() {
  return feedback.toast.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
}

async function choose(label: string, option: string) {
  const input = screen.getByRole('combobox', { name: label })
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  await screen.findByRole('listbox')
  fireEvent.click(await screen.findByRole('option', { name: option }))
  await waitFor(() => assert.equal(screen.queryByRole('listbox'), null))
}

/** A field of the visible form; stake and exposure labels repeat, so a group narrows them. */
function numberInput(label: string, group?: { name: string; index: number }): HTMLInputElement {
  const scope = group ? screen.getAllByRole('group', { name: group.name })[group.index] : document.body
  return within(scope).getByRole('textbox', { name: label }) as HTMLInputElement
}

function setNumber(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } })
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))
}

describe('SportsAdvancedConfigPage', () => {
  test('the page frame, the guard, the tabs and the sport picker before a choice', async () => {
    renderPage()
    assert.deepStrictEqual(feedback.guard.calls[0].required, [{ domain: 'config.sports-advanced', actions: ['view'] }])
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Advanced Sports Configuration' }))
    assert.ok(screen.queryByText('System') === null)
    assert.ok(screen.queryByText('Configure detailed settings per sport and league. These settings override global defaults.') === null)
    const back = screen.getByRole('link', { name: 'Back to Basic Config' })
    assert.equal(back.getAttribute('href'), '/config/app-configuration?tab=sports')

    const tabs = screen.getAllByRole('tab')
    assert.deepStrictEqual(
      tabs.map((tab) => [tab.textContent, tab.getAttribute('aria-selected')]),
      [
        ['Sport-Level Settings', 'true'],
        ['League-Level Settings', 'false'],
      ],
    )
    assert.ok(screen.getByRole('tabpanel', { name: 'Sport-Level Settings' }))
    assert.ok(screen.getByText('Please select a sport to configure its settings'))
    const sport = screen.getByRole('combobox', { name: 'Select Sport' }) as HTMLInputElement
    assert.equal(sport.placeholder, 'Select a sport to configure')
    assert.equal(sport.getAttribute('aria-required'), 'true')
    await waitFor(() => assert.equal(named('ListSports').length, 1))
    assert.deepStrictEqual(named('ListLeagues'), [], 'no leagues before a sport is chosen')
    assert.deepStrictEqual(named('GetSportSettings'), [])
    assert.equal(screen.queryByRole('button', { name: 'Save Settings' }), null)
  })

  test('a denied caller starts no query', async () => {
    feedback.guard.allowed = false
    renderPage()
    assert.ok(screen.getByRole('alert'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepStrictEqual(calls, [])
  })

  test('a chosen sport loads its settings, then the form mounts seeded with them', async () => {
    // Keep the response pending until the loading-state assertions finish,
    // independently of scheduler/load during the full parallel suite.
    heldOperations.add('GetSportSettings')
    renderPage()
    await choose('Select Sport', 'Cricket')
    assert.ok(screen.getByText('Configuring: Cricket'))
    assert.ok(screen.getByText('Loading sport settings'), 'no empty form while the record loads')
    assert.equal(screen.queryByRole('button', { name: 'Save Settings' }), null)
    await waitFor(() => assert.ok(releaseResponse.GetSportSettings))
    act(() => releaseResponse.GetSportSettings!())
    await screen.findByRole('button', { name: 'Save Settings' })

    const [query] = named('GetSportSettings')
    assert.deepStrictEqual(query.variables, { sportId: '1', tierId: 'default' })
    assert.ok(query.document.includes('sportSettings(sportId: $sportId, tierId: $tierId)'))

    assert.equal(numberInput('Exchange Commission').value, '2.5')
    assert.equal(numberInput('Bookmaker Commission').value, '0')
    assert.equal(numberInput('Fancy Commission').value, '')
    assert.equal(numberInput('Fancy Commission').placeholder, '2.0')
    assert.equal(numberInput('Minimum Stake', { name: 'Exchange Markets', index: 0 }).value, '100')
    assert.equal(numberInput('Total Cap', { name: 'Exchange Markets', index: 1 }).value, '10000000')
    assert.equal(numberInput('Exchange Delay').value, '5')
    assert.equal(numberInput('Exchange Minimum Odds').value, '1.01')
    assert.equal(numberInput('Alert Rate Limit (per hour)').value, '10')
    assert.equal(screen.getAllByText('â‚¹').length, 15, 'six stakes and nine exposure limits carry the currency')
    assert.equal(screen.getAllByText('%').length, 3)
    assert.equal(screen.getByRole('switch', { name: 'Cashout Active' }).getAttribute('aria-checked'), 'true')
    assert.equal(screen.getByRole('switch', { name: 'Alert on Risk Breach' }).getAttribute('aria-checked'), 'false')
    assert.equal((screen.getByRole('combobox', { name: 'Risk Level' }) as HTMLSelectElement).value, 'medium')
    const channel = screen.getByRole('combobox', { name: 'Alert Channel' }) as HTMLSelectElement
    assert.equal(channel.value, 'telegram', 'a stored value without an option is still shown')
    assert.deepStrictEqual(
      within(channel).getAllByRole('option').map((option) => option.textContent),
      ['Select channel', 'Email', 'SMS', 'Webhook', 'telegram'],
    )
    for (const title of [
      'Commission Rates (%)',
      'Stake Limits',
      'Exposure Limits',
      'Bet Delays & Cooldowns (seconds)',
      'Odds Limits',
      'Risk Settings',
      'Other Settings',
    ]) {
      assert.ok(screen.getByRole('group', { name: title }), title)
    }
  })

  test('saving sends the legacy input with every stored and edited value, toasts once and refetches', async () => {
    renderPage()
    await choose('Select Sport', 'Cricket')
    await screen.findByRole('button', { name: 'Save Settings' })
    setNumber(numberInput('Exchange Commission'), '3')
    setNumber(numberInput('Fancy Commission'), '1.5')
    setNumber(numberInput('Exchange Delay'), '')
    fireEvent.click(screen.getByRole('switch', { name: 'Alert on Risk Breach' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Risk Level' }), { target: { value: 'high' } })
    sportRecord = { ...storedSettings(), exchangeCommission: 3, fancyCommission: 1.5, exchangeDelay: null }
    save()

    await waitFor(() => assert.equal(named('UpsertSportSettings').length, 1))
    const [upsert] = named('UpsertSportSettings')
    assert.deepStrictEqual(upsert.variables, {
      input: {
        sportIds: ['1'],
        tierId: 'default',
        mode: 'overwrite',
        ...storedSettings(),
        exchangeCommission: 3,
        fancyCommission: 1.5,
        exchangeDelay: null,
        alertOnBreach: true,
        riskLevel: 'high',
      },
    })
    await waitFor(() =>
      assert.deepStrictEqual(lastToast(), { message: 'Settings saved for 1 sport(s)', tone: 'ok', duration: 3000 }),
    )
    await waitFor(() => assert.equal(named('GetSportSettings').length, 2))
    assert.equal(feedback.toast.mock.calls.length, 1, 'no second "Settings saved successfully" toast')
    await waitFor(() => assert.equal(numberInput('Exchange Commission').value, '3'))
    assert.equal(numberInput('Exchange Delay').value, '')
  })

  test('nothing stored: an empty form whose save sends only the target', async () => {
    sportRecord = null
    renderPage()
    await choose('Select Sport', 'Soccer')
    await screen.findByRole('button', { name: 'Save Settings' })
    assert.equal(numberInput('Exchange Commission').value, '')
    assert.equal(screen.getByRole('switch', { name: 'Cashout Active' }).getAttribute('aria-checked'), 'false')
    assert.equal((screen.getByRole('combobox', { name: 'Risk Level' }) as HTMLSelectElement).value, '')
    save()
    await waitFor(() => assert.equal(named('UpsertSportSettings').length, 1))
    assert.deepStrictEqual(named('UpsertSportSettings')[0].variables, {
      input: { sportIds: ['2'], tierId: 'default', mode: 'overwrite' },
    })
  })

  test('the legacy rules stop the save and say why', async () => {
    renderPage()
    await choose('Select Sport', 'Cricket')
    await screen.findByRole('button', { name: 'Save Settings' })
    setNumber(numberInput('Exchange Commission'), '150')
    setNumber(numberInput('Maximum Stake', { name: 'Bookmaker Markets', index: 0 }), '-5')
    save()
    await screen.findByText('Exchange Commission must be between 0-100')
    assert.ok(screen.getByText('Maximum Stake must be minimum 0'))
    assert.ok(screen.getByText('Failed to save settings'))
    assert.ok(screen.getByText('Fix 2 highlighted fields and save again.'))
    assert.equal(named('UpsertSportSettings').length, 0)
    assert.equal(feedback.toast.mock.calls.length, 0)
  })

  test('a Min Stake above its Max Stake is refused on the field before the save (SPO-SETTINGS-MINMAX)', async () => {
    renderPage()
    await choose('Select Sport', 'Cricket')
    await screen.findByRole('button', { name: 'Save Settings' })
    setNumber(numberInput('Minimum Stake', { name: 'Exchange Markets', index: 0 }), '50000')
    setNumber(numberInput('Maximum Stake', { name: 'Exchange Markets', index: 0 }), '10000')
    save()
    await screen.findByText('Exchange Min Stake cannot exceed the Max Stake (10000)')
    assert.equal(numberInput('Minimum Stake', { name: 'Exchange Markets', index: 0 }).getAttribute('aria-invalid'), 'true')
    assert.equal(named('UpsertSportSettings').length, 0, 'nothing reaches the server')
  })

  test('a refused or thrown save toasts its message; Reset restores the loaded values and refetches', async () => {
    renderPage()
    await choose('Select Sport', 'Cricket')
    await screen.findByRole('button', { name: 'Save Settings' })

    sportResult = { success: false, message: null }
    save()
    await waitFor(() =>
      assert.deepStrictEqual(lastToast(), { message: 'Failed to save sport settings', tone: 'error', duration: 3000 }),
    )
    sportResult = new Error('Forbidden: insufficient permissions')
    save()
    await waitFor(() =>
      assert.deepStrictEqual(lastToast(), {
        message: 'Forbidden: insufficient permissions',
        tone: 'error',
        duration: 3000,
      }),
    )
    assert.equal(named('GetSportSettings').length, 1, 'no refetch after a failed save')

    setNumber(numberInput('Exchange Commission'), '9')
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => assert.equal(numberInput('Exchange Commission').value, '2.5'))
    await waitFor(() => assert.equal(named('GetSportSettings').length, 2))
  })

  test('a failed load offers a retry instead of an empty form', async () => {
    respond.GetSportSettings = () => ({ errors: [{ message: 'Sport settings unavailable' }] })
    renderPage()
    await choose('Select Sport', 'Cricket')
    await screen.findByText('Settings could not be loaded')
    assert.ok(screen.getByText('Sport settings unavailable'))
    assert.equal(screen.queryByRole('button', { name: 'Save Settings' }), null)
    respond.GetSportSettings = () => ({
      data: { sportSettings: { __typename: 'SportSettings', sportId: '1', tierId: 'default', ...storedSettings() } },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('button', { name: 'Save Settings' })
    assert.equal(numberInput('Exchange Commission').value, '2.5')
  })

  test('the league tab: leagues load for a sport, a leagueâ€™s settings save, and the sport tab keeps its edits', async () => {
    renderPage()
    await choose('Select Sport', 'Cricket')
    await screen.findByRole('button', { name: 'Save Settings' })
    setNumber(numberInput('Exchange Commission'), '4')

    fireEvent.click(screen.getByRole('tab', { name: 'League-Level Settings' }))
    assert.ok(screen.getByRole('tabpanel', { name: 'League-Level Settings' }))
    assert.ok(screen.getByText('Please select a sport and league to configure settings'))
    const league = screen.getByRole('combobox', { name: 'Select League' }) as HTMLInputElement
    assert.equal(league.disabled, true, 'a league needs a sport first')
    assert.equal(
      (screen.getByRole('combobox', { name: 'Select Sport (to load leagues)' }) as HTMLInputElement).placeholder,
      'Select sport first',
    )

    await choose('Select Sport (to load leagues)', 'Soccer')
    await waitFor(() => assert.deepStrictEqual(named('ListLeagues').map((call) => call.variables), [{ sportId: '2' }]))
    await waitFor(() => assert.equal((screen.getByRole('combobox', { name: 'Select League' }) as HTMLInputElement).disabled, false))
    await choose('Select League', 'Premier League')
    assert.ok(screen.getByText('Configuring: Premier League'))
    await screen.findByRole('button', { name: 'Save Settings' })
    assert.deepStrictEqual(named('GetLeagueSettings')[0].variables, { leagueId: '21', tierId: 'default' })
    assert.equal(numberInput('Exchange Commission').value, '1')
    assert.equal((screen.getByRole('combobox', { name: 'Risk Level' }) as HTMLSelectElement).value, 'low')

    save()
    await waitFor(() => assert.equal(named('UpsertLeagueSettings').length, 1))
    assert.deepStrictEqual(named('UpsertLeagueSettings')[0].variables, {
      leagueIds: ['21'],
      input: { tierId: 'default', ...storedSettings(), exchangeCommission: 1, riskLevel: 'low' },
    })
    await waitFor(() =>
      assert.deepStrictEqual(lastToast(), {
        message: 'League settings saved successfully',
        tone: 'ok',
        duration: 3000,
      }),
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Sport-Level Settings' }))
    assert.equal(numberInput('Exchange Commission').value, '4', 'the unsaved sport edit survived the tab switch')

    fireEvent.click(screen.getByRole('tab', { name: 'League-Level Settings' }))
    await choose('Select Sport (to load leagues)', 'Cricket')
    assert.ok(screen.getByText('Please select a sport and league to configure settings'), 'the league choice resets')
    assert.ok(screen.queryByText('Configuring: Premier League') === null)
  })
})

