import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { IconArrowRight, IconChartBar, IconGift, IconReportAnalytics, IconRotateClockwise, IconShieldExclamation, IconSparkles, IconTrendingUp, IconUsers } from '@tabler/icons-react'
import clsx from 'clsx'
import { AI_AVAILABILITY, AI_CHAT } from '@/lib/graphql/aiAssistant'
import { Button } from '@/ui/components/Button'
import { Drawer } from '@/ui/components/Drawer'
import { LoadingState } from '@/ui/components/LoadingState'
import { Meter } from '@/ui/components/Meter'
import { Notice } from '@/ui/components/Notice'
import { Spinner } from '@/ui/components/Spinner'
import { StatusPill } from '@/ui/components/StatusPill'
import { Textarea } from '@/ui/components/Textarea'
import { ProposalCard, type Proposal } from './ProposalCard'
import styles from './AiAssistant.module.css'

interface Turn {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  failed?: boolean
  toolsUsed?: string[]
  proposals?: Proposal[]
}
interface AvailabilityData {
  aiAvailability: { enabled: boolean; reason?: string | null }
  aiEntitlement?: { enabled: boolean; chatLimit: number; limitPeriod: string; used: number; remaining: number; blockedReason?: string | null } | null
}
interface ChatData {
  aiChat: { conversationId: string; reply: string; toolsUsed?: string[] | null; proposals?: Proposal[] | null }
}
const SUGGESTIONS = [
  { title: 'Performance summary', description: "Today's metrics and concerns", prompt: "Show me today's performance overview and any concerns.", icon: IconChartBar, tone: 'accent' },
  { title: 'Player insights', description: 'New players and their activity', prompt: 'How many players signed up this week?', icon: IconUsers, tone: 'blue' },
  { title: 'Risk alerts', description: 'Review pending withdrawals', prompt: 'Show me pending withdrawal requests', icon: IconShieldExclamation, tone: 'amber' },
  { title: 'Bonus analysis', description: 'Check bonus performance', prompt: 'Analyze bonus performance for this month.', icon: IconGift, tone: 'accent' },
  { title: 'Market trends', description: 'Compare agent turnover', prompt: 'Which agents brought the most turnover?', icon: IconTrendingUp, tone: 'green' },
  { title: 'Custom report', description: 'Explore revenue and GGR', prompt: 'What was casino GGR last month?', icon: IconReportAnalytics, tone: 'blue' },
]
const FOLLOW_UPS = [
  { label: 'Analyze further', prompt: 'Analyze the key concerns in your last answer and suggest next steps.' },
  { label: 'Player segments', prompt: 'Show the player segments related to this conversation.' },
  { label: 'Revenue summary', prompt: 'Generate a revenue summary for the period discussed in this conversation.' },
]
const timeLabel = (value: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value))
const dayKey = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
function dayLabel(value: string) {
  return dayKey(value) === dayKey(new Date().toISOString()) ? 'Today' : new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}
function inlineText(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part)
}

/** Text only: server replies are never interpreted as HTML or executable arguments. */
function ReplyBody({ text }: { text: string }) {
  return <div className={styles.reply}>{text.split(/\n{2,}/).map((block, index) => {
    const lines = block.split('\n')
    return lines.length > 1 && lines.every((line) => /^\s*([-*•]|\d+[.)])\s+/.test(line))
      ? <ul key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{inlineText(line.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>)}</ul>
      : <p key={index}>{inlineText(block)}</p>
  })}</div>
}

export const ASSISTANT_TITLE = 'AI Assistant'
export const ASSISTANT_SUB = 'Insights and actions for your workspace'

/** Live answers use the signed-in administrator's permissions; proposals require explicit approval.
 *  `surface="inline"`: the shell's tool rail panel hosts it (and carries the title and close button), so it
 *  renders only the conversation and the composer under it. */
export function AiAssistantPanel({ open, onClose, surface = 'drawer' }: { open: boolean; onClose: () => void; surface?: 'drawer' | 'inline' }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const busyRef = useRef(false)
  const turnSequence = useRef(0)
  const nextId = (prefix: string) => `${prefix}-${++turnSequence.current}`

  const { data, loading: checking, error, refetch } = useQuery<AvailabilityData>(AI_AVAILABILITY, { skip: !open, fetchPolicy: 'cache-and-network' })
  const refreshAllowance = () => { void refetch().catch(() => undefined) }
  const [sendChat, { loading: sending }] = useMutation<ChatData>(AI_CHAT, {
    onCompleted: ({ aiChat: reply }) => {
      setConversationId(reply.conversationId)
      setTurns((previous) => [...previous, { id: nextId('assistant'), role: 'assistant', content: reply.reply, createdAt: new Date().toISOString(), toolsUsed: reply.toolsUsed ?? [], proposals: reply.proposals ?? [] }])
      refreshAllowance()
    },
    onError: (failure) => {
      setTurns((previous) => [...previous, { id: nextId('error'), role: 'assistant', content: failure.message, createdAt: new Date().toISOString(), failed: true }])
      refreshAllowance()
    },
  })
  useLayoutEffect(() => {
    if (!open) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [open, turns, sending])
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => inputRef.current?.focus(), 150)
    return () => clearTimeout(timer)
  }, [open])

  const availability = data?.aiAvailability
  const entitlement = data?.aiEntitlement
  const blocked = entitlement?.blockedReason ?? null
  const canSend = Boolean(availability?.enabled) && !blocked
  const send = useCallback((text?: string) => {
    const message = (text ?? draft).trim()
    if (!message || sending || busyRef.current || !canSend) return
    busyRef.current = true
    setTurns((previous) => [...previous, { id: `user-${++turnSequence.current}`, role: 'user', content: message, createdAt: new Date().toISOString() }])
    setDraft('')
    void sendChat({ variables: { message, conversationId } }).catch(() => undefined).finally(() => { busyRef.current = false })
  }, [draft, sending, canSend, conversationId, sendChat])
  const startNew = () => {
    // A pending answer belongs to its original conversation, not a newly reset one.
    if (sending || busyRef.current) return
    setTurns([]); setConversationId(null); setDraft(''); inputRef.current?.focus()
  }
  const usedPct = entitlement?.chatLimit ? Math.min(100, (entitlement.used / entitlement.chatLimit) * 100) : 0
  const composer = availability?.enabled && <div className={styles.footer}>
    <div className={styles.composer}>
      <Textarea ref={inputRef} label="Message to the assistant" hideLabel rows={1} autoGrow value={draft} onChange={setDraft}
        textareaClassName={styles.composerInput} placeholder={canSend ? 'Ask anything about your workspace…' : 'Chatting is not available'} disabled={sending || !canSend}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() }
        }} />
      <Button className={styles.sendButton} variant="primary" icon={<IconArrowRight size={18} />} aria-label="Send message" title="Send message" loading={sending} disabled={!draft.trim() || !canSend} onClick={() => send()} />
    </div>
    <p className={styles.composerHint}>Enter to send · Shift+Enter for a new line</p>
    <p className={styles.disclaimer}>AI can make mistakes. Verify important information.</p>
  </div>

  const body = <div className={styles.panel}>
      {checking && !data ? <LoadingState label="Checking assistant availability" /> : !availability?.enabled
        ? <Notice tone="warn" title="The assistant is unavailable" action={error ? <Button variant="secondary" size="sm" onClick={() => refreshAllowance()}>Retry</Button> : undefined}>{error?.message ?? availability?.reason ?? 'It has not been configured on the server.'}</Notice>
        : <>
          {entitlement && entitlement.chatLimit > 0 && <div className={styles.allowance}>
            <div className={styles.row}>
              <p className={styles.secondary}>{entitlement.used} of {entitlement.chatLimit} messages used{entitlement.limitPeriod !== 'total' && ` this ${entitlement.limitPeriod.replace('ly', '')}`}</p>
              <p className={styles.secondary}>{entitlement.remaining} left</p>
            </div>
            <Meter value={usedPct} tone={usedPct >= 100 ? 'neg' : usedPct >= 80 ? 'warn' : 'acc'} label="Assistant message allowance" valueText={`${entitlement.used} of ${entitlement.chatLimit} messages used`} />
          </div>}
          {blocked && <Notice tone="info" title="Chatting is not available">{blocked}</Notice>}
          {turns.length > 0 && <div className={styles.threadActions}><span>Conversation</span><Button variant="ghost" size="xs" icon={<IconRotateClockwise size={14} />} disabled={sending} onClick={startNew}>New conversation</Button></div>}
          <div ref={scrollRef} className={styles.conversation} role="log" aria-label="Assistant conversation" aria-live="polite" aria-relevant="additions">
            <section className={styles.quickActions} aria-label="Assistant quick actions">
              {SUGGESTIONS.map(({ title, description, prompt, icon: Icon, tone }) => <button type="button" key={title} className={styles.suggestion} disabled={sending || !canSend} onClick={() => send(prompt)}>
                <span className={styles.suggestionTitle}><Icon size={16} stroke={1.8} className={styles[tone]} aria-hidden="true"/><strong>{title}</strong></span><span>{description}</span>
              </button>)}
            </section>
            {turns.length === 0 && !blocked && <div className={styles.welcome}><span><IconSparkles size={22}/></span><strong>How can I help you today?</strong><p>Choose a quick action or ask a question about your workspace.</p></div>}
            {turns.map((turn, index) => <div key={turn.id} className={styles.messageGroup}>
              {(index === 0 || dayKey(turn.createdAt) !== dayKey(turns[index - 1].createdAt)) && <div className={styles.day}><span>{dayLabel(turn.createdAt)}</span></div>}
              <div className={clsx(styles.turn, turn.role === 'user' && styles.user)}>
              {turn.role === 'assistant' && <span className={styles.avatar} aria-hidden="true"><IconSparkles size={17}/></span>}
              <div className={styles.turnBody}>
                <div className={clsx(styles.bubble, turn.failed && styles.failed)}>
                  {turn.role === 'assistant' && !turn.failed ? <ReplyBody text={turn.content} /> : turn.content}
                  <time className={styles.timestamp} dateTime={turn.createdAt}>{timeLabel(turn.createdAt)}</time>
                </div>
                {turn.role === 'assistant' && !!turn.toolsUsed?.length && <details className={styles.sources}><summary>Sources ({new Set(turn.toolsUsed).size})</summary><div className={styles.actions}>{Array.from(new Set(turn.toolsUsed)).map((tool) => <StatusPill key={tool} tone="muted">{tool.replace(/_/g, ' ')}</StatusPill>)}</div></details>}
                {!!turn.proposals?.length && <div className={styles.stack}>{turn.proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal}
                  onResolved={(id) => setTurns((previous) => previous.map((existing) => existing.proposals?.some((item) => item.id === id) ? { ...existing, proposals: existing.proposals.filter((item) => item.id !== id) } : existing))} />)}</div>}
              </div>
              </div>
              {index === turns.length - 1 && turn.role === 'assistant' && !turn.failed && canSend && !sending && <div className={styles.followUps} aria-label="Suggested follow-up questions">{FOLLOW_UPS.map(({ label, prompt }, followIndex) => <Button key={label} variant={followIndex === 0 ? 'primary' : 'secondary'} size="sm" onClick={() => send(prompt)}>{label}</Button>)}</div>}
            </div>)}
            {sending && <div className={styles.thinking} role="status"><IconSparkles size={16}/><Spinner size="sm" />Thinking…</div>}
          </div>
        </>}
    </div>

  if (surface === 'inline') {
    // The tool rail panel is a drawer, square on every corner (the owner, 2026-10-28): so are the strips on its edges.
    return <div className={styles.inline} data-ui-radius="square">
      <div className={styles.inlineBody} data-ui-radius="square">{body}</div>
      {composer && <div className={styles.inlineFoot} data-ui-radius="square">{composer}</div>}
    </div>
  }
  return <Drawer open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }} title={<span className={styles.drawerTitle}><IconSparkles size={19}/><span>{ASSISTANT_TITLE}</span><span className={styles.drawerBadge} aria-hidden="true">AI</span></span>}
    sub={ASSISTANT_SUB} size="md" className={styles.drawer} footer={composer || undefined}>
    {body}
  </Drawer>
}
