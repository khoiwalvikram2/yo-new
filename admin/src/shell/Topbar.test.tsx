/**
 * Topbar.tsx composes ~10 widgets (search, Super Admin switcher, tenant/currency selects, one of four
 * wallets, clock, two notification bells, theme toggle, profile menu) and had no render/mount test at
 * all: a `vite build` proves it compiles, never that mounting it does not throw (e.g. a child widget's
 * hook expecting a context that is not there). This is a smoke test, not a re-test of each widget's own
 * Apollo wiring (that already happens in NotificationBell/wallet/SuperAdminSwitcher's own hook and View
 * tests) — it mocks out the heaviest Apollo-backed widgets as simple stand-ins so it can focus on what
 * only Topbar.tsx itself is responsible for: which widget shows for which role (topbarRoles.ts), and that
 * the whole tree mounts for representative role states without throwing.
 *
 * Widgets NOT mocked here (SearchTrigger, DateTime, ThemeToggle, ProfileMenu + ChangePasswordModal,
 * Breadcrumb, GlobalSearch) touch no Apollo query that fires on mount (GlobalSearch's search is a
 * useLazyQuery that only fires on submit; ChangePasswordModal's useMutation only fires on submit), but
 * they do need router (useNavigate/useLocation/Link) and Apollo (useLazyQuery/useMutation read client
 * context even when idle) ancestors, so the tree is wrapped in MemoryRouter + MockedProvider.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MockedProvider } from '@apollo/client/testing'
import { useAuthStore } from '@/shared/core/authStore'
import { Topbar, type TopbarProps } from './Topbar'
import type { BurgerProps } from './useNavDrawer'

vi.mock('./topbar/NotificationBell', () => ({
  NotificationBell: ({ category }: { category: string }) => (
    <div data-testid={`notification-bell-${category}`} />
  ),
}))
vi.mock('./topbar/SuperAdminSwitcher', () => ({
  SuperAdminSwitcher: ({ compact }: { compact: boolean }) => (
    <div data-testid="super-admin-switcher-stub" data-compact={String(compact)} />
  ),
}))
vi.mock('./topbar/TenantCurrencyControls', () => ({
  TenantCurrencyControls: ({ compact }: { compact: boolean }) => (
    <div data-testid="tenant-currency-controls-stub" data-compact={String(compact)} />
  ),
}))
vi.mock('./topbar/WhitelabelWallet', () => ({
  WhitelabelWallet: ({ compact }: { compact: boolean }) => (
    <div data-testid="whitelabel-wallet-stub" data-compact={String(compact)} />
  ),
}))
vi.mock('./topbar/AgentCreditWallet', () => ({
  AgentCreditWallet: ({ compact }: { compact: boolean }) => (
    <div data-testid="agent-credit-wallet-stub" data-compact={String(compact)} />
  ),
}))
vi.mock('./topbar/AgentSharingWallet', () => ({
  AgentSharingWallet: ({ compact }: { compact: boolean }) => (
    <div data-testid="agent-sharing-wallet-stub" data-compact={String(compact)} />
  ),
}))
vi.mock('./topbar/AgentCommissionWallet', () => ({
  AgentCommissionWallet: ({ compact }: { compact: boolean }) => (
    <div data-testid="agent-commission-wallet-stub" data-compact={String(compact)} />
  ),
}))

const LOGGED_OUT = {
  user: undefined,
  agent: undefined,
  roles: [] as string[],
  permissions: [] as { domain: string; actions: string[] }[],
  agentPermissions: [] as { domain: string; actions: string[] }[],
  token: undefined,
  isReadOnly: false,
}

const ALL_PERMISSIONS = [{ domain: 'all', actions: ['*'] }]

function signInAdmin(roles: string[], name = 'Priya Admin') {
  useAuthStore.setState({
    user: { id: 'admin-topbar-test', name },
    agent: undefined,
    roles,
    permissions: ALL_PERMISSIONS,
    agentPermissions: [],
    token: 'test-token',
    isReadOnly: false,
  })
}

function signInCreditAgent() {
  useAuthStore.setState({
    user: undefined,
    agent: {
      id: 'agent-topbar-test',
      tenantId: 'wl-topbar-test',
      username: 'credit.agent',
      phone: null,
      schemeType: 'CREDIT',
      allowedDomains: ['sports'],
      status: 'ACTIVE',
      parentAgentId: null,
      levelIndex: 1,
      tallyEnabled: false,
      tallyDomains: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    roles: [],
    permissions: [],
    agentPermissions: ALL_PERMISSIONS,
    token: 'test-token',
    isReadOnly: false,
  })
}

function makeBurgerProps(onClick: () => void = () => {}): BurgerProps {
  return { 'aria-expanded': false, 'aria-controls': 'shell-nav-drawer', onClick }
}

function renderTopbar(overrides: Partial<TopbarProps> = {}) {
  const props: TopbarProps = {
    showBurger: false,
    burgerRef: () => {},
    burgerProps: makeBurgerProps(),
    ...overrides,
  }
  return render(
    <MemoryRouter>
      <MockedProvider mocks={[]}>
        <Topbar {...props} />
      </MockedProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useAuthStore.setState(LOGGED_OUT)
})

afterEach(() => {
  useAuthStore.setState(LOGGED_OUT)
})

describe('Topbar', () => {
  test('plain administrator: mounts, shows search + profile menu + tenant/currency controls, hides every wallet and the Super Admin switcher', () => {
    signInAdmin(['Administrator'])

    assert.doesNotThrow(() => renderTopbar())

    assert.ok(screen.getByRole('button', { name: 'Open search' }))
    assert.ok(
      screen.getByRole('button', { name: 'Priya Admin, Administrator. Account menu.' }),
      'the profile menu trigger names the signed-in admin',
    )
    // topbarRoles.ts: a plain administrator is not an agent, not Super Admin, not Whitelabel
    // Admin, so showTenantCurrency is true and wallet is null.
    assert.ok(screen.getByTestId('tenant-currency-controls-stub'))
    assert.equal(screen.queryByTestId('super-admin-switcher-stub'), null)
    assert.equal(screen.queryByTestId('whitelabel-wallet-stub'), null)
    assert.equal(screen.queryByTestId('agent-credit-wallet-stub'), null)
    assert.equal(screen.queryByTestId('agent-sharing-wallet-stub'), null)
    assert.equal(screen.queryByTestId('agent-commission-wallet-stub'), null)
    // showGeneralBell / showTaskBell are both `!isSuperAdmin` (and task also needs `!isAgent`).
    assert.ok(screen.getByTestId('notification-bell-general'))
    assert.ok(screen.getByTestId('notification-bell-task'))
  })

  test('with the right tool rail showing, the bells move to the rail and the theme switch stays', () => {
    signInAdmin(['Administrator'])
    renderTopbar({ bellsInToolRail: true })
    assert.equal(screen.queryByTestId('notification-bell-general'), null)
    assert.equal(screen.queryByTestId('notification-bell-task'), null)
    assert.ok(screen.getByRole('button', { name: 'Open search' }))
  })

  test('Super Admin: mounts, shows the Super Admin switcher, hides both notification bells and tenant/currency controls', () => {
    signInAdmin(['Super Admin'], 'Sana SuperAdmin')

    assert.doesNotThrow(() => renderTopbar())

    assert.ok(screen.getByRole('button', { name: 'Open search' }))
    assert.ok(screen.getByTestId('super-admin-switcher-stub'))
    // showTenantCurrency and showGeneralBell (hence showTaskBell too) are all `!isSuperAdmin`.
    assert.equal(screen.queryByTestId('tenant-currency-controls-stub'), null)
    assert.equal(screen.queryByTestId('notification-bell-general'), null)
    assert.equal(screen.queryByTestId('notification-bell-task'), null)
    // A bare Super Admin (not also a Whitelabel Admin or agent) gets no wallet widget.
    assert.equal(screen.queryByTestId('whitelabel-wallet-stub'), null)
    assert.equal(screen.queryByTestId('agent-credit-wallet-stub'), null)
    assert.equal(screen.queryByTestId('agent-sharing-wallet-stub'), null)
    assert.equal(screen.queryByTestId('agent-commission-wallet-stub'), null)
  })

  test('Whitelabel Admin: mounts, shows the whitelabel wallet, hides tenant/currency controls and the Super Admin switcher', () => {
    signInAdmin(['Whitelabel Admin'], 'Wendy Whitelabel')

    assert.doesNotThrow(() => renderTopbar())

    assert.ok(screen.getByRole('button', { name: 'Open search' }))
    assert.ok(screen.getByTestId('whitelabel-wallet-stub'))
    assert.equal(screen.queryByTestId('tenant-currency-controls-stub'), null)
    assert.equal(screen.queryByTestId('super-admin-switcher-stub'), null)
    assert.equal(screen.queryByTestId('agent-credit-wallet-stub'), null)
    assert.equal(screen.queryByTestId('agent-sharing-wallet-stub'), null)
    assert.equal(screen.queryByTestId('agent-commission-wallet-stub'), null)
    // A Whitelabel Admin is not an agent and not Super Admin, so both bells still show.
    assert.ok(screen.getByTestId('notification-bell-general'))
    assert.ok(screen.getByTestId('notification-bell-task'))
  })

  test('CREDIT-scheme agent: mounts, shows the agent credit wallet, hides the task bell but keeps the general bell', () => {
    signInCreditAgent()

    assert.doesNotThrow(() => renderTopbar())

    assert.ok(screen.getByRole('button', { name: 'Open search' }))
    assert.ok(screen.getByTestId('agent-credit-wallet-stub'))
    assert.equal(screen.queryByTestId('agent-sharing-wallet-stub'), null)
    assert.equal(screen.queryByTestId('agent-commission-wallet-stub'), null)
    assert.equal(screen.queryByTestId('whitelabel-wallet-stub'), null)
    assert.equal(screen.queryByTestId('super-admin-switcher-stub'), null)
    // showTenantCurrency is `!isAgent && ...`, so an agent never gets it.
    assert.equal(screen.queryByTestId('tenant-currency-controls-stub'), null)
    // showTaskBell is `!isSuperAdmin && !isAgent`: agents lose the task bell.
    assert.equal(screen.queryByTestId('notification-bell-task'), null)
    // showGeneralBell is only `!isSuperAdmin`: agents keep the general bell.
    assert.ok(screen.getByTestId('notification-bell-general'))
    assert.ok(
      screen.getByRole('button', { name: 'credit.agent, Agent. Account menu.' }),
      'agent userName falls back to agentUsername per topbarRoles.ts',
    )
  })

  test('showBurger renders the "Open navigation" burger button; it is absent when showBurger is false', () => {
    signInAdmin(['Administrator'])

    const onClick = vi.fn()
    assert.doesNotThrow(() => renderTopbar({ showBurger: true, burgerProps: makeBurgerProps(onClick) }))

    assert.ok(screen.getByRole('button', { name: 'Open navigation' }))
    assert.equal(screen.queryByRole('button', { name: 'Open navigation' })?.getAttribute('aria-expanded'), 'false')
  })

  test('the burger button is not rendered when showBurger is false', () => {
    signInAdmin(['Administrator'])

    assert.doesNotThrow(() => renderTopbar({ showBurger: false }))

    assert.equal(screen.queryByRole('button', { name: 'Open navigation' }), null)
  })
})
