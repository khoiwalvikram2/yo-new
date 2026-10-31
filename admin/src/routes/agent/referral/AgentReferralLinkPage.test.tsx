import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { toast } from '@/ui/components/toast'
import AgentReferralLinkPage from './AgentReferralLinkPage'

interface MockAgent {
  id: string
  schemeType: string
}

interface Call {
  operationName: string
  variables: Record<string, unknown>
}

const auth = vi.hoisted(() => ({ agent: undefined as MockAgent | undefined }))

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { agent?: MockAgent }) => unknown) => selector({ agent: auth.agent }),
}))

vi.mock('@/shared/config/environment', () => ({
  environmentConfig: { userFrontendUrl: 'https://play.example.com/' },
}))

let calls: Call[]
let queryMode: 'link' | 'missing' | 'error'
const writeText = vi.fn<(value: string) => Promise<void>>()

const linkRecord = {
  __typename: 'AgentReferralLink',
  id: 'link-1',
  code: 'JOIN-2026',
  agentId: 'agent-1',
  qrCodeUrl: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  totalClicks: 1280,
  totalSignups: 96,
  conversionRate: 7.5,
}

function response(operation: Operation): FetchResult {
  calls.push({
    operationName: operation.operationName,
    variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown>,
  })
  if (operation.operationName === 'AgentReferralLink') {
    if (queryMode === 'error') throw new Error('Referral service unavailable')
    return { data: { agentReferralLink: queryMode === 'link' ? linkRecord : null } }
  }
  if (operation.operationName === 'GenerateAgentReferralLink') {
    queryMode = 'link'
    return {
      data: {
        generateReferralLink: {
          __typename: 'GenerateReferralLinkPayload',
          success: true,
          message: 'created',
          link: linkRecord,
        },
      },
    }
  }
  throw new Error(`Unexpected operation ${operation.operationName}`)
}

function serverLink() {
  return new ApolloLink((operation) => new Observable((observer) => {
    queueMicrotask(() => {
      try {
        observer.next(response(operation))
        observer.complete()
      } catch (error) {
        observer.error(error)
      }
    })
  }))
}

function renderPage() {
  return render(
    <MockedProvider link={serverLink()} cache={undefined}>
      <MemoryRouter initialEntries={['/agent/referral']}>
        <PageEyebrowProvider value="Agent tools">
          <Routes>
            <Route path="/agent/referral" element={<AgentReferralLinkPage />} />
            <Route path="/agent" element={<p>Agent dashboard</p>} />
          </Routes>
        </PageEyebrowProvider>
      </MemoryRouter>
    </MockedProvider>,
  )
}

beforeEach(() => {
  auth.agent = { id: 'agent-1', schemeType: 'SHARING' }
  calls = []
  queryMode = 'link'
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  toast.clear()
})

describe('/agent/referral', () => {
  test('shows the unauthenticated state and skips the query', async () => {
    auth.agent = undefined
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Invite Players' })).toBeTruthy()
    expect(screen.getByText('Not Authenticated')).toBeTruthy()
    await Promise.resolve()
    expect(calls).toHaveLength(0)
  })

  test('keeps the exact scheme gate and dashboard action', async () => {
    auth.agent = { id: 'agent-1', schemeType: 'CREDIT' }
    renderPage()
    expect(screen.getByText('Access Denied')).toBeTruthy()
    expect(screen.getByText('Referral links are only available for SHARING and COMMISSION agents.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Go to Dashboard' }))
    expect(await screen.findByText('Agent dashboard')).toBeTruthy()
  })

  test('loads the exact agent link and copies both public values', async () => {
    renderPage()
    expect(await screen.findByDisplayValue('https://play.example.com/r?ref=JOIN-2026')).toBeTruthy()
    expect(screen.getByDisplayValue('JOIN-2026')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(calls.find((call) => call.operationName === 'AgentReferralLink')?.variables).toEqual({
      agentId: 'agent-1',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://play.example.com/r?ref=JOIN-2026'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Code' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('JOIN-2026'))
  })

  test('opens an accessible QR dialog with the encoded public link', async () => {
    renderPage()
    await screen.findByText('Your Referral Link')
    fireEvent.click(screen.getByRole('button', { name: 'View QR Code' }))
    expect(screen.getByRole('dialog', { name: 'QR Code' })).toBeTruthy()
    const image = screen.getByRole('img', { name: 'Referral QR code for JOIN-2026' })
    expect(image.getAttribute('src')).toContain('data=https%3A%2F%2Fplay.example.com%2Fr%3Fref%3DJOIN-2026')
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('generates a missing link with the exact mutation variables and refetches', async () => {
    queryMode = 'missing'
    renderPage()
    expect(await screen.findByText('Referral Link Not Found')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Generate Referral Link' }))
    await waitFor(() => {
      expect(calls.find((call) => call.operationName === 'GenerateAgentReferralLink')?.variables).toEqual({
        agentId: 'agent-1',
      })
    })
    expect(await screen.findByDisplayValue('JOIN-2026')).toBeTruthy()
    expect(toast.peek().some((item) => item.title === 'Referral Link Generated')).toBe(true)
  })

  test('keeps non-not-found query failures distinct and retries', async () => {
    queryMode = 'error'
    renderPage()
    expect(await screen.findByText('Error Loading Referral Link')).toBeTruthy()
    expect(screen.getByText('Referral service unavailable')).toBeTruthy()
    const before = calls.filter((call) => call.operationName === 'AgentReferralLink').length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(calls.filter((call) => call.operationName === 'AgentReferralLink').length).toBeGreaterThan(before)
    })
  })

  test('refreshes and returns to the agent dashboard from the header', async () => {
    renderPage()
    await screen.findByText('Your Referral Link')
    const before = calls.filter((call) => call.operationName === 'AgentReferralLink').length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      expect(calls.filter((call) => call.operationName === 'AgentReferralLink').length).toBeGreaterThan(before)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Back to Dashboard' }))
    expect(await screen.findByText('Agent dashboard')).toBeTruthy()
  })
})
