import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { AiAssistantPanel } from './AiAssistantPanel'
import { AiAssistantLauncher } from './AiAssistantLauncher'
import { ProposalCard } from './ProposalCard'
import { useAuthStore } from '@/shared/core/authStore'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/shared/services/notification', () => ({ notify: feedback }))
const proposal = { id: 'proposal-1', toolName: 'update_stake_limit', summary: 'Set the stake limit to 500. <script>not executable</script>', expiresAt: '2099-10-09T18:30:00Z' }
let calls: { name: string; variables: Record<string, unknown> }[]
let options: { enabled: boolean; blocked?: string; failedChat?: boolean; failedConfirm?: boolean; failedReject?: boolean; status?: string; chatDelay?: number; reply?: string }
function page(element = <AiAssistantPanel open onClose={() => {}} />) {
  const savedCalls = calls; const config = options
  const link = new ApolloLink(operation => new Observable(observer => {
    savedCalls.push({ name: operation.operationName, variables: structuredClone(operation.variables) as Record<string, unknown> })
    const timer = setTimeout(() => {
      try {
        switch (operation.operationName) {
          case 'AiAvailability': observer.next({ data: { aiAvailability: { enabled: config.enabled, reason: 'Not configured for this tenant' }, aiEntitlement: { enabled: true, chatLimit: 10, limitPeriod: 'monthly', used: 8, remaining: 2, blockedReason: config.blocked ?? null } } }); break
          case 'AiChat': if (config.failedChat) throw new Error('Assistant service unavailable'); observer.next({ data: { aiChat: { conversationId: 'conversation-1', reply: config.reply ?? 'Live totals\n\n- First total\n- Second total', toolsUsed: ['player_stats', 'player_stats'], proposals: [proposal] } } }); break
          case 'AiConfirmAction': if (config.failedConfirm) throw new Error('Approval permission refused'); observer.next({ data: { aiConfirmAction: { status: config.status ?? 'confirmed', message: config.status === 'expired' ? 'Proposal expired' : 'Updated under your permissions' } } }); break
          case 'AiRejectAction': if (config.failedReject) throw new Error('Discard unavailable'); observer.next({ data: { aiRejectAction: { status: 'rejected', message: 'Discarded' } } }); break
          default: throw new Error(`Unhandled ${operation.operationName}`)
        }
        observer.complete()
      } catch (error) { observer.error(error) }
    }, operation.operationName === 'AiChat' ? config.chatDelay ?? 0 : 0)
    return () => clearTimeout(timer)
  }))
  return render(<MockedProvider cache={new InMemoryCache()} link={link}>{element}</MockedProvider>)
}
beforeEach(() => {
  options = { enabled: true }; calls = []; vi.clearAllMocks()
  useAuthStore.setState({ user: { id: 'admin-1', name: 'Operator' }, agent: undefined, token: undefined, roles: [], permissions: [], agentPermissions: [] })
})
test('closed panel and signed-out or agent launcher do not query the assistant', () => {
  const closed = page(<AiAssistantPanel open={false} onClose={() => {}} />); assert.equal(calls.length, 0); closed.unmount()
  useAuthStore.setState({ user: undefined }); const signedOut = page(<AiAssistantLauncher />); assert.equal(screen.queryByRole('button', { name: 'Open portal assistant' }), null); signedOut.unmount()
  useAuthStore.setState({ user: { id: 'admin-1', name: 'Operator' }, agent: { id: 'agent-1', tenantId: 'tenant-1', username: 'agent', phone: null, schemeType: 'CREDIT', allowedDomains: [], status: 'ACTIVE', parentAgentId: null, levelIndex: 0, tallyEnabled: false, tallyDomains: [], createdAt: '2026-10-09T00:00:00Z' } })
  page(<AiAssistantLauncher />); assert.equal(screen.queryByRole('button', { name: 'Open portal assistant' }), null); assert.equal(calls.length, 0)
})
test('unavailable and quota-blocked states do not permit sending', async () => {
  options.enabled = false; const unavailable = page(); await screen.findByText('Not configured for this tenant'); assert.equal(screen.queryByRole('textbox'), null); unavailable.unmount()
  options.enabled = true; options.blocked = 'Your message allowance has been used'; page(); await screen.findByText(options.blocked)
  assert.equal((screen.getByRole('textbox', { name: 'Message to the assistant' }) as HTMLTextAreaElement).disabled, true)
  assert.equal((screen.getByRole('button', { name: /Player insights/ }) as HTMLButtonElement).disabled, true)
  fireEvent.click(screen.getByRole('button', { name: /Player insights/ }))
  assert.equal(calls.some(call => call.name === 'AiChat'), false)
})
test('allowance and suggestion keep the exact message contract; proposals never apply implicitly', async () => {
  page(); await screen.findByText('8 of 10 messages used this month'); assert.equal(screen.getByRole('meter', { name: 'Assistant message allowance' }).getAttribute('aria-valuenow'), '80')
  fireEvent.click(screen.getByRole('button', { name: /Player insights/ })); await screen.findByText('Live totals')
  assert.deepEqual(calls.find(call => call.name === 'AiChat')?.variables, { message: 'How many players signed up this week?', conversationId: null })
  assert.equal(screen.getAllByText('player stats').length, 1); screen.getByText('First total'); screen.getByText(proposal.summary)
  assert.equal(document.querySelector('script'), null); assert.equal(calls.some(call => ['AiConfirmAction', 'AiRejectAction'].includes(call.name)), false)
  assert.ok(calls.filter(call => call.name === 'AiAvailability').length >= 2)
})

test('six quick actions send real prompts and follow-up questions keep the active conversation', async () => {
  page()
  const cards = await screen.findByRole('region', { name: 'Assistant quick actions' })
  assert.equal(within(cards).getAllByRole('button').length, 6)
  fireEvent.click(within(cards).getByRole('button', { name: /Performance summary/ }))
  await screen.findByText('Live totals')
  assert.deepEqual(calls.find(call => call.name === 'AiChat')?.variables, { message: "Show me today's performance overview and any concerns.", conversationId: null })
  fireEvent.click(screen.getByRole('button', { name: 'Analyze further' }))
  await waitFor(() => assert.equal(screen.getAllByText('Live totals').length, 2))
  assert.deepEqual(calls.filter(call => call.name === 'AiChat')[1].variables, { message: 'Analyze the key concerns in your last answer and suggest next steps.', conversationId: 'conversation-1' })
  assert.equal(calls.some(call => call.name === 'AiConfirmAction'), false)
})

test('timestamps and safe inline emphasis format replies without interpreting HTML', async () => {
  options.reply = '**Summary**\n\n- **Total:** <img src=x onerror=alert(1)>'
  page(); fireEvent.click(await screen.findByRole('button', { name: /Player insights/ }))
  await screen.findByText('Summary')
  const log = screen.getByRole('log', { name: 'Assistant conversation' })
  assert.equal(within(log).getByText('Summary').tagName, 'STRONG')
  assert.equal(within(log).getByText('Total:').tagName, 'STRONG')
  assert.equal(log.querySelectorAll('time[datetime]').length, 2)
  assert.ok(within(log).getByText('Today'))
  assert.equal(log.querySelector('img'), null)
  assert.ok(log.textContent?.includes('<img src=x onerror=alert(1)>'))
})
test('Enter sends a trimmed draft, Shift+Enter and composing Enter do not send, and next turn preserves conversationId', async () => {
  page(); const input = await screen.findByRole('textbox', { name: 'Message to the assistant' })
  fireEvent.change(input, { target: { value: '  Pending withdrawals  ' } }); fireEvent.keyDown(input, { key: 'Enter', shiftKey: true }); fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); assert.equal(calls.some(call => call.name === 'AiChat'), false)
  fireEvent.keyDown(input, { key: 'Enter' }); await screen.findByText('Live totals'); assert.deepEqual(calls.find(call => call.name === 'AiChat')?.variables, { message: 'Pending withdrawals', conversationId: null })
  fireEvent.change(input, { target: { value: 'Show agent totals' } }); fireEvent.click(screen.getByRole('button', { name: 'Send message' })); await waitFor(() => assert.equal(screen.getAllByText('Live totals').length, 2))
  assert.deepEqual(calls.filter(call => call.name === 'AiChat')[1].variables, { message: 'Show agent totals', conversationId: 'conversation-1' })
})
test('rapid send is single-flight and a pending answer cannot reset into a new conversation', async () => {
  options.chatDelay = 80; page(); const input = await screen.findByRole('textbox', { name: 'Message to the assistant' }); fireEvent.change(input, { target: { value: 'Totals' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send message' })); fireEvent.keyDown(input, { key: 'Enter' }) })
  assert.equal(calls.filter(call => call.name === 'AiChat').length, 1); assert.equal((screen.getByRole('button', { name: 'New conversation' }) as HTMLButtonElement).disabled, true)
  await screen.findByText('Live totals'); fireEvent.click(screen.getByRole('button', { name: 'New conversation' })); screen.getByRole('button', { name: /Player insights/ }); assert.equal(screen.queryByText('Live totals'), null)
  fireEvent.change(input, { target: { value: 'Fresh totals' } }); fireEvent.click(screen.getByRole('button', { name: 'Send message' })); await screen.findByText('Live totals'); assert.equal(calls.filter(call => call.name === 'AiChat')[1].variables.conversationId, null)
})
test('close/reopen retains history and launcher is themed kit entry for administrators', async () => {
  page(<AiAssistantLauncher />); fireEvent.click(screen.getByRole('button', { name: 'Open portal assistant' })); fireEvent.click(await screen.findByRole('button', { name: /Custom report/ })); await screen.findByText('Live totals')
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' })); assert.equal(screen.queryByRole('dialog'), null); fireEvent.click(screen.getByRole('button', { name: 'Open portal assistant' })); await screen.findByText('Live totals'); assert.equal(calls.filter(call => call.name === 'AiChat').length, 1)
})
test('failed reply is visible and a retry remains in the same new-conversation contract', async () => {
  options.failedChat = true; page(); fireEvent.click(await screen.findByRole('button', { name: /Risk alerts/ })); await screen.findByText('Assistant service unavailable')
  options.failedChat = false; const input = screen.getByRole('textbox', { name: 'Message to the assistant' }); fireEvent.change(input, { target: { value: 'Retry totals' } }); fireEvent.click(screen.getByRole('button', { name: 'Send message' })); await screen.findByText('Live totals'); assert.equal(calls.filter(call => call.name === 'AiChat')[1].variables.conversationId, null)
})
test('proposal approval and discard are explicit, serialized and use only proposalId', async () => {
  const resolved = vi.fn(); page(<ProposalCard proposal={proposal} onResolved={resolved} />)
  assert.equal(calls.length, 0); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply this change' })); fireEvent.click(screen.getByRole('button', { name: 'Discard' })) }); await screen.findByText('Applied')
  assert.deepEqual(calls, [{ name: 'AiConfirmAction', variables: { proposalId: 'proposal-1' } }]); assert.deepEqual(resolved.mock.calls, [['proposal-1', 'confirmed']]); assert.equal(feedback.success.mock.calls.length, 1)
})
test('server refusal keeps unresolved proposal retryable; expired outcome removes it without claiming success', async () => {
  options.failedConfirm = true; const resolved = vi.fn(); page(<ProposalCard proposal={proposal} onResolved={resolved} />); fireEvent.click(screen.getByRole('button', { name: 'Apply this change' })); await waitFor(() => assert.equal(feedback.error.mock.calls.length, 1)); screen.getByRole('button', { name: 'Apply this change' }); assert.equal(resolved.mock.calls.length, 0)
  options.failedConfirm = false; options.status = 'expired'; fireEvent.click(screen.getByRole('button', { name: 'Apply this change' })); await screen.findByText('Discarded'); assert.deepEqual(resolved.mock.calls, [['proposal-1', 'rejected']]); assert.equal(feedback.success.mock.calls.length, 0)
})
test('discard failure does not resolve the proposal; successful retry removes only its card from history', async () => {
  options.failedReject = true; page(); fireEvent.click(await screen.findByRole('button', { name: /Market trends/ })); await screen.findByText('Live totals')
  const card = screen.getByRole('region', { name: 'Proposed change' }); await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Discard' })) }); await waitFor(() => assert.equal(feedback.error.mock.calls.length, 1)); assert.ok(screen.getByRole('region', { name: 'Proposed change' }))
  options.failedReject = false; await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Discard' })) }); await waitFor(() => assert.equal(Boolean(screen.queryByRole('region', { name: 'Proposed change' })), false)); screen.getByText('Live totals'); assert.deepEqual(calls.find(call => call.name === 'AiRejectAction')?.variables, { proposalId: 'proposal-1' })
})
