/**
 * /config/otp-providers against a mocked GraphQL server (MockedProvider): the exact list query and upsert inputs,
 * the guard, the table cells, client paging, the row switch, the add and edit drawer (provider change, rules,
 * the leave-blank-to-keep rule, Reset, Cancel) and every toast. The mocked server applies each upsert, so a refetch
 * shows what the backend would return. Every credential typed here is an obvious placeholder, and no test prints
 * one.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider, MockLink, type MockedResponse } from '@apollo/client/testing'
import { ApolloLink, Observable } from '@apollo/client'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { OTP_PROVIDERS, UPSERT_OTP_PROVIDER } from '@/lib/graphql/otp'
import OtpProvidersPage from './OtpProvidersPage'
import type { OtpProviderRow } from './otpProvidersModel'

const feedback = vi.hoisted(() => ({
  toast: vi.fn(),
  handleExport: vi.fn(),
  exportOptions: [] as Array<Record<string, unknown>>,
}))
const rbacCalls = vi.hoisted(() => [] as Array<{
  required: Array<{ domain: string; actions: string[] }>
  requireAny?: boolean
}>)
const rbacState = vi.hoisted(() => ({ allowed: true }))

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

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDateTime: (value: string, format?: string) => `${format} @ ${value}`,
  }),
}))

vi.mock('@/shared/hooks/useTableExport', () => ({
  useTableExport: (options: Record<string, unknown>) => {
    feedback.exportOptions.push(options)
    return { exporting: false, handleExport: feedback.handleExport }
  },
}))

type Reply = { success: boolean; message: string | null } | 'throw'

interface ServerState {
  providers: OtpProviderRow[]
  queries: number
  upserts: Array<Record<string, unknown>>
  reply: Reply
}

let server: ServerState

function provider(overrides: Partial<OtpProviderRow>): OtpProviderRow {
  return {
    id: 1,
    provider: 'TWILIO',
    region: null,
    senderId: null,
    templateId: null,
    baseUrl: null,
    active: false,
    priority: 0,
    accountSidMasked: null,
    authTokenMasked: null,
    accessKeyMasked: null,
    secretKeyMasked: null,
    apiKeyMasked: null,
    apiSecretMasked: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

function initialProviders(): OtpProviderRow[] {
  return [
    provider({
      id: 1,
      provider: 'TWILIO',
      senderId: '+14155550123',
      active: true,
      priority: 3,
      accountSidMasked: 'AC••••42',
      authTokenMasked: 'ab••••yz',
      updatedAt: '2026-10-01T10:00:00.000Z',
    }),
    provider({ id: 2, provider: 'MSG91', senderId: 'FLOXIP', templateId: 'TPL-1', priority: 2, apiKeyMasked: 'k1••••9z' }),
    provider({ id: 3, provider: 'AWS_SNS', region: 'ap-south-1', priority: 1 }),
    provider({ id: 4, provider: 'TWO_FACTOR', priority: 0 }),
  ]
}

function queryMock(): MockedResponse {
  const currentServer = server
  return {
    request: { query: OTP_PROVIDERS },
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: () => {
      currentServer.queries += 1
      return {
        data: { otpProviders: currentServer.providers.map((row) => ({ __typename: 'OtpProvider', ...row })) },
      }
    },
  }
}

/** Records every input and applies a successful one, as the backend's upsert would. */
function upsertMock(delay = 0): MockedResponse {
  const currentServer = server
  return {
    request: { query: UPSERT_OTP_PROVIDER },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    delay,
    result: (variables: Record<string, unknown>) => {
      const input = variables.input as Record<string, unknown>
      currentServer.upserts.push(input)
      const reply = currentServer.reply === 'throw' ? { success: false, message: null } : currentServer.reply
      if (reply.success) {
        const existing = currentServer.providers.find((row) => row.provider === input.provider)
        if (input.active === true) currentServer.providers = currentServer.providers.map((row) => ({ ...row, active: false }))
        currentServer.providers = currentServer.providers.map((row) =>
          row.provider === input.provider ? { ...row, ...(input as Partial<OtpProviderRow>) } : row,
        )
        if (!existing) {
          currentServer.providers.push(provider({ ...(input as Partial<OtpProviderRow>), id: currentServer.providers.length + 1 }))
        }
      }
      return { data: { upsertOtpProvider: { __typename: 'MessageResponse', ...reply } } }
    },
  }
}

function throwingUpsertMock(): MockedResponse {
  const currentServer = server
  return {
    request: { query: UPSERT_OTP_PROVIDER },
    variableMatcher: (variables) => {
      currentServer.upserts.push((variables as { input: Record<string, unknown> }).input)
      return true
    },
    error: new Error('Network down'),
  }
}

type HeldUpsert = { release?: () => void }
function renderPage(mocks: MockedResponse[] = [queryMock(), upsertMock()], held?: HeldUpsert) {
  const link = held ? ApolloLink.from([new ApolloLink((operation, forward) => {
    if (operation.operationName !== 'UpsertOtpProvider') return forward(operation)
    return new Observable((observer) => {
      let cancel: (() => void) | undefined
      held.release = () => {
        const subscription = forward(operation).subscribe(observer)
        cancel = () => subscription.unsubscribe()
      }
      return () => { held.release = undefined; cancel?.() }
    })
  }), new MockLink(mocks)]) : undefined
  return render(
    <MockedProvider mocks={mocks} link={link}>
      <MemoryRouter initialEntries={['/config/otp-providers']}>
        <PageEyebrowProvider value="System">
          <OtpProvidersPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function renderLoaded(mocks?: MockedResponse[], held?: HeldUpsert) {
  const view = renderPage(mocks, held)
  await screen.findByRole('switch', { name: 'Twilio active' })
  return view
}

function rowOf(name: string): HTMLElement {
  const table = screen.getByRole('table', { name: 'OTP providers' })
  const cell = within(table).getAllByText(name).find((element) => element.closest('tbody tr'))
  const found = cell?.closest('tr')
  assert.ok(found, `Expected a row for ${name}`)
  return found as HTMLElement
}

function bodyRowCount(): number {
  return within(screen.getByRole('table', { name: 'OTP providers' })).getAllByRole('row').length - 1
}

/** A field by its visible label; a required field's label ends with the decorative asterisk. */
function field(container: HTMLElement, label: string): HTMLInputElement {
  const escaped = label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return within(container).getByLabelText(new RegExp(`^${escaped}\\*?$`)) as HTMLInputElement
}

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } })
}

function toastCalls() {
  return feedback.toast.mock.calls.map((call) => call[0])
}

beforeEach(() => {
  server = { providers: initialProviders(), queries: 0, upserts: [], reply: { success: true, message: 'OTP provider saved' } }
  rbacCalls.length = 0
  rbacState.allowed = true
  feedback.toast.mockReset()
  feedback.handleExport.mockReset()
  feedback.exportOptions.length = 0
})

describe('OtpProvidersPage list', () => {
  test('loads the providers with the legacy header, guard, card copy and every cell', async () => {
    renderPage()

    assert.ok(screen.getByText('Loading...'))
    assert.ok(screen.getByText('Loading OTP providers'))
    assert.ok(screen.queryByRole('navigation', { name: 'Pagination' }) === null)
    assert.ok(screen.queryByRole('button', { name: 'Export Excel' }) === null)
    await screen.findByRole('switch', { name: 'Twilio active' })

    assert.deepStrictEqual(rbacCalls.at(-1), {
      required: [{ domain: 'config.otp-providers', actions: ['view'] }],
      requireAny: undefined,
    })
    assert.equal(server.queries, 1)
    assert.ok(screen.queryByText('System') === null)
    assert.ok(screen.getByRole('heading', { level: 1, name: 'OTP Providers' }))
    assert.ok(screen.queryByText('Manage Twilio, AWS SNS, MSG91, and 2Factor credentials for sending OTPs.') === null)
    assert.ok(screen.getByRole('heading', { level: 2, name: 'OTP Providers List' }))
    assert.ok(screen.getByText('4 providers'))
    assert.equal(bodyRowCount(), 4)

    const headers = within(screen.getByRole('table', { name: 'OTP providers' }))
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
    assert.deepStrictEqual(headers, ['Provider Details', 'Configuration', 'Priority', 'Status', 'Actions'])

    const twilio = rowOf('Twilio')
    assert.equal(within(twilio).getAllByText('Active').length, 2)
    assert.ok(within(twilio).getByText('Sender ID'))
    assert.ok(within(twilio).getByRole('button', { name: 'Copy Sender ID' }))
    assert.ok(within(twilio).getByText('Updated: MMM d, yyyy HH:mm @ 2026-10-01T10:00:00.000Z'))
    assert.ok(within(twilio).getByText('Sender'))
    assert.ok(within(twilio).getByText('Priority: 3'))
    assert.equal(within(twilio).getByRole('switch', { name: 'Twilio active' }).getAttribute('aria-checked'), 'true')
    assert.ok(within(twilio).getByRole('button', { name: 'Edit Twilio' }))

    const msg91 = rowOf('MSG91')
    assert.ok(within(msg91).getByText('Template ID'))
    assert.ok(within(msg91).getByText('Template'))
    assert.ok(within(msg91).getByText('Inactive'))
    assert.ok(within(msg91).queryByText('Updated:', { exact: false }) === null)

    const sns = rowOf('AWS SNS')
    assert.equal(within(sns).getAllByText('ap-south-1').length, 2)
    assert.ok(within(sns).queryByText('Sender ID') === null)

    const twoFactor = rowOf('2Factor')
    assert.ok(within(twoFactor).getByText('No configuration'))
    assert.ok(within(twoFactor).getByText('Priority: 0'))
    assert.equal(within(twoFactor).getByRole('switch', { name: '2Factor active' }).getAttribute('aria-checked'), 'false')

    assert.ok(screen.getByRole('navigation', { name: 'Pagination' }))
    const exportOptions = feedback.exportOptions.at(-1) as {
      data: unknown[]
      filename: string
      sheetName: string
      title: string
      columns: Array<{ header: string }>
    }
    assert.equal(exportOptions.data.length, 4)
    assert.equal(exportOptions.filename, 'OTP-Providers')
    assert.equal(exportOptions.sheetName, 'OTP Providers')
    assert.equal(exportOptions.title, 'OTP Providers — 4 provider(s)')
    assert.deepStrictEqual(exportOptions.columns.map((column) => column.header), [
      'Provider', 'Region', 'Sender ID', 'Template ID', 'Priority', 'Active',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }))
    assert.equal(feedback.handleExport.mock.calls.length, 1)
  })

  test('a denied caller sees the guard and starts no query', async () => {
    rbacState.allowed = false
    renderPage()

    assert.ok(screen.getByRole('alert'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(server.queries, 0)
    assert.ok(screen.queryByRole('heading', { level: 1 }) === null)
  })

  test('an empty list shows the legacy empty copy, with no export and no pager', async () => {
    server.providers = []
    renderPage()

    await screen.findByText('No OTP providers found')
    assert.ok(screen.getByText('0 providers'))
    assert.ok(screen.queryByRole('button', { name: 'Export Excel' }) === null)
    assert.ok(screen.queryByRole('navigation', { name: 'Pagination' }) === null)
  })

  test('pages on the client, ten to a page, and Refresh asks the server again', async () => {
    server.providers = Array.from({ length: 12 }, (_, index) =>
      provider({ id: index + 1, provider: 'MSG91', senderId: `SNDR${index + 1}`, priority: index }),
    )
    renderPage()
    await screen.findAllByText('SNDR1', { selector: 'code' })

    assert.equal(bodyRowCount(), 10)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findAllByText('SNDR12', { selector: 'code' })
    assert.equal(bodyRowCount(), 2)
    assert.equal(server.queries, 1)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.equal(server.queries, 2))
  })
})

describe('OtpProvidersPage row switch', () => {
  test('sends the provider and the next state, busy while it saves, then toasts and refetches', async () => {
    const held: HeldUpsert = {}
    await renderLoaded([queryMock(), upsertMock()], held)

    const toggle = within(rowOf('MSG91')).getByRole('switch', { name: 'MSG91 active' })
    fireEvent.click(toggle)
    await waitFor(() => assert.equal(toggle.getAttribute('aria-busy'), 'true'))
    assert.equal(toggle.getAttribute('aria-disabled'), 'true')
    assert.ok(held.release)
    assert.equal(server.upserts.length, 0)
    held.release()

    await waitFor(() => assert.equal(server.upserts.length, 1))
    assert.deepStrictEqual(server.upserts[0], { provider: 'MSG91', active: true })
    await waitFor(() => assert.deepStrictEqual(toastCalls(), [{ message: 'OTP provider saved', tone: 'ok', duration: 2000 }]))
    await waitFor(() => assert.equal(server.queries, 2))
    await waitFor(() =>
      assert.equal(within(rowOf('MSG91')).getByRole('switch', { name: 'MSG91 active' }).getAttribute('aria-checked'), 'true'),
    )
    assert.equal(within(rowOf('MSG91')).getByRole('switch', { name: 'MSG91 active' }).getAttribute('aria-busy'), null)
  })

  test('a refused toggle and a thrown toggle keep the legacy fallbacks and do not refetch', async () => {
    server.reply = { success: false, message: null }
    const view = await renderLoaded()

    fireEvent.click(within(rowOf('Twilio')).getByRole('switch', { name: 'Twilio active' }))
    await waitFor(() =>
      assert.deepStrictEqual(toastCalls(), [{ message: 'Failed to update provider', tone: 'error', duration: 4000 }]),
    )
    assert.deepStrictEqual(server.upserts[0], { provider: 'TWILIO', active: false })
    assert.equal(server.queries, 1)
    view.unmount()

    feedback.toast.mockReset()
    await renderLoaded([queryMock(), throwingUpsertMock()])
    fireEvent.click(within(rowOf('AWS SNS')).getByRole('switch', { name: 'AWS SNS active' }))
    await waitFor(() => assert.deepStrictEqual(toastCalls(), [{ message: 'Network down', tone: 'error', duration: 5000 }]))
  })
})

describe('OtpProvidersPage drawer', () => {
  test('Add Provider: the legacy defaults and rules, then the exact input, toast, close and refetch', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add OTP Provider: Twilio' })

    assert.ok(within(dialog).getByText('Configure Twilio provider'))
    assert.ok(within(dialog).getByText('New'))
    assert.ok(within(dialog).getByText('Configure provider credentials and settings'))
    const select = within(dialog).getByRole('combobox', { name: 'Provider Type' }) as HTMLSelectElement
    assert.equal(select.value, 'TWILIO')
    assert.equal(select.disabled, false)
    await waitFor(() => assert.ok(document.activeElement === select))
    assert.ok(within(dialog).getByText('Choose the OTP service provider'))
    // Twilio is active already, so a new provider starts inactive, after the highest priority (3).
    assert.equal((within(dialog).getByRole('textbox', { name: 'Priority' }) as HTMLInputElement).value, '4')
    assert.equal(within(dialog).getByRole('switch', { name: 'Active' }).getAttribute('aria-checked'), 'false')
    assert.ok(within(dialog).getByText('Inactive'))
    assert.ok(within(dialog).getByText('Sender IDs, templates, and regions vary per provider'))

    const sender = field(dialog, 'Sender ID / From Number')
    assert.equal(sender.placeholder, '+1XXXXXXXXXX')
    assert.equal(sender.getAttribute('aria-required'), 'true')
    const sid = field(dialog, 'Account SID')
    const token = field(dialog, 'Auth Token')
    for (const secret of [sid, token]) {
      assert.equal(secret.type, 'password')
      assert.equal(secret.getAttribute('autocomplete'), 'new-password')
      assert.equal(secret.getAttribute('aria-required'), 'true')
    }
    assert.equal(sid.placeholder, 'Enter Account SID')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add Provider' }))
    await within(dialog).findByText('Enter Sender ID / From Number')
    assert.ok(within(dialog).getByText('Enter Account SID'))
    assert.ok(within(dialog).getByText('Enter Auth Token'))
    await waitFor(() => assert.ok(document.activeElement === sender))
    assert.equal(server.upserts.length, 0)

    type(sender, ' +14155550199 ')
    type(sid, 'placeholder-sid')
    type(token, 'placeholder-token')
    // The secret is never written into the markup.
    assert.equal(sid.getAttribute('value'), null)
    assert.equal(token.getAttribute('value'), null)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add Provider' }))

    await waitFor(() => assert.equal(server.upserts.length, 1))
    assert.deepStrictEqual(server.upserts[0], {
      provider: 'TWILIO',
      active: false,
      priority: 4,
      senderId: '+14155550199',
      accountSid: 'placeholder-sid',
      authToken: 'placeholder-token',
    })
    await waitFor(() => assert.deepStrictEqual(toastCalls(), [{ message: 'OTP provider saved', tone: 'ok', duration: 3000 }]))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null))
    await waitFor(() => assert.equal(server.queries, 2))
  })

  test('a provider change swaps the fields and clears the ones the new provider does not use', async () => {
    server.providers = initialProviders().map((row) => ({ ...row, active: false }))
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }))
    let dialog = await screen.findByRole('dialog', { name: 'Add OTP Provider: Twilio' })
    assert.equal(within(dialog).getByRole('switch', { name: 'Active' }).getAttribute('aria-checked'), 'true')

    type(field(dialog, 'Sender ID / From Number'), 'OTPMSG')
    type(field(dialog, 'Account SID'), 'placeholder-sid')

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Provider Type' }), { target: { value: 'MSG91' } })
    dialog = await screen.findByRole('dialog', { name: 'Add OTP Provider: MSG91' })
    assert.ok(within(dialog).getByText('Configure MSG91 provider'))
    assert.equal(field(dialog, 'Sender ID').value, 'OTPMSG')
    assert.equal(field(dialog, 'Template ID').placeholder, 'Enter Template ID')
    assert.ok(within(dialog).getByText('MSG91_TEMPLATE_ID'))
    type(field(dialog, 'API Key'), 'placeholder-key')

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Provider Type' }), { target: { value: 'TWO_FACTOR' } })
    dialog = await screen.findByRole('dialog', { name: 'Add OTP Provider: 2Factor' })
    assert.equal(field(dialog, '2Factor API Key').value, 'placeholder-key')
    const number = field(dialog, '2Factor Number')
    assert.equal(number.type, 'text')
    assert.equal(number.placeholder, 'Enter 2Factor Number')

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Provider Type' }), { target: { value: 'AWS_SNS' } })
    dialog = await screen.findByRole('dialog', { name: 'Add OTP Provider: AWS SNS' })
    assert.equal(field(dialog, 'Region').placeholder, 'ap-south-1')
    assert.ok(within(dialog).getByText('AWS_SNS_REGION'))
    assert.equal(field(dialog, 'Access Key ID').value, '')

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Provider Type' }), { target: { value: 'TWILIO' } })
    dialog = await screen.findByRole('dialog', { name: 'Add OTP Provider: Twilio' })
    assert.equal(field(dialog, 'Account SID').value, '')
    assert.equal(field(dialog, 'Sender ID / From Number').value, 'OTPMSG')
  })

  test('Edit keeps stored credentials unless a new one is typed; emptied delivery fields are cleared', async () => {
    await renderLoaded()
    fireEvent.click(within(rowOf('MSG91')).getByRole('button', { name: 'Edit MSG91' }))
    let dialog = await screen.findByRole('dialog', { name: 'Edit OTP Provider: MSG91' })

    assert.ok(within(dialog).getByText('Update provider configuration'))
    assert.ok(within(dialog).getByText('Update credentials to rotate keys; leave blank to keep existing values'))
    assert.equal((within(dialog).getByRole('combobox', { name: 'Provider Type' }) as HTMLSelectElement).disabled, true)
    const priority = within(dialog).getByRole('textbox', { name: 'Priority' }) as HTMLInputElement
    await waitFor(() => assert.ok(document.activeElement === priority))
    assert.equal(field(dialog, 'Sender ID').value, 'FLOXIP')
    assert.equal(field(dialog, 'Sender ID').getAttribute('aria-required'), null)
    const apiKey = field(dialog, 'API Key')
    assert.equal(apiKey.placeholder, '••••••••')
    assert.equal(apiKey.getAttribute('aria-required'), null)
    const help = document.getElementById(`${apiKey.id}-help`)
    assert.ok(help)
    assert.equal(help.textContent, 'StoredLeave blank to keep existing valueMSG91_API_KEY')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.equal(server.upserts.length, 1))
    assert.deepStrictEqual(server.upserts[0], {
      provider: 'MSG91',
      active: false,
      priority: 2,
      senderId: 'FLOXIP',
      templateId: 'TPL-1',
    })
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null))

    fireEvent.click(within(rowOf('MSG91')).getByRole('button', { name: 'Edit MSG91' }))
    dialog = await screen.findByRole('dialog', { name: 'Edit OTP Provider: MSG91' })
    type(field(dialog, 'API Key'), 'placeholder-key')
    type(field(dialog, 'API Key'), '')
    type(field(dialog, 'Template ID'), '')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.equal(server.upserts.length, 2))
    assert.deepStrictEqual(server.upserts[1], {
      provider: 'MSG91',
      active: false,
      priority: 2,
      senderId: 'FLOXIP',
      templateId: null,
    })
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null))

    fireEvent.click(within(rowOf('MSG91')).getByRole('button', { name: 'Edit MSG91' }))
    dialog = await screen.findByRole('dialog', { name: 'Edit OTP Provider: MSG91' })
    type(field(dialog, 'API Key'), 'placeholder-new-key')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.equal(server.upserts.length, 3))
    assert.equal(server.upserts[2]?.apiKey, 'placeholder-new-key')
  })

  test('a fractional priority sent past the blur clamp is refused inline, not by GraphQL', async () => {
    await renderLoaded()
    fireEvent.click(within(rowOf('AWS SNS')).getByRole('button', { name: 'Edit AWS SNS' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit OTP Provider: AWS SNS' })
    const priority = within(dialog).getByRole('textbox', { name: 'Priority' }) as HTMLInputElement
    fireEvent.focus(priority)
    type(priority, '1.5')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }))
    await within(dialog).findByText('Enter a whole number')
    assert.equal(server.upserts.length, 0)
  })

  test('Reset returns the form to the values it opened with; Cancel closes without saving', async () => {
    await renderLoaded()
    fireEvent.click(within(rowOf('MSG91')).getByRole('button', { name: 'Edit MSG91' }))
    let dialog = await screen.findByRole('dialog', { name: 'Edit OTP Provider: MSG91' })

    const priority = within(dialog).getByRole('textbox', { name: 'Priority' }) as HTMLInputElement
    fireEvent.focus(priority)
    type(priority, '9')
    fireEvent.blur(priority)
    type(field(dialog, 'Sender ID'), 'NEWID')
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Active' }))
    assert.ok(within(dialog).getByText('Active'))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
    await waitFor(() => assert.equal(field(dialog, 'Sender ID').value, 'FLOXIP'))
    assert.equal(priority.value, '2')
    assert.equal(within(dialog).getByRole('switch', { name: 'Active' }).getAttribute('aria-checked'), 'false')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null))
    assert.equal(server.upserts.length, 0)

    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }))
    dialog = await screen.findByRole('dialog', { name: 'Add OTP Provider: Twilio' })
    type(field(dialog, 'Account SID'), 'placeholder-sid')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null))
    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }))
    dialog = await screen.findByRole('dialog', { name: 'Add OTP Provider: Twilio' })
    assert.equal(field(dialog, 'Account SID').value, '')
    assert.equal(server.upserts.length, 0)
  })

  test('a refused save and a thrown save keep the drawer open with the legacy error toasts', async () => {
    server.reply = { success: false, message: null }
    const view = await renderLoaded()
    fireEvent.click(within(rowOf('Twilio')).getByRole('button', { name: 'Edit Twilio' }))
    let dialog = await screen.findByRole('dialog', { name: 'Edit OTP Provider: Twilio' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      assert.deepStrictEqual(toastCalls(), [{ message: 'Failed to save provider', tone: 'error', duration: 5000 }]),
    )
    assert.ok(screen.getByRole('dialog', { name: 'Edit OTP Provider: Twilio' }))
    assert.equal(server.queries, 1)
    view.unmount()

    feedback.toast.mockReset()
    await renderLoaded([queryMock(), throwingUpsertMock()])
    fireEvent.click(within(rowOf('Twilio')).getByRole('button', { name: 'Edit Twilio' }))
    dialog = await screen.findByRole('dialog', { name: 'Edit OTP Provider: Twilio' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.deepStrictEqual(toastCalls(), [{ message: 'Network down', tone: 'error', duration: 5000 }]))
    assert.ok(screen.getByRole('dialog', { name: 'Edit OTP Provider: Twilio' }))
  })
})

