import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { print, type DocumentNode } from 'graphql'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import BonusCreatePage from './BonusCreatePage'

interface GuardCall {
  required: Array<{ domain: string; actions: string[] }>
  requireAny?: boolean
}

const apollo = vi.hoisted(() => ({
  document: undefined as DocumentNode | undefined,
  mutate: vi.fn(),
  loading: false,
}))

const navigation = vi.hoisted(() => ({ navigate: vi.fn() }))
const feedback = vi.hoisted(() => ({ toast: vi.fn() }))
const guard = vi.hoisted(() => ({ allowed: true, calls: [] as GuardCall[] }))
const currencyState = vi.hoisted(() => ({ base: 'AED' }))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return {
    ...actual,
    useMutation: (document: DocumentNode) => {
      apollo.document = document
      return [apollo.mutate, { loading: apollo.loading }]
    },
  }
})

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigation.navigate }
})

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    currencies: [
      {
        code: 'INR',
        name: 'Indian Rupee',
        symbol: '₹',
        decimals: 2,
        isActive: true,
        exchangeRate: 1,
      },
      {
        code: 'USD',
        name: 'US Dollar',
        symbol: '$',
        decimals: 2,
        isActive: false,
        exchangeRate: 0.012,
      },
      {
        code: 'AED',
        name: 'UAE Dirham',
        symbol: 'د.إ',
        decimals: 2,
        isActive: true,
        exchangeRate: 0.044,
      },
    ],
    getWhitelabelBaseCurrencyCode: () => currencyState.base,
  }),
}))

vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({
    required,
    requireAny,
    children,
  }: GuardCall & { children: ReactNode }) => {
    guard.calls.push({ required, requireAny })
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

const TOAST_MS = 4500

function page() {
  return (
    <MemoryRouter>
      <PageEyebrowProvider value="MARKETING">
        <BonusCreatePage />
      </PageEyebrowProvider>
    </MemoryRouter>
  )
}

function renderPage() {
  return render(page())
}

function combobox(name: RegExp) {
  return screen.getByRole('combobox', { name }) as HTMLSelectElement
}

/** Text and number inputs. Native date-time inputs have no role, so they are found by label. */
function textbox(name: RegExp) {
  return screen.getByRole('textbox', { name }) as HTMLInputElement
}

function choose(name: RegExp, value: string) {
  fireEvent.change(combobox(name), { target: { value } })
}

function type(name: RegExp, value: string) {
  fireEvent.change(textbox(name), { target: { value } })
}

function enterDate(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create Campaign' }))
}

function fillDirectCampaign() {
  type(/^Campaign Name/, 'Launch reward')
  choose(/^Bonus Type/, 'direct_amount')
  type(/^Amount/, '500')
}

function successResult(id = '91', message = 'Bonus campaign created successfully') {
  return {
    data: {
      createBonusCampaignV2: {
        success: true,
        message,
        campaign: { id },
      },
    },
  }
}

beforeEach(() => {
  apollo.document = undefined
  apollo.loading = false
  apollo.mutate.mockReset()
  apollo.mutate.mockResolvedValue(successResult())
  navigation.navigate.mockReset()
  feedback.toast.mockReset()
  guard.allowed = true
  guard.calls.length = 0
  currencyState.base = 'AED'
})

afterEach(cleanup)

describe('BonusCreatePage', () => {
  test('keeps the exact mutation, RBAC requirement and active base-currency default', async () => {
    renderPage()

    assert.equal(screen.getByRole('heading', { level: 1 }).textContent, 'Create Bonus Campaign')
    assert.ok(screen.queryByText('MARKETING') === null)
    assert.deepEqual(guard.calls[0], {
      required: [{ domain: 'bonuses.create', actions: ['view', 'create'] }],
      requireAny: undefined,
    })
    assert.equal(print(apollo.document as DocumentNode), `mutation CreateBonusCampaign($input: BonusCampaignCreateInput!) {
  createBonusCampaignV2(input: $input) {
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
}`)

    const currency = screen.getByRole('combobox', { name: /Currency/i }) as HTMLSelectElement
    await waitFor(() => assert.equal(currency.value, 'AED'))
    assert.deepEqual(
      within(currency).getAllByRole('option').map((option) => [
        (option as HTMLOptionElement).value,
        option.textContent,
      ]),
      [
        ['', 'Select currency'],
        ['INR', '₹ INR - Indian Rupee'],
        ['AED', 'د.إ AED - UAE Dirham'],
      ],
    )

    const bonusType = screen.getByRole('combobox', { name: /Bonus Type/i })
    assert.ok(within(bonusType).queryByRole('option', { name: /referral/i }) === null, 'no referral option')
  })

  test('denies content through the unchanged guard when RBAC rejects the route', () => {
    guard.allowed = false
    renderPage()
    assert.ok(screen.getByRole('alert'))
    assert.ok(screen.queryByRole('heading', { name: 'Create Bonus Campaign' }) === null, 'no page heading')
    assert.equal(apollo.document, undefined, 'the guarded page hooks must not run when access is denied')
  })

  test('follows a base currency that arrives after mount but keeps a currency the admin chose', async () => {
    currencyState.base = ''
    const view = renderPage()
    assert.equal(combobox(/^Currency/).value, '')

    currencyState.base = 'INR'
    view.rerender(page())
    await waitFor(() => assert.equal(combobox(/^Currency/).value, 'INR'))

    choose(/^Currency/, 'AED')
    // Another CurrencyProvider render with the same base no longer resets the choice (named change).
    view.rerender(page())
    assert.equal(combobox(/^Currency/).value, 'AED')
  })

  test('shows a base currency that is not active rather than a blank select, and submits it', async () => {
    currencyState.base = 'USD'
    renderPage()
    const currency = combobox(/^Currency/)
    assert.equal(currency.value, 'USD')
    const retained = within(currency).getByRole('option', { name: 'USD' }) as HTMLOptionElement
    assert.equal(retained.disabled, true)

    fillDirectCampaign()
    submit()
    await waitFor(() => assert.equal(apollo.mutate.mock.calls.length, 1))
    assert.equal(apollo.mutate.mock.calls[0][0].variables.input.currency, 'USD')
  })

  test('mounts exactly the legacy controls for each offered bonus family', () => {
    const controls = {
      domain: () => screen.queryByRole('combobox', { name: /^Domain/ }),
      depositRequired: () => screen.queryByRole('group', { name: /^Deposit Required/ }),
      conditionType: () => screen.queryByRole('combobox', { name: /^Deposit Condition Type/ }),
      conditionAmount: () => screen.queryByRole('textbox', { name: /^Deposit Condition Amount/ }),
      wagering: () => screen.queryByRole('textbox', { name: /^Wagering Requirement/ }),
      releaseType: () => screen.queryByRole('combobox', { name: /^Bonus Amount Release Type/ }),
      amountType: () => screen.queryByRole('group', { name: /^Amount Type/ }),
      amount: () => screen.queryByRole('textbox', { name: /^Amount/ }),
      percentage: () => screen.queryByRole('textbox', { name: /^Percentage/ }),
      usagePerPlayer: () => screen.queryByRole('textbox', { name: /^Usage Per Player/ }),
    }
    type Control = keyof typeof controls
    const depositFamily: Control[] = ['conditionType', 'conditionAmount', 'amountType', 'amount', 'usagePerPlayer']
    const families: Array<[string, Control[]]> = [
      ['deposit', depositFamily],
      ['daily_first_deposit', depositFamily],
      ['signup', ['depositRequired', 'amount']],
      ['direct_amount', ['amount']],
      ['losing_bonus', ['domain', 'wagering', 'releaseType', 'percentage', 'usagePerPlayer']],
      ['special', ['wagering', 'amount', 'usagePerPlayer']],
    ]

    for (const [bonusType, shown] of families) {
      const view = renderPage()
      choose(/^Bonus Type/, bonusType)
      for (const control of Object.keys(controls) as Control[]) {
        assert.equal(controls[control]() !== null, shown.includes(control), `${bonusType}: ${control}`)
      }

      const distribution = combobox(/^Distribution Type/)
      assert.equal(distribution.required, bonusType === 'special', `${bonusType}: distribution required`)
      if (shown.includes('amount')) {
        assert.equal(textbox(/^Amount/).required, bonusType !== 'special', `${bonusType}: amount required`)
      }
      if (bonusType === 'losing_bonus') {
        assert.equal(distribution.value, 'roll_over')
        assert.equal(distribution.disabled, true)
        assert.equal(combobox(/^Bonus Amount Release Type/).value, 'bonus_amount_only')
      } else {
        assert.equal(distribution.disabled, false)
      }
      const rollOver = within(distribution).getByRole('option', { name: 'Roll Over' }) as HTMLOptionElement
      assert.equal(rollOver.disabled, bonusType === 'signup', `${bonusType}: Roll Over disabled`)
      assert.equal(
        within(distribution).queryByRole('option', { name: 'Instant Cash' }) === null,
        bonusType === 'special' || bonusType === 'losing_bonus',
        `${bonusType}: Instant Cash offered`,
      )
      if (bonusType === 'daily_first_deposit') {
        assert.match(
          screen.getByText(/still at most once per calendar day/).textContent ?? '',
          /^Max times each player can receive this bonus in total; still at most once per calendar day \(whitelabel timezone\)\./,
        )
      }
      if (bonusType === 'special') {
        assert.match(
          screen.getByText(/Optional at campaign level/).textContent ?? '',
          /^Optional at campaign level; amount is set per grant from player list/,
        )
      }
      view.unmount()
    }
  })

  test('brings retained values back when a hidden control returns, as the legacy form did', () => {
    renderPage()
    choose(/^Bonus Type/, 'losing_bonus')
    choose(/^Domain/, 'sports')
    type(/^Percentage/, '12.5')
    type(/^Wagering Requirement/, '3')

    choose(/^Bonus Type/, 'deposit')
    assert.ok(screen.queryByRole('combobox', { name: /^Domain/ }) === null, 'Domain hidden')
    // The forced Roll Over and percentage stay, so their controls and values remain.
    assert.equal(combobox(/^Distribution Type/).value, 'roll_over')
    assert.equal((screen.getByRole('radio', { name: 'Percentage' }) as HTMLInputElement).checked, true)
    assert.equal(textbox(/^Percentage/).value, '12.5')
    assert.equal(textbox(/^Wagering Requirement/).value, '3')
    assert.ok(screen.queryByRole('textbox', { name: /^Amount/ }) === null, 'Amount hidden')

    choose(/^Bonus Type/, 'losing_bonus')
    assert.equal(combobox(/^Domain/).value, 'sports')
  })

  test('hides a retained percentage for Special Bonus and leaves every hidden value out of the input', async () => {
    renderPage()
    type(/^Campaign Name/, 'Festive special')
    choose(/^Bonus Type/, 'deposit')
    choose(/^Deposit Condition Type/, 'greater_than')
    type(/^Deposit Condition Amount/, '1000')
    choose(/^Distribution Type/, 'instant_otp')
    fireEvent.click(screen.getByRole('radio', { name: 'Percentage' }))
    type(/^Percentage/, '12.5')

    choose(/^Bonus Type/, 'special')
    assert.ok(screen.queryByRole('textbox', { name: /^Percentage/ }) === null, 'Percentage hidden')
    assert.ok(
      screen.queryByRole('textbox', { name: /^Deposit Condition Amount/ }) === null,
      'Deposit Condition Amount hidden',
    )
    type(/^Wagering Requirement/, '2')
    submit()

    await waitFor(() => assert.equal(apollo.mutate.mock.calls.length, 1))
    assert.deepEqual(apollo.mutate.mock.calls[0][0].variables.input, {
      name: 'Festive special',
      domain: 'global',
      type: 'special',
      status: 'draft',
      currency: 'AED',
      budgetNumeric: 0,
      depositConditionType: undefined,
      depositConditionAmount: undefined,
      distributionType: 'instant_otp',
      amountType: 'fixed',
      amount: 0,
      percentage: undefined,
      numberOfPlayers: undefined,
      usagePerPlayer: 1,
      startDate: undefined,
      endDate: undefined,
      wagering: 2,
    })
  })

  test('focuses the first invalid field, brings it into view and says why without firing the mutation', async () => {
    // vitest.setup.ts installs a no-op scrollIntoView on HTMLElement.prototype for jsdom.
    const scrolled: Array<{ element: HTMLElement; options: unknown }> = []
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(function (this: HTMLElement, options?: boolean | ScrollIntoViewOptions) {
        scrolled.push({ element: this, options })
      })
    try {
      renderPage()
      submit()

      // Elements are compared by identity: a failing node:assert diff of a jsdom element inspects
      // the whole document graph and exhausts the worker.
      const campaignName = textbox(/^Campaign Name/)
      await waitFor(() => assert.ok(document.activeElement === campaignName, 'Campaign Name has focus'))
      await waitFor(() => assert.ok(
        scrolled.length === 1 && scrolled[0].element === campaignName,
        `Campaign Name scrolled into view once (${scrolled.length} calls)`,
      ))
      assert.deepEqual(scrolled[0].options, { block: 'nearest' })
      assert.ok(screen.getByText('Campaign not created'))
      assert.ok(screen.getByText('Fix 3 highlighted fields and submit again.'))
      assert.ok(screen.getByText('3 form errors found.'))
      assert.ok(screen.getByText('Campaign name is required'))
      assert.ok(screen.getByText('Bonus type is required'))
      assert.ok(screen.getByText('Amount is required'))
      assert.equal(campaignName.getAttribute('aria-invalid'), 'true')
      assert.equal(apollo.mutate.mock.calls.length, 0)

      // The count follows the remaining errors as they are fixed.
      type(/^Campaign Name/, 'Launch reward')
      await waitFor(() => assert.ok(screen.getByText('Fix 2 highlighted fields and submit again.')))
    } finally {
      scrollSpy.mockRestore()
    }
  })

  test('submits the exact direct-bonus input, toasts success and opens the created campaign', async () => {
    renderPage()
    fillDirectCampaign()
    submit()

    await waitFor(() => assert.equal(apollo.mutate.mock.calls.length, 1))
    assert.deepEqual(apollo.mutate.mock.calls[0][0], {
      variables: {
        input: {
          name: 'Launch reward',
          domain: 'global',
          type: 'direct_amount',
          status: 'draft',
          currency: 'AED',
          budgetNumeric: 0,
          depositConditionType: undefined,
          depositConditionAmount: undefined,
          distributionType: undefined,
          amountType: 'fixed',
          amount: 500,
          percentage: undefined,
          numberOfPlayers: undefined,
          startDate: undefined,
          endDate: undefined,
          wagering: undefined,
        },
      },
    })
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[0][0], {
      title: 'Success',
      message: 'Bonus campaign created successfully',
      tone: 'ok',
      duration: TOAST_MS,
    }))
    assert.deepEqual(navigation.navigate.mock.calls, [['/bonuses/91']])
  })

  test('submits the exact deposit input and groups amounts the Indian way', async () => {
    renderPage()
    type(/^Campaign Name/, 'Weekend reload')
    choose(/^Bonus Type/, 'deposit')
    choose(/^Deposit Condition Type/, 'greater_than')
    const conditionAmount = textbox(/^Deposit Condition Amount/)
    fireEvent.change(conditionAmount, { target: { value: '1000000' } })
    fireEvent.blur(conditionAmount)
    assert.equal(conditionAmount.value, '10,00,000')
    choose(/^Distribution Type/, 'roll_over')
    type(/^Wagering Requirement/, '2.5')
    choose(/^Bonus Amount Release Type/, 'total_bonus_wallet')
    type(/^Amount/, '2500')
    type(/^Number of Players/, '100')
    type(/^Usage Per Player/, '3')
    type(/^Expiry bonus/, '7.9')
    submit()

    await waitFor(() => assert.equal(apollo.mutate.mock.calls.length, 1))
    assert.deepEqual(apollo.mutate.mock.calls[0][0].variables.input, {
      name: 'Weekend reload',
      domain: 'global',
      type: 'deposit',
      status: 'draft',
      currency: 'AED',
      budgetNumeric: 0,
      depositConditionType: 'greater_than',
      depositConditionAmount: 1_000_000,
      distributionType: 'roll_over',
      amountType: 'fixed',
      amount: 2500,
      percentage: undefined,
      numberOfPlayers: 100,
      usagePerPlayer: 3,
      startDate: undefined,
      endDate: undefined,
      wagering: 2.5,
      expiryBonusDays: 7,
      releaseType: 'total_bonus_wallet',
    })
  })

  test('converts scheduled IST values in the page mutation input', async () => {
    renderPage()
    fillDirectCampaign()
    enterDate(/^Start Date/, '2026-09-22T14:30')
    enterDate(/^End Date/, '2026-09-22T15:30')
    submit()

    await waitFor(() => assert.equal(apollo.mutate.mock.calls.length, 1))
    const input = apollo.mutate.mock.calls[0][0].variables.input
    assert.equal(input.startDate, '2026-09-22T09:00:00.000Z')
    assert.equal(input.endDate, '2026-09-22T10:00:00.000Z')
  })

  test('blocks an end before the start and re-checks End Date whenever Start Date moves', async () => {
    renderPage()
    fillDirectCampaign()
    enterDate(/^Start Date/, '2026-09-22T14:30')
    enterDate(/^End Date/, '2026-09-22T14:00')
    submit()

    await waitFor(() => assert.ok(screen.getByText('End date must be after start date')))
    assert.ok(document.activeElement === screen.getByLabelText(/^End Date/), 'End Date has focus')
    assert.equal(apollo.mutate.mock.calls.length, 0)

    enterDate(/^Start Date/, '2026-09-22T13:00')
    await waitFor(() => assert.ok(
      screen.queryByText('End date must be after start date') === null,
      'the end-date error has cleared',
    ))

    // End Date has no error now and is not touched: moving the start past it still flags it.
    enterDate(/^Start Date/, '2026-09-22T15:00')
    await waitFor(() => assert.ok(screen.getByText('End date must be after start date')))

    // An equal start and end was allowed by the legacy rule.
    enterDate(/^Start Date/, '2026-09-22T14:00')
    await waitFor(() => assert.ok(
      screen.queryByText('End date must be after start date') === null,
      'the end-date error has cleared',
    ))
    submit()
    await waitFor(() => assert.equal(apollo.mutate.mock.calls.length, 1))
  })

  test('keeps a pending submit single-flight and marks the action busy', async () => {
    let resolveMutation: ((value: ReturnType<typeof successResult>) => void) | undefined
    apollo.mutate.mockImplementation(() => new Promise((resolve) => { resolveMutation = resolve }))
    renderPage()
    fillDirectCampaign()

    const submitButton = screen.getByRole('button', { name: 'Create Campaign' })
    const form = submitButton.closest('form')
    assert.ok(form)
    fireEvent.submit(form)
    fireEvent.submit(form)
    fireEvent.click(submitButton)

    await waitFor(() => assert.equal(apollo.mutate.mock.calls.length, 1))
    assert.equal(submitButton.getAttribute('aria-busy'), 'true')
    fireEvent.submit(form)
    await act(async () => resolveMutation?.(successResult()))
    await waitFor(() => assert.equal(submitButton.getAttribute('aria-busy'), null))
    assert.equal(apollo.mutate.mock.calls.length, 1)
    assert.deepEqual(navigation.navigate.mock.calls, [['/bonuses/91']])
  })

  test('shows backend and thrown mutation errors without navigating', async () => {
    apollo.mutate.mockResolvedValueOnce({
      data: {
        createBonusCampaignV2: {
          success: false,
          message: 'Campaign overlaps an active offer',
          campaign: null,
        },
      },
    })
    const first = renderPage()
    fillDirectCampaign()
    submit()
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[0][0], {
      title: 'Error',
      message: 'Campaign overlaps an active offer',
      tone: 'error',
      duration: TOAST_MS,
    }))
    assert.equal(navigation.navigate.mock.calls.length, 0)

    first.unmount()
    feedback.toast.mockReset()
    apollo.mutate.mockReset()
    apollo.mutate.mockResolvedValueOnce({
      data: { createBonusCampaignV2: { success: false, message: '', campaign: null } },
    })
    const second = renderPage()
    fillDirectCampaign()
    submit()
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[0][0], {
      title: 'Error',
      message: 'Failed to create campaign',
      tone: 'error',
      duration: TOAST_MS,
    }))

    second.unmount()
    feedback.toast.mockReset()
    apollo.mutate.mockReset()
    apollo.mutate.mockRejectedValueOnce(new Error('Network unavailable'))
    renderPage()
    fillDirectCampaign()
    submit()
    await waitFor(() => assert.deepEqual(feedback.toast.mock.calls[0][0], {
      title: 'Error',
      message: 'Network unavailable',
      tone: 'error',
      duration: TOAST_MS,
    }))
    assert.equal(navigation.navigate.mock.calls.length, 0)
    // A failed attempt can be retried.
    apollo.mutate.mockResolvedValueOnce(successResult('92'))
    submit()
    await waitFor(() => assert.deepEqual(navigation.navigate.mock.calls, [['/bonuses/92']]))
  })

  test('cancels back to the bonus list without submitting', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.deepEqual(navigation.navigate.mock.calls, [['/bonuses']])
    assert.equal(apollo.mutate.mock.calls.length, 0)
  })

  test('walks the controls in the legacy order with one stop per radio group', () => {
    renderPage()
    choose(/^Bonus Type/, 'deposit')
    const form = screen.getByRole('button', { name: 'Create Campaign' }).closest('form')
    assert.ok(form)
    assert.equal(form.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])').length, 0)

    const stops: string[] = []
    const radioGroups = new Set<string>()
    for (const element of Array.from(form.elements)) {
      if (element instanceof HTMLFieldSetElement || !(element instanceof HTMLElement)) continue
      if ((element as HTMLInputElement).disabled || element.tabIndex < 0) continue
      if (element instanceof HTMLInputElement && element.type === 'radio') {
        if (radioGroups.has(element.name)) continue
        radioGroups.add(element.name)
      }
      stops.push(element.getAttribute('name') ?? element.textContent ?? '')
    }
    assert.deepEqual(stops, [
      'campaignName',
      'currency',
      'bonusType',
      'depositConditionType',
      'depositConditionAmount',
      'distributionType',
      'amountType',
      'amount',
      'numberOfPlayers',
      'usagePerPlayer',
      'expiryBonusDays',
      'startDate',
      'endDate',
      'Cancel',
      'Create Campaign',
    ])
  })
})
