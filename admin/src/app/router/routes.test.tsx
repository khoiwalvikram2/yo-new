/**
 * The route table (app/router/index.tsx), driven through a memory router: who may open which page, and what an
 * unknown address shows. The shell is stubbed; Layout, the guards and the redirects are the real ones.
 *
 * - SCO-01: a signed-in agent opening an admin-only page (casino management, matka worli, manual results, ...)
 *   landed on the sign-in form with its session intact. Layout repeated AdminOnly's check for a list of path
 *   prefixes and navigated to /login after AdminOnly had sent the agent to /agent.
 * - SYS-11: an unknown address showed the route error screen ("Something went wrong").
 * - SYS-19: Super-Admin-only config pages opened for a Whitelabel Admin by URL and showed their refusals.
 * - SCO-07: the sports pages and the casino/matka live pages ignored an agent's allowed domains.
 * - MAR-16: an agent's Alerts > View all, and every notification link, landed on /agent: the inbox routes sat
 *   behind AdminOnly although the inbox is the caller's own (the server scopes it to the recipient).
 */
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { beforeEach, describe, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

const page = vi.hoisted(() => (name: string) => ({ default: () => name }))
vi.mock('@/shell/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }))
vi.mock('@/components/topbar/useNotificationSubscription', () => ({ useNotificationSubscription: () => undefined }))
vi.mock('@/shared/components/VersionRefreshBanner', () => ({ VersionRefreshBanner: () => null }))
vi.mock('@/modules/aiAssistant/AiAssistantLauncher', () => ({ AiAssistantLauncher: () => null }))
vi.mock('@/routes/LoginPage', () => page('Sign-in page'))
vi.mock('@/modules/agents/AgentHome', () => page('Agent home'))
vi.mock('@/routes/overview/AdminHomeEntry', () => page('Overview page'))
vi.mock('@/routes/audit/EventsPage', () => page('Audit trail page'))
vi.mock('@/routes/reporting/PNLPage', () => page('P&L page'))
vi.mock('@/routes/config/AiAssistantSettingsPage', () => page('AI assistant settings page'))
vi.mock('@/routes/config/CrmAccessPage', () => page('CRM access page'))
vi.mock('@/routes/config/WhitelabelsListPage', () => page('Whitelabels page'))
vi.mock('@/routes/config/WhitelabelWizardPage', () => page('Whitelabel wizard page'))
vi.mock('@/routes/sports/EventsPage', () => page('Sports events page'))
vi.mock('@/routes/sports/EventDetailPage', () => page('Sports event page'))
vi.mock('@/routes/sports/live-analysis/LiveAnalysisPage', () => page('Sports live page'))
vi.mock('@/routes/casino/live-analysis/LiveAnalysisPage', () => page('Casino live page'))
vi.mock('@/routes/matka/live-analysis/LiveAnalysisPage', () => page('Matka live page'))
vi.mock('@/routes/notifications/NotificationsPage', () => page('Notifications inbox'))
vi.mock('@/routes/notifications/NotificationDetailPage', () => page('Notification detail'))
vi.mock('@/routes/notifications/TaskDetailPage', () => page('Task detail'))

import { useAuthStore } from '@/shared/core/authStore'
import { routes } from './index'

function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}
const signedIn = { token: 'session-token', _hasHydrated: true }
const asAgent = (allowedDomains: string[]) =>
  useAuthStore.setState({ ...signedIn, user: undefined, roles: [], agent: { id: 'agent-1', status: 'ACTIVE', allowedDomains } as never })
const asAdmin = (role: string) =>
  useAuthStore.setState({ ...signedIn, agent: undefined, roles: [role], user: { id: '2', name: 'Admin' } as never })

beforeEach(() => { useAuthStore.setState({ token: undefined, user: undefined, agent: undefined, roles: [], _hasHydrated: true }) })

describe('an agent on an admin-only page goes to its dashboard, never to the sign-in form (SCO-01)', () => {
  // The pages Layout listed (two of its prefixes could never match), and the ones it did not.
  test.each([
    '/casino/management', '/casino/vendors', '/casino/providers', '/casino/categories', '/matka/list', '/matka/management',
    '/matka/create', '/matka/edit/m1', '/matka/settings/m1', '/matka/worli', '/matka/worli/w1', '/sports/manual-results',
    '/sports-exchange/builder', '/sports-exchange/configuration', '/matka/running', '/matka/results', '/security/roles',
  ])('%s', async (path) => {
    asAgent(['sports', 'casino', 'matka'])
    const router = open(path)
    await screen.findByText('Agent home')
    assert.equal(router.state.location.pathname, '/agent')
    assert.equal(useAuthStore.getState().token, 'session-token')
  })
})

describe('an unknown address is a not-found page inside the shell (SYS-11)', () => {
  test('an admin gets the page and a way to the overview', async () => {
    asAdmin('Whitelabel Admin')
    const router = open('/finance/overview')
    await screen.findByText('Page not found')
    assert.equal(router.state.location.pathname, '/finance/overview')
    assert.equal(screen.getByRole('link', { name: 'Go to Overview' }).getAttribute('href'), '/overview')
    assert.equal(screen.queryByText('Something went wrong'), null)
  })

  test('an agent is offered its dashboard', async () => {
    asAgent(['casino'])
    open('/agent/missing')
    await screen.findByText('Page not found')
    assert.equal(screen.getByRole('link', { name: 'Go to dashboard' }).getAttribute('href'), '/agent')
  })

  test('a signed-out visitor still meets the sign-in page first', async () => {
    const router = open('/finance/overview')
    await screen.findByText('Sign-in page')
    assert.equal(router.state.location.pathname, '/login')
  })

  test('a real route still wins over the catch-all', async () => {
    asAdmin('Whitelabel Admin')
    open('/audit/events')
    await screen.findByText('Audit trail page')
    assert.equal(screen.queryByText('Page not found'), null)
  })
})

describe('Super-Admin-only config pages redirect everyone else (SYS-19)', () => {
  test.each(['/config/ai-assistant', '/config/crm-access', '/config/whitelabels', '/config/whitelabels/create'])('%s', async (path) => {
    asAdmin('Whitelabel Admin')
    const router = open(path)
    await screen.findByText('Overview page')
    assert.equal(router.state.location.pathname, '/overview')
  })

  test('a Super Admin opens them', async () => {
    asAdmin('Super Admin')
    const router = open('/config/crm-access')
    await screen.findByText('CRM access page')
    assert.equal(router.state.location.pathname, '/config/crm-access')
  })
})

describe("the domain pages follow an agent's allowed domains (SCO-07)", () => {
  test.each(['/sports/events', '/sports/event/e1', '/sports/live-analysis', '/matka/live'])('a casino-only agent is sent from %s to the P&L report', async (path) => {
    asAgent(['casino'])
    const router = open(path)
    await screen.findByText('P&L page')
    assert.equal(router.state.location.pathname, '/reporting/pnl')
  })

  test('the domain it holds opens', async () => {
    asAgent(['casino'])
    const router = open('/casino/live')
    await screen.findByText('Casino live page')
    assert.equal(router.state.location.pathname, '/casino/live')
  })

  test('an admin is not limited by domains', async () => {
    asAdmin('Whitelabel Admin')
    open('/sports/events')
    await waitFor(() => screen.getByText('Sports events page'))
  })
})

describe('the notification inbox opens for agents as well as admins (MAR-16)', () => {
  test.each([
    ['/notifications', 'Notifications inbox'],
    ['/notifications/n1', 'Notification detail'],
    ['/notifications/tasks/t1', 'Task detail'],
  ])('an agent opens %s', async (path, shown) => {
    asAgent(['casino'])
    const router = open(path)
    await screen.findByText(shown)
    assert.equal(router.state.location.pathname, path)
    assert.equal(screen.queryByText('Agent home'), null)
  })

  test('an admin still opens the inbox', async () => {
    asAdmin('Whitelabel Admin')
    const router = open('/notifications')
    await screen.findByText('Notifications inbox')
    assert.equal(router.state.location.pathname, '/notifications')
  })

  test('a signed-out visitor is sent to sign in', async () => {
    const router = open('/notifications')
    await screen.findByText('Sign-in page')
    assert.equal(router.state.location.pathname, '/login')
  })
})
