/**
 * /payments/pg-settings (WeLivePay v2) against a mocked GraphQL server (MockedProvider): the guard, the payment
 * whitelabel a Super Admin must select first, the stored settings in the form, the live gateway list, the exact
 * save input (merchant key only when typed), the toasts and refetch, the key cleared after a save attempt, the
 * required name and deposit floor, both webhook URLs with copy and regenerate, and unsaved edits surviving a
 * regenerate.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { REGENERATE_PG_WEBHOOK_TOKEN, UPSERT_PG_SETTINGS, WELIVEPAY_AVAILABLE_GATEWAYS, WHITELABEL_PG_SETTINGS } from '@/lib/graphql/pgSettings'
import PgSettingsPage from './PgSettingsPage'

const feedback = vi.hoisted(() => ({ toast: vi.fn(), confirm: vi.fn() }))
const rbacCalls = vi.hoisted(() => [] as Array<{
  required: Array<{ domain: string; actions: string[] }>
  requireAny?: boolean
}>)
const rbacState = vi.hoisted(() => ({ allowed: true }))
/** A whitelabel admin by default; a test may turn it into a Super Admin who has not selected a site. */
const scopeState = vi.hoisted(() => ({ selectionRequired: false }))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({
    required,
    requireAny,
    children,
  }: {
    required: Array<{ domain: string; actions: string[] }>
    requireAny?: boolean
    children: ReactNode
  }) => {
    rbacCalls.push({ required, requireAny })
    return rbacState.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('./usePaymentWhitelabelScope', () => ({
  usePaymentWhitelabelScope: () => ({
    key: scopeState.selectionRequired ? 'admin-1:core:' : 'admin-1:floxi',
    superAdmin: scopeState.selectionRequired,
    selectionRequired: scopeState.selectionRequired,
    expectedTenant: null,
    readOnly: false,
    isCurrent: () => true,
  }),
}))

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))
// The confirmation is accepted at once: its options are checked, then its action runs as ConfirmHost would.
vi.mock('@/ui/components/confirm', () => ({ confirm: feedback.confirm }))

interface Settings {
  enabled: boolean
  payinGateway: string
  payoutEnabled: boolean
  payoutGateway: string
  minPayout: number | null
  maxPayout: number | null
  displayName: string
  hasSecretSiteKey: boolean
  secretSiteKeyMasked: string | null
  webhookUrl: string
  payoutWebhookUrl: string
  minDeposit: number | null
  maxDeposit: number | null
  redirectSuccessUrl: string | null
  redirectFailureUrl: string | null
}

interface ServerState {
  settings: Settings
  queries: number
  gatewayQueries: number
  saves: Array<{ input: Record<string, unknown> }>
  regenerations: number
}

let server: ServerState

function payload() {
  return { __typename: 'WhitelabelPgSettings', id: 'pg-1', ...server.settings, updatedAt: `2026-10-0${server.queries + 1}T10:00:00.000Z` }
}

function queryMock(): MockedResponse {
  return {
    request: { query: WHITELABEL_PG_SETTINGS },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      server.queries += 1
      return {
        data: {
          whitelabelPgSettings: { ...payload(), tenant: 'floxi', provider: 'WELIVEPAY' },
        },
      }
    },
  }
}

function gatewaysMock(): MockedResponse {
  return {
    request: { query: WELIVEPAY_AVAILABLE_GATEWAYS },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      server.gatewayQueries += 1
      return {
        data: {
          welivepayAvailableGateways: {
            __typename: 'WelivepayAvailableGateways',
            payin: [
              { __typename: 'WelivepayGatewayOption', code: 'IRISPAY', key: 'irispay', label: 'Iris Pay (Payin)' },
              { __typename: 'WelivepayGatewayOption', code: 'QPC', key: 'qpc', label: 'QuickPayCash (Payin)' },
            ],
            payout: [{ __typename: 'WelivepayGatewayOption', code: 'QPC', key: 'qpc_payout', label: 'QuickPayCash (Payout)' }],
          },
        },
      }
    },
  }
}

function saveMock(): MockedResponse {
  return {
    request: { query: UPSERT_PG_SETTINGS },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      const { input } = variables as { input: Record<string, unknown> }
      server.saves.push({ input })
      server.settings = {
        ...server.settings,
        enabled: input.enabled as boolean,
        payinGateway: input.payinGateway as string,
        payoutEnabled: input.payoutEnabled as boolean,
        payoutGateway: input.payoutGateway as string,
        minPayout: input.minPayout as number | null,
        maxPayout: input.maxPayout as number | null,
        displayName: input.displayName as string,
        minDeposit: input.minDeposit as number | null,
        maxDeposit: input.maxDeposit as number | null,
        redirectSuccessUrl: input.redirectSuccessUrl as string | null,
        redirectFailureUrl: input.redirectFailureUrl as string | null,
        ...(input.secretSiteKey ? { hasSecretSiteKey: true, secretSiteKeyMasked: 'sk••••23' } : {}),
      }
      return { data: { upsertWhitelabelPgSettings: payload() } }
    },
  }
}

function failingSaveMock(message: string): MockedResponse {
  return {
    request: { query: UPSERT_PG_SETTINGS },
    variableMatcher: (variables) => {
      server.saves.push(variables as { input: Record<string, unknown> })
      return true
    },
    error: new Error(message),
  }
}

function regenerateMock(): MockedResponse {
  return {
    request: { query: REGENERATE_PG_WEBHOOK_TOKEN },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      server.regenerations += 1
      const base = `https://api.example.test/wlp/new${server.regenerations}`
      server.settings = { ...server.settings, webhookUrl: base, payoutWebhookUrl: `${base}/payout` }
      return {
        data: {
          regeneratePgWebhookToken: {
            __typename: 'WhitelabelPgSettings', id: 'pg-1', webhookUrl: server.settings.webhookUrl, payoutWebhookUrl: server.settings.payoutWebhookUrl,
          },
        },
      }
    },
  }
}

function failingRegenerateMock(): MockedResponse {
  return { request: { query: REGENERATE_PG_WEBHOOK_TOKEN }, error: new Error('Not allowed') }
}

function renderPage(mocks: MockedResponse[] = [queryMock(), gatewaysMock(), saveMock(), regenerateMock()]) {
  return render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter>
        <PageEyebrowProvider value="Payment operations">
          <PgSettingsPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

function textbox(name: RegExp) {
  return screen.getByRole('textbox', { name }) as HTMLInputElement
}

function secretInput() {
  return screen.getByLabelText('Merchant API Key') as HTMLInputElement
}

function payinSwitch() {
  return screen.getByRole('switch', { name: 'Enable WeLivePay pay-in' })
}

async function loaded() {
  await screen.findByRole('switch', { name: 'Enable WeLivePay pay-in' })
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save PG Settings' }))
}

/** What the DOM shows in the pay-in switch and the three inputs the stored settings fill; null before the form mounts. */
function formOnScreen() {
  const toggle = document.querySelector('[role="switch"]')
  if (!toggle) return null
  const input = (name: string) => (document.querySelector(`input[name="${name}"]`) as HTMLInputElement).value
  return {
    enabled: toggle.getAttribute('aria-checked'),
    displayName: input('displayName'),
    minDeposit: input('minDeposit'),
    maxDeposit: input('maxDeposit'),
  }
}

/**
 * Calls back once, on the DOM commit that first shows the form. MutationObserver callbacks are microtasks, so
 * this runs before React renders again (its follow-up renders are scheduler tasks).
 */
function onFirstFormCommit(callback: (form: NonNullable<ReturnType<typeof formOnScreen>>) => void) {
  const observer = new MutationObserver(() => {
    const form = formOnScreen()
    if (!form) return
    observer.disconnect()
    callback(form)
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })
  return observer
}

const STORED_INPUT = {
  enabled: true,
  payinGateway: 'IRISPAY',
  payoutEnabled: false,
  payoutGateway: 'AUTO',
  minPayout: null,
  maxPayout: null,
  displayName: 'UPI (Instant)',
  minDeposit: 100,
  maxDeposit: 100000,
  redirectSuccessUrl: 'https://floxi.example.test/deposit',
  redirectFailureUrl: null,
}

beforeEach(() => {
  server = {
    settings: {
      enabled: true,
      payinGateway: 'IRISPAY',
      payoutEnabled: false,
      payoutGateway: 'AUTO',
      minPayout: null,
      maxPayout: null,
      displayName: 'UPI (Instant)',
      hasSecretSiteKey: true,
      secretSiteKeyMasked: 'ab••••yz',
      webhookUrl: 'https://api.example.test/wlp/abc123',
      payoutWebhookUrl: 'https://api.example.test/wlp/abc123/payout',
      minDeposit: 100,
      maxDeposit: 100000,
      redirectSuccessUrl: 'https://floxi.example.test/deposit',
      redirectFailureUrl: null,
    },
    queries: 0,
    gatewayQueries: 0,
    saves: [],
    regenerations: 0,
  }
  rbacCalls.length = 0
  rbacState.allowed = true
  scopeState.selectionRequired = false
  feedback.toast.mockReset()
  feedback.confirm.mockReset()
  feedback.confirm.mockImplementation(async (options: { onConfirm?: () => Promise<void> }) => { await options.onConfirm?.(); return true })
})

describe('PgSettingsPage', () => {
  test('loads the stored settings and the live gateway list into the form, with the guard', async () => {
    renderPage()
    assert.ok(screen.getByText('Loading PG settings'))
    await loaded()

    assert.deepStrictEqual(rbacCalls.at(-1), {
      required: [{ domain: 'payments.pgsettings', actions: ['view'] }],
      requireAny: undefined,
    })
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Payment Gateway (PG) Settings' }))
    assert.ok(screen.getByText('Whitelabel: floxi'))
    assert.ok(screen.queryByText('Payment operations') === null)
    assert.equal(payinSwitch().getAttribute('aria-checked'), 'true')
    assert.equal(screen.getByRole('switch', { name: 'Enable WeLivePay payouts' }).getAttribute('aria-checked'), 'false')
    assert.equal(textbox(/^Display Name/).value, 'UPI (Instant)')
    assert.equal(secretInput().value, '')
    assert.equal(secretInput().type, 'password')
    assert.equal(secretInput().getAttribute('placeholder'), '•••• (unchanged)')
    assert.equal(secretInput().getAttribute('autocomplete'), 'new-password')
    assert.ok(screen.getByText('Current: ab••••yz. Leave blank to keep unchanged.'))
    assert.equal(textbox(/^Min Deposit/).value, '100')
    assert.equal(textbox(/^Max Deposit/).value, '1,00,000')
    assert.equal(textbox(/^Checkout Return URL/).value, 'https://floxi.example.test/deposit')
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Webhook URLs' }))
    assert.equal(textbox(/^Pay-in webhook URL/).value, 'https://api.example.test/wlp/abc123')
    assert.equal(textbox(/^Payout webhook URL/).value, 'https://api.example.test/wlp/abc123/payout')
    assert.equal(textbox(/^Pay-in webhook URL/).readOnly, true)
    assert.equal(screen.getByRole('link', { name: 'Merchant API guide (opens in a new tab)' }).getAttribute('href'), 'https://welivepay.in/docs/')

    await waitFor(() => assert.ok(screen.getByText('WeLivePay lists 2 pay-in and 1 payout gateway(s) as assigned and active for this project.')))
    const payin = screen.getByRole('combobox', { name: /^Pay-in Gateway/ }) as HTMLSelectElement
    assert.equal(payin.value, 'IRISPAY')
    assert.deepStrictEqual([...payin.options].map((option) => option.textContent), ['Iris Pay (Payin)', 'QuickPayCash (Payin)'])
    const payout = screen.getByRole('combobox', { name: /^Payout Gateway/ }) as HTMLSelectElement
    assert.deepStrictEqual([...payout.options].map((option) => option.value), ['AUTO', 'QPC'])
  })

  test('a Super Admin without a selected whitelabel is asked to select one, and nothing is queried', async () => {
    scopeState.selectionRequired = true
    renderPage()
    assert.ok(screen.getByText('Select a whitelabel'))
    assert.ok(screen.getByText('Switch to Whitelabel mode and select the site whose payment gateway you want to configure.'))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    assert.equal(server.queries, 0)
    assert.equal(screen.queryByRole('switch', { name: 'Enable WeLivePay pay-in' }), null)
  })

  test('the form first appears with the stored settings already in it', async () => {
    // The page used to mount the form empty and fill it from an effect, so the first form on screen was empty
    // and the limits filled up to two renders later.
    let first: ReturnType<typeof formOnScreen> = null
    const observer = onFirstFormCommit((form) => {
      first = form
    })
    try {
      renderPage()
      await loaded()
    } finally {
      observer.disconnect()
    }
    assert.deepStrictEqual(first, { enabled: 'true', displayName: 'UPI (Instant)', minDeposit: '100', maxDeposit: '1,00,000' })
  })

  test('a save sent the moment the form appears carries the stored values, not nulls', async () => {
    const observer = onFirstFormCommit(() => {
      fireEvent.submit(document.querySelector('form') as HTMLFormElement)
    })
    try {
      renderPage()
      await loaded()
      await waitFor(() => assert.equal(server.saves.length, 1))
    } finally {
      observer.disconnect()
    }
    assert.deepStrictEqual(server.saves[0]?.input, STORED_INPUT)
    await waitFor(() => assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], { message: 'PG settings saved', tone: 'ok' }))
  })

  test('without a key: says none is set and does not ask WeLivePay for gateways', async () => {
    server.settings = { ...server.settings, hasSecretSiteKey: false, secretSiteKeyMasked: null }
    renderPage()
    await loaded()
    assert.ok(screen.getByText('Not set yet.'))
    assert.equal(secretInput().getAttribute('placeholder'), 'Paste your WeLivePay project key')
    assert.ok(screen.getByText('Save the merchant API key to load the gateways WeLivePay has assigned to this project.'))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    assert.equal(server.gatewayQueries, 0)
  })

  test('starts no query when the guard denies access', async () => {
    rbacState.allowed = false
    renderPage()
    assert.match(screen.getByRole('alert').textContent ?? '', /Access denied/)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    assert.equal(server.queries, 0)
  })

  test('saves gateways, payouts and a trimmed key in input order, then toasts, refetches and clears the key', async () => {
    renderPage()
    await loaded()
    await waitFor(() => assert.equal(server.gatewayQueries, 1))
    fireEvent.click(payinSwitch())
    fireEvent.change(textbox(/^Display Name/), { target: { value: 'UPI Fast' } })
    fireEvent.change(screen.getByRole('combobox', { name: /^Pay-in Gateway/ }), { target: { value: 'QPC' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Enable WeLivePay payouts' }))
    fireEvent.change(textbox(/^Max Payout/), { target: { value: '50000' } })
    fireEvent.change(secretInput(), { target: { value: '  sk_live_123  ' } })
    fireEvent.change(textbox(/^Min Deposit/), { target: { value: '' } })
    fireEvent.change(textbox(/^Checkout Return URL/), { target: { value: '' } })
    save()

    await waitFor(() => assert.equal(server.saves.length, 1))
    const { input } = server.saves[0] as { input: Record<string, unknown> }
    assert.deepStrictEqual(Object.keys(input), [
      'enabled', 'payinGateway', 'payoutEnabled', 'payoutGateway', 'minPayout', 'maxPayout',
      'displayName', 'minDeposit', 'maxDeposit', 'redirectSuccessUrl', 'redirectFailureUrl', 'secretSiteKey',
    ])
    assert.deepStrictEqual(input, {
      ...STORED_INPUT,
      enabled: false,
      payinGateway: 'QPC',
      payoutEnabled: true,
      maxPayout: 50000,
      displayName: 'UPI Fast',
      minDeposit: null,
      redirectSuccessUrl: null,
      secretSiteKey: 'sk_live_123',
    })
    await waitFor(() => assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], { message: 'PG settings saved', tone: 'ok' }))
    await waitFor(() => assert.equal(server.queries, 2, 'refetched after the save'))
    await waitFor(() => assert.equal(secretInput().value, ''))
    await waitFor(() => assert.ok(screen.getByText('Current: sk••••23. Leave blank to keep unchanged.')))
    await waitFor(() => assert.equal(server.gatewayQueries, 2, 'a replaced key reloads the gateways'))
    assert.equal(textbox(/^Display Name/).value, 'UPI Fast')
    assert.equal(payinSwitch().getAttribute('aria-checked'), 'false')
  })

  test('requires a display name and omits a blank key', async () => {
    renderPage()
    await loaded()
    fireEvent.change(textbox(/^Display Name/), { target: { value: '' } })
    save()
    assert.ok(await screen.findByText('Required'))
    await waitFor(() => assert.ok(document.activeElement === textbox(/^Display Name/), 'the name is focused'))
    assert.equal(server.saves.length, 0)

    fireEvent.change(textbox(/^Display Name/), { target: { value: 'UPI' } })
    fireEvent.change(secretInput(), { target: { value: '   ' } })
    save()
    await waitFor(() => assert.equal(server.saves.length, 1))
    assert.equal('secretSiteKey' in (server.saves[0]?.input ?? {}), false)
  })

  test('names a deposit limit left below 10 and a payout minimum above the maximum instead of sending them', async () => {
    renderPage()
    await loaded()
    fireEvent.change(textbox(/^Min Deposit/), { target: { value: '5' } })
    fireEvent.change(textbox(/^Min Payout/), { target: { value: '900' } })
    fireEvent.change(textbox(/^Max Payout/), { target: { value: '100' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save PG Settings' }).closest('form') as HTMLFormElement)
    assert.ok(await screen.findByText('Value must be at least 10'))
    assert.ok(await screen.findByText('Min payout must not exceed max payout'))
    assert.equal(server.saves.length, 0)
  })

  test('a failed save shows its message and still clears the key', async () => {
    renderPage([queryMock(), gatewaysMock(), failingSaveMock('Invalid secret site key'), regenerateMock()])
    await loaded()
    fireEvent.change(secretInput(), { target: { value: 'sk_bad' } })
    save()

    await waitFor(() => assert.deepStrictEqual(
      feedback.toast.mock.calls[0]?.[0],
      { message: 'Invalid secret site key', tone: 'error' },
    ))
    await waitFor(() => assert.equal(secretInput().value, ''))
    assert.equal(server.queries, 1, 'no refetch after a failure')
  })

  test('copies the pay-in webhook URL and regenerates both without losing unsaved edits', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage()
    await loaded()

    fireEvent.click(screen.getByRole('button', { name: 'Copy pay-in webhook URL' }))
    await waitFor(() => assert.ok(screen.getByText('Pay-in webhook URL copied')))
    assert.deepStrictEqual(writeText.mock.calls, [['https://api.example.test/wlp/abc123']])

    fireEvent.change(textbox(/^Display Name/), { target: { value: 'Unsaved name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate webhook URLs' }))
    const asked = feedback.confirm.mock.calls[0]?.[0] as { title: string; tone: string; confirmLabel: string }
    assert.deepStrictEqual([asked.title, asked.tone, asked.confirmLabel], ['Regenerate the webhook URLs?', 'danger', 'Regenerate'])
    await waitFor(() => assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], { message: 'Webhook token regenerated', tone: 'ok' }))
    await waitFor(() => assert.equal(textbox(/^Pay-in webhook URL/).value, 'https://api.example.test/wlp/new1'))
    await waitFor(() => assert.equal(textbox(/^Payout webhook URL/).value, 'https://api.example.test/wlp/new1/payout'))
    assert.equal(textbox(/^Display Name/).value, 'Unsaved name')
  })

  test('a failed regenerate shows its message', async () => {
    renderPage([queryMock(), gatewaysMock(), saveMock(), failingRegenerateMock()])
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate webhook URLs' }))
    await waitFor(() => assert.deepStrictEqual(feedback.toast.mock.calls[0]?.[0], { message: 'Not allowed', tone: 'error' }))
  })

  test('a cancelled regenerate keeps the webhook URLs', async () => {
    feedback.confirm.mockImplementation(async () => false)
    renderPage()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate webhook URLs' }))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    assert.equal(server.regenerations, 0)
    assert.equal(textbox(/^Pay-in webhook URL/).value, 'https://api.example.test/wlp/abc123')
  })

  test('the live summary shows the stored state, and Discard returns the form to it', async () => {
    renderPage()
    await loaded()
    const live = screen.getByRole('region', { name: 'Live configuration' })
    assert.ok(within(live).getByText('On'))
    assert.ok(within(live).getByText('Off'), 'payouts are off')
    assert.ok(within(live).getByText('Saved'))
    assert.ok(within(live).getByText('1 of 2 set'))
    assert.match(live.textContent ?? '', /100.+1,00,000/)
    await waitFor(() => assert.ok(within(live).getByText('Iris Pay (Payin)')))
    const discard = screen.getByRole('button', { name: 'Discard' }) as HTMLButtonElement
    assert.equal(discard.disabled, true)
    assert.ok(screen.getByText('Settings are up to date'))
    fireEvent.change(textbox(/^Display Name/), { target: { value: 'Changed' } })
    fireEvent.click(payinSwitch())
    assert.ok(screen.getByText('Unsaved changes'))
    assert.ok(within(live).getByText('On'), 'the summary is the saved state, not the draft')
    fireEvent.click(discard)
    assert.equal(textbox(/^Display Name/).value, 'UPI (Instant)')
    assert.equal(payinSwitch().getAttribute('aria-checked'), 'true')
  })

  test('the key can be shown and hidden', async () => {
    renderPage()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Show merchant API key' }))
    assert.equal(secretInput().type, 'text')
    fireEvent.click(screen.getByRole('button', { name: 'Hide merchant API key' }))
    assert.equal(secretInput().type, 'password')
  })
})
