import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useAuthStore } from './authStore'
import { useUIStore } from './uiStore'
import { useSupportPermissionSync } from './useSupportPermissionSync'
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
