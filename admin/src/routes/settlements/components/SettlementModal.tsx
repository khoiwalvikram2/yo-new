import { useState, useEffect } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { notify } from '@/shared/services/notification'
import { Dialog } from '@/ui/components/Dialog'
import { Button } from '@/ui/components/Button'
import { NumberField } from '@/ui/components/NumberField'
import { Textarea } from '@/ui/components/Textarea'
import { Notice } from '@/ui/components/Notice'
import { StatusPill } from '@/ui/components/StatusPill'
import { DescriptionList } from '@/ui/components/DescriptionList'
import styles from './SettlementModal.module.css'
import { remainingAfterSettlement, settlementModalDirection } from './settlementModalModel'

/**
 * A SHARING agent's P/L settlement. SHARING is the only scheme settled here: COMMISSION is paid by payCommission,
 * and since 2026-11-02 a CREDIT agent settles by moving chips (Deposit / Withdraw of its Ref P/L), so the old
 * fixed-amount CREDIT settle with a free direction is gone.
 */
interface SettlementAgent {
  /** Signed, positive = TO_AGENT (you pay the agent), negative = FROM_AGENT. */
  pendingAmount?: number | null
  /** Who pays (backend): TO_AGENT, FROM_AGENT or NONE. Wins over the sign of pendingAmount. */
  settlementDirection?: string | null
  username?: string | null
  schemeType?: string
  agent?: { username?: string | null; schemeType?: string }
  /** amount = the players' P/L, agentShare positive = the agent earns, cutAmount = the platform's part (|GGR| − |share|). */
  settlementBreakdownByDomain?: Array<{ domain: string; amount: number; percentage: number; cutAmount: number; cutPercentage: number; agentShare?: number | null }>
}
interface SettlementValues { amount: number | null; direction: string; notes: string }
type SettlementModalProps = {
  visible: boolean
  agent: SettlementAgent | null
  onCancel: () => void
  onSubmit: (values: { amount: number; direction: string; notes: string }) => Promise<void>
  formatCurrency: (value: number) => string
  onRefresh?: () => Promise<unknown>
}
export function SettlementModal({ visible, agent, onCancel, onSubmit, formatCurrency, onRefresh }: SettlementModalProps) {
  const { getCurrencySymbol } = useCurrency()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [values, setValues] = useState<SettlementValues>({ amount: null, direction: '', notes: '' })
  const [review, setReview] = useState<SettlementValues | null>(null)
  const [errors, setErrors] = useState<{ amount?: string; notes?: string }>({})
  const pending = Number(agent?.pendingAmount || 0)
  // positive pending = TO_AGENT (you pay the agent its share), negative = FROM_AGENT; the backend's direction wins.
  const derivedDirection = settlementModalDirection(agent?.settlementDirection, pending)
  useEffect(() => {
    if (visible && agent?.pendingAmount != null) {
      setValues({ amount: Math.abs(Number(agent.pendingAmount)) || 0, direction: settlementModalDirection(agent.settlementDirection, Number(agent.pendingAmount) || 0), notes: '' })
      setReview(null); setErrors({}); setStep(1)
    }
  }, [visible, agent])
  const validate = () => {
    // The direction is derived, never entered, so only the amount and the notes are checked.
    const next = {
      amount: values.amount == null ? 'Please enter settlement amount' : values.amount < .01 ? 'Amount must be greater than 0' : undefined,
      notes: !values.notes ? 'Please enter notes for audit trail' : values.notes.length < 3 ? 'Notes must be at least 3 characters' : undefined,
    }
    setErrors(next)
    return !next.amount && !next.notes
  }
  const cancel = () => { setValues({ amount: null, direction: '', notes: '' }); setReview(null); setStep(1); setErrors({}); onCancel() }
  const submit = async () => {
    if (!(step === 2 && review) && !validate()) return
    setLoading(true)
    try {
      const input = { ...(step === 2 && review ? review : values) }
      if (input.amount == null || (Math.abs(pending) > 0 && Number(input.amount) <= 0)) input.amount = Math.abs(pending) || 0
      // The direction follows the P/L (the backend's, else the sign); it is never picked by hand.
      input.direction = derivedDirection
      input.notes ??= ''
      await onSubmit({ ...input, amount: Number(input.amount) })
    } catch (error) { notify.error(error instanceof Error ? error.message : 'An error occurred while processing the settlement', 'Settlement Failed') }
    finally { setLoading(false) }
  }
  const refresh = async () => { if (!onRefresh) return; setRefreshing(true); try { await onRefresh() } finally { setRefreshing(false) } }
  if (!agent || agent.pendingAmount == null) return null
  const displayed = step === 2 && review ? review : values
  const amount = Number(displayed.amount ?? 0)
  const direction = displayed.direction || derivedDirection
  const collecting = direction === 'FROM_AGENT'
  const owedLabel = derivedDirection === 'FROM_AGENT' ? 'Agent owes you' : 'You owe agent'
  const remaining = remainingAfterSettlement(pending, derivedDirection, direction, amount)
  const remainingLabel = Math.abs(remaining) < 0.005 ? 'Settled' : remaining > 0 ? 'You still owe agent' : 'Agent still owes you'
  const username = agent.agent?.username || agent.username || 'Agent'
  return <Dialog open={visible} onOpenChange={open => { if (!open && !loading) cancel() }} title={step === 1 ? `Settle with: ${username}` : 'Confirm Settlement'} size="lg" dismissible={!loading}
    footer={<div className={styles.actions}>{step === 1 ? <><Button onClick={cancel}>Cancel</Button><Button variant="primary" onClick={() => { if (validate()) { setReview({ ...values }); setStep(2) } }}>Review Details</Button></> : <><Button disabled={loading} onClick={() => { setReview(null); setStep(1) }}>Go Back</Button><Button variant={collecting ? 'dangerSolid' : 'primary'} loading={loading} onClick={() => void submit()}>Confirm Settlement</Button></>}</div>}>
    <div className={styles.stack}>
      {step === 1 ? <>
        <div className={styles.head}><StatusPill tone="info">{agent.agent?.schemeType || agent.schemeType || 'N/A'}</StatusPill>{onRefresh && <Button size="sm" loading={refreshing} onClick={() => void refresh().catch(() => undefined)}>Refresh amount</Button>}</div>
        {Boolean(agent.settlementBreakdownByDomain?.length) && <section className={styles.stack}><h3 className={styles.title}>Breakdown by domain (players' P/L · % of total · agent share · platform cut)</h3><div className={styles.breakdown}>{agent.settlementBreakdownByDomain?.map(item => {
          const playersPl = Number(item.amount || 0)
          const share = item.agentShare != null ? Number(item.agentShare) : null
          return <div key={item.domain} className={styles.domain}><span>{item.domain[0].toUpperCase() + item.domain.slice(1)}</span><strong>{playersPl >= 0 ? '+' : '-'}{formatCurrency(Math.abs(playersPl))}</strong><span className={styles.note}>Players' P/L · {item.percentage}% of total</span>{share != null && <span className={share > 0 ? styles.positive : share < 0 ? styles.negative : styles.note}>Agent share {share >= 0 ? '+' : '-'}{formatCurrency(Math.abs(share))}</span>}<span className={styles.note}>Platform cut {formatCurrency(Number(item.cutAmount ?? 0))} ({Number(item.cutPercentage ?? 0)}%)</span></div>
        })}</div></section>}
        <Notice title="Pending balance"><strong className={derivedDirection === 'FROM_AGENT' ? styles.positive : styles.negative}>{formatCurrency(Math.abs(pending))}</strong><span className={styles.note}>{owedLabel}</span><span className={styles.note}>Direction is auto-calculated from this balance. You may settle a partial amount below.</span></Notice>
        <div className={styles.stack}><NumberField label="Settlement Amount" min={.01} step={100} grouping="en-US" prefix={getCurrencySymbol()} value={values.amount} onChange={amount => setValues(previous => ({ ...previous, amount }))} disabled={loading} error={errors.amount} /><Button variant="link" onClick={() => setValues(previous => ({ ...previous, amount: Math.abs(pending) }))}>Full Amount</Button></div>
        <Notice title="Direction">{collecting ? 'Collect FROM Agent (Agent pays you)' : 'Pay TO Agent (You pay agent)'}<span className={styles.note}>{owedLabel} — derived from P/L; not editable for sharing agents.</span></Notice>
        <Textarea label="Notes" required rows={3} placeholder="Enter settlement reason/notes (required for audit trail)" maxLength={500} showCount value={values.notes} onChange={notes => setValues(previous => ({ ...previous, notes }))} error={errors.notes} disabled={loading} />
      </> : <>
        <Notice tone="warn" title="This action CANNOT be undone">You are about to: <strong>{collecting ? 'COLLECT' : 'PAY'} {formatCurrency(amount)} {collecting ? 'FROM' : 'TO'} {agent.agent?.username || 'Agent'}</strong></Notice>
        <DescriptionList items={[{ term: 'Before Settlement', value: `${formatCurrency(Math.abs(pending))} (${owedLabel})` }, { term: 'After Settlement', value: `${formatCurrency(Math.abs(remaining))} (${remainingLabel})` }, { term: 'Notes', value: displayed.notes }]} />
      </>}
    </div>
  </Dialog>
}

