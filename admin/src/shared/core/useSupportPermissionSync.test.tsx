import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useAuthStore } from './authStore'
import { useUIStore } from './uiStore'
import { mayHaveSupportInbox, useSupportPermissionSync } from './useSupportPermissionSync'
import { useShellNavigation } from '@/shell/useShellNavigation'

const request = vi.hoisted(() => vi.fn())
vi.mock('./useAdminSupportClient', () => ({ useAdminSupportClient: () => ({ request }) }))
vi.mock('./uiStore', async () => {
  const { create } = await import('zustand')
  return { useUIStore: create(() => ({ directorMode: 'core' as 'core' | 'whitelabel', selectedWhitelabelId: null as string | null })) }
})
const actor = { id: 'owner', kind: 'admin', canReply: true, canAssign: true, canSettings: true }
const permissions = [{ domain: 'security.roles', actions: ['view'] }]
const destinations = (sections: ReturnType<typeof useShellNavigation>) => sections.flatMap((s) => s.rows.map((r) => r.to))
const grants = () => useAuthStore.getState().permissions.find((p) => p.domain === 'support.chat')?.actions
const flush = () => act(async () => { await Promise.resolve() })

describe('support permission refresh for existing sessions', () => {
  beforeEach(() => {
    request.mockReset()
    useAuthStore.setState({ token: 'existing-session', user: { id: 'owner', name: 'Owner' }, agent: undefined, roles: ['Whitelabel Admin'], permissions })
    useUIStore.setState({ directorMode: 'core', selectedWhitelabelId: null })
  })

  test('an old cached session gains the menu from server capabilities without logging in again', async () => {
    request.mockResolvedValue({ actor })
    const { result } = renderHook(() => { useSupportPermissionSync(); return useShellNavigation() })
    assert.equal(destinations(result.current).includes('/support/live-chat'), false)
    await waitFor(() => assert.equal(destinations(result.current).includes('/support/live-chat'), true))
    assert.deepEqual(grants(), ['view', 'reply', 'assign', 'settings'])
    assert.equal(useAuthStore.getState().token, 'existing-session')
    assert.deepEqual(useAuthStore.getState().permissions.find((p) => p.domain === 'security.roles'), permissions[0])
  })

  test('the Whitelabel Admin name does not grant support when the server refuses access', async () => {
    useAuthStore.setState({ permissions: [...permissions, { domain: 'support.chat', actions: ['view', 'reply'] }] })
    request.mockRejectedValue(Object.assign(new Error('Permission required'), { status: 403 }))
    const { result } = renderHook(() => { useSupportPermissionSync(); return useShellNavigation() })
    await waitFor(() => assert.equal(grants(), undefined))
    assert.equal(destinations(result.current).includes('/support/live-chat'), false)
    assert.deepEqual(useAuthStore.getState().permissions, permissions)
  })

  test('view-only access replaces stale reply, assign and settings grants', async () => {
    useAuthStore.setState({ permissions: [{ domain: 'support.chat', actions: ['view', 'reply', 'assign', 'settings'] }] })
    request.mockResolvedValue({ actor: { ...actor, canReply: false, canAssign: false, canSettings: false } })
    renderHook(() => useSupportPermissionSync())
    await waitFor(() => assert.deepEqual(grants(), ['view']))
  })

  test('a late response from a previous login cannot change the new session', async () => {
    let complete!: (result: { actor: typeof actor }) => void
    request.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    request.mockRejectedValue(Object.assign(new Error('Denied'), { status: 403 }))
    renderHook(() => useSupportPermissionSync())
    act(() => useAuthStore.setState({ token: 'next-session', user: { id: 'next-owner', name: 'Next' }, permissions }))
    await flush()
    await act(async () => complete({ actor }))
    assert.equal(grants(), undefined)
    assert.equal(useAuthStore.getState().user?.id, 'next-owner')
  })

  test('a late result for the previous selected whitelabel cannot overwrite the current selection', async () => {
    useAuthStore.setState({ roles: ['Super Admin'] })
    useUIStore.setState({ directorMode: 'whitelabel', selectedWhitelabelId: 'tenant-a' })
    let complete!: (result: { actor: typeof actor }) => void
    request.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    request.mockResolvedValue({ actor: { ...actor, canReply: false, canAssign: false, canSettings: false } })
    renderHook(() => useSupportPermissionSync())
    act(() => useUIStore.setState({ selectedWhitelabelId: 'tenant-b' }))
    await waitFor(() => assert.deepEqual(grants(), ['view']))
    await act(async () => complete({ actor }))
    assert.deepEqual(grants(), ['view'])
  })

  test('temporary network errors keep the last confirmed grants', async () => {
    const confirmed = [...permissions, { domain: 'support.chat', actions: ['view'] }]
    useAuthStore.setState({ permissions: confirmed })
    request.mockRejectedValue(new Error('Network unavailable'))
    renderHook(() => useSupportPermissionSync())
    await flush()
    assert.deepEqual(useAuthStore.getState().permissions, confirmed)
  })

  test('Super Admin core mode and signed-out sessions do not request a tenant inbox', async () => {
    useAuthStore.setState({ roles: ['Super Admin'] })
    const view = renderHook(() => useSupportPermissionSync())
    await flush();assert.equal(request.mock.calls.length, 0)
    act(() => useAuthStore.setState({ token: undefined, user: undefined }))
    view.rerender();await flush();assert.equal(request.mock.calls.length, 0)
  })
})

/* N006: an admin without the support grant asked GET /support/bootstrap at every sign-in, page load, minute and
   focus, and every answer was 403 "Support inbox permission is required" in the browser console. */
describe('support inbox requests for admins without the grant', () => {
  const denied = () => Object.assign(new Error('Support inbox permission is required'), { status: 403 })
  let clock = 0
  /** Focus and visibility, some minutes on: past the minute between requests, when the hook would ask again. */
  const laterFocus = (minutes: number) => act(() => {
    clock += minutes * 60_000
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
  })

  beforeEach(() => {
    clock = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    request.mockReset()
    useUIStore.setState({ directorMode: 'core', selectedWhitelabelId: null })
  })
  afterEach(() => { vi.restoreAllMocks() })

  test('a session that holds no support grant never asks', async () => {
    useAuthStore.setState({ token: 'finance-session', user: { id: '648', name: 'Finance' }, agent: undefined, roles: ['Finance Manager'], permissions })
    request.mockRejectedValue(denied())
    renderHook(() => useSupportPermissionSync())
    await flush()
    await laterFocus(2)
    await flush()
    assert.equal(request.mock.calls.length, 0, 'the inbox was asked for by an admin the server can only refuse')
  })

  test('a stored grant asks; once refused the grant goes and the hook asks no more', async () => {
    useAuthStore.setState({ token: 'support-session', user: { id: '700', name: 'Support' }, agent: undefined, roles: ['Customer Support'],
      permissions: [...permissions, { domain: 'support.chat', actions: ['view'] }] })
    request.mockRejectedValue(denied())
    renderHook(() => useSupportPermissionSync())
    await waitFor(() => assert.equal(grants(), undefined))
    assert.equal(request.mock.calls.length, 1)
    await laterFocus(2)
    await flush()
    await laterFocus(5)
    await flush()
    assert.equal(request.mock.calls.length, 1, 'kept polling after the 403')
  })

  test('a refused Whitelabel Admin stops asking until the session changes, then asks again', async () => {
    useAuthStore.setState({ token: 'owner-session', user: { id: 'owner', name: 'Owner' }, agent: undefined, roles: ['Whitelabel Admin'], permissions })
    request.mockRejectedValue(denied())
    renderHook(() => useSupportPermissionSync())
    await waitFor(() => assert.equal(request.mock.calls.length, 1))
    await laterFocus(2)
    await flush()
    assert.equal(request.mock.calls.length, 1, 'the owner kept polling after the 403')

    // A new session (its permissions come with it) is asked about again, and live chat works when it is granted.
    request.mockResolvedValue({ actor })
    act(() => useAuthStore.setState({ token: 'owner-session-2' }))
    await waitFor(() => assert.deepEqual(grants(), ['view', 'reply', 'assign', 'settings']))
    assert.equal(request.mock.calls.length, 2)
  })

  test('who may ask: a stored support grant, all:*, a Super Admin or a Whitelabel Admin', () => {
    assert.equal(mayHaveSupportInbox([{ domain: 'support.chat', actions: ['view'] }], ['Customer Support']), true)
    assert.equal(mayHaveSupportInbox([{ domain: 'all', actions: ['*'] }], []), true)
    assert.equal(mayHaveSupportInbox([], ['Super Admin']), true)
    assert.equal(mayHaveSupportInbox([], ['Whitelabel Admin']), true)
    assert.equal(mayHaveSupportInbox([], ['whitelabel_admin']), true)
    assert.equal(mayHaveSupportInbox(permissions, ['Finance Manager']), false)
    assert.equal(mayHaveSupportInbox([{ domain: 'support.chat', actions: [] }], ['Viewer']), false, 'a grant with no view is no grant')
  })
})
