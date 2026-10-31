import { useState, useEffect } from 'react'
import clsx from 'clsx'
import { useQuery } from '@apollo/client'
import { IconCalendarEvent, IconChartLine, IconPercentage, IconScale } from '@tabler/icons-react'
import { SETTLEMENT_SUMMARY_QUERY, AGENT_LEDGERS_QUERY, AGENT_SETTLEMENTS_QUERY } from '@/lib/graphql/agents'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useBreakpoint } from '@/shared/hooks/useBreakpoint'
import { AccountListMetric } from '@/modules/account-lists/AccountList'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { StatusPill } from '@/ui/components/StatusPill'
import { DateField } from '@/ui/components/DateField'
import { Notice } from '@/ui/components/Notice'
import { EmptyState } from '@/ui/components/EmptyState'
import { useAuthStore } from '@/shared/core/authStore'
import { agentDirectionLabel, hasPendingAmount, settlementDirectionOf, settlerDirectionLabel } from '@/routes/settlement/settlementModel'
import styles from './AgentProfileComponents.module.css'

interface SharingTabProps {
  agentId: string
  agent: { sharingRates?: Array<{ domain: string; rate?: number }> }
}

const domainName = (domain?: string) => domain ? domain[0].toUpperCase() + domain.slice(1) : '—'

export function SharingTab({ agentId, agent }: SharingTabProps) {
  const navigate = useNavigate()
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  // On a phone the tables keep their key columns only.
  const { isMobile } = useBreakpoint()
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(30, 'days'),
    dayjs(),
  ])

  const periodFrom = dateRange[0].format('YYYY-MM-DD')
  const periodTo = dateRange[1].format('YYYY-MM-DD')

  const { data: settlementData, loading: settlementLoading, error: settlementError, refetch: refetchSettlement } = useQuery(
    SETTLEMENT_SUMMARY_QUERY,
    {
      variables: { agentId, periodFrom, periodTo },
      fetchPolicy: 'cache-and-network',
      errorPolicy: 'all',
    }
  )

  const { data: ledgerData, loading: ledgerLoading, error: ledgerError, refetch: refetchLedger } = useQuery(
    AGENT_LEDGERS_QUERY,
    {
      variables: { agentId, periodFrom, periodTo },
      fetchPolicy: 'cache-and-network',
      errorPolicy: 'all',
    }
  )

  const { data: settlementsData, loading: settlementsLoading, error: settlementsError, refetch: refetchSettlements } = useQuery(
    AGENT_SETTLEMENTS_QUERY,
    {
      variables: { agentId, periodFrom, periodTo },
      fetchPolicy: 'cache-and-network',
      errorPolicy: 'all',
    }
  )

  const settlement = settlementData?.agents?.settlementSummary
  // Until the first answer for a range the summary cards hold their height with placeholders.
  const settlementPending = settlementLoading && !settlement
  // settlementDue is signed: positive = TO_AGENT (the agent is paid its share), negative = FROM_AGENT. Shown as
  // its size plus who pays: the agent on its own profile sees its side, admins and the parent the settler's.
  const loggedInAgent = useAuthStore((state) => state.agent)
  const settlementDue = Number(settlement?.settlementDue) || 0
  const dueDirection = settlementDirectionOf(settlement?.settlementDirection, settlementDue)
  const hasDue = hasPendingAmount(settlementDue)
  const dueLabel = !hasDue ? 'Settled' : loggedInAgent && loggedInAgent.id === agentId ? agentDirectionLabel(dueDirection) : settlerDirectionLabel(dueDirection)
  const ledgerEntries = ledgerData?.agents?.agentLedgers || []
  const settlements = settlementsData?.agents?.agentSettlements || []

  // Refetch queries when date range changes
  useEffect(() => {
    refetchSettlement()
    refetchLedger()
    refetchSettlements()
  }, [periodFrom, periodTo, refetchSettlement, refetchLedger, refetchSettlements])

  const fmt = (amount: number) => formatAmount(convertFromWhitelabelCurrency(Number(amount || 0)))
  // A figure that can go below zero keeps its minus in front of the currency (-₹100.00).
  const net = (amount: number) => `${amount < 0 ? '-' : ''}${fmt(Math.abs(amount))}`

  type LedgerRow = { id?: string; createdAt?: string; domain?: string; lineType?: string; periodFrom?: string; periodTo?: string; amount?: number; currency?: string }
  type SettlementRow = { id?: string; periodFrom?: string; periodTo?: string; totalAmount?: number; currency?: string; status?: string; postedAt?: string }
  const periodText = (from?: string, to?: string, format = 'MMM DD') => `${from ? dayjs(from).format(format) : '—'} - ${to ? dayjs(to).format(format) : '—'}`
  const ledgerColumns: DataTableColumn<LedgerRow>[] = [
    { key: 'date', header: 'Date', cell: row => <div className={styles.rowDetails}><span>{row.createdAt ? dayjs(row.createdAt).format('MMM DD, YYYY HH:mm') : '—'}</span>{isMobile && <span className={styles.muted}>{row.lineType} · {periodText(row.periodFrom, row.periodTo)}</span>}</div> },
    { key: 'domain', header: 'Domain', cell: row => <StatusPill>{domainName(row.domain)}</StatusPill> },
    { key: 'type', header: 'Type', hidden: isMobile, cell: row => <StatusPill tone={row.lineType === 'SHARE' ? 'info' : row.lineType === 'SETTLEMENT' ? 'ok' : 'neutral'}>{row.lineType}</StatusPill> },
    { key: 'period', header: 'Period', hidden: isMobile, cell: row => periodText(row.periodFrom, row.periodTo) },
    { key: 'amount', header: 'Amount', align: 'right', cell: row => { const amount = Number(row.amount || 0); return <strong className={amount >= 0 ? styles.positive : styles.negative}>{amount >= 0 ? '+' : '-'}{fmt(Math.abs(amount))} {row.currency || ''}</strong> } },
  ]
  const settlementColumns: DataTableColumn<SettlementRow>[] = [
    { key: 'period', header: 'Period', cell: row => <div className={styles.rowDetails}><span>{row.periodFrom ? dayjs(row.periodFrom).format('MMM DD, YYYY') : '—'}</span><span className={styles.muted}>to {row.periodTo ? dayjs(row.periodTo).format('MMM DD, YYYY') : '—'}</span></div> },
    { key: 'amount', header: 'Amount', align: 'right', cell: row => <strong className={styles.positive}>{fmt(row.totalAmount || 0)} {row.currency || ''}</strong> },
    { key: 'status', header: 'Status', cell: row => <StatusPill tone={row.status === 'POSTED' ? 'ok' : 'warn'}>{row.status}</StatusPill> },
    { key: 'posted', header: 'Posted At', hidden: isMobile, cell: row => row.postedAt ? dayjs(row.postedAt).format('MMM DD, YYYY HH:mm') : '—' },
  ]
  const reload = () => { void refetchSettlement(); void refetchLedger(); void refetchSettlements() }
  const setDate = (from: string, to: string) => { setDateRange(from && to ? [dayjs(from), dayjs(to)] : [dayjs().subtract(30, 'days'), dayjs()]) }
  const rangeText = dateRange[0].isSame(dateRange[1], 'day') ? dateRange[0].format('DD MMM YYYY') : `${dateRange[0].format('DD MMM')} – ${dateRange[1].format('DD MMM YYYY')}`
  const netPL = Number(settlement?.netPL || 0)
  // 2026-10-29 layout: the period and its four figures, the rates, then the ledger lines and the settlements.
  return <div className={clsx(styles.stack, styles.tabPanel)}>
    <Card title="Settlement Summary" sub={`${rangeText} · net P/L and settlement due`} tools={<div className={styles.actions}>{hasDue && <Button variant="primary" size="sm" onClick={() => navigate('/settlement')}>Initiate Settlement</Button>}<Button size="sm" onClick={reload}>Refresh</Button></div>}>
      <div className={styles.stack}>
        <div className={styles.period}><DateField label="Sharing From" size="sm" value={periodFrom} onChange={from => setDate(from, periodTo)} /><DateField label="Sharing To" size="sm" value={periodTo} onChange={to => setDate(periodFrom, to)} /></div>
        {settlementError && !settlementPending ? <Notice tone="error" action={<Button onClick={reload}>Retry</Button>}>{settlementError.message || 'Failed to load settlement data'}</Notice> : settlement || settlementPending ? <div className={styles.tabKpis} role="group" aria-label="Sharing figures" aria-busy={settlementPending || undefined}>
          <AccountListMetric label="Net P/L" value={net(netPL)} note={netPL >= 0 ? 'Profit' : 'Loss'} icon={<IconChartLine size={18} />} hue="blu" loading={settlementPending} />
          <AccountListMetric label="Share Percentage" value={`${settlement?.sharePercentage || 0}%`} note="This agent's share" icon={<IconPercentage size={18} />} hue="vio" loading={settlementPending} />
          <AccountListMetric label="Settlement Due" value={fmt(Math.abs(settlementDue))} note={dueLabel} icon={<IconScale size={18} />} hue="grn" loading={settlementPending} />
          <AccountListMetric label="Last Settlement" value={settlement?.lastSettlementDate ? dayjs(settlement.lastSettlementDate).format('MMM DD, YYYY') : '—'} note={settlement?.lastSettlementAmount ? `${fmt(settlement.lastSettlementAmount)} ${settlement.currency || ''}` : 'None yet'} icon={<IconCalendarEvent size={18} />} hue="amb" loading={settlementPending} />
        </div> : <EmptyState title="No settlement data available" />}
      </div>
    </Card>
    <Card title="Sharing Rates by Domain" sub="Percentage share per product" body={agent.sharingRates?.length ? 'flush' : undefined}>
      {agent.sharingRates?.length ? <div className={styles.rateTiles}>{agent.sharingRates.map(rate => <div key={rate.domain} className={styles.figureCell}>
        <span className={styles.stripLabel}>{domainName(rate.domain)}</span>
        <strong className={styles.figureValue}>{typeof rate.rate === 'number' ? `${rate.rate.toFixed(2)}%` : '—'}</strong>
      </div>)}</div> : <EmptyState title="No sharing rates configured" />}
    </Card>
    <Card title="Recent Ledger Entries" sub="Share and settlement lines in this period" body="table" tools={<Button size="sm" onClick={() => void refetchLedger()}>Refresh</Button>}>
      <DataTable label="Sharing ledger entries" columns={ledgerColumns} rows={ledgerEntries} rowKey={row => String(row.id)} state={ledgerLoading ? 'loading' : ledgerError ? 'error' : 'ready'} error={ledgerError?.message || 'Failed to load ledger'} onRetry={() => void refetchLedger()} empty={<EmptyState title="No ledger entries" />} pagination="client"
        density={isMobile ? 'compact' : undefined} width={isMobile ? 'fill' : undefined} />
    </Card>
    <Card title="Posted Settlements" sub="Sharing settlements in this period" body="table" tools={<Button size="sm" onClick={() => void refetchSettlements()}>Refresh</Button>}>
      <DataTable label="Sharing settlement history" columns={settlementColumns} rows={settlements} rowKey={row => String(row.id)} state={settlementsLoading ? 'loading' : settlementsError ? 'error' : 'ready'} error={settlementsError?.message || 'Failed to load settlements'} onRetry={() => void refetchSettlements()} empty={<EmptyState title="No settlement history" />} pagination="client"
        density={isMobile ? 'compact' : undefined} width={isMobile ? 'fill' : undefined} />
    </Card>
  </div>
}
