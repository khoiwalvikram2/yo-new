import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PlayerChatWidget } from '../../../../ui-shared/support/SupportChat'
import type { SupportClient } from '../../../../ui-shared/support/client'
import type { ChatBootstrap, ChatConversation } from '../../../../shared/src/support/contracts'

const boot: ChatBootstrap = {
  actor: { tenant: 'qa', kind: 'player', id: '7', name: 'Player', readOnly: false, canReply: true, canAssign: false, canSettings: false, viewAll: false, bookIds: [] },
  settings: { enabled: true, title: 'Live support', welcomeMessage: 'Welcome', offlineMessage: 'Leave a message', timezone: 'Asia/Kolkata', openMinute: 0, closeMinute: 1440, days: [1,2,3,4,5,6,7] },
  online: true, withinHours: true, available: false, unreadTotal: 0,
}
const chat: ChatConversation = { id: 'chat-1', playerId: '7', playerName: 'Player', playerType: 'REGULAR', topic: 'Account', status: 'waiting', assignedKind: null, assignedId: null, assignedName: null, lastSeq: '0', playerReadSeq: '0', staffReadSeq: '0', playerDeliveredSeq: '0', staffDeliveredSeq: '0', preview: '', updatedAt: '2026-10-26T10:00:00Z', unread: 0 }
const originals = new Map(['show', 'showModal', 'close'].map((key) => [key, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key)]))
let show: ReturnType<typeof vi.fn>, showModal: ReturnType<typeof vi.fn>
let media: MediaQueryList
const changes = new Set<() => void>()
function viewport(desktop: boolean) { act(() => { Object.defineProperty(media, 'matches', { configurable: true, value: desktop }); changes.forEach((fn) => fn()) }) }
function client() {
  const request = vi.fn(async (url: string, method?: string) => url === '/bootstrap' ? boot : url.endsWith('/messages') ? { conversation: chat, items: [], before: null } : method === 'POST' ? chat : { items: [], cursor: null })
  return { request, publicStatus: async () => ({ settings: boot.settings }), connect: () => () => {}, typing: () => {}, image: async () => new Blob(), base: '/support' } as unknown as SupportClient
}
async function open() { fireEvent.click(await screen.findByRole('button', { name: 'Open live chat' })); return screen.findByRole('dialog', { name: 'Live support chat' }) }

beforeEach(() => {
  changes.clear()
  media = { matches: true, addEventListener: (_type: string, fn: () => void) => changes.add(fn), removeEventListener: (_type: string, fn: () => void) => changes.delete(fn) } as unknown as MediaQueryList
  vi.spyOn(window, 'matchMedia').mockReturnValue(media)
  show = vi.fn(function(this: HTMLDialogElement) { this.open = true })
  showModal = vi.fn(function(this: HTMLDialogElement) { this.open = true })
  const close = function(this: HTMLDialogElement) { this.open = false; queueMicrotask(() => this.dispatchEvent(new Event('close'))) }
  for (const [key, value] of Object.entries({ show, showModal, close })) Object.defineProperty(HTMLDialogElement.prototype, key, { configurable: true, value })
  document.body.style.overflow = 'auto'
})
afterEach(() => {
  for (const [key, value] of originals) { if (value) Object.defineProperty(HTMLDialogElement.prototype, key, value); else Reflect.deleteProperty(HTMLDialogElement.prototype, key) }
  document.body.style.overflow = ''
})

describe('player chat drawer behavior', () => {
  test('desktop uses a non-modal rail drawer, allows page scrolling, and closes outside or on Escape', async () => {
    render(<PlayerChatWidget client={client()} authenticated onLogin={() => {}} />)
    await open()
    assert.equal(show.mock.calls.length, 1); assert.equal(showModal.mock.calls.length, 0)
    assert.equal(document.body.style.overflow, 'auto')
    fireEvent.pointerDown(document.body)
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    await open(); fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    assert.equal(document.activeElement, screen.getByRole('button', { name: 'Open live chat' }))
  })

  test('mobile locks background scrolling and restores it and launcher focus on cancel', async () => {
    viewport(false)
    render(<PlayerChatWidget client={client()} authenticated onLogin={() => {}} />)
    const dialog = await open()
    assert.equal(showModal.mock.calls.length, 1); assert.equal(show.mock.calls.length, 0)
    assert.equal(document.body.style.overflow, 'hidden')
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    assert.equal(document.body.style.overflow, 'auto')
    assert.equal(document.activeElement, screen.getByRole('button', { name: 'Open live chat' }))
  })

  test('crossing the rail breakpoint changes modality without closing the chat', async () => {
    render(<PlayerChatWidget client={client()} authenticated onLogin={() => {}} />)
    await open(); viewport(false); await act(async () => { await Promise.resolve() })
    assert.equal(showModal.mock.calls.length, 1); assert.equal(document.body.style.overflow, 'hidden')
    assert.ok(screen.getByRole('dialog'))
    viewport(true); await act(async () => { await Promise.resolve() })
    assert.equal(show.mock.calls.length, 2); assert.equal(document.body.style.overflow, 'auto')
    assert.ok(screen.getByRole('dialog'))
  })

  test('closing for another drawer keeps the active conversation draft', async () => {
    render(<PlayerChatWidget client={client()} authenticated onLogin={() => {}} />)
    await open(); fireEvent.click(await screen.findByRole('button', { name: 'Start conversation' }))
    const input = await screen.findByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: 'Keep this draft' } })
    act(() => window.dispatchEvent(new Event('support-chat:close')))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
    await open()
    assert.equal((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value, 'Keep this draft')
  })

  test('guests are sent to sign in and opening a drawer announces coordination to the shell', async () => {
    const login = vi.fn(), opening = vi.fn(), api = client()
    window.addEventListener('support-chat:opening', opening)
    try {
      const view = render(<PlayerChatWidget client={api} authenticated={false} onLogin={login} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Open live chat' }))
      assert.equal(login.mock.calls.length, 1); assert.equal(show.mock.calls.length, 0); assert.equal(opening.mock.calls.length, 0)
      view.rerender(<PlayerChatWidget client={api} authenticated onLogin={login} />)
      await open(); assert.equal(opening.mock.calls.length, 1)
    } finally { window.removeEventListener('support-chat:opening', opening) }
  })
})
