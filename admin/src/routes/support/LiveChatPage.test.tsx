/**
 * Live Chat for a Super Admin (SYS-20). In core mode there is no inbox: the server answers bootstrap and the
 * conversation list 403 "Select a whitelabel to manage its support inbox", and the page used to show that next
 * to an empty inbox and a socket stuck on "Reconnecting". It now asks for a whitelabel and mounts no inbox.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const inbox = vi.hoisted(() => ({ mounted: 0 }))
vi.mock('../../../../ui-shared/support/SupportChat', () => ({
  SupportInbox: () => { inbox.mounted += 1; return 'Support inbox' },
  SupportSettings: () => 'Support settings',
}))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/shared/core/uiStore', async () => {
  const { create } = await import('zustand')
  return { useUIStore: create(() => ({ tenant: 'grandwinn-com', directorMode: 'core' as 'core' | 'whitelabel', selectedWhitelabelId: null as string | null })) }
})

import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { supportNeedsWhitelabel } from '@/shared/core/useAdminSupportClient'
import LiveChatPage from './LiveChatPage'

beforeEach(() => {
  inbox.mounted = 0
  useAuthStore.setState({ token: 'session', user: { id: '1', name: 'Platform' } as never, agent: undefined, roles: ['Super Admin'] })
  useUIStore.setState({ directorMode: 'core', selectedWhitelabelId: null })
})

describe('Live Chat needs a whitelabel for a Super Admin', () => {
  test('in core mode it asks for one and mounts no inbox (no requests, no socket)', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    render(<LiveChatPage />)
    assert.ok(screen.getByText('Select a whitelabel'))
    assert.equal(inbox.mounted, 0)
    assert.equal(fetcher.mock.calls.length, 0)
  })

  test('with a whitelabel selected the inbox opens', () => {
    useUIStore.setState({ directorMode: 'whitelabel', selectedWhitelabelId: 'grandwinn-com' })
    render(<LiveChatPage />)
    assert.ok(screen.getByText('Support inbox'))
  })

  test('a Whitelabel Admin always has its own inbox', () => {
    useAuthStore.setState({ roles: ['Whitelabel Admin'] })
    render(<LiveChatPage />)
    assert.ok(screen.getByText('Support inbox'))
  })

  test('whitelabel mode with no site chosen is the same as core mode', () => {
    assert.equal(supportNeedsWhitelabel(['Super Admin'], 'whitelabel', null), true)
    assert.equal(supportNeedsWhitelabel(['Super Admin'], 'whitelabel', 'kondareddi-com'), false)
    assert.equal(supportNeedsWhitelabel(['Whitelabel Admin'], 'core', null), false)
  })
})
