/**
 * /referrals/rules against a mocked GraphQL server (MockedProvider with a link that answers by operation
 * name): the guard, the documents and variables sent, the list and its states, and the rule drawer for
 * adding and editing each rule type, with the exact UpsertReferralRule input and its outcomes.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider } from '@apollo/client/testing'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { print } from 'graphql'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import RulesManagementPage from './RulesManagementPage'

interface GuardCall {
  required: Array<{ domain: string; actions: string[] }>
  requireAny?: boolean
}

interface ServerCall {
  operationName: string
  variables: Record<string, unknown>
  document: string
}

interface StoredRule {
  id: string
  ruleType: string
  tierRates?: Record<string, number> | null
  fixedAmounts?: Record<string, number> | null
  thresholds?: Record<string, number> | null
  payoutType: string
  reloadDepositsCount?: number | null
  reloadMinDeposit?: number | null
  isActive: boolean
  createdAt: string | null
}

interface ServerState {
  maxDepth: number | null
  rules: StoredRule[]
  rulesError: Error | null
  upsert: { success: boolean; message: string | null } | Error
  calls: ServerCall[]
}

const feedback = vi.hoisted(() => ({ toast: vi.fn() }))
const guard = vi.hoisted(() => ({ allowed: true, calls: [] as GuardCall[] }))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number) => `₹${Number(amount).toFixed(2)}`,
    getCurrencySymbol: () => '₹',
  }),
}))

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({
    formatDate: (value: string, pattern: string) => `date:${value}:${pattern}`,
    formatTime: (value: string, pattern: string) => `time:${value}:${pattern}`,
  }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, requireAny, children }: GuardCall & { children: ReactNode }) => {
    guard.calls.push({ required, requireAny })
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

const SIGNUP: StoredRule = {
  id: '11',
  ruleType: 'SIGNUP_CPA',
  fixedAmounts: { 1: 250 },
  payoutType: 'CASH',
  isActive: true,
  createdAt: '2026-09-01T10:00:00.000Z',
}
const RELOAD: StoredRule = {
  id: '12',
  ruleType: 'RELOAD_DEPOSITS_PCT',
  fixedAmounts: { 1: 2.5 },
  reloadDepositsCount: 5,
  reloadMinDeposit: 500,
  payoutType: 'BONUS',
  isActive: false,
  createdAt: null,
}
const REVSHARE: StoredRule = {
  id: '13',
  ruleType: 'REVSHARE',
  payoutType: 'SPLIT',
  isActive: true,
  createdAt: '2026-09-02T10:00:00.000Z',
}
const LOSS: StoredRule = {
  id: '14',
  ruleType: 'LOSS_SHARE',
  tierRates: { 1: 10, 3: 2 },
  payoutType: 'SPLIT',
  isActive: true,
  createdAt: '2026-09-03T10:00:00.000Z',
}
const TURNOVER: StoredRule = {
  id: '15',
  ruleType: 'TURNOVER_MILESTONE',
  fixedAmounts: { 1: 1 },
  thresholds: { turnoverTarget: 100000 },
  payoutType: 'CASH',
  isActive: true,
  createdAt: '2026-09-04T10:00:00.000Z',
}

let server: ServerState

function calls(operationName: string) {
  return server.calls.filter((call) => call.operationName === operationName)
}

/** Variables as they travel: undefined keys dropped, numeric JSON keys as strings. */
function lastSent(operationName: string) {
  const list = calls(operationName)
  return JSON.parse(JSON.stringify(list[list.length - 1]?.variables ?? null)) as { input: Record<string, unknown> }
}

function storedRule(rule: StoredRule) {
  return {
    __typename: 'ReferralRule',
    tierRates: null,
    fixedAmounts: null,
    caps: null,
    thresholds: null,
    splitRatio: null,
    escrow: null,
    reloadDepositsCount: null,
    reloadMinDeposit: null,
    updatedAt: rule.createdAt,
    ...rule,
  }
}

function answer(operation: Operation): FetchResult {
  switch (operation.operationName) {
    case 'ReferralProgram':
      return {
        data: { referralProgramByTenant: { __typename: 'ReferralProgram', id: 'p1', maxDepth: server.maxDepth } },
      }
    case 'ReferralRules':
      if (server.rulesError) throw server.rulesError
      return { data: { referralRules: server.rules.map(storedRule) } }
    case 'UpsertReferralRule': {
      if (server.upsert instanceof Error) throw server.upsert
      const input = operation.variables.input as { ruleType: string; isActive: boolean }
      return {
        data: {
          upsertReferralRules: {
            __typename: 'UpsertReferralRuleResult',
            success: server.upsert.success,
            message: server.upsert.message,
            rule: server.upsert.success
              ? { __typename: 'ReferralRule', id: '99', ruleType: input.ruleType, isActive: input.isActive }
              : null,
          },
        },
      }
    }
    default:
      throw new Error(`unexpected operation ${operation.operationName}`)
  }
}

const serverLink = new ApolloLink((operation) => new Observable<FetchResult>((observer) => {
  server.calls.push({
    operationName: operation.operationName,
    variables: { ...operation.variables },
    document: print(operation.query).replace(/\s+/g, ' '),
  })
  Promise.resolve()
    .then(() => answer(operation))
    .then(
      (result) => {
        observer.next(result)
        observer.complete()
      },
      (error: unknown) => observer.error(error),
    )
}))

function renderPage() {
  return render(
    <MockedProvider link={serverLink}>
      <MemoryRouter initialEntries={['/referrals/rules']}>
        <PageEyebrowProvider value="Marketing">
          <RulesManagementPage />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

const table = () => screen.getByRole('table', { name: 'Referral rules' })

function bodyRows() {
  const [, ...rows] = within(table()).getAllByRole('row')
  return rows
}

async function renderLoaded() {
  const view = renderPage()
  await waitFor(() => assert.ok(screen.queryByText('Loading Referral rules') === null))
  await waitFor(() => assert.ok(calls('ReferralProgram').length === 1))
  return view
}

const drawer = (name: string) => screen.getByRole('dialog', { name })
const field = (name: RegExp) => within(screen.getByRole('dialog')).getByRole('textbox', { name }) as HTMLInputElement
const ruleTypeSelect = () =>
  within(screen.getByRole('dialog')).getByRole('combobox', { name: /^Rule Type/ }) as HTMLSelectElement

function type(name: RegExp, value: string) {
  fireEvent.change(field(name), { target: { value } })
}

async function submit(label: string) {
  await act(async () => {
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: label }))
  })
}

beforeEach(() => {
  feedback.toast.mockReset()
  guard.allowed = true
  guard.calls.length = 0
  server = {
    maxDepth: 1,
    rules: [SIGNUP, RELOAD, REVSHARE],
    rulesError: null,
    upsert: { success: true, message: 'Rule saved' },
    calls: [],
  }
})

describe('RulesManagementPage', () => {
  test('sends the two legacy queries behind the referrals.rules view guard', async () => {
    await renderLoaded()
    assert.deepEqual(guard.calls[0], { required: [{ domain: 'referrals.rules', actions: ['view'] }], requireAny: undefined })
    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Referral Rules')
    assert.ok(screen.queryByText('Configure reward rules for your referral program') === null)
    assert.equal(calls('ReferralRules').length, 1)
    assert.deepEqual(calls('ReferralRules')[0].variables, {})
    assert.match(calls('ReferralProgram')[0].document, /referralProgramByTenant \{ id maxDepth/)
    assert.match(
      calls('ReferralRules')[0].document,
      /referralRules\(programId: \$programId\) \{ id ruleType tierRates fixedAmounts caps thresholds payoutType splitRatio escrow reloadDepositsCount reloadMinDeposit isActive createdAt updatedAt/,
    )
  })

  test('a denied caller sees the denial and starts no query', async () => {
    guard.allowed = false
    renderPage()
    assert.ok(screen.getByRole('alert').textContent === 'Access denied')
    await act(async () => {
      await Promise.resolve()
    })
    assert.equal(server.calls.length, 0)
  })

  test('lists every rule but REVSHARE with its Config, payout tag, status and created time', async () => {
    await renderLoaded()
    await waitFor(() => assert.equal(bodyRows().length, 2))
    const headers = within(table()).getAllByRole('columnheader').map((header) => header.textContent)
    assert.deepEqual(headers, ['Rule Type', 'Payout Type', 'Status', 'Created', 'Actions'])
    const [signup, reload] = bodyRows()
    assert.match(signup.textContent ?? '', /Signup CPAConfig:₹250\.00CASHActive/)
    assert.ok(within(signup).getByText('date:2026-09-01T10:00:00.000Z:MMM d, yyyy'))
    assert.ok(within(signup).getByText('time:2026-09-01T10:00:00.000Z:HH:mm'))
    assert.match(reload.textContent ?? '', /Reload Deposits %Config:2\.5% \(5 deposits, min ₹500\.00\)BONUSInactive—/)
    assert.ok(screen.getByText('1 of 2 rules active'))
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Referral Rules' }))
    assert.ok(screen.queryByText('No Rules Configured') === null)
  })

  test('with no rules: the notice and the empty table, and Create Rule opens a blank drawer', async () => {
    server.rules = [REVSHARE]
    await renderLoaded()
    assert.ok(await screen.findByText('No Rules Configured'))
    assert.ok(screen.getByText(/Create your first referral rule to start earning rewards/))
    assert.ok(within(table()).getByText('No rules configured'))
    assert.ok(screen.getByText('0 of 0 rules active'))
    fireEvent.click(screen.getByRole('button', { name: 'Create Rule' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create Rule' })
    assert.ok(within(dialog).getByText('New Referral Rule'))
    assert.ok(within(dialog).getByText('Configure a new referral rule'))
    assert.equal(ruleTypeSelect().value, '')
    assert.ok(within(dialog).queryByText('Rule Configuration') === null)
    assert.equal((within(dialog).getByRole('combobox', { name: /^Payout Type/ }) as HTMLSelectElement).value, 'CASH')
    assert.equal(within(dialog).getByRole('switch', { name: 'Active' }).getAttribute('aria-checked'), 'true')
  })

  test('a failed rules query says so with Retry instead of the empty notice', async () => {
    server.rulesError = new Error('Network down')
    renderPage()
    assert.ok(await screen.findByText('Could not load rules. Network down'))
    assert.ok(screen.queryByText('No Rules Configured') === null)
    server.rulesError = null
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => assert.equal(bodyRows().length, 2))
    assert.equal(calls('ReferralRules').length, 2)
  })

  test('adding a rule: configured types are disabled, the field is required, and the exact input is sent', async () => {
    await renderLoaded()
    await waitFor(() => assert.equal(bodyRows().length, 2))
    fireEvent.click(screen.getByRole('button', { name: 'Add Rule' }))
    await screen.findByRole('dialog', { name: 'Create Rule' })

    const options = within(ruleTypeSelect()).getAllByRole('option') as HTMLOptionElement[]
    assert.deepEqual(
      options.map((option) => [option.textContent, option.disabled]),
      [
        ['Select rule type', true],
        ['Signup CPA (already configured)', true],
        ['First Deposit %', false],
        ['Reload Deposits % (already configured)', true],
      ],
    )

    await submit('Create Rule')
    assert.ok(await within(drawer('Create Rule')).findByText('Rule type is required'))
    assert.equal(calls('UpsertReferralRule').length, 0)

    fireEvent.change(ruleTypeSelect(), { target: { value: 'FIRST_DEPOSIT_PCT' } })
    assert.ok(within(drawer('Create Rule')).getByText('New: First Deposit %'))
    assert.ok(within(drawer('Create Rule')).getByText('Configure reward parameters for First Deposit %'))
    await submit('Create Rule')
    assert.ok(await within(drawer('Create Rule')).findByText('Percentage is required'))
    assert.ok(within(drawer('Create Rule')).getByText('Rule not saved'))
    assert.ok(within(drawer('Create Rule')).getByText('Fix 1 highlighted field and submit again.'))
    assert.ok(document.activeElement === field(/^First Deposit Percentage/))

    type(/^First Deposit Percentage/, '12.5')
    fireEvent.change(within(drawer('Create Rule')).getByRole('combobox', { name: /^Payout Type/ }), {
      target: { value: 'SPLIT' },
    })
    await submit('Create Rule')
    await waitFor(() => assert.equal(calls('UpsertReferralRule').length, 1))
    const { input } = lastSent('UpsertReferralRule')
    assert.deepEqual(input, {
      ruleType: 'FIRST_DEPOSIT_PCT',
      payoutType: 'SPLIT',
      splitRatio: { cash: 100, bonus: 0 },
      escrow: { untilKyc: false, untilFraudClear: false },
      isActive: true,
      fixedAmounts: { 1: 12.5 },
    })
    assert.deepEqual(Object.keys(input), ['ruleType', 'payoutType', 'splitRatio', 'escrow', 'isActive', 'fixedAmounts'])
    assert.match(calls('UpsertReferralRule')[0].document, /mutation UpsertReferralRule\(\$input: ReferralRuleInput!\)/)

    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null))
    assert.deepEqual(feedback.toast.mock.calls[0][0], { message: 'Rule saved', tone: 'ok', duration: 3000 })
    await waitFor(() => assert.equal(calls('ReferralRules').length, 2))
  })

  test('editing a Reload rule: its values, a locked type, Reset, the status switch and the input with its id', async () => {
    server.upsert = { success: true, message: null }
    await renderLoaded()
    await waitFor(() => assert.equal(bodyRows().length, 2))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Reload Deposits % rule' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Rule' })
    assert.ok(within(dialog).getByText('Editing: Reload Deposits %'))
    assert.ok(within(dialog).getByText('Update rule configuration'))
    assert.ok(within(dialog).getByText('Update rule configuration and settings'))
    assert.equal(ruleTypeSelect().value, 'RELOAD_DEPOSITS_PCT')
    assert.equal(ruleTypeSelect().disabled, true)
    assert.equal(field(/^Reload Deposits Percentage/).value, '2.5')
    assert.equal(field(/^Number of Last Deposits/).value, '5')
    assert.equal(field(/^Minimum Deposit Amount/).value, '500')
    const status = within(dialog).getByRole('switch', { name: 'Active' })
    assert.equal(status.getAttribute('aria-checked'), 'false')

    type(/^Number of Last Deposits/, '2.5')
    fireEvent.click(status)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
    assert.equal(field(/^Number of Last Deposits/).value, '5')
    assert.equal(within(dialog).getByRole('switch', { name: 'Active' }).getAttribute('aria-checked'), 'false')

    type(/^Number of Last Deposits/, '2.5')
    await submit('Save Changes')
    assert.ok(await within(dialog).findByText('Enter a whole number'))
    assert.equal(calls('UpsertReferralRule').length, 0)

    type(/^Number of Last Deposits/, '3')
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Active' }))
    await submit('Save Changes')
    await waitFor(() => assert.equal(calls('UpsertReferralRule').length, 1))
    assert.deepEqual(lastSent('UpsertReferralRule').input, {
      ruleType: 'RELOAD_DEPOSITS_PCT',
      payoutType: 'BONUS',
      splitRatio: { cash: 100, bonus: 0 },
      escrow: { untilKyc: false, untilFraudClear: false },
      isActive: true,
      ruleId: '12',
      fixedAmounts: { 1: 2.5 },
      reloadDepositsCount: 3,
      reloadMinDeposit: 500,
    })
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null))
    assert.deepEqual(feedback.toast.mock.calls[0][0], { message: 'Rule saved successfully', tone: 'ok', duration: 3000 })
  })

  test('a refused save stays open with the server message; a network error toasts its message', async () => {
    server.upsert = { success: false, message: 'Rule type already configured' }
    await renderLoaded()
    await waitFor(() => assert.equal(bodyRows().length, 2))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Signup CPA rule' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Rule' })
    assert.equal(field(/^Fixed Amount \(CPA\)/).value, '250')
    await submit('Save Changes')
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 1))
    assert.deepEqual(feedback.toast.mock.calls[0][0], {
      message: 'Rule type already configured',
      tone: 'error',
      duration: 5000,
    })
    assert.ok(screen.getByRole('dialog') === dialog)
    assert.equal(calls('ReferralRules').length, 1)

    server.upsert = new Error('Gateway timeout')
    await submit('Save Changes')
    await waitFor(() => assert.equal(feedback.toast.mock.calls.length, 2))
    assert.deepEqual(feedback.toast.mock.calls[1][0], { message: 'Gateway timeout', tone: 'error', duration: 5000 })
    assert.ok(screen.getByRole('dialog') === dialog)
  })

  test('Loss Share with tiers on: one field per tier, required by name, and every tier sent', async () => {
    server.maxDepth = 3
    server.rules = [LOSS, TURNOVER]
    await renderLoaded()
    await waitFor(() => assert.equal(bodyRows().length, 2))
    assert.match(bodyRows()[0].textContent ?? '', /Loss ShareConfig:L1: 10%, L3: 2%SPLIT/)
    assert.match(bodyRows()[1].textContent ?? '', /Turnover MilestoneConfig:1% @ ₹100000\.00/)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Loss Share rule' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Rule' })
    // A type the drawer does not offer keeps its raw value on show, as antd did.
    assert.equal(ruleTypeSelect().selectedOptions[0]?.textContent, 'LOSS_SHARE')
    assert.ok(within(dialog).getByText('Tier Rates (%) - 3 Tiers'))
    assert.deepEqual(
      [1, 2, 3].map((tier) => field(new RegExp(`^Tier ${tier}`)).value),
      ['10', '0', '2'],
    )
    type(/^Tier 2/, '')
    await submit('Save Changes')
    assert.ok(await within(dialog).findByText('Tier 2 percentage is required'))

    type(/^Tier 2/, '4')
    await submit('Save Changes')
    await waitFor(() => assert.equal(calls('UpsertReferralRule').length, 1))
    const { input } = lastSent('UpsertReferralRule')
    assert.deepEqual(input.tierRates, { 1: 10, 2: 4, 3: 2 })
    assert.deepEqual(input.fixedAmounts, {})
    assert.equal(input.ruleId, '14')
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null))

    fireEvent.click(screen.getByRole('button', { name: 'Edit Turnover Milestone rule' }))
    await screen.findByRole('dialog', { name: 'Edit Rule' })
    assert.equal(field(/^Turnover Percentage/).value, '1')
    assert.equal(field(/^Turnover Target/).value, '1,00,000')
    await submit('Save Changes')
    await waitFor(() => assert.equal(calls('UpsertReferralRule').length, 2))
    assert.deepEqual(lastSent('UpsertReferralRule').input.thresholds, { turnoverTarget: 100000 })
    assert.deepEqual(lastSent('UpsertReferralRule').input.fixedAmounts, { 1: 1 })
  })

  test('Cancel and the close button close the drawer without saving', async () => {
    await renderLoaded()
    await waitFor(() => assert.equal(bodyRows().length, 2))
    fireEvent.click(screen.getByRole('button', { name: 'Add Rule' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create Rule' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null))

    fireEvent.click(screen.getByRole('button', { name: 'Edit Signup CPA rule' }))
    const edit = await screen.findByRole('dialog', { name: 'Edit Rule' })
    fireEvent.click(within(edit).getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null))
    assert.equal(calls('UpsertReferralRule').length, 0)
  })
})
