/**
 * /bonuses against a mocked GraphQL server (MockedProvider + MemoryRouter): the exact list, preview,
 * distribute, delete and status documents and their variables, the guard, statistics, the table cells,
 * client-side paging, filters reaching the query, every confirmation and its mutation, the distribute
 * dialog in each of its states, navigation, export and the loading and empty states.
 *
 * The page's documents are private to its module, so the mocks are built with graphql's parse() from
 * the same text; a changed page document stops matching and fails these tests.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ApolloLink } from '@apollo/client'
import { MockedProvider, MockLink, type MockedResponse } from '@apollo/client/testing'
import { GraphQLError, parse, type DocumentNode } from 'graphql'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import BonusesListPage from './BonusesListPage'
import type { BonusCampaignRow } from './bonusesListModel'

const LIST_DOCUMENT = parse(`
  query BonusCampaigns($status: BonusStatus, $domain: BonusDomain, $type: String, $search: String) {
    bonusCampaigns(status: $status, domain: $domain, type: $type, search: $search) {
      id
      name
      domain
      type
      status
      budgetNumeric
      currency
      validFrom
      validTo
      createdAt
      directSubType
      depositConditionType
      depositConditionAmount
      distributionType
      amountType
      amount
      percentage
      numberOfPlayers
      usagePerPlayer
      startDate
      endDate
      wagering
      distributedAt
    }
  }
`)

const PREVIEW_DOCUMENT = parse(`
  query PreviewBonusDistribution($campaignId: ID!) {
    previewBonusDistribution(campaignId: $campaignId) {
      eligibleCount
      campaignName
      campaignType
      alreadyDistributed
      distributedAt
    }
  }
`)

const DISTRIBUTE_DOCUMENT = parse(`
  mutation DistributeBonusCampaign($campaignId: ID!) {
    distributeBonusCampaign(campaignId: $campaignId) {
      success
      message
      distributedCount
    }
  }
`)

const DELETE_DOCUMENT = parse(`
  mutation DeleteBonusCampaign($id: ID!) {
    deleteBonusCampaign(id: $id) {
      success
      message
    }
  }
`)

const STATUS_DOCUMENT = parse(`
  mutation UpdateBonusCampaignStatus($input: BonusCampaignUpdateInput!) {
    updateBonusCampaign(input: $input) {
      success
      message
      campaign {
        id
        status
      }
    }
  }
`)

interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: string
  onConfirm?: () => void | Promise<void>
}

interface ExportOptions {
  data: BonusCampaignRow[]
  filename: string
  sheetName?: string
  title?: string
  columns: Array<{ header: string }>
}

type Reply = { success: boolean; message: string; distributedCount?: number | null } | Error

interface Preview {
  eligibleCount: number
  campaignName: string
  campaignType: string
  alreadyDistributed: boolean
  distributedAt: string | null
}

const feedback = vi.hoisted(() => ({ toast: vi.fn(), confirm: vi.fn() }))
const rbac = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))
const exporter = vi.hoisted(() => ({
  options: null as null | ExportOptions,
  handleExport: vi.fn(),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: { required: Array<{ domain: string; actions: string[] }>; children: ReactNode }) => {
    rbac.calls.push(required)
    return rbac.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency?: string) => `${currency ?? 'BASE'} ${amount.toFixed(2)}`,
    convertFromWhitelabelCurrency: (amount: number) => amount * 2,
  }),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDateTime: (value: string, pattern: string) => `${value.slice(0, 10)} [${pattern}]`,
  }),
}))

vi.mock('@/shared/hooks/useTableExport', () => ({
  useTableExport: (options: ExportOptions) => {
    exporter.options = options
    return { exporting: false, handleExport: exporter.handleExport }
  },
}))

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))
vi.mock('@/ui/components/confirm', () => ({ confirm: feedback.confirm }))

const TOAST_MS = 4500

function row(id: string, overrides: Partial<BonusCampaignRow> = {}): BonusCampaignRow {
  return {
    id,
    name: `Campaign ${id}`,
    domain: 'casino',
    type: 'deposit',
    status: 'draft',
    budgetNumeric: 100,
    currency: 'INR',
    validFrom: null,
    validTo: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    directSubType: null,
    depositConditionType: 'greater_than',
    depositConditionAmount: 500,
    distributionType: 'instant_otp',
    amountType: 'percentage',
    amount: null,
    percentage: 10,
    numberOfPlayers: null,
    usagePerPlayer: 1,
    startDate: null,
    endDate: null,
    wagering: null,
    distributedAt: null,
    ...overrides,
  }
}

const WELCOME = row('7', {
  name: 'Welcome 100%',
  domain: 'sports',
  status: 'active',
  budgetNumeric: '2500.50',
  distributionType: 'roll_over',
  amountType: 'fixed',
  amount: 1000,
  percentage: null,
  numberOfPlayers: 1500,
  usagePerPlayer: 2,
  startDate: '2026-09-22T09:00:00.000Z',
  // Far ahead, so the campaign stays live whenever the test runs (a past end date reads Expired).
  endDate: '2099-12-31T18:29:00.000Z',
  wagering: 5,
})
const LAUNCH = row('8', {
  name: 'Launch drop',
  domain: 'global',
  type: 'direct_amount',
  status: 'paused',
  budgetNumeric: 0,
  distributionType: 'instant_cash',
  amountType: 'fixed',
  amount: 250,
  percentage: null,
})
const DIWALI = row('9', {
  name: 'Diwali drop',
  domain: 'global',
  type: 'direct_amount',
  status: 'ended',
  budgetNumeric: null,
  distributionType: null,
  amountType: 'fixed',
  amount: 500,
  percentage: null,
  distributedAt: '2026-10-02T06:30:00.000Z',
})

interface Server {
  campaigns: BonusCampaignRow[]
  listCalls: Array<Record<string, unknown>>
  previewCalls: Array<Record<string, unknown>>
  mutations: Array<{ name: string; variables: Record<string, unknown> }>
  preview: Preview | Error
  replies: Partial<Record<'delete' | 'status' | 'distribute', Reply[]>>
  /** Each operation as the link chain saw it: where the app's global mutation toast reads skipNotification. */
  operations: Array<{ name: string; skipNotification: unknown }>
}

let server: Server

const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>

function listMock(): MockedResponse {
  return {
    request: { query: LIST_DOCUMENT },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      server.listCalls.push(plain(variables))
      return {
        data: {
          bonusCampaigns: server.campaigns.map((campaign) => ({ __typename: 'BonusCampaign', ...campaign })),
        },
      }
    },
  }
}

function previewMock(): MockedResponse {
  return {
    request: { query: PREVIEW_DOCUMENT },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      server.previewCalls.push(plain(variables))
      if (server.preview instanceof Error) return { errors: [new GraphQLError(server.preview.message)] }
      return { data: { previewBonusDistribution: { __typename: 'BonusDistributionPreview', ...server.preview } } }
    },
  }
}

function mutationMock(
  name: 'delete' | 'status' | 'distribute',
  query: DocumentNode,
  field: string,
  typename: string,
): MockedResponse {
  return {
    request: { query },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      server.mutations.push({ name, variables: plain(variables) })
      const reply = server.replies[name]?.shift() ?? { success: true, message: `${name} done` }
      if (reply instanceof Error) return { errors: [new GraphQLError(reply.message)] }
      const extra = name === 'status'
        ? { campaign: { __typename: 'BonusCampaign', id: '7', status: 'paused' } }
        : name === 'distribute'
          ? { distributedCount: reply.distributedCount ?? null }
          : {}
      return { data: { [field]: { __typename: typename, success: reply.success, message: reply.message, ...extra } } }
    },
  }
}

function mocks(): MockedResponse[] {
  return [
    listMock(),
    previewMock(),
    mutationMock('delete', DELETE_DOCUMENT, 'deleteBonusCampaign', 'BonusCampaignDeleteResult'),
    mutationMock('status', STATUS_DOCUMENT, 'updateBonusCampaign', 'BonusCampaignPayload'),
    mutationMock('distribute', DISTRIBUTE_DOCUMENT, 'distributeBonusCampaign', 'BonusDistributionResult'),
  ]
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderPage(path = '/bonuses') {
  const capture = new ApolloLink((operation, forward) => {
    server.operations.push({ name: operation.operationName, skipNotification: operation.getContext().skipNotification })
    return forward(operation)
  })
  return render(
    <MockedProvider link={ApolloLink.from([capture, new MockLink(mocks())])}>
      <MemoryRouter initialEntries={[path]}>
        <PageEyebrowProvider value="Marketing">
          <Routes>
            <Route path="/bonuses" element={<BonusesListPage />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function renderLoaded() {
  const view = renderPage()
  await screen.findByRole('table', { name: 'Bonus campaigns' })
  await waitFor(() => assert.ok(screen.queryByText('Loading Bonus campaigns') === null, 'the table loaded'))
  return view
}

function rowOf(name: string): HTMLElement {
  const cell = screen.getAllByText(name).find((element) => element.closest('tbody tr'))
  const found = cell?.closest('tr')
  assert.ok(found, `Expected a row for ${name}`)
  return found as HTMLElement
}

function tableCard(): HTMLElement {
  return screen.getByRole('region', { name: 'Bonus Campaigns' })
}

function bodyRowNames(): string[] {
  const table = screen.getByRole('table', { name: 'Bonus campaigns' })
  return within(table).getAllByRole('row').slice(1).map((tableRow) => within(tableRow).getAllByRole('cell')[0].textContent ?? '')
}

function lastConfirm(): ConfirmOptions {
  const options = feedback.confirm.mock.calls.at(-1)?.[0] as ConfirmOptions | undefined
  assert.ok(options, 'a confirmation was requested')
  return options as ConfirmOptions
}

beforeEach(() => {
  server = {
    campaigns: [WELCOME, LAUNCH, DIWALI],
    listCalls: [],
    previewCalls: [],
    mutations: [],
    preview: {
      eligibleCount: 12,
      campaignName: 'Launch drop',
      campaignType: 'direct_amount',
      alreadyDistributed: false,
      distributedAt: null,
    },
    replies: {},
    operations: [],
  }
  feedback.toast.mockReset()
  feedback.confirm.mockReset()
  feedback.confirm.mockResolvedValue(false)
  exporter.options = null
  exporter.handleExport.mockReset()
  rbac.allowed = true
  rbac.calls.length = 0
})

describe('BonusesListPage', () => {
  test('keeps the guard, the list query and its variables, the header and the create link', async () => {
    await renderLoaded()
    assert.deepEqual(rbac.calls[0], [{ domain: 'bonuses.list', actions: ['view'] }])
    assert.deepEqual(server.listCalls[0], {})
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Bonus Campaigns')
    assert.ok(screen.queryByText('Manage bonus campaigns and rewards') === null)
    assert.ok(screen.queryByText('Marketing') === null)
    const create = screen.getByRole('link', { name: 'Create Campaign' })
    assert.equal(create.getAttribute('href'), '/bonuses/new')
    assert.equal(screen.getByRole('heading', { level: 2, name: 'Bonus Campaigns' }).textContent, 'Bonus Campaigns')
    // The card's count is the rows on the page; the Total Budget tile says the same for the whole list.
    assert.ok(within(tableCard()).getByText('3 campaigns'))
  })

  test('denies through the unchanged guard without querying', async () => {
    rbac.allowed = false
    renderPage()
    assert.ok(screen.getByRole('alert'))
    assert.ok(screen.queryByRole('heading', { level: 1 }) === null, 'no page heading')
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(server.listCalls.length, 0)
  })

  test('shows the loading states, then the statistics and the legacy cells', async () => {
    renderPage()
    // The tiles hold their place with placeholders until the list answers.
    assert.equal(screen.getByRole('group', { name: 'Bonus campaign statistics' }).getAttribute('aria-busy'), 'true')
    assert.ok(screen.getByText('Loading Bonus campaigns'))
    await renderLoadedStats()

    const stats = screen.getByRole('group', { name: 'Bonus campaign statistics' })
    assert.equal(stats.getAttribute('aria-busy'), null)
    const statText = stats.textContent ?? ''
    assert.match(statText, /Active1/)
    assert.match(statText, /1 campaigns, 3 total/)
    assert.match(statText, /0 drafts, 3 total/)
    assert.match(statText, /Paused1/)
    assert.match(statText, /33% of total/)
    // Total budget: 2500.50 + 0 + 0, converted from the whitelabel currency, as before.
    assert.match(statText, /BASE 5001\.00/)

    const welcome = rowOf('Welcome 100%')
    const cells = within(welcome).getAllByRole('cell').map((cell) => cell.textContent)
    assert.deepEqual(cells.slice(0, 8), [
      'Welcome 100%SPORTS',
      'Deposit',
      'Active',
      'Roll Over',
      'INR 1000.00Fixed',
      `${(1500).toLocaleString()}(2/player)`,
      '2026-09-22 [dd MMM yyyy HH:mm]',
      '2099-12-31 [dd MMM yyyy HH:mm]',
    ])
    const launch = within(rowOf('Launch drop')).getAllByRole('cell').map((cell) => cell.textContent)
    assert.deepEqual(launch.slice(0, 8), [
      'Launch dropAll', 'Direct Bonus', 'Paused', 'Instant Cash', 'INR 250.00Fixed', '∞', '—', '—',
    ])
    // A distributed direct bonus carries the Distributed tag with its date printed.
    const diwali = within(rowOf('Diwali drop')).getAllByRole('cell')
    assert.equal(diwali[2].textContent, 'EndedDistributed2026-10-02 [dd MMM yyyy HH:mm]')
    assert.equal(diwali[3].textContent, '—')
  })

  test('offers the legacy row actions per campaign and navigates to view and edit', async () => {
    await renderLoaded()
    assert.deepEqual(
      within(rowOf('Welcome 100%')).getAllByRole('button').map((button) => button.getAttribute('aria-label')),
      ['View details of Welcome 100%', 'Edit Welcome 100%', 'Deactivate Welcome 100%', 'End Welcome 100%'],
    )
    assert.deepEqual(
      within(rowOf('Launch drop')).getAllByRole('button').map((button) => button.getAttribute('aria-label')),
      [
        'Distribute Launch drop to users',
        'View details of Launch drop',
        'Edit Launch drop',
        'Activate Launch drop',
        'End Launch drop',
      ],
    )
    // Already distributed: no Distribute action. Already ended: nothing to end, and Activate says Reactivate (MAR-07).
    assert.ok(within(rowOf('Diwali drop')).queryByRole('button', { name: /^Distribute/ }) === null)
    assert.deepEqual(
      within(rowOf('Diwali drop')).getAllByRole('button').map((button) => button.getAttribute('aria-label')),
      ['View details of Diwali drop', 'Edit Diwali drop', 'Reactivate Diwali drop'],
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit Welcome 100%' }))
    assert.equal(screen.getByTestId('location').textContent, '/bonuses/7/edit')
  })

  test('opens a campaign from View Details', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'View details of Launch drop' }))
    assert.equal(screen.getByTestId('location').textContent, '/bonuses/8')
  })

  test('a link with ?search= (the global search "See all Bonuses") opens the list already searched', async () => {
    renderPage('/bonuses?search=drop')
    await screen.findByRole('table', { name: 'Bonus campaigns' })
    assert.equal((screen.getByRole('searchbox', { name: 'Search campaigns' }) as HTMLInputElement).value, 'drop')
    // The first list request already carries it: no unfiltered list first.
    await waitFor(() => assert.ok(server.listCalls.length > 0))
    assert.deepEqual(server.listCalls[0], { search: 'drop' })
  })

  test('sends every filter to the query, counts them and clears them', async () => {
    await renderLoaded()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search campaigns' }), { target: { value: '  drop ' } })
    await waitFor(() => assert.deepEqual(server.listCalls.at(-1), { search: 'drop' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'paused' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Domain' }), { target: { value: 'global' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'direct_amount' } })
    await waitFor(() => assert.deepEqual(server.listCalls.at(-1), {
      status: 'paused',
      domain: 'global',
      type: 'direct_amount',
      search: 'drop',
    }))
    assert.ok(screen.getByText('4 filters applied'))

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => assert.equal((screen.getByRole('searchbox', { name: 'Search campaigns' }) as HTMLInputElement).value, ''))
    assert.equal((screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement).value, '')
    // Every type the create form offers (MAR-03).
    assert.deepEqual(
      within(screen.getByRole('combobox', { name: 'Type' })).getAllByRole('option').map((option) => option.textContent),
      ['All types', 'Deposit', 'First Day First Time Deposit', 'Signup', 'Direct Bonus', 'Losing Bonus', 'Special Bonus'],
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'losing_bonus' } })
    await waitFor(() => assert.deepEqual(server.listCalls.at(-1), { type: 'losing_bonus' }))
  })

  test('pages through the list on the client and keeps a shrunken list on its last page', async () => {
    server.campaigns = Array.from({ length: 23 }, (_, index) => row(String(index + 1)))
    await renderLoaded()
    assert.equal(bodyRowNames().length, 10)
    assert.equal(bodyRowNames()[0], 'Campaign 1CASINO')
    // The card counts every campaign the filters match, like the pager total, not the page's 10.
    assert.ok(within(tableCard()).getByText('23 campaigns'))
    // Export Excel takes every campaign the filters match, not the page's 10 (B007).
    assert.equal(exporter.options?.title, 'Bonus Campaigns — 23 campaign(s)')
    assert.deepEqual(exporter.options?.data.map((campaign) => campaign.id), server.campaigns.map((campaign) => campaign.id))

    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    await waitFor(() => assert.deepEqual(bodyRowNames(), ['Campaign 21CASINO', 'Campaign 22CASINO', 'Campaign 23CASINO']))
    const callsBefore = server.listCalls.length

    // A filter that leaves fewer rows shows the last page instead of an empty table (named change).
    server.campaigns = server.campaigns.slice(0, 12)
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'draft' } })
    await waitFor(() => assert.ok(server.listCalls.length > callsBefore))
    await waitFor(() => assert.deepEqual(bodyRowNames(), ['Campaign 11CASINO', 'Campaign 12CASINO']))
    assert.equal(screen.getByRole('button', { name: 'Page 2' }).getAttribute('aria-current'), 'page')
    // The export and the card follow the filter: the 12 it leaves, though the page shows 2.
    assert.equal(exporter.options?.title, 'Bonus Campaigns — 12 campaign(s)')
    assert.equal(exporter.options?.data.length, 12)
    assert.ok(within(tableCard()).getByText('12 campaigns'))

    fireEvent.change(screen.getByRole('combobox', { name: /Rows per page/ }), { target: { value: '25' } })
    await waitFor(() => assert.equal(bodyRowNames().length, 12))
    // Paging and page size never refetch (client-side, as before).
    assert.equal(server.listCalls.at(-1)?.status, 'draft')
  })

  test('shows the empty state with no pager and an unavailable export', async () => {
    server.campaigns = []
    renderPage()
    await screen.findByText('No bonus campaigns found')
    assert.ok(screen.queryByRole('navigation', { name: 'Pagination' }) === null, 'no pager')
    const exportButton = screen.getByRole('button', { name: 'Export Excel' })
    assert.equal(exportButton.hasAttribute('disabled') || exportButton.getAttribute('aria-disabled') === 'true', true)
    assert.ok(within(tableCard()).getByText('0 campaigns'))
  })

  test('exports with the legacy file names', async () => {
    await renderLoaded()
    assert.equal(exporter.options?.filename, 'Bonus-Campaigns')
    assert.equal(exporter.options?.sheetName, 'Campaigns')
    assert.deepEqual(exporter.options?.columns.map((column) => column.header), [
      'Campaign', 'Domain', 'Type', 'Status', 'Distribution', 'Amount', 'Players', 'Start Date', 'End Date', 'Currency',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }))
    assert.equal(exporter.handleExport.mock.calls.length, 1)
  })

  test('deactivates and activates through the legacy confirmations and refetches', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Welcome 100%' }))
    const deactivate = lastConfirm()
    assert.equal(deactivate.title, 'Deactivate campaign?')
    assert.equal(deactivate.description, 'This will pause the campaign and prevent new awards.')
    assert.equal(deactivate.confirmLabel, 'Yes')
    assert.equal(deactivate.cancelLabel, 'No')
    assert.equal(deactivate.tone, undefined)
    assert.equal(server.mutations.length, 0, 'nothing is sent before the confirmation')

    const listCallsBefore = server.listCalls.length
    server.replies.status = [{ success: true, message: 'Bonus campaign updated successfully' }]
    await act(async () => { await deactivate.onConfirm?.() })
    assert.deepEqual(server.mutations[0], { name: 'status', variables: { input: { id: '7', status: 'paused' } } })
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[0][0], {
      title: 'Success',
      message: 'Bonus campaign updated successfully',
      tone: 'ok',
      duration: TOAST_MS,
    }))
    await waitFor(() => assert.ok(server.listCalls.length > listCallsBefore, 'the list refetched'))

    fireEvent.click(screen.getByRole('button', { name: 'Activate Launch drop' }))
    const activate = lastConfirm()
    assert.equal(activate.title, 'Activate campaign?')
    assert.equal(activate.description, 'This will make the campaign active and allow new awards.')
    server.replies.status = [{ success: false, message: '' }]
    await act(async () => { await activate.onConfirm?.() })
    assert.deepEqual(server.mutations[1], { name: 'status', variables: { input: { id: '8', status: 'active' } } })
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[1][0], {
      title: 'Error',
      message: 'Failed to update campaign status',
      tone: 'error',
      duration: TOAST_MS,
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Activate Launch drop' }))
    server.replies.status = [new Error('Only one signup campaign can be active')]
    await act(async () => { await lastConfirm().onConfirm?.() })
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[2][0], {
      title: 'Error',
      message: 'Only one signup campaign can be active',
      tone: 'error',
      duration: TOAST_MS,
    }))
  })

  test('ends a campaign through a confirmation that says what End does, and reports each outcome (MAR-07)', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'End Launch drop' }))
    const confirmation = lastConfirm()
    assert.equal(confirmation.title, 'End campaign?')
    assert.equal(confirmation.description, 'It stops new awards. The campaign stays in the list and can be activated again.')
    assert.equal(confirmation.confirmLabel, 'Yes')
    assert.equal(confirmation.cancelLabel, 'No')

    const listCallsBefore = server.listCalls.length
    server.replies.delete = [{ success: true, message: 'Bonus campaign ended successfully' }]
    await act(async () => { await confirmation.onConfirm?.() })
    assert.deepEqual(server.mutations[0], { name: 'delete', variables: { id: '8' } })
    await waitFor(() => assert.equal(feedback.toast.mock.calls[0][0].message, 'Bonus campaign ended successfully'))
    await waitFor(() => assert.ok(server.listCalls.length > listCallsBefore, 'the list refetched'))

    fireEvent.click(screen.getByRole('button', { name: 'End Welcome 100%' }))
    server.replies.delete = [{ success: false, message: 'Campaign has active awards' }]
    await act(async () => { await lastConfirm().onConfirm?.() })
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[1][0], {
      title: 'Error',
      message: 'Campaign has active awards',
      tone: 'error',
      duration: TOAST_MS,
    }))
  })

  test('reports each mutation once: every page mutation tells the global toast to stay quiet (MAR-06)', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Welcome 100%' }))
    await act(async () => { await lastConfirm().onConfirm?.() })
    fireEvent.click(screen.getByRole('button', { name: 'End Launch drop' }))
    await act(async () => { await lastConfirm().onConfirm?.() })
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 2))

    const sent = server.operations.filter((operation) => operation.name !== 'BonusCampaigns')
    assert.deepEqual(sent, [
      { name: 'UpdateBonusCampaignStatus', skipNotification: true },
      { name: 'DeleteBonusCampaign', skipNotification: true },
    ])
    assert.ok(server.operations.some((operation) => operation.name === 'BonusCampaigns' && operation.skipNotification === undefined))
  })

  test('shows an active campaign past its end date as Expired and keeps it out of Active (MAR-18)', async () => {
    server.campaigns = [WELCOME, row('10', { name: 'FTD', status: 'active', endDate: '2026-03-14T18:30:00.000Z' }), LAUNCH]
    await renderLoaded()
    const statText = screen.getByRole('group', { name: 'Bonus campaign statistics' }).textContent ?? ''
    assert.match(statText, /Active1/)
    assert.match(statText, /1 past end date, 3 total/)
    assert.equal(within(rowOf('FTD')).getAllByRole('cell')[2].textContent, 'Expired')
    assert.equal(within(rowOf('Welcome 100%')).getAllByRole('cell')[2].textContent, 'Active')
    // It is still active by status, so it still offers Deactivate and End.
    assert.ok(within(rowOf('FTD')).getByRole('button', { name: 'Deactivate FTD' }))
    assert.ok(within(rowOf('FTD')).getByRole('button', { name: 'End FTD' }))
  })

  test('previews and distributes a direct bonus, then refetches and closes', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Distribute Launch drop to users' }))
    const dialog = await screen.findByRole('dialog', { name: 'Distribute Bonus' })
    await within(dialog).findByText('Launch drop')
    assert.deepEqual(server.previewCalls, [{ campaignId: '8' }])
    assert.match(dialog.textContent ?? '', /Campaign: Launch drop/)
    assert.match(dialog.textContent ?? '', /Eligible users: 12/)
    assert.ok(within(dialog).getByText('This action can only be done once and cannot be undone.'))
    const distribute = within(dialog).getByRole('button', { name: 'Distribute' })
    assert.equal(distribute.hasAttribute('disabled'), false)

    const listCallsBefore = server.listCalls.length
    server.replies.distribute = [{ success: true, message: 'ok', distributedCount: 12 }]
    fireEvent.click(distribute)
    await waitFor(() => assert.deepEqual(server.mutations[0], { name: 'distribute', variables: { campaignId: '8' } }))
    assert.ok(server.operations.some((operation) => operation.name === 'DistributeBonusCampaign' && operation.skipNotification === true))
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[0][0], {
      title: 'Success',
      message: 'Distributed to 12 users',
      tone: 'ok',
      duration: TOAST_MS,
    }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'the dialog closed'))
    await waitFor(() => assert.ok(server.listCalls.length > listCallsBefore, 'the list refetched'))
  })

  test('keeps Distribute unavailable for a distributed or empty preview and cancels cleanly', async () => {
    server.preview = {
      eligibleCount: 3,
      campaignName: 'Launch drop',
      campaignType: 'direct_amount',
      alreadyDistributed: true,
      distributedAt: '2026-10-01T10:00:00.000Z',
    }
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Distribute Launch drop to users' }))
    let dialog = await screen.findByRole('dialog', { name: 'Distribute Bonus' })
    await within(dialog).findByText('This campaign has already been distributed.')
    assert.equal(within(dialog).getByRole('button', { name: 'Distribute' }).hasAttribute('disabled'), true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'the dialog closed'))

    server.preview = { ...server.preview, alreadyDistributed: false, eligibleCount: 0, distributedAt: null }
    fireEvent.click(screen.getByRole('button', { name: 'Distribute Launch drop to users' }))
    dialog = await screen.findByRole('dialog', { name: 'Distribute Bonus' })
    await within(dialog).findByText('No eligible users for distribution.')
    assert.equal(within(dialog).getByRole('button', { name: 'Distribute' }).hasAttribute('disabled'), true)
    assert.equal(server.mutations.length, 0)
  })

  test('reports a failed preview and a refused distribution and closes the dialog', async () => {
    server.preview = new Error('Campaign is not a direct bonus')
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Distribute Launch drop to users' }))
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[0][0], {
      title: 'Error',
      message: 'Campaign is not a direct bonus',
      tone: 'error',
      duration: TOAST_MS,
    }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'the dialog closed'))

    server.preview = {
      eligibleCount: 5,
      campaignName: 'Launch drop',
      campaignType: 'direct_amount',
      alreadyDistributed: false,
      distributedAt: null,
    }
    server.replies.distribute = [{ success: false, message: 'Distribution already running' }]
    fireEvent.click(screen.getByRole('button', { name: 'Distribute Launch drop to users' }))
    const dialog = await screen.findByRole('dialog', { name: 'Distribute Bonus' })
    await within(dialog).findByText('Launch drop')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Distribute' }))
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[1][0], {
      title: 'Error',
      message: 'Distribution already running',
      tone: 'error',
      duration: TOAST_MS,
    }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null, 'the dialog closed'))
  })
})

async function renderLoadedStats() {
  await screen.findByRole('group', { name: 'Bonus campaign statistics' })
  await waitFor(() => assert.ok(screen.queryByText('Loading Bonus campaigns') === null, 'the table loaded'))
}
