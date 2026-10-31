/**
 * /bonuses/:id/edit against a mocked GraphQL server (MockedProvider + MemoryRouter): the exact query and
 * update documents and variables, the guard, the loading and not-found states, a form whose first
 * commit already holds the campaign, the legacy controls per type, the update input (untouched dates
 * sent as stored, cleared numbers as null), validation, the toasts, navigation and the refetch that
 * does not reload the form.
 *
 * The page's documents are private to its module, so the mocks are built with graphql's parse() from
 * the same text; a changed page document stops matching and fails these tests.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { GraphQLError, parse } from 'graphql'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import BonusEditPage from './BonusEditPage'
import type { BonusCampaignRecord } from './bonusEditModel'

const QUERY_DOCUMENT = parse(`
  query GetBonusCampaign($id: ID!) {
    bonusCampaign(id: $id) {
      id
      name
      domain
      type
      status
      currency
      budgetNumeric
      depositConditionType
      depositConditionAmount
      distributionType
      amountType
      depositRequired
      releaseType
      amount
      percentage
      numberOfPlayers
      usagePerPlayer
      startDate
      endDate
      wagering
      expiryBonusDays
    }
  }
`)

const UPDATE_DOCUMENT = parse(`
  mutation UpdateBonusCampaign($input: BonusCampaignUpdateInput!) {
    updateBonusCampaign(input: $input) {
      success
      message
      campaign {
        id
        name
        domain
        type
        status
      }
    }
  }
`)

type Reply = { success: boolean; message: string } | Error

const feedback = vi.hoisted(() => ({ toast: vi.fn() }))
const rbac = vi.hoisted(() => ({
  allowed: true,
  calls: [] as Array<Array<{ domain: string; actions: string[] }>>,
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: { required: Array<{ domain: string; actions: string[] }>; children: ReactNode }) => {
    rbac.calls.push(required)
    return rbac.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    currencies: [
      { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2, isActive: true, exchangeRate: 1 },
      { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2, isActive: false, exchangeRate: 0.012 },
      { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', decimals: 2, isActive: true, exchangeRate: 0.044 },
    ],
  }),
}))

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

const TOAST_MS = 4500

const DEPOSIT: BonusCampaignRecord = {
  id: '42',
  name: 'Weekend reload',
  domain: 'global',
  type: 'deposit',
  status: 'active',
  currency: 'INR',
  budgetNumeric: 250000,
  depositConditionType: 'greater_than',
  depositConditionAmount: 1000,
  distributionType: 'roll_over',
  amountType: 'percentage',
  depositRequired: null,
  releaseType: 'total_bonus_wallet',
  amount: null,
  percentage: 25,
  numberOfPlayers: 500,
  usagePerPlayer: 2,
  startDate: '2026-09-22T09:00:30.000Z',
  endDate: '2026-10-22T18:29:59.000Z',
  wagering: 3,
  expiryBonusDays: 7,
}

interface Server {
  campaign: BonusCampaignRecord | null
  queryCalls: Array<Record<string, unknown>>
  updates: Array<Record<string, unknown>>
  replies: Reply[]
}

let server: Server

const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>

function queryMock(): MockedResponse {
  return {
    request: { query: QUERY_DOCUMENT },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      server.queryCalls.push(plain(variables))
      return {
        data: { bonusCampaign: server.campaign ? { __typename: 'BonusCampaign', ...server.campaign } : null },
      }
    },
  }
}

function updateMock(): MockedResponse {
  return {
    request: { query: UPDATE_DOCUMENT },
    variableMatcher: () => true,
    maxUsageCount: Number.POSITIVE_INFINITY,
    result: (variables: Record<string, unknown>) => {
      server.updates.push(plain(variables))
      const reply = server.replies.shift() ?? { success: true, message: 'Bonus campaign updated successfully' }
      if (reply instanceof Error) return { errors: [new GraphQLError(reply.message)] }
      return {
        data: {
          updateBonusCampaign: {
            __typename: 'BonusCampaignPayload',
            success: reply.success,
            message: reply.message,
            campaign: reply.success
              ? { __typename: 'BonusCampaign', id: '42', name: 'x', domain: 'global', type: 'deposit', status: 'active' }
              : null,
          },
        },
      }
    },
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderPage(path = '/bonuses/42/edit') {
  return render(
    <MockedProvider mocks={[queryMock(), updateMock()]}>
      <MemoryRouter initialEntries={[path]}>
        <PageEyebrowProvider value="Marketing">
          <Routes>
            <Route path="/bonuses/:id/edit" element={<BonusEditPage />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

function textbox(name: RegExp) {
  return screen.getByRole('textbox', { name }) as HTMLInputElement
}

function combobox(name: RegExp) {
  return screen.getByRole('combobox', { name }) as HTMLSelectElement
}

function choose(name: RegExp, value: string) {
  fireEvent.change(combobox(name), { target: { value } })
}

function type(name: RegExp, value: string) {
  fireEvent.change(textbox(name), { target: { value } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Update Campaign' }))
}

async function renderLoaded(path?: string) {
  const view = renderPage(path)
  await screen.findByRole('textbox', { name: /^Campaign Name/ })
  // NumberField fills its text from the value in an effect of its own.
  await waitFor(() => assert.equal(textbox(/^Number of Players/).value, '500'))
  return view
}

beforeEach(() => {
  server = { campaign: { ...DEPOSIT }, queryCalls: [], updates: [], replies: [] }
  feedback.toast.mockReset()
  rbac.allowed = true
  rbac.calls.length = 0
})

afterEach(cleanup)

describe('BonusEditPage', () => {
  test('keeps the guard and query, shows the loading state, then a form that first appears filled', async () => {
    let firstValues: string[] | null = null
    const observer = new MutationObserver(() => {
      if (firstValues) return
      const name = document.querySelector<HTMLInputElement>('input[name="campaignName"]')
      if (!name) return
      const select = (field: string) => document.querySelector<HTMLSelectElement>(`select[name="${field}"]`)?.value ?? '?'
      const date = document.querySelector<HTMLInputElement>('input[name="startDate"]')?.value ?? '?'
      firstValues = [name.value, select('currency'), select('bonusType'), select('status'), date]
    })
    observer.observe(document.body, { childList: true, subtree: true })
    try {
      renderPage()
      assert.deepEqual(rbac.calls[0], [{ domain: 'bonuses.detail', actions: ['view', 'update'] }])
      assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Edit Bonus Campaign')
      assert.ok(screen.queryByText('Update bonus campaign settings') === null)
      assert.ok(screen.getByText('Loading bonus campaign'))
      await screen.findByRole('textbox', { name: /^Campaign Name/ })
    } finally {
      observer.disconnect()
    }
    assert.deepEqual(server.queryCalls[0], { id: '42' })
    assert.deepEqual(firstValues, ['Weekend reload', 'INR', 'deposit', 'active', '2026-09-22T14:30'])
  })

  test('denies through the unchanged guard without querying', async () => {
    rbac.allowed = false
    renderPage()
    assert.ok(screen.getByRole('alert'))
    assert.ok(screen.queryByRole('heading', { level: 1 }) === null, 'no page heading')
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(server.queryCalls.length, 0)
  })

  test('says the campaign was not found and goes back to the list', async () => {
    server.campaign = null
    renderPage()
    await screen.findByText('Campaign not found')
    assert.ok(screen.queryByRole('textbox', { name: /^Campaign Name/ }) === null, 'no form')
    fireEvent.click(screen.getByRole('button', { name: 'Back to List' }))
    assert.equal(screen.getByTestId('location').textContent, '/bonuses')
  })

  test('loads every legacy control with the campaign values', async () => {
    await renderLoaded()
    assert.equal(textbox(/^Campaign Name/).value, 'Weekend reload')
    assert.deepEqual(
      within(combobox(/^Currency/)).getAllByRole('option').map((option) => option.textContent),
      ['Select currency', '₹ INR - Indian Rupee', 'د.إ AED - UAE Dirham'],
    )
    assert.deepEqual(
      within(combobox(/^Bonus Type/)).getAllByRole('option').map((option) => (option as HTMLOptionElement).value),
      ['', 'deposit', 'daily_first_deposit', 'signup', 'direct_amount', 'referral_deposit', 'losing_bonus', 'special'],
    )
    assert.equal(combobox(/^Status/).value, 'active')
    assert.equal(combobox(/^Deposit Condition Type/).value, 'greater_than')
    await waitFor(() => assert.equal(textbox(/^Deposit Condition Amount/).value, '1,000'))
    assert.equal(combobox(/^Distribution Type/).value, 'roll_over')
    assert.equal(textbox(/^Wagering Requirement/).value, '3')
    assert.equal(combobox(/^Bonus Amount Release Type/).value, 'total_bonus_wallet')
    assert.equal((screen.getByRole('radio', { name: 'Percentage' }) as HTMLInputElement).checked, true)
    assert.equal(textbox(/^Percentage/).value, '25')
    assert.ok(screen.queryByRole('textbox', { name: /^Amount$/ }) === null, 'Amount hidden for a percentage')
    assert.equal(textbox(/^Usage Per Player/).value, '2')
    assert.equal(textbox(/^Expiry bonus/).value, '7')
    assert.equal((screen.getByLabelText(/^Start Date/) as HTMLInputElement).value, '2026-09-22T14:30')
    assert.equal((screen.getByLabelText(/^End Date/) as HTMLInputElement).value, '2026-10-22T23:59')
    assert.equal(textbox(/^Budget/).value, '2,50,000')
    assert.ok(screen.queryByRole('combobox', { name: /^Domain/ }) === null, 'Domain only for Losing Bonus')
  })

  test('saves the loaded campaign as the legacy input, toasts and opens the campaign', async () => {
    await renderLoaded()
    submit()
    await waitFor(() => assert.equal(server.updates.length, 1))
    assert.deepEqual(server.updates[0], {
      input: {
        id: '42',
        name: 'Weekend reload',
        domain: 'global',
        type: 'deposit',
        status: 'active',
        currency: 'INR',
        budgetNumeric: 250000,
        depositConditionType: 'greater_than',
        depositConditionAmount: 1000,
        distributionType: 'roll_over',
        amountType: 'percentage',
        percentage: 25,
        numberOfPlayers: 500,
        usagePerPlayer: 2,
        startDate: '2026-09-22T09:00:30.000Z',
        endDate: '2026-10-22T18:29:59.000Z',
        wagering: 3,
        expiryBonusDays: 7,
        releaseType: 'total_bonus_wallet',
      },
    })
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[0][0], {
      title: 'Success',
      message: 'Bonus campaign updated successfully',
      tone: 'ok',
      duration: TOAST_MS,
    }))
    await waitFor(() => assert.equal(screen.getByTestId('location').textContent, '/bonuses/42'))
  })

  test('sends edits: a new status and date, a cleared limit as null, Losing Bonus forced values', async () => {
    await renderLoaded()
    choose(/^Status/, 'paused')
    fireEvent.change(screen.getByLabelText(/^Start Date/), { target: { value: '2026-09-23T10:00' } })
    type(/^Usage Per Player/, '')
    choose(/^Bonus Type/, 'losing_bonus')
    // Losing Bonus: Domain appears, Distribution reads a disabled Roll Over, the release type stays.
    choose(/^Domain/, 'sports')
    const distribution = combobox(/^Distribution Type/)
    assert.equal(distribution.disabled, true)
    assert.equal(distribution.value, 'roll_over')
    assert.ok(screen.queryByRole('group', { name: /^Amount Type/ }) === null, 'Amount Type hidden')
    assert.equal(textbox(/^Percentage/).value, '25')
    submit()

    await waitFor(() => assert.equal(server.updates.length, 1))
    const input = server.updates[0].input as Record<string, unknown>
    assert.equal(input.status, 'paused')
    assert.equal(input.type, 'losing_bonus')
    assert.equal(input.domain, 'sports')
    assert.equal(input.distributionType, 'roll_over')
    assert.equal(input.amountType, 'percentage')
    assert.equal(input.releaseType, 'total_bonus_wallet')
    assert.equal(input.startDate, '2026-09-23T04:30:00.000Z')
    assert.equal(input.endDate, '2026-10-22T18:29:59.000Z')
    assert.equal(input.usagePerPlayer, null)
    assert.equal('depositConditionType' in input, false)
  })

  test('switches to Signup with its forced Fixed amount and Deposit Required', async () => {
    await renderLoaded()
    choose(/^Bonus Type/, 'signup')
    assert.ok(screen.getByRole('group', { name: /^Deposit Required/ }))
    assert.ok(screen.queryByRole('textbox', { name: /^Usage Per Player/ }) === null, 'Usage hidden for Signup')
    assert.equal(
      within(combobox(/^Distribution Type/)).getByRole('option', { name: 'Roll Over' }).hasAttribute('disabled'),
      true,
    )
    type(/^Amount/, '150')
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }))
    submit()
    await waitFor(() => assert.equal(server.updates.length, 1))
    const input = server.updates[0].input as Record<string, unknown>
    assert.equal(input.amountType, 'fixed')
    assert.equal(input.amount, 150)
    assert.equal(input.depositRequired, true)
    assert.equal('usagePerPlayer' in input, false)
    assert.equal(input.percentage, undefined)
  })

  test('blocks an invalid form, focuses the first field and says why', async () => {
    await renderLoaded()
    type(/^Campaign Name/, 'ab')
    type(/^Percentage/, '')
    submit()
    await waitFor(() => assert.ok(screen.getByText('Campaign name must be at least 3 characters')))
    assert.ok(screen.getByText('Percentage is required'))
    assert.ok(screen.getByText('Campaign not updated'))
    assert.ok(screen.getByText('Fix 2 highlighted fields and submit again.'))
    const name = textbox(/^Campaign Name/)
    await waitFor(() => assert.ok(document.activeElement === name, 'Campaign Name has focus'))
    assert.equal(server.updates.length, 0)
  })

  test('keeps a legacy bonus type as loaded and saves it', async () => {
    server.campaign = { ...DEPOSIT, type: 'deposit_match', depositConditionType: 'less_than' }
    await renderLoaded()
    const bonusType = combobox(/^Bonus Type/)
    assert.equal(bonusType.value, 'deposit_match')
    assert.equal(within(bonusType).getByRole('option', { name: 'deposit_match' }).hasAttribute('disabled'), true)
    assert.ok(screen.queryByRole('combobox', { name: /^Deposit Condition Type/ }) === null, 'not a deposit family')
    submit()
    await waitFor(() => assert.equal(server.updates.length, 1))
    const input = server.updates[0].input as Record<string, unknown>
    assert.equal(input.type, 'deposit_match')
    assert.equal('depositConditionType' in input, false)
  })

  test('reports refused and failed updates, stays on the form and keeps what was typed', async () => {
    server.replies = [
      { success: false, message: 'Only one signup campaign can be active' },
      { success: false, message: '' },
      new Error('Network unavailable'),
    ]
    await renderLoaded()
    type(/^Campaign Name/, 'Weekend reload v2')
    submit()
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[0]?.[0], {
      title: 'Error',
      message: 'Only one signup campaign can be active',
      tone: 'error',
      duration: TOAST_MS,
    }))
    // The update refetched the campaign; the form keeps the admin's edit (it loads only once).
    await waitFor(() => assert.ok(server.queryCalls.length >= 2, 'the campaign was refetched'))
    assert.equal(textbox(/^Campaign Name/).value, 'Weekend reload v2')

    submit()
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[1]?.[0], {
      title: 'Error',
      message: 'Failed to update campaign',
      tone: 'error',
      duration: TOAST_MS,
    }))
    submit()
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[2]?.[0], {
      title: 'Error',
      message: 'Network unavailable',
      tone: 'error',
      duration: TOAST_MS,
    }))
    assert.ok(screen.queryByTestId('location') === null, 'still on the edit page')
  })

  test('cancels back to the campaign without saving', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.equal(screen.getByTestId('location').textContent, '/bonuses/42')
    assert.equal(server.updates.length, 0)
  })
})
