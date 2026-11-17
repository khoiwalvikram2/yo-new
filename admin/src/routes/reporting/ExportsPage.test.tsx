/**
 * /reporting/exports against a recording GraphQL server (MockedProvider + MemoryRouter). The real
 * page, its panels and the kit render; useQuery/useMutation are wrapped, not replaced, so every option
 * the page passes is recorded while the real Apollo hooks run. One link answers the Export Center's
 * operations by name and records what each was sent, so the test holds no copy of any document. The
 * row estimate and the download have their own suites and are stand-ins here; so is the drawer (the
 * kit's has its own). The clock is fixed at 2026-10-07 11:30 IST.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { ApolloLink, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { GraphQLError } from 'graphql'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import ExportsPage from './ExportsPage'
import { exportAnalytics, type ExportJob } from './exportsPageModel'
import { EXPORT_JOBS_QUERY, SAVED_REPORTS_QUERY } from './exportsPageQueries'

interface HookCall {
  name: string
  document: unknown
  options: Record<string, unknown>
}

interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: string
  onConfirm?: () => void | Promise<void>
}

interface ToastOptions {
  title?: string
  message: string
  tone?: string
  duration?: number
}

interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
}

interface MockAgent {
  id: string
  tenantId: string
  schemeType: string
  allowedDomains: string[]
}

const apollo = vi.hoisted(() => ({
  queries: [] as HookCall[],
  mutations: [] as HookCall[],
}))

const auth = vi.hoisted(() => ({
  agent: undefined as MockAgent | undefined,
  roles: ['Super Admin'] as string[],
  permissions: [{ domain: 'all', actions: ['*'] }] as Array<{ domain: string; actions: string[] }>,
}))

const guard = vi.hoisted(() => ({
  allowed: true,
  contextAllowed: true,
  calls: [] as unknown[],
}))

const feedback = vi.hoisted(() => ({
  toast: vi.fn((options: ToastOptions) => {
    void options
    return 1
  }),
  dismiss: vi.fn(),
  confirm: vi.fn(async (options: ConfirmOptions) => {
    void options
    return true
  }),
  estimate: vi.fn(),
  download: vi.fn(),
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  const nameOf = (document: unknown) =>
    (document as { definitions?: Array<{ name?: { value?: string } }> }).definitions?.[0]?.name?.value ?? ''
  return {
    ...actual,
    useQuery: (...args: Parameters<typeof actual.useQuery>) => {
      apollo.queries.push({ name: nameOf(args[0]), document: args[0], options: (args[1] ?? {}) as Record<string, unknown> })
      return actual.useQuery(...args)
    },
    useMutation: (...args: Parameters<typeof actual.useMutation>) => {
      apollo.mutations.push({ name: nameOf(args[0]), document: args[0], options: (args[1] ?? {}) as Record<string, unknown> })
      return actual.useMutation(...args)
    },
  }
})

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { agent?: MockAgent; roles: string[]; permissions: Array<{ domain: string; actions: string[] }> }) => unknown) =>
    selector({ agent: auth.agent, roles: auth.roles, permissions: auth.permissions }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({
    required,
    bypassForAgents,
    children,
  }: { required: unknown; bypassForAgents?: boolean; children: ReactNode }) => {
    guard.calls.push({ required, bypassForAgents })
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('./exportCenterAccess', () => ({
  useCanAccessExportCenterContext: () => guard.contextAllowed,
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDateTime: (value: string, pattern: string) => `${pattern}@${value}`,
  }),
}))

vi.mock('@/ui/components/toast', () => ({
  toast: Object.assign(feedback.toast, { dismiss: feedback.dismiss }),
}))

vi.mock('@/ui/components/confirm', () => ({ confirm: feedback.confirm }))

vi.mock('./exportsPageEstimate', () => ({ estimateExport: feedback.estimate }))

vi.mock('./exportsPageDownload', () => ({ downloadExportFile: feedback.download }))

vi.mock('@/ui/components/Drawer', () => ({
  Drawer: ({ open, onOpenChange, title, children, footer }: DrawerProps) =>
    open ? (
      <div role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
        <h2>{title}</h2>
        <button type="button" onClick={() => onOpenChange(false)}>Close dialog</button>
        <div>{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    ) : null,
}))

/* ---------- the server ---------- */

const NOW = new Date('2026-10-07T06:00:00.000Z')
const ALL_TIME = { dateFrom: '1999-12-31T18:30:00.000Z', dateTo: '2026-10-07T18:29:59.999Z' }
const TODAY = { dateFrom: '2026-10-06T18:30:00.000Z', dateTo: '2026-10-07T18:29:59.999Z' }

function exportJob(overrides: Record<string, unknown>) {
  return {
    id: 'job',
    reportType: 'players',
    exportFormat: 'CSV',
    status: 'completed',
    fileUrl: null,
    errorMessage: null,
    scheduledAt: null,
    completedAt: null,
    createdAt: '2026-10-07T05:00:00.000Z',
    ...overrides,
  }
}

const JOBS = [
  exportJob({
    id: 'job-completed-0001',
    fileUrl: '/api/exports/1',
    completedAt: '2026-10-07T05:03:00.000Z',
  }),
  exportJob({ id: 'job-processing-0002', reportType: 'deposits', exportFormat: 'XLSX', status: 'processing' }),
  exportJob({ id: 'job-failed-0003', reportType: 'audit-logs', status: 'failed', errorMessage: 'Unsupported filter' }),
  exportJob({ id: 'job-pending-0004', reportType: 'mystery-report', status: 'pending' }),
]

const TEMPLATES = [
  {
    id: 'tpl-1',
    name: 'Monthly Players Report',
    description: null,
    reportType: 'players',
    filtersJson: { status: 'active', dateFrom: '2026-09-06T18:30:00.000Z', dateTo: '2026-10-07T18:29:59.999Z' },
    isPinned: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
]

type Mode = 'ok' | 'pending' | 'error'

const server = {
  jobs: JOBS as unknown[],
  jobsMode: 'ok' as Mode,
  templates: TEMPLATES as unknown[],
  createMode: 'ok' as Mode,
  deleteMode: 'ok' as Mode,
  operations: [] as Array<{ name: string; variables: Record<string, unknown> }>,
}

const never = () => new Observable<never>(() => undefined)

const serverLink = new ApolloLink((operation) => {
  server.operations.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) })
  switch (operation.operationName) {
    case 'ExportJobs':
      if (server.jobsMode === 'pending') return never()
      if (server.jobsMode === 'error') return new Observable((observer) => observer.error(new Error('Network down')))
      return Observable.of({ data: { exportJobsPage: { ...exportAnalytics(server.jobs as ExportJob[]), items: server.jobs.slice(Number(operation.variables.offset ?? 0), Number(operation.variables.offset ?? 0) + Number(operation.variables.limit ?? 10)) } } })
    case 'SavedReports':
      return Observable.of({ data: { savedReports: server.templates } })
    case 'CreateExportJob': {
      if (server.createMode === 'pending') return never()
      if (server.createMode === 'error') return Observable.of({ errors: [new GraphQLError('Unsupported report type')] })
      const input = operation.variables.input as { reportType: string; exportFormat: string }
      return Observable.of({
        data: {
          createExportJob: {
            id: 'job-new',
            reportType: input.reportType,
            exportFormat: input.exportFormat,
            status: 'pending',
            fileUrl: null,
            errorMessage: null,
            scheduledAt: null,
            createdAt: '2026-10-07T06:00:00.000Z',
          },
        },
      })
    }
    case 'DeleteSavedReport':
      if (server.deleteMode === 'error') return Observable.of({ errors: [new GraphQLError('Template is in use')] })
      return Observable.of({ data: { deleteSavedReport: { success: true, message: 'Removed Monthly Players Report' } } })
    default:
      return new Observable((observer) => observer.error(new Error(`unexpected ${operation.operationName}`)))
  }
})

const sent = (name: string) => server.operations.filter((operation) => operation.name === name)
const queriesNamed = (name: string) => apollo.queries.filter((call) => call.name === name)

function renderPage() {
  return render(
    <MockedProvider addTypename={false} link={serverLink}>
      <MemoryRouter initialEntries={['/reporting/exports']}>
        <PageEyebrowProvider value="Reporting">
          <ExportsPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

async function loaded() {
  await screen.findByText('Monthly Players Report')
  await waitFor(() => assert.equal(within(statsGroup()).getByText('Total Exports').nextSibling?.textContent, '4'))
}

const statsGroup = () => screen.getByRole('group', { name: 'Export totals' })
const headingNames = (level: number) => screen.getAllByRole('heading', { level }).map((heading) => heading.textContent)

async function openHistory() {
  fireEvent.click(screen.getByRole('tab', { name: 'History' }))
  return screen.findByRole('table', { name: 'Export history' })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  apollo.queries.length = 0
  apollo.mutations.length = 0
  guard.calls.length = 0
  guard.allowed = true
  guard.contextAllowed = true
  auth.agent = undefined
  auth.roles = ['Super Admin']
  auth.permissions = [{ domain: 'all', actions: ['*'] }]
  server.jobs = JOBS
  server.jobsMode = 'ok'
  server.templates = TEMPLATES
  server.createMode = 'ok'
  server.deleteMode = 'ok'
  server.operations.length = 0
  feedback.toast.mockClear()
  feedback.dismiss.mockClear()
  feedback.confirm.mockClear()
  feedback.download.mockReset()
  feedback.estimate.mockReset()
  feedback.estimate.mockImplementation(() => new Promise(() => undefined))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('guards', () => {
  test('wraps the page in reporting.exports:view, bypassed for agents, and starts nothing when denied', () => {
    guard.allowed = false
    renderPage()
    assert.deepEqual(guard.calls[0], { required: [{ domain: 'reporting.exports', actions: ['view'] }], bypassForAgents: true })
    screen.getByRole('alert')
    assert.equal(apollo.queries.length, 0)
    assert.equal(apollo.mutations.length, 0)
  })

  test('outside a whitelabel context it says so, links to the dashboard and starts nothing', () => {
    guard.contextAllowed = false
    renderPage()
    screen.getByText('Export Center is only available in Whitelabel view')
    screen.getByText('Switch to a whitelabel context to create and download exports.')
    assert.equal(screen.getByRole('link', { name: 'Go to Dashboard' }).getAttribute('href'), '/')
    assert.equal(screen.queryByRole('heading', { level: 1 }), null)
    assert.equal(apollo.queries.length, 0)
  })
})

describe('page frame and data', () => {
  test('one h1, the eyebrow, the legacy sub, the totals and the exact queries', async () => {
    renderPage()
    await loaded()
    assert.deepEqual(headingNames(1), ['Export Center'])
    assert.ok(screen.queryByText('Reporting') === null)
    assert.ok(screen.queryByText('Professional data export management with advanced filtering, scheduling, and analytics') === null)

    const stats = within(statsGroup())
    for (const [label, value, note] of [
      ['Total Exports', '4', '1 completed'],
      ['Success Rate', '25.0%', '1 failed'],
      ['In Progress', '2', 'Pending / processing'],
      ['Avg. Time', '3.0min', 'All time'],
    ]) {
      stats.getByText(label)
      stats.getByText(value)
      stats.getByText(note)
    }

    const jobs = queriesNamed('ExportJobs').at(-1)
    assert.equal(jobs?.document, EXPORT_JOBS_QUERY)
    assert.deepEqual(jobs?.options, { variables: { status: undefined, limit: 10, offset: 0 }, pollInterval: 0, errorPolicy: 'all' })
    const templates = queriesNamed('SavedReports').at(-1)
    assert.equal(templates?.document, SAVED_REPORTS_QUERY)
    assert.deepEqual(templates?.options, { errorPolicy: 'all' })
    assert.deepEqual(sent('ExportJobs')[0]?.variables, { limit: 10, offset: 0 })

    assert.deepEqual(
      apollo.mutations.map((call) => call.name).slice(0, 2),
      ['CreateExportJob', 'DeleteSavedReport'],
    )
    const create = apollo.mutations.find((call) => call.name === 'CreateExportJob')
    assert.deepEqual(create?.options.refetchQueries, [{ query: EXPORT_JOBS_QUERY }])
    const remove = apollo.mutations.find((call) => call.name === 'DeleteSavedReport')
    assert.deepEqual(remove?.options.refetchQueries, [{ query: SAVED_REPORTS_QUERY }])
    assert.equal(apollo.mutations.some((call) => call.name === 'CreateSavedReport'), false)

    const tablist = screen.getByRole('tablist', { name: 'Export Center tabs selector' })
    const create0 = within(tablist).getByRole('tab', { name: 'Create Export' })
    assert.equal(create0.getAttribute('aria-selected'), 'true')
    assert.equal(screen.getByRole('tabpanel').getAttribute('aria-labelledby'), create0.id)
  })

  test('Refresh in the header refetches the jobs and the templates', async () => {
    renderPage()
    await loaded()
    const jobs = sent('ExportJobs').length
    const templates = sent('SavedReports').length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.equal(sent('ExportJobs').length, jobs + 1))
    await waitFor(() => assert.equal(sent('SavedReports').length, templates + 1))
  })
})

describe('Create Export', () => {
  test('an admin is not offered a type the server would refuse it (F-REP-10)', async () => {
    // A Whitelabel Admin's grants: reporting and users, but no audit export.
    auth.roles = ['Whitelabel Admin']
    auth.permissions = [
      { domain: 'reporting', actions: ['read', 'export'] },
      { domain: 'users', actions: ['read'] },
      { domain: 'audit', actions: ['read'] },
    ]
    renderPage()
    await loaded()
    const offered = headingNames(3)
    assert.equal(offered.includes('Audit Logs'), false, 'audit.events:export is not held')
    for (const name of ['Players Data', 'GGR Reports', 'Sports Bets', 'Matka Bets']) assert.ok(offered.includes(name), name)
    assert.equal(screen.queryByRole('button', { name: 'Export Audit Logs as CSV' }), null)
  })

  test('the catalogue: a card per category, a tile per type, the export-limit notice', async () => {
    renderPage()
    await loaded()
    assert.deepEqual(headingNames(2), [
      'My templates', 'Core Data', 'Financial Reports', 'Betting Data', 'Analytics & KPIs', 'System Data', 'Payment Requests',
    ])
    assert.deepEqual(headingNames(3), [
      'Players Data', 'Transactions', 'Agents Data', 'GGR Reports', 'Sports Bets', 'Casino Bets', 'Matka Bets',
      'Bonus Campaigns Report', 'Audit Logs', 'Deposit Requests', 'Withdrawal Requests',
    ])
    screen.getByText('Export limit')
    screen.getByText('Exports are limited to 10,000 rows. Use filters and date range to narrow results.', { exact: false })
    screen.getByText('Excel (XLSX) format is currently delivered as CSV.')
    assert.equal(screen.getAllByText('3 export types').length, 2)
    assert.equal(screen.getAllByText('1 export type').length, 3)
    screen.getByText('2 export types')
    const players = screen.getByRole('heading', { level: 3, name: 'Players Data' }).closest('li') as HTMLElement
    within(players).getByText('Comprehensive player list with balances, stats, activity, and profile information')
    within(players).getByRole('combobox', { name: 'Player Status' })
    within(players).getByRole('button', { name: 'Export Players Data as CSV' })
    within(players).getByRole('button', { name: 'Export Players Data as XLSX' })
  })

  test('search, category, period and Clear all', async () => {
    renderPage()
    await loaded()
    const filters = screen.getByRole('search', { name: 'Filters' })

    fireEvent.change(within(filters).getByRole('searchbox', { name: 'Search export types' }), { target: { value: 'MATKA' } })
    assert.deepEqual(headingNames(3), ['Matka Bets'])
    within(filters).getByText('1 filter applied')

    fireEvent.change(within(filters).getByRole('searchbox', { name: 'Search export types' }), { target: { value: 'nothing like it' } })
    screen.getByText('No export types found. Try adjusting your search.')

    fireEvent.change(within(filters).getByRole('searchbox', { name: 'Search export types' }), { target: { value: '' } })
    fireEvent.change(within(filters).getByRole('combobox', { name: 'Category' }), { target: { value: 'payments' } })
    assert.deepEqual(headingNames(3), ['Deposit Requests', 'Withdrawal Requests'])

    fireEvent.click(within(filters).getByRole('button', { name: 'Today' }))
    within(filters).getByText('2 filters applied')

    fireEvent.click(within(filters).getByRole('button', { name: 'Clear all' }))
    within(filters).getByText('0 filters applied')
    assert.equal(headingNames(3).length, 11)
    assert.equal((within(filters).getByRole('combobox', { name: 'Category' }) as HTMLSelectElement).value, '')
    assert.equal(within(filters).getByRole('button', { name: 'All time' }).getAttribute('aria-pressed'), 'true')
  })

  test('exporting sends the legacy job input, then thanks the user and opens History', async () => {
    renderPage()
    await loaded()
    const players = screen.getByRole('heading', { level: 3, name: 'Players Data' }).closest('li') as HTMLElement
    fireEvent.change(within(players).getByRole('combobox', { name: 'Player Status' }), { target: { value: 'active' } })
    fireEvent.click(within(players).getByRole('button', { name: 'Export Players Data as CSV' }))

    await waitFor(() => assert.equal(sent('CreateExportJob').length, 1))
    assert.deepEqual(sent('CreateExportJob')[0].variables, {
      input: { reportType: 'players', filtersJson: { status: 'active', ...ALL_TIME }, exportFormat: 'CSV' },
    })
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepEqual(feedback.toast.mock.calls[0][0], {
      title: 'Export Job Created Successfully',
      message: 'Your export has been queued and will be processed shortly. Check the History tab for real-time updates.',
      tone: 'ok',
      duration: 4000,
    })
    await waitFor(() => assert.equal(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected'), 'true'))
    assert.equal(queriesNamed('ExportJobs').at(-1)?.options.pollInterval, 3000)
    // the refetch the mutation asks for: the jobs document without variables
    await waitFor(() => assert.ok(sent('ExportJobs').some((operation) => Object.keys(operation.variables).length === 0)))

    // back on Create, the type filters were reset
    fireEvent.click(screen.getByRole('tab', { name: 'Create Export' }))
    const again = screen.getByRole('heading', { level: 3, name: 'Players Data' }).closest('li') as HTMLElement
    assert.equal((within(again).getByRole('combobox', { name: 'Player Status' }) as HTMLSelectElement).value, '')
  })

  test("Today's period and an XLSX export; All stores no choice", async () => {
    renderPage()
    await loaded()
    fireEvent.click(within(screen.getByRole('search', { name: 'Filters' })).getByRole('button', { name: 'Today' }))
    const agents = screen.getByRole('heading', { level: 3, name: 'Agents Data' }).closest('li') as HTMLElement
    fireEvent.change(within(agents).getByRole('combobox', { name: 'Agent Level' }), { target: { value: '4+' } })
    fireEvent.change(within(agents).getByRole('combobox', { name: 'Agent Status' }), { target: { value: 'inactive' } })
    fireEvent.change(within(agents).getByRole('combobox', { name: 'Agent Status' }), { target: { value: '' } })
    fireEvent.click(within(agents).getByRole('button', { name: 'Export Agents Data as XLSX' }))
    await waitFor(() => assert.equal(sent('CreateExportJob').length, 1))
    assert.deepEqual(sent('CreateExportJob')[0].variables, {
      input: { reportType: 'agents', filtersJson: { level: '4+', ...TODAY }, exportFormat: 'XLSX' },
    })
  })

  test('while a job is being created every format waits and the chosen type shows busy', async () => {
    server.createMode = 'pending'
    renderPage()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Export GGR Reports as XLSX' }))
    await waitFor(() =>
      assert.equal(screen.getByRole('button', { name: 'Export GGR Reports as XLSX' }).getAttribute('aria-busy'), 'true'))
    assert.equal(screen.getByRole('button', { name: 'Export GGR Reports as CSV' }).getAttribute('aria-busy'), 'true')
    assert.equal(screen.getByRole('button', { name: 'Export Players Data as CSV' }).getAttribute('aria-disabled'), 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Export Players Data as CSV' }))
    assert.equal(sent('CreateExportJob').length, 1)
  })

  test('a refused job raises the legacy failure toast and stays on Create', async () => {
    server.createMode = 'error'
    renderPage()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Export Deposit Requests as CSV' }))
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepEqual(feedback.toast.mock.calls[0][0], {
      title: 'Export Creation Failed',
      message: 'Unsupported report type',
      tone: 'error',
      duration: 5000,
    })
    assert.equal(screen.getByRole('tab', { name: 'Create Export' }).getAttribute('aria-selected'), 'true')
  })

  test("an agent sees its scheme's and domains' types and its exports carry the agent and tenant", async () => {
    auth.agent = { id: 'agent-7', tenantId: 'tenant-2', schemeType: 'SHARING', allowedDomains: ['casino'] }
    auth.roles = []
    renderPage()
    await loaded()
    const names = headingNames(3)
    for (const name of ['Players Data', 'Settlement Reports', 'Sub-Agents Data', 'Deposit Requests', 'Withdrawal Requests']) {
      assert.ok(names.includes(name), `${name} is not offered to a SHARING agent`)
    }
    for (const name of ['Audit Logs', 'GGR Reports', 'Bonus Campaigns Report', 'Transactions', 'Agents Data', 'Commission Reports']) {
      assert.equal(names.includes(name), false, `${name} is offered to a SHARING agent`)
    }
    assert.equal(names.includes('Sports Bets'), false)
    assert.equal(names.includes('Matka Bets'), false)
    assert.equal(names.includes('Casino Bets'), true)
    fireEvent.click(screen.getByRole('button', { name: 'Export Casino Bets as CSV' }))
    await waitFor(() => assert.equal(sent('CreateExportJob').length, 1))
    assert.deepEqual(sent('CreateExportJob')[0].variables, {
      input: {
        reportType: 'casino-bets',
        filtersJson: { ...ALL_TIME, agentId: 'agent-7', tenant: 'tenant-2' },
        exportFormat: 'CSV',
      },
    })
  })

  test('row estimates load on hover and on keyboard focus, once per filters and period', async () => {
    let resolve: (value: { rows: number; size: string }) => void = () => undefined
    feedback.estimate.mockImplementation(() => new Promise((done) => { resolve = done }))
    renderPage()
    await loaded()
    const players = screen.getByRole('heading', { level: 3, name: 'Players Data' }).closest('li') as HTMLElement
    fireEvent.mouseEnter(players)
    assert.equal(feedback.estimate.mock.calls.length, 1)
    const [client, typeId, request] = feedback.estimate.mock.calls[0]
    assert.equal(typeof (client as { query?: unknown }).query, 'function')
    assert.equal(typeId, 'players')
    assert.deepEqual(request, {
      filters: { ...ALL_TIME },
      dateRange: { from: ALL_TIME.dateFrom, to: ALL_TIME.dateTo },
      isAgent: false,
      agentId: undefined,
    })
    within(players).getByRole('img', { name: 'Estimating Players Data' })
    fireEvent.mouseEnter(players)
    assert.equal(feedback.estimate.mock.calls.length, 1, 'no second request while one is loading')

    await act(async () => {
      resolve({ rows: 50, size: '9.8 KB' })
    })
    within(players).getByText('50 rows • ~9.8 KB')
    fireEvent.mouseEnter(players)
    assert.equal(feedback.estimate.mock.calls.length, 1, 'a cached estimate is reused')

    const transactions = screen.getByRole('heading', { level: 3, name: 'Transactions' }).closest('li') as HTMLElement
    act(() => {
      within(transactions).getByRole('combobox', { name: 'Transaction Type' }).focus()
    })
    assert.equal(feedback.estimate.mock.calls.at(-1)?.[1], 'transactions')

    // a new choice clears the estimates
    fireEvent.change(within(players).getByRole('combobox', { name: 'Player Status' }), { target: { value: 'suspended' } })
    assert.equal(within(players).queryByText('50 rows • ~9.8 KB'), null)
  })

  test('the list view: a table per category with the long export labels', async () => {
    renderPage()
    await loaded()
    fireEvent.click(screen.getByRole('radio', { name: 'List' }))
    const payments = screen.getByRole('table', { name: 'Payment Requests export types' })
    assert.deepEqual(
      within(payments).getAllByRole('columnheader').map((header) => header.textContent),
      ['Export Type', 'Formats', 'Actions'],
    )
    const row = within(payments).getByText('Withdrawal Requests').closest('tr') as HTMLElement
    within(row).getByText('Export CSV')
    fireEvent.click(within(row).getByRole('button', { name: 'Export Withdrawal Requests as XLSX' }))
    await waitFor(() => assert.equal(sent('CreateExportJob').length, 1))
    assert.equal((sent('CreateExportJob')[0].variables.input as { exportFormat: string }).exportFormat, 'XLSX')
    assert.equal(screen.queryAllByRole('heading', { level: 3 }).length, 0)
  })
})

describe('templates', () => {
  test('Load brings back the type, its filters and its period as a custom range', async () => {
    renderPage()
    await loaded()
    const card = screen.getByRole('heading', { level: 2, name: 'My templates' }).closest('section') as HTMLElement
    within(card).getByText('Players Data')
    fireEvent.click(within(card).getByRole('button', { name: 'Load' }))

    screen.getByRole('button', { name: 'Period: 07 Sep 2026 – 07 Oct 2026' })
    const players = screen.getByRole('heading', { level: 3, name: 'Players Data' }).closest('li') as HTMLElement
    assert.equal((within(players).getByRole('combobox', { name: 'Player Status' }) as HTMLSelectElement).value, 'active')
    within(screen.getByRole('search', { name: 'Filters' })).getByText('1 filter applied')

    fireEvent.click(within(players).getByRole('button', { name: 'Export Players Data as CSV' }))
    await waitFor(() => assert.equal(sent('CreateExportJob').length, 1))
    assert.deepEqual(sent('CreateExportJob')[0].variables, {
      input: {
        reportType: 'players',
        filtersJson: { status: 'active', dateFrom: '2026-09-06T18:30:00.000Z', dateTo: '2026-10-07T18:29:59.999Z' },
        exportFormat: 'CSV',
      },
    })
  })

  test('Delete asks first with the legacy copy, deletes and says so; a failure says why', async () => {
    renderPage()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Delete template Monthly Players Report' }))
    assert.equal(feedback.confirm.mock.calls.length, 1)
    const options = feedback.confirm.mock.calls[0][0]
    assert.equal(options.title, 'Delete template?')
    assert.equal(options.description, 'This cannot be undone.')
    assert.equal(options.confirmLabel, 'Delete')
    assert.equal(options.cancelLabel, 'Cancel')
    assert.equal(options.tone, 'danger')
    assert.equal(sent('DeleteSavedReport').length, 0, 'nothing is deleted before the confirmation')

    const templatesBefore = sent('SavedReports').length
    await act(async () => {
      await options.onConfirm?.()
    })
    assert.deepEqual(sent('DeleteSavedReport')[0].variables, { id: 'tpl-1' })
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepEqual(feedback.toast.mock.calls[0][0], {
      title: 'Template Deleted',
      message: 'Removed Monthly Players Report',
      tone: 'ok',
      duration: 4500,
    })
    await waitFor(() => assert.equal(sent('SavedReports').length, templatesBefore + 1))

    server.deleteMode = 'error'
    fireEvent.click(screen.getByRole('button', { name: 'Delete template Monthly Players Report' }))
    await act(async () => {
      await feedback.confirm.mock.calls[1][0].onConfirm?.()
    })
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 2))
    assert.deepEqual(feedback.toast.mock.calls[1][0], {
      title: 'Delete template failed',
      message: 'Template is in use',
      tone: 'error',
      duration: 4500,
    })
  })

  test('no templates, no templates card', async () => {
    server.templates = []
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Core Data' })
    assert.equal(screen.queryByRole('heading', { level: 2, name: 'My templates' }), null)
  })
})

describe('History', () => {
  test('polls every 3 seconds and lists the jobs with their statuses, formats and dates', async () => {
    renderPage()
    await loaded()
    const table = await openHistory()
    assert.equal(queriesNamed('ExportJobs').at(-1)?.options.pollInterval, 3000)
    assert.deepEqual(
      within(table).getAllByRole('columnheader').map((header) => header.textContent),
      ['Expand', 'Export Type', 'Format', 'Status', 'Created', 'Completed', 'Actions'],
    )
    const completed = within(table).getByText('Players Data').closest('tr') as HTMLElement
    within(completed).getByText('Comprehensive player list with balances, stats, ac...')
    within(completed).getByText('CSV')
    within(completed).getByText('Completed')
    within(completed).getByText('MMM d, yyyy@2026-10-07T05:00:00.000Z')
    within(completed).getByText('HH:mm:ss@2026-10-07T05:03:00.000Z')
    const pending = within(table).getByText('mystery-report').closest('tr') as HTMLElement
    within(pending).getByText('...')
    within(pending).getByText('Pending')
    within(pending).getByText('-')
    // the status pill and the waiting button
    assert.equal(within(within(table).getByText('Deposit Requests').closest('tr') as HTMLElement).getAllByText('Processing').length, 2)

    const card = screen.getByRole('heading', { level: 2, name: 'Export History' }).closest('section') as HTMLElement
    assert.equal(card.querySelector('p')?.textContent, 'Total: 4 exports')
    within(card).getByText('2 job(s) in progress')
    within(card).getByText('2 exports currently in progress')
    screen.getByText('1-4 of 4 exports')
  })

  test('Refresh Now and the card Refresh refetch the jobs', async () => {
    renderPage()
    await loaded()
    await openHistory()
    const before = sent('ExportJobs').length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Now' }))
    await waitFor(() => assert.ok(sent('ExportJobs').length > before))
    const card = screen.getByRole('heading', { level: 2, name: 'Export History' }).closest('section') as HTMLElement
    const after = sent('ExportJobs').length
    fireEvent.click(within(card).getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.ok(sent('ExportJobs').length > after))
  })

  test('the status filter re-queries and Clear all lifts it', async () => {
    renderPage()
    await loaded()
    await openHistory()
    const filters = screen.getByRole('search', { name: 'Filters' })
    fireEvent.change(within(filters).getByRole('combobox', { name: 'Status' }), { target: { value: 'failed' } })
    await waitFor(() => assert.deepEqual(queriesNamed('ExportJobs').at(-1)?.options.variables, { status: 'failed', limit: 10, offset: 0 }))
    await waitFor(() => assert.ok(sent('ExportJobs').some((operation) => operation.variables.status === 'failed')))
    within(filters).getByText('1 filter applied')
    fireEvent.click(within(filters).getByRole('button', { name: 'Clear all' }))
    await waitFor(() => assert.deepEqual(queriesNamed('ExportJobs').at(-1)?.options.variables, { status: undefined, limit: 10, offset: 0 }))
  })

  test('row actions: download, the processing and failed explanations, and expanded rows', async () => {
    renderPage()
    await loaded()
    const table = await openHistory()
    const completed = within(table).getByText('Players Data').closest('tr') as HTMLElement
    fireEvent.click(within(completed).getByRole('button', { name: 'Download' }))
    assert.equal(feedback.download.mock.calls.length, 1)
    const [, jobId, filename] = feedback.download.mock.calls[0]
    assert.equal(jobId, 'job-completed-0001')
    assert.match(String(filename), /^Players Data-2026-10-0[67]-job-comp\.csv$/)

    const processing = within(table).getByText('Deposit Requests').closest('tr') as HTMLElement
    assert.equal(within(processing).getByRole('button', { name: 'Processing' }).getAttribute('aria-disabled'), 'true')
    const failed = within(table).getByText('Audit Logs').closest('tr') as HTMLElement
    within(failed).getByRole('button', { name: 'Failed' })

    fireEvent.click(within(failed).getByRole('button', { name: 'Expand job-failed-0003' }))
    screen.getByText('Export Error Details')
    screen.getByText('Unsupported filter')
    fireEvent.click(within(processing).getByRole('button', { name: 'Expand job-processing-0002' }))
    screen.getByText('Your export is being processed. This page will auto-refresh every 3 seconds.')
    fireEvent.click(within(completed).getByRole('button', { name: 'Expand job-completed-0001' }))
    screen.getByText('Export Created')
    screen.getByText('Export Completed')
    screen.getByText('yyyy-MM-dd HH:mm:ss@2026-10-07T05:03:00.000Z')
  })

  test('Details opens the job drawer with its facts, notices and download', async () => {
    renderPage()
    await loaded()
    const table = await openHistory()
    const completed = within(table).getByText('Players Data').closest('tr') as HTMLElement
    fireEvent.click(within(completed).getByRole('button', { name: 'Details' }))
    const drawer = screen.getByRole('dialog', { name: 'Export Details' })
    assert.deepEqual(
      Array.from(drawer.querySelectorAll('dt')).map((term) => term.textContent),
      ['Export Type', 'Format', 'Status', 'Created', 'Completed'],
    )
    within(drawer).getByText('yyyy-MM-dd HH:mm:ss@2026-10-07T05:00:00.000Z')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Download File (CSV)' }))
    assert.equal(feedback.download.mock.calls[0]?.[1], 'job-completed-0001')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close dialog' }))
    assert.equal(screen.queryByRole('dialog'), null)

    const failed = within(table).getByText('Audit Logs').closest('tr') as HTMLElement
    fireEvent.click(within(failed).getByRole('button', { name: 'Details' }))
    const failedDrawer = screen.getByRole('dialog', { name: 'Export Details' })
    within(failedDrawer).getByText('Error')
    within(failedDrawer).getByText('Export Failed')
    assert.equal(within(failedDrawer).getAllByText('Unsupported filter').length, 2)
    assert.equal(within(failedDrawer).queryByRole('button', { name: /Download File/ }), null)
    fireEvent.click(within(failedDrawer).getByRole('button', { name: 'Close dialog' }))

    const pending = within(table).getByText('mystery-report').closest('tr') as HTMLElement
    fireEvent.click(within(pending).getByRole('button', { name: 'Details' }))
    within(screen.getByRole('dialog', { name: 'Export Details' })).getByText('Export in Progress')
  })

  test('loading, empty and failed history', async () => {
    server.jobsMode = 'pending'
    const { unmount } = renderPage()
    await screen.findByText('Monthly Players Report')
    await openHistory()
    screen.getByText('Loading Export history')
    unmount()

    server.jobsMode = 'ok'
    server.jobs = []
    const empty = renderPage()
    await screen.findByText('Monthly Players Report')
    await openHistory()
    await screen.findByText('No exports yet. Create your first export from the Create Export tab.')
    assert.ok(screen.queryByText(/of 0 exports/) === null)
    assert.ok(screen.queryByText(/currently in progress/) === null)
    empty.unmount()

    server.jobsMode = 'error'
    renderPage()
    await screen.findByText('Monthly Players Report')
    await openHistory()
    await screen.findByText('Export history could not be loaded.')
    screen.getByRole('button', { name: 'Retry' })
  })
})
