/**
 * `/config/whitelabels/create` against a small GraphQL server. Covers the outer guard, every wizard
 * step, uploads, exact create payload/refetch options, failure copy, success actions and navigation.
 */
import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApolloLink, Observable, type FetchResult } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { print } from 'graphql'
import type { ReactNode } from 'react'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import WhitelabelWizardPage from './WhitelabelWizardPage'

interface GuardCall {
  required: Array<{ domain: string; actions: string[] }>
}

const feedback = vi.hoisted(() => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  guard: { allowed: true, calls: [] as GuardCall[] },
  compress: vi.fn(),
}))

vi.mock('@/shared/services/notification', () => ({ notify: feedback.notify }))
vi.mock('@/shared/utils/imageCompression', () => ({ compressImageToDataUrl: feedback.compress }))
vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: GuardCall & { children: ReactNode }) => {
    feedback.guard.calls.push({ required })
    return feedback.guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))
vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({ getCurrencySymbol: () => '₹' }),
}))

type Vars = Record<string, unknown>
type Responder = (variables: Vars) => FetchResult | Error

interface Call {
  name: string
  variables: Vars
  document: string
  context: Record<string, unknown>
}

let calls: Call[]
let respond: Record<string, Responder>

function serverLink() {
  return new ApolloLink(
    (operation) => new Observable<FetchResult>((observer) => {
      const call: Call = {
        name: operation.operationName,
        variables: { ...operation.variables },
        document: print(operation.query),
        context: { ...operation.getContext() },
      }
      calls.push(call)
      const timer = setTimeout(() => {
        const responder = respond[call.name]
        const result = responder ? responder(call.variables) : { errors: [{ message: `no responder for ${call.name}` }] }
        if (result instanceof Error) observer.error(result)
        else {
          observer.next(result)
          observer.complete()
        }
      }, 0)
      return () => clearTimeout(timer)
    }),
  )
}

const named = (name: string) => calls.filter((call) => call.name === name)

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="location">{location.pathname}{location.search}</output>
}

function renderPage() {
  return render(
    <MockedProvider link={serverLink()}>
      <MemoryRouter initialEntries={['/config/whitelabels/create']}>
        <PageEyebrowProvider value="Configuration">
          <WhitelabelWizardPage />
          <LocationProbe />
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

function field(label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return screen.getByLabelText(new RegExp(`^${escaped}`))
}

function setText(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } })
}

function fillBasic(name = 'Partner Gaming', domain = 'partner.example.com') {
  setText('Whitelabel Name', name)
  setText('Primary Domain', domain)
}

async function goToAccount() {
  fillBasic()
  fireEvent.click(screen.getByRole('button', { name: 'Next Step' }))
  await screen.findByRole('heading', { name: 'Account Status' })
}

function fillAccount() {
  setText('Admin Email', 'admin@example.com')
  setText('Admin Name', 'Partner Admin')
  setText('Login Password', 'safe-pass-123')
  setText('Confirm Password', 'safe-pass-123')
  setText('Contact Phone', '+919999999999')
  fireEvent.change(field('Sports Share (%)'), { target: { value: '12.5' } })
  fireEvent.change(field('Casino Share (%)'), { target: { value: '30' } })
  fireEvent.change(field('Matka Share (%)'), { target: { value: '2' } })
  fireEvent.change(field('Credit Limit (₹)'), { target: { value: '100000' } })
}

async function goToBranding() {
  await goToAccount()
  fillAccount()
  fireEvent.click(screen.getByRole('button', { name: 'Next Step' }))
  await screen.findByRole('heading', { name: 'Branding Assets' })
}

async function goToReview() {
  await goToBranding()
  fireEvent.click(screen.getByRole('button', { name: 'Next Step' }))
  await screen.findByText('Review Whitelabel Changes')
}

beforeEach(() => {
  calls = []
  respond = {
    CreateWhitelabel: () => ({
      data: {
        createWhitelabel: {
          __typename: 'WhitelabelMutationResponse',
          success: true,
          message: 'Created',
          whitelabel: { __typename: 'Whitelabel', id: 'partner-example-com' },
        },
      },
    }),
    Whitelabels: () => ({ data: { whitelabels: [] } }),
    GenerateCasinoCategories: () => ({
      data: {
        generateCasinoCategories: {
          __typename: 'GenerateCasinoCategoriesResponse',
          success: true,
          message: null,
          categoriesCreated: 3,
          gamesAssigned: 20,
          nonLatinDisabled: 0,
        },
      },
    }),
  }
  feedback.notify.success.mockReset()
  feedback.notify.error.mockReset()
  feedback.notify.info.mockReset()
  feedback.guard.allowed = true
  feedback.guard.calls = []
  feedback.compress.mockReset()
  feedback.compress.mockImplementation(async (_file: File, preset: string) => `data:image/png;base64,${preset}`)
})

describe('WhitelabelWizardPage', () => {
  test('renders the approved frame, exact guard and first wizard step without starting a request', () => {
    renderPage()
    assert.deepStrictEqual(feedback.guard.calls[0]?.required, [
      { domain: 'config.whitelabels', actions: ['view', 'create'] },
    ])
    assert.ok(screen.queryByText('Configuration') === null)
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Create Whitelabel' }))
    assert.ok(screen.queryByText('Set up a new whitelabel partnership with comprehensive configuration') === null)
    assert.equal(screen.getByRole('link', { name: 'Back to Whitelabels' }).getAttribute('href'), '/config/whitelabels')
    assert.equal(screen.getByRole('listitem', { current: 'step' }).textContent?.includes('Basic Info'), true)
    assert.ok(field('Whitelabel Name'))
    assert.ok(field('Primary Domain'))
    assert.deepStrictEqual(calls, [])
  })

  test('a denied caller mounts no query or mutation hook', async () => {
    feedback.guard.allowed = false
    renderPage()
    assert.ok(screen.getByRole('alert'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepStrictEqual(calls, [])
  })

  test('Next shows exact basic errors, focuses the first field and preserves values across Previous', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }))
    assert.ok(await screen.findByText('Please enter whitelabel name'))
    assert.equal(document.activeElement, field('Whitelabel Name'))

    fillBasic('Partner Gaming', 'wrong')
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }))
    assert.ok(await screen.findByText('Enter a valid domain'))

    setText('Primary Domain', 'partner.example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }))
    await screen.findByRole('heading', { name: 'Account Status' })
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    assert.equal((field('Whitelabel Name') as HTMLInputElement).value, 'Partner Gaming')
    assert.equal((field('Primary Domain') as HTMLInputElement).value, 'partner.example.com')
  })

  test('account controls preserve labels, defaults, password security and scoped validation', async () => {
    renderPage()
    await goToAccount()
    const status = screen.getByRole('combobox', { name: 'Whitelabel Status' }) as HTMLSelectElement
    assert.equal(status.value, 'active')
    assert.deepStrictEqual(
      Array.from(status.options).map((option) => [option.value, option.textContent]),
      [
        ['active', 'Active — Full access enabled'],
        ['inactive', 'Inactive — Limited access'],
        ['suspend', 'Suspended — Access blocked'],
      ],
    )
    const password = field('Login Password') as HTMLInputElement
    assert.equal(password.type, 'password')
    assert.equal(password.autocomplete, 'new-password')
    assert.equal(password.hasAttribute('value'), false, 'controlled secret never reaches an HTML attribute')

    setText('Admin Email', 'wrong')
    setText('Admin Name', 'A')
    setText('Login Password', 'short')
    setText('Confirm Password', 'different')
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }))
    assert.ok(await screen.findByText('Please enter a valid email'))
    assert.ok(screen.getByText('Name must be at least 2 characters'))
    assert.ok(screen.getByText('Password must be at least 8 characters'))

    fillAccount()
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }))
    assert.ok(await screen.findByRole('heading', { name: 'Branding Assets' }))
  })

  test('branding rejects non-images, compresses both presets, previews and removes assets', async () => {
    renderPage()
    await goToBranding()
    const logoInput = screen.getByLabelText('Choose logo image')
    const faviconInput = screen.getByLabelText('Choose favicon image')

    fireEvent.change(logoInput, { target: { files: [new File(['bad'], 'bad.txt', { type: 'text/plain' })] } })
    assert.equal(feedback.notify.error.mock.calls.at(-1)?.[0], 'You can only upload image files!')
    assert.equal(feedback.compress.mock.calls.length, 0)

    fireEvent.change(logoInput, { target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] } })
    fireEvent.change(faviconInput, { target: { files: [new File(['fav'], 'fav.png', { type: 'image/png' })] } })
    await waitFor(() => assert.equal(feedback.compress.mock.calls.length, 2))
    assert.deepStrictEqual(feedback.compress.mock.calls.map((call) => call[1]), ['logo', 'favicon'])
    assert.ok(await screen.findByRole('button', { name: 'Open preview: Logo preview' }))
    assert.ok(screen.getByRole('button', { name: 'Open preview: Favicon preview' }))
    assert.equal(screen.getAllByText('✓ Ready to save').length, 2)

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    assert.equal(screen.queryByRole('button', { name: 'Open preview: Logo preview' }), null)
    assert.ok(screen.getByRole('button', { name: 'Open preview: Favicon preview' }))
  })

  test('review preserves copy and creates with the exact payload, query refetch and success panel', async () => {
    renderPage()
    await goToReview()
    assert.ok(screen.getByText('Please review all the changes below before updating the whitelabel. The changes will be applied immediately.'))
    assert.ok(screen.getByText('Partner Gaming'))
    assert.ok(screen.getByText('partner.example.com'))
    assert.ok(screen.getByText('12.50%'))
    assert.ok(screen.getByText('30.00%'))
    assert.ok(screen.getByText('High Share'))
    assert.ok(screen.getByText('Partner Admin'))
    assert.equal(screen.queryByText('safe-pass-123'), null, 'the review never renders the secret')

    fireEvent.click(screen.getByRole('button', { name: 'Create Whitelabel' }))
    await screen.findByText('Whitelabel created successfully')
    const [mutation] = named('CreateWhitelabel')
    assert.deepStrictEqual(mutation.variables, {
      input: {
        id: 'partner-example-com',
        name: 'Partner Gaming',
        domain: 'partner.example.com',
        sharingRates: [
          { domain: 'sports', shareRate: 12.5 },
          { domain: 'casino', shareRate: 30 },
          { domain: 'matka', shareRate: 2 },
        ],
        partnerAdminName: 'Partner Admin',
        partnerAdminEmail: 'admin@example.com',
        partnerAdminPassword: 'safe-pass-123',
        logoUrl: null,
        faviconUrl: null,
        creditLimit: 100000,
      },
    })
    assert.ok(mutation.document.includes('mutation CreateWhitelabel'))
    await waitFor(() => assert.equal(named('Whitelabels').length, 1))
    assert.ok(named('Whitelabels')[0].document.includes('creditAlertThreshold'))
  })

  test('full validation reports the first hidden error and returns to its owning step', async () => {
    renderPage()
    await goToAccount()
    fillAccount()
    fireEvent.change(field('Sports Share (%)'), { target: { value: '200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }))
    await screen.findByRole('heading', { name: 'Branding Assets' })
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }))
    await screen.findByText('Review Whitelabel Changes')
    fireEvent.click(screen.getByRole('button', { name: 'Create Whitelabel' }))

    await screen.findByRole('heading', { name: 'Account Status' })
    assert.equal(feedback.notify.error.mock.calls.at(-1)?.[0], 'Share must be 0-100%')
    assert.equal(document.activeElement, field('Sports Share (%)'))
    assert.deepStrictEqual(named('CreateWhitelabel'), [])
  })

  test('GraphQL and transport failures keep the review and use the exact server or fallback copy', async () => {
    respond.CreateWhitelabel = () => ({ errors: [{ message: 'Domain already exists' }] })
    renderPage()
    await goToReview()
    fireEvent.click(screen.getByRole('button', { name: 'Create Whitelabel' }))
    await waitFor(() => assert.equal(feedback.notify.error.mock.calls.at(-1)?.[0], 'Domain already exists'))
    assert.ok(screen.getByText('Review Whitelabel Changes'))

    respond.CreateWhitelabel = () => new Error('Network unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Create Whitelabel' }))
    await waitFor(() => assert.equal(feedback.notify.error.mock.calls.at(-1)?.[0], 'Network unavailable'))
    assert.equal(named('CreateWhitelabel').length, 2)
  })

  test('success can generate categories with notification suppression and navigate to the list', async () => {
    renderPage()
    await goToReview()
    fireEvent.click(screen.getByRole('button', { name: 'Create Whitelabel' }))
    await screen.findByText('Whitelabel created successfully')
    fireEvent.click(screen.getByRole('button', { name: 'Generate categories' }))
    await waitFor(() => assert.equal(feedback.notify.success.mock.calls.at(-1)?.[0], 'Casino categories generated.'))
    const [generate] = named('GenerateCasinoCategories')
    assert.deepStrictEqual(generate.variables, { tenantId: 'partner-example-com' })
    assert.equal(generate.context.skipNotification, true)

    fireEvent.click(screen.getByRole('button', { name: 'Go to Whitelabels' }))
    assert.equal(screen.getByLabelText('location').textContent, '/config/whitelabels')
  })

  test('category no-work and refusal outcomes preserve the legacy messages', async () => {
    respond.GenerateCasinoCategories = () => ({
      data: {
        generateCasinoCategories: {
          success: true,
          message: null,
          categoriesCreated: 0,
          gamesAssigned: 0,
          nonLatinDisabled: 0,
        },
      },
    })
    renderPage()
    await goToReview()
    fireEvent.click(screen.getByRole('button', { name: 'Create Whitelabel' }))
    await screen.findByText('Whitelabel created successfully')
    fireEvent.click(screen.getByRole('button', { name: 'Generate categories' }))
    await waitFor(() => assert.equal(
      feedback.notify.info.mock.calls.at(-1)?.[0],
      'No categories created. Enable at least one casino provider (Gap or GMAG) for this whitelabel.',
    ))
  })

  test('Cancel returns to the existing whitelabel list route', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.equal(screen.getByLabelText('location').textContent, '/config/whitelabels')
  })
})
