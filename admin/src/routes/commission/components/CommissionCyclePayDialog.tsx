import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, type PureQueryOptions } from '@apollo/client'
import { Link } from 'react-router-dom'
import { Dialog } from '@/ui/components/Dialog'
import { Button } from '@/ui/components/Button'
import { Select } from '@/ui/components/Select'
import { Textarea } from '@/ui/components/Textarea'
import { Notice } from '@/ui/components/Notice'
import { LoadingState } from '@/ui/components/LoadingState'
import { Stat } from '@/ui/components/Stat'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { notify } from '@/shared/services/notification'
import { COMMISSION_CYCLES_FOR_AGENT_QUERY, COMMISSION_CYCLE_READINESS_QUERY, PAY_COMMISSION_MUTATION } from '@/lib/graphql/settlements'
import { COMMISSION_SUMMARY_QUERY, COMMISSION_HISTORY_QUERY } from '@/lib/graphql/agents'
import {
  COMMISSION_DOMAINS,
  blockingReadinessReasons,
  commissionPayoutInput,
  commissionRateLabel,
  cyclePeriod,
  cycleRangeLabel,
  payableCommissionCycles,
  readinessReasonText,
  zeroCommissionCycleCount,
  type CommissionCycleRow,
  type CommissionReadinessInfo,
} from '../commissionOverviewModel'
import { reviewAdjustmentsHref } from '../commissionAdjustmentsModel'
import { CommissionCarryLines } from './CommissionCarryLines'
import styles from './CommissionCyclePayDialog.module.css'

const domainName = (domain: string) => domain[0].toUpperCase() + domain.slice(1)

type Summary = Record<string, unknown> & { tallyApplied?: { enabled?: boolean; domains?: string[] | null } | null }

export interface CommissionCyclePayDialogProps {
  open: boolean
  agentId: string | null | undefined
  username?: string | null
  onClose: () => void
  /** Called after a successful payout (the dialog has closed). */
  onPaid?: () => void
  /** Queries to refetch after a payout, as useMutation's refetchQueries. */
  refetchQueries?: PureQueryOptions[]
  /** Opens the bets of the selected cycle (the caller's View Bets dialog). */
  onViewBets?: (cycle: { from: string; to: string; periodFrom: string; periodTo: string }) => void
}

/**
 * Pay a commission agent for ONE closed, unpaid IST week. The picker lists the agent's CLOSED_UNSETTLED
 * cycles with their payable; the open week and all-time or custom ranges cannot be paid. The amount is the
 * readiness payable for the chosen cycle (the payee's gross after tally, adjustments and payouts) and the
 * payout carries that cycle's IST dates, exactly what payCommission checks.
 */
export function CommissionCyclePayDialog({ open, agentId, username, onClose, onPaid, refetchQueries, onViewBets }: CommissionCyclePayDialogProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(Number(value || 0)))
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [notes, setNotes] = useState('')

  const { data: cyclesData, loading: cyclesLoading, error: cyclesError } = useQuery<{ commissionCyclesForAgent?: CommissionCycleRow[] }>(COMMISSION_CYCLES_FOR_AGENT_QUERY, {
    variables: { agentId: agentId ?? '' }, skip: !open || !agentId, fetchPolicy: 'network-only',
  })
  const allCycles = cyclesData?.commissionCyclesForAgent
  const cycles = useMemo(() => payableCommissionCycles(allCycles), [allCycles])
  const zeroWeeks = zeroCommissionCycleCount(allCycles)
  const cycle = cycles.find((row) => row.from === selectedKey) ?? cycles[0]
  const period = cycle ? cyclePeriod(cycle) : null

  useEffect(() => { if (!open) { setSelectedKey(null); setNotes('') } }, [open])

  const detailSkipped = !open || !agentId || !period
  const { data: readinessData, loading: readinessLoading, error: readinessError } = useQuery<{ commissionCycleReadiness?: CommissionReadinessInfo }>(COMMISSION_CYCLE_READINESS_QUERY, {
    variables: { agentId: agentId ?? '', cycleFrom: period?.periodFrom ?? '', cycleTo: period?.periodTo ?? '' }, skip: detailSkipped, fetchPolicy: 'network-only',
  })
  const readiness = readinessLoading || readinessError ? undefined : readinessData?.commissionCycleReadiness
  const { data: summaryData } = useQuery<{ agents?: { commissionSummary?: Summary } }>(COMMISSION_SUMMARY_QUERY, {
    variables: { agentId: agentId ?? '', periodFrom: period?.periodFrom ?? '', periodTo: period?.periodTo ?? '' }, skip: detailSkipped, fetchPolicy: 'network-only',
  })
  const summary = summaryData?.agents?.commissionSummary
  const { data: historyData } = useQuery<{ agents?: { commissionHistory?: { total?: number } } }>(COMMISSION_HISTORY_QUERY, {
    variables: { agentId: agentId ?? '', periodFrom: period?.periodFrom ?? '', periodTo: period?.periodTo ?? '', limit: 1, offset: 0 }, skip: detailSkipped, fetchPolicy: 'network-only',
  })
  const betCount = historyData?.agents?.commissionHistory?.total ?? 0

  const [payCommission, { loading: paying }] = useMutation<{ payCommission?: { success: boolean; message?: string | null } }>(PAY_COMMISSION_MUTATION, {
    refetchQueries: refetchQueries ?? [], awaitRefetchQueries: true,
    onCompleted: (data) => {
      if (data.payCommission?.success) {
        notify.success(data.payCommission.message ?? 'Commission paid', 'Success')
        onClose()
        onPaid?.()
      } else notify.error(data.payCommission?.message ?? 'Payment failed', 'Error')
    },
    onError: (error) => notify.error(error.message ?? 'Payment error', 'Error'),
  })

  const close = () => { if (!paying) onClose() }
  const input = commissionPayoutInput(agentId ?? undefined, cycle, readiness, notes)
  const blocking = blockingReadinessReasons(readiness)
  // The payee's gross for the cycle (what is paid), per domain; older backends only had the caller-mode figures.
  const figure = (key: string) => Number(summary?.[key] ?? 0)
  const grossOf = (domain: string) => summary?.[`gross${domainName(domain)}Commission`] != null ? figure(`gross${domainName(domain)}Commission`) : figure(`${domain}Commission`)
  const effectiveOf = (domain: string) => summary?.[`grossEffective${domainName(domain)}Commission`] != null ? figure(`grossEffective${domainName(domain)}Commission`) : figure(`effective${domainName(domain)}Commission`)
  const effectiveTotal = summary?.grossEffectiveCalculatedTotal != null ? figure('grossEffectiveCalculatedTotal') : figure('effectiveCalculatedTotal')
  // Loss carry-forward: the backend total is after last week's carried loss; "after tally" is shown before it, then the carry line.
  const carryApplied = figure('carryApplied')

  return <Dialog open={open} onOpenChange={(next) => { if (!next) close() }} title={`Pay commission — ${username ?? 'Agent'}`} size="lg" dismissible={!paying}
    footer={<div className={styles.actions}>
      <Button onClick={close} aria-disabled={paying}>Cancel</Button>
      <Button variant="primary" loading={paying} disabled={!input}
        onClick={() => { if (input && !paying) void payCommission({ variables: { input } }).catch(() => undefined) }}>Pay this cycle</Button>
    </div>}>
    <div className={styles.stack}>
      {cyclesLoading && !allCycles ? <LoadingState label="Loading unpaid cycles" /> : cyclesError ? <Notice tone="error">{cyclesError.message}</Notice> :
        !cycle ? <Notice tone="info" title="Nothing to pay">
          Every closed week for this agent is paid{zeroWeeks > 0 ? `, or had no commission (${zeroWeeks} week${zeroWeeks === 1 ? '' : 's'} counted as settled)` : ''}. The current week can be paid once it closes (Monday 00:00 IST).
        </Notice> : <>
          <Select label="Unpaid cycle" layout="stacked" value={cycle.from} onChange={setSelectedKey}
            options={cycles.map((row) => ({ value: row.from, label: `${cycleRangeLabel(row)} · payable ${row.payableAmount != null ? money(Number(row.payableAmount)) : '—'}` }))} />
          <p className={styles.muted}>Closed weeks (Monday to Monday, IST) that are not paid yet, oldest first. The current week cannot be paid until it closes.{zeroWeeks > 0 ? ` Weeks with no commission count as settled (${zeroWeeks}).` : ''}</p>
          <section className={styles.domains} aria-label="Commission by domain">
            {COMMISSION_DOMAINS.map((domain) => <div key={domain} className={styles.domain}>
              <strong>{domainName(domain)}</strong>
              <span>GGR {money(figure(`${domain}GGR`))}</span>
              <span>Commission {money(grossOf(domain))} ({commissionRateLabel(figure(`${domain}CommissionRate`))})</span>
              <span className={styles.muted}>After tally {money(effectiveOf(domain))}</span>
            </div>)}
          </section>
          <div className={styles.row}>
            <span className={styles.muted}>{betCount} settled bet{betCount === 1 ? '' : 's'} in this cycle{summary?.tallyApplied?.enabled ? ` · Tally ON: ${(summary.tallyApplied.domains ?? []).map(domainName).join(', ')}` : ''}</span>
            {onViewBets && period && <Button size="sm" onClick={() => onViewBets({ from: cycle.from, to: cycle.to, periodFrom: period.periodFrom, periodTo: period.periodTo })}>View Bets</Button>}
          </div>
          {readinessLoading ? <LoadingState label="Checking payout readiness" height={49} /> : readinessError ? <Notice tone="error">{readinessError.message}</Notice> : null}
          {readiness && blocking.length > 0 && <Notice tone="warn" title="Cannot pay this cycle yet"
            action={agentId && readiness.reasons?.includes('UNRESOLVED_ADJUSTMENT')
              ? <Link className={styles.link} to={reviewAdjustmentsHref(agentId)} onClick={() => onClose()}>Review adjustments</Link>
              : undefined}>
            {blocking.map((text) => <span key={text} className={styles.reason}>{text}</span>)}</Notice>}
          {readiness?.reasons?.includes('ZERO_PAYABLE_NET') && <Notice tone="info" title="No payout due">{readinessReasonText('ZERO_PAYABLE_NET')}</Notice>}
          {readiness?.reasons?.includes('LEDGER_GAP') && <Notice tone="info" title="Ledger gap">{readinessReasonText('LEDGER_GAP')}</Notice>}
          <DescriptionList items={[
            { term: 'Commission after tally', value: money(effectiveTotal + carryApplied) },
            ...(cycle.adjustmentAmount ? [{ term: 'Adjustments', value: money(Number(cycle.adjustmentAmount)) }] : []),
            ...(cycle.paidAmount ? [{ term: 'Already paid', value: money(Number(cycle.paidAmount)) }] : []),
          ]} />
          <CommissionCarryLines figures={summary ? { carriedLoss: figure('carriedLoss'), carryApplied, lossThisCycle: figure('lossThisCycle') } : null} format={money} />
          <Stat label="Payable amount (fixed)" value={readiness ? money(Number(readiness.payableAmount ?? 0)) : '—'} note="The payout is exactly this amount, for this cycle only." hue="grn" />
          <Textarea label="Notes" rows={2} placeholder="Optional notes" value={notes} onChange={setNotes} disabled={paying} />
        </>}
    </div>
  </Dialog>
}
