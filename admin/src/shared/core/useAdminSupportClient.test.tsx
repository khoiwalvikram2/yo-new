import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, renderHook } from '@testing-library/react'
import { useAuthStore } from './authStore'
import { readSignOutNotice } from './signOutReason'
import { useUIStore } from './uiStore'
import { useAdminSupportClient } from './useAdminSupportClient'

vi.mock('./uiStore', async () => {
  const { create } = await import('zustand')
  return { useUIStore: create(() => ({ tenant: 'tenant-owner', directorMode: 'whitelabel' as 'core' | 'whitelabel', selectedWhitelabelId: 'tenant-selected' })) }
})

describe('admin support client', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuthStore.setState({ token: 'current-token', user: { id: 'owner', name: 'Owner' }, agent: undefined, roles: ['Whitelabel Admin'], permissions: [] })
  })

  // N003: the support API's 401 signs the panel out like the GraphQL refusal does, and the sign-in page says why.
  test('a refused support session signs out and leaves the reason for the sign-in page', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"error":"Invalid support session"}', { status: 401, headers: { 'content-type': 'application/json' } }))
    const { result } = renderHook(() => useAdminSupportClient())
    await assert.rejects(result.current.request('/bootstrap'), /Invalid support session/)
    assert.equal(useAuthStore.getState().token, undefined, 'the session was kept')
    assert.equal(readSignOutNotice()?.title, 'Session ended')
  })

  test('the selected tenant is used for Super Admin and the owner tenant for whitelabel staff', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }))
    const { result } = renderHook(() => useAdminSupportClient())
    await result.current.request('/bootstrap')
    assert.equal((fetcher.mock.calls[0][1]?.headers as Record<string, string>)['x-whitelabel-id'], 'tenant-owner')
    act(() => useAuthStore.setState({ roles: ['Super Admin'] }))
    // Headers re-read roles even when a refreshed role list keeps the same token.
    await result.current.request('/bootstrap')
    assert.equal((fetcher.mock.calls[1][1]?.headers as Record<string, string>)['x-whitelabel-id'], useUIStore.getState().selectedWhitelabelId)
    assert.equal((fetcher.mock.calls[1][1]?.headers as Record<string, string>)['x-admin-mode'], 'whitelabel')
  })

  test('an expired request from a previous login cannot log out a newer session', async () => {
    let complete!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const { result } = renderHook(() => useAdminSupportClient())
    const pending = result.current.request('/bootstrap').catch((error: unknown) => error)
    act(() => useAuthStore.setState({ token: 'next-token', user: { id: 'next-owner', name: 'Next owner' } }))
    complete(new Response('{"error":"Session expired"}', { status: 401, headers: { 'content-type': 'application/json' } }))
    await pending
    assert.equal(useAuthStore.getState().token, 'next-token')
    assert.equal(useAuthStore.getState().user?.id, 'next-owner')
    assert.equal(readSignOutNotice(), null, 'no sign-out reason for a session that was not ended')
  })
})
