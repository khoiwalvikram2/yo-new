/**
 * /referrals/program mounted against MockedProvider and a MemoryRouter: both documents exactly as written,
 * the RBAC requirement and its denial, the stored program in the form (revenue share out, hidden types
 * kept), the exact upsert input and its toasts, the refetch, the unsaved-changes notice, the legacy
 * validation messages with focus on the first invalid field, the reward checkboxes' antd order, a refused
 * and a failed save, Cancel and the back link. The guard and toast are stubs; everything else is real.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { parse, print, type DocumentNode } from 'graphql'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import ProgramEditorPage from './ProgramEditorPage'

const PROGRAM_TEXT = 'query ReferralProgram { referralProgramByTenant { id name enabledModes maxDepth flags minReferralBalanceForCashTransfer } }'
const UPSERT_TEXT = 'mutation UpsertReferralProgram($input: ReferralProgramInput!) { upsertReferralProgram(input: $input) { success message program { id name enabledModes maxDepth minReferralBalanceForCashTransfer } } }'

const apollo = vi.hoisted(() => ({
  queries: [] as Array<{ query: unknown; options: unknown }>,
  mutations: [] as Array<{ mutation: unknown; options: unknown }>,
}))
const rbac = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))
const feedback = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return {
    ...actual,
    useQuery: (...args: Parameters<typeof actual.useQuery>) => {
      apollo.queries.push({ query: args[0], options: args[1] })
      return actual.useQuery(...args)
    },
    useMutation: (...args: Parameters<typeof actual.useMutation>) => {
      apollo.mutations.push({ mutation: args[0], options: args[1] })
      return actual.useMutation(...args)
    },
  }
})

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: { required: Array<{ domain: string; actions: string[] }>; children: ReactNode }) => {
    rbac.calls.push(required)
    return rbac.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()
// The document's own source text, whitespace-normalised (what gate 10 compares).
const sourceOf = (document: unknown) => normalise((document as DocumentNode).loc?.source.body ?? '')

interface StoredProgram {
  __typename: 'ReferralProgram'
  id: string
  name: string
  enabledModes: string[]
  maxDepth: number
  flags: unknown
  minReferralBalanceForCashTransfer: number | null
}

interface ServerState {
  program: StoredProgram | null
  programCalls: number
  saves: Array<Record<string, unknown>>
  answer: { success: boolean; message: string | null } | null
  failWith: string | null
}

let server: ServerState

function mocks(): MockedResponse[] {
  return [
    {
      request: { query: parse(PROGRAM_TEXT) },
      maxUsageCount: Number.POSITIVE_INFINITY,
      result: () => {
        server.programCalls += 1
        return { data: { referralProgramByTenant: server.program } }
      },
    },
    {
      request: { query: parse(UPSERT_TEXT) },
      variableMatcher: (variables) => {
        server.saves.push((variables as { input: Record<string, unknown> }).input)
        return true
      },
      maxUsageCount: Number.POSITIVE_INFINITY,
      result: (variables: Record<string, unknown>) => {
        if (server.failWith) throw new Error(server.failWith)
        const input = variables.input as { name: string; enabledModes: string[]; maxDepth: number; minReferralBalanceForCashTransfer: number }
        const answer = server.answer ?? { success: true, message: 'Program saved' }
        if (answer.success && server.program) server.program = { ...server.program, ...input }
        return {
          data: {
            upsertReferralProgram: {
              __typename: 'ReferralProgramPayload',
              success: answer.success,
              message: answer.message,
              program: answer.success && server.program
                ? {
                    __typename: 'ReferralProgram',
                    id: server.program.id,
                    name: server.program.name,
                    enabledModes: server.program.enabledModes,
                    maxDepth: server.program.maxDepth,
                    minReferralBalanceForCashTransfer: server.program.minReferralBalanceForCashTransfer,
                  }
                : null,
            },
          },
        }
      },
    },
  ]
}

function failingSave(message: string): MockedResponse {
  return {
    request: { query: parse(UPSERT_TEXT) },
    variableMatcher: (variables) => {
      server.saves.push((variables as { input: Record<string, unknown> }).input)
      return true
    },
    error: new Error(message),
  }
}

function renderPage(extra: MockedResponse[] = []) {
  return render(
    <MockedProvider mocks={[...extra, ...mocks()]}>
      <MemoryRouter initialEntries={['/referrals/program']}>
        <PageEyebrowProvider value="Marketing">
          <Routes>
            <Route path="/referrals/program" element={<ProgramEditorPage />} />
            <Route path="/referrals" element={<p>Referrals overview</p>} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

const nameInput = () => screen.getByRole('textbox', { name: /Program Name/ }) as HTMLInputElement
const depthInput = () => screen.getByRole('textbox', { name: /Max Tier Depth/ }) as HTMLInputElement
const minimumInput = () => screen.getByRole('textbox', { name: /Min Balance to Transfer to Cash/ }) as HTMLInputElement
const checkbox = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement

beforeEach(() => {
  apollo.queries.length = 0
  apollo.mutations.length = 0
  rbac.allowed = true
  rbac.calls.length = 0
  feedback.toast.mockReset()
  server = {
    program: {
      __typename: 'ReferralProgram',
      id: 'p1',
      name: 'Default Referral Program',
      enabledModes: ['REVSHARE', 'FIRST_DEPOSIT_PCT', 'LOSS_SHARE'],
      maxDepth: 3,
      flags: null,
      minReferralBalanceForCashTransfer: 500,
    },
    programCalls: 0,
    saves: [],
    answer: null,
    failWith: null,
  }
})

describe('ProgramEditorPage', () => {
  test('requires referrals.program view, and a denied caller starts no query and no mutation hook', () => {
    rbac.allowed = false
    renderPage()
    assert.equal(screen.getByRole('alert').textContent, 'Access denied')
    assert.deepEqual(rbac.calls[0], [{ domain: 'referrals.program', actions: ['view'] }])
    assert.equal(apollo.queries.length, 0)
    assert.equal(apollo.mutations.length, 0)
  })

  test('both documents unchanged; the query with errorPolicy all; a loading state until the program is known', async () => {
    renderPage()
    assert.ok(screen.getByText('Loading referral program'))
    await screen.findByDisplayValue('Default Referral Program')
    const query = apollo.queries[0]
    const mutation = apollo.mutations[0]
    assert.equal(sourceOf(query.query), PROGRAM_TEXT)
    assert.equal(print(query.query as DocumentNode), print(parse(PROGRAM_TEXT)))
    assert.deepEqual(query.options, { errorPolicy: 'all' })
    assert.equal(sourceOf(mutation.mutation), UPSERT_TEXT)
    assert.equal(print(mutation.mutation as DocumentNode), print(parse(UPSERT_TEXT)))
    const options = mutation.options as { onCompleted?: unknown; onError?: unknown }
    assert.equal(typeof options.onCompleted, 'function')
    assert.equal(typeof options.onError, 'function')
  })

  test('the header, the attribution notice, the fields with their legacy help, and the stored values', async () => {
    renderPage()
    await screen.findByDisplayValue('Default Referral Program')
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Referral Program Settings')
    assert.ok(screen.queryByText('Configure your referral program settings and enabled reward types') === null)
    assert.ok(screen.queryByText('Marketing') === null)
    assert.equal(screen.getByRole('link', { name: 'Back to Referrals' }).getAttribute('href'), '/referrals')
    assert.equal(screen.getByRole('heading', { level: 2 }).textContent, 'Attribution Method')
    assert.ok(screen.getByText('Code-Only Attribution'))
    assert.ok(screen.getByText(/Referral attribution is code-only and permanent\./))
    assert.ok(screen.getByText(/you'll need to create and configure individual rules for each type in the Rules section\./))
    assert.ok(screen.getByText('A descriptive name for your referral program'))
    assert.ok(screen.getByText(/Maximum number of referral tiers \(1-4\)\. Only Loss Share supports multi-tier\./))
    assert.ok(screen.getByText(/Minimum referral balance required before a user can transfer to their cash wallet/))
    assert.equal(depthInput().value, '3')
    assert.equal(minimumInput().value, '500')
    assert.equal(nameInput().placeholder, 'Default Referral Program')
    assert.equal(checkbox('Signup CPA').checked, false)
    assert.equal(checkbox('First Deposit %').checked, true)
    assert.equal(checkbox('Reload Deposits %').checked, false)
    assert.equal(screen.queryByRole('checkbox', { name: 'Loss Share' }), null)
    assert.ok(screen.queryByText('You have unsaved changes') === null)
  })

  test('with no program the form starts from the legacy defaults', async () => {
    server.program = null
    renderPage()
    await screen.findByRole('button', { name: 'Save Changes' })
    assert.equal(nameInput().value, '')
    assert.equal(depthInput().value, '4')
    assert.equal(minimumInput().value, '0')
    assert.equal(checkbox('Signup CPA').checked, false)
    assert.equal(checkbox('First Deposit %').checked, false)
  })

  test('an edit raises the unsaved notice; Save sends the exact input, toasts, refetches and clears it', async () => {
    renderPage()
    await screen.findByDisplayValue('Default Referral Program')
    fireEvent.change(nameInput(), { target: { value: 'Festive Referrals' } })
    assert.ok(screen.getByText('You have unsaved changes'))
    const calls = server.programCalls

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.equal(server.saves.length, 1))
    // Untouched checkboxes keep the hidden Loss Share, as antd did; revenue share is never sent.
    assert.deepEqual(server.saves[0], {
      name: 'Festive Referrals',
      enabledModes: ['FIRST_DEPOSIT_PCT', 'LOSS_SHARE'],
      maxDepth: 3,
      minReferralBalanceForCashTransfer: 500,
    })
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls.at(-1)?.[0], {
      message: 'Program saved',
      tone: 'ok',
      duration: 3000,
    }))
    await waitFor(() => assert.equal(server.programCalls, calls + 1))
    await waitFor(() => assert.ok(screen.queryByText('You have unsaved changes') === null))
    assert.equal(nameInput().value, 'Festive Referrals')
  })

  test('changing a reward checkbox keeps the stored order, appends, and drops the hidden types', async () => {
    renderPage()
    await screen.findByDisplayValue('Default Referral Program')
    fireEvent.click(checkbox('Signup CPA'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.equal(server.saves.length, 1))
    assert.deepEqual(server.saves[0].enabledModes, ['FIRST_DEPOSIT_PCT', 'SIGNUP_CPA'])
  })

  test('the legacy messages block the save and the first invalid field takes focus', async () => {
    renderPage()
    await screen.findByDisplayValue('Default Referral Program')
    fireEvent.change(nameInput(), { target: { value: '' } })
    fireEvent.click(checkbox('First Deposit %'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await screen.findByText('Program name is required')
    // The hidden Loss Share left with the checkbox change, so no reward type remains.
    assert.ok(screen.getByText('At least one reward type must be enabled'))
    await waitFor(() => assert.equal(document.activeElement, nameInput()))
    assert.equal(server.saves.length, 0)

    fireEvent.change(nameInput(), { target: { value: 'ab' } })
    fireEvent.blur(nameInput())
    await screen.findByText('At least 3 characters')
  })

  test('a fractional depth is refused inline; an out-of-range depth is clamped on blur', async () => {
    renderPage()
    await screen.findByDisplayValue('Default Referral Program')
    fireEvent.focus(depthInput())
    fireEvent.change(depthInput(), { target: { value: '2.5' } })
    fireEvent.blur(depthInput())
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await screen.findByText('Enter a whole number')
    assert.equal(server.saves.length, 0)

    fireEvent.focus(depthInput())
    fireEvent.change(depthInput(), { target: { value: '9' } })
    fireEvent.blur(depthInput())
    await waitFor(() => assert.equal(depthInput().value, '4'))
  })

  test('a refused save shows the server message for 5 seconds and keeps the edit and the notice', async () => {
    server.answer = { success: false, message: 'A program name must be unique' }
    renderPage()
    await screen.findByDisplayValue('Default Referral Program')
    fireEvent.change(nameInput(), { target: { value: 'Taken Name' } })
    const calls = server.programCalls
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls.at(-1)?.[0], {
      message: 'A program name must be unique',
      tone: 'error',
      duration: 5000,
    }))
    assert.equal(server.programCalls, calls)
    assert.equal(nameInput().value, 'Taken Name')
    assert.ok(screen.getByText('You have unsaved changes'))
  })

  test('a failed request toasts its message', async () => {
    renderPage([failingSave('Network down')])
    await screen.findByDisplayValue('Default Referral Program')
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls.at(-1)?.[0], {
      message: 'Network down',
      tone: 'error',
      duration: 5000,
    }))
  })

  test('Close dismisses the notice and keeps the edit; Cancel returns to the overview', async () => {
    renderPage()
    await screen.findByDisplayValue('Default Referral Program')
    fireEvent.change(nameInput(), { target: { value: 'Edited' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    assert.ok(screen.queryByText('You have unsaved changes') === null)
    assert.equal(nameInput().value, 'Edited')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await screen.findByText('Referrals overview')
    assert.equal(server.saves.length, 0)
  })
})
