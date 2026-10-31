import { useState, useCallback } from 'react'
import clsx from 'clsx'
import { useQuery, useMutation, useSubscription } from '@apollo/client'
import { Link } from 'react-router-dom'
import { IconArrowUpRight, IconCreditCard, IconUsers, IconWallet } from '@tabler/icons-react'
import { CREDIT_ALLOCATION, AGENT_CREDIT_ALERTS_QUERY, AGENT_PLAYER_CREDITS, SET_AGENT_CREDIT_ALERT_THRESHOLD, RESOLVE_AGENT_CREDIT_ALERT, AGENT_CREDIT_TRANSACTIONS_QUERY, AGENT_CREDIT_UPDATED_SUBSCRIPTION } from '@/lib/graphql/agentCredit'
import { notify } from '@/shared/services/notification'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useBreakpoint } from '@/shared/hooks/useBreakpoint'
import { AccountListMetric } from '@/modules/account-lists/AccountList'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Notice } from '@/ui/components/Notice'
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable'
import { Dialog } from '@/ui/components/Dialog'
import { NumberField } from '@/ui/components/NumberField'
import { Meter } from '@/ui/components/Meter'
import { Skeleton } from '@/ui/components/Skeleton'
import { EmptyState } from '@/ui/components/EmptyState'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from './AgentProfileComponents.module.css'

interface CreditTabProps {
  agentId: string
  agent: { id: string; schemeType?: string } | null
}

export function CreditTab({ agentId }: CreditTabProps) {
  const [thresholdModalVisible, setThresholdModalVisible] = useState(false)
  const [reconciliationModalVisible, setReconciliationModalVisible] = useState(false)
  const [transactionsPage, setTransactionsPage] = useState(1)
  const [transactionsPageSize, setTransactionsPageSize] = useState(20)
  const [thresholdValue, setThresholdValue] = useState<number | null>(null)
  const [thresholdError, setThresholdError] = useState<string>()
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set())
  const [transactionSort, setTransactionSort] = useState<DataTableSort | null>({ key: 'date', dir: 'desc' })
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatDateTime } = useFormatDate()
  // On a phone each table keeps its key columns only.
  const { isMobile } = useBreakpoint()

  const { data: creditData, loading: creditLoading, error: creditError, refetch: refetchCredit } = useQuery(CREDIT_ALLOCATION, {
    variables: { agentId },
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  const { data: alertsData, refetch: refetchAlerts } = useQuery(AGENT_CREDIT_ALERTS_QUERY, {
    variables: { agentId, isActive: true },
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  const { data: playersData, loading: playersLoading, error: playersError, refetch: refetchPlayers } = useQuery(AGENT_PLAYER_CREDITS, {
    variables: { agentId },
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  const { data: transactionsData, loading: transactionsLoading, error: transactionsError, refetch: refetchTransactions } = useQuery(AGENT_CREDIT_TRANSACTIONS_QUERY, {
    variables: {
      agentId,
      limit: transactionsPageSize,
      offset: (transactionsPage - 1) * transactionsPageSize,
    },
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  // Subscribe to real-time credit updates
  useSubscription(AGENT_CREDIT_UPDATED_SUBSCRIPTION, {
    variables: { agentId },
    skip: !agentId,
    onData: useCallback((opts: { data?: { data?: { agentCreditUpdated?: unknown } } }) => {
      if (opts?.data?.data?.agentCreditUpdated) {
        refetchCredit().catch(() => { /* best-effort */ })
        refetchPlayers().catch(() => { /* best-effort */ })
      }
    }, [refetchCredit, refetchPlayers]),
    onError: useCallback(() => { /* non-critical */ }, []),
  })

  const [setThreshold, { loading: updatingThreshold }] = useMutation(SET_AGENT_CREDIT_ALERT_THRESHOLD, {
    onCompleted: (result) => {
      if (!result.agents?.setAgentCreditAlertThreshold) { notify.error('Failed to update credit alert threshold', 'Update Failed'); return }
      notify.success('Credit alert threshold has been updated', 'Threshold Updated')
      refetchCredit()
      setThresholdModalVisible(false)
      setThresholdValue(null); setThresholdError(undefined)
    },
    onError: (err) => {
      notify.error(err.message, 'Update Failed')
    },
  })

  const [resolveAlert] = useMutation(RESOLVE_AGENT_CREDIT_ALERT, {
    onCompleted: (result) => {
      if (!result.agents?.resolveAgentCreditAlert) { notify.error('Failed to resolve credit alert', 'Failed'); return }
      notify.success('Credit alert has been resolved', 'Alert Resolved')
      refetchAlerts()
    },
    onError: (err) => {
      notify.error(err.message, 'Failed')
    },
  })

  const credit = creditData?.agents?.creditAllocation
  // Until the first answer the summary keeps its layout with placeholders.
  const creditPending = creditLoading && !credit
  const playersPending = playersLoading && !playersData
  const alerts = alertsData?.agents?.agentCreditAlerts || []
  const players = playersData?.agents?.agentPlayerCredits || []
  const transactions = transactionsData?.agents?.agentCreditTransactions || []

  const usagePercentage = credit?.usagePercentage || 0
  const threshold = credit?.creditAlertThreshold || 80
  const fmt = (amount: number) => formatAmount(convertFromWhitelabelCurrency(Number(amount || 0)))

  const permissions = useAuthStore(s => s.permissions)
  const agentLogin = useAuthStore(s => s.agent)
  const canViewPlayerCredit = !!agentLogin || hasPermissionWithNested(permissions, 'players.credit', 'view')
  const playerCreditMask = '••••'
  const fmtPlayerCredit = (amount: number) => canViewPlayerCredit ? fmt(amount) : playerCreditMask

  type PlayerCredit = { playerId: string; playerName?: string; creditLimit?: number; currentBalance?: number; openExposure?: number; creditUsed?: number; creditAvailable?: number }
  type CreditTransaction = { id: string; createdAt?: string; transactionType?: string; amount?: number; balanceBefore?: number; balanceAfter?: number; reason?: string; toEntityType?: string; toEntityId?: string }
  const givenToPlayers = players.reduce((sum: number, player: PlayerCredit) => sum + Number(player.creditLimit || 0), 0)
  // The limit and what is left first; a phone drops the limit, the balance and the exposure.
  const playerColumns: DataTableColumn<PlayerCredit>[] = [
    { key: 'player', header: 'Player', cell: row => row.playerId ? <Link className={styles.link} to={`/players/profile/${row.playerId}`}><strong>{row.playerName || `Player ${row.playerId}`}</strong></Link> : '—' },
    { key: 'creditLimit', header: 'Credit Limit', align: 'right', hidden: isMobile, cell: row => fmtPlayerCredit(row.creditLimit || 0) },
    { key: 'creditUsed', header: 'Credit Used', align: 'right', cell: row => fmtPlayerCredit(row.creditUsed || 0) },
    { key: 'creditAvailable', header: 'Available', align: 'right', cell: row => fmtPlayerCredit(row.creditAvailable || 0) },
    { key: 'currentBalance', header: 'Current Balance', align: 'right', hidden: isMobile, cell: row => fmtPlayerCredit(row.currentBalance || 0) },
    { key: 'openExposure', header: 'Open Exposure', align: 'right', hidden: isMobile, cell: row => fmtPlayerCredit(row.openExposure || 0) },
  ]
  const transactionColumns: DataTableColumn<CreditTransaction>[] = [
    { key: 'date', header: 'Date', cell: row => row.createdAt ? formatDateTime(row.createdAt, 'yyyy-MM-dd HH:mm:ss') : '—', sort: (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime() },
    { key: 'type', header: 'Type', cell: row => <StatusPill tone="info">{(row.transactionType || '').replace(/_/g, ' ')}</StatusPill> },
    { key: 'amount', header: 'Amount', align: 'right', cell: row => <strong>{fmt(row.amount || 0)}</strong> },
    { key: 'balance', header: 'Balance', hidden: isMobile, cell: row => <span><span className={styles.muted}>{fmt(row.balanceBefore || 0)} → </span>{fmt(row.balanceAfter || 0)}</span> },
    { key: 'reason', header: 'Reason', hidden: isMobile, cell: row => row.reason || '-' },
    { key: 'entity', header: 'Related Entity', hidden: isMobile, cell: row => row.toEntityType === 'player' ? `Player ${row.toEntityId}` : row.toEntityType === 'agent' && row.toEntityId !== agentId ? `Agent ${(row.toEntityId || '').slice(0, 8)}...` : '-' },
  ]
  const handleSetThreshold = async () => {
    if (thresholdValue == null) { setThresholdError('Please enter a threshold'); return }
    if (thresholdValue < 0 || thresholdValue > 100) { setThresholdError('Threshold must be between 0 and 100'); return }
    setThresholdError(undefined)
    await setThreshold({ variables: { agentId, threshold: Number(thresholdValue) } }).catch(() => undefined)
  }
  const transactionTotal = transactionsData?.agents?.agentCreditTransactionsCount ?? 0
  const reload = () => { void refetchCredit(); void refetchAlerts(); void refetchPlayers() }
  const visibleAlerts = alerts.filter((alert: { id: string }) => !dismissedAlerts.has(alert.id))
  const alertTitle = (type?: string) => { const text = (type || 'Credit alert').replace(/_/g, ' ').toLowerCase(); return text[0].toUpperCase() + text.slice(1) }
  // 2026-10-29 layout: the credit figures, the usage against its alert threshold and any alert in one card,
  // then the players' allocations and the movements.
  return <div className={clsx(styles.stack, styles.tabPanel)}>
    <Card title="Credit Allocation Summary" sub="Limit, used and available, with the players on credit" aria-busy={creditPending || undefined} tools={<div className={styles.actions}><Button size="sm" onClick={() => setReconciliationModalVisible(true)}>Credit Reconciliation</Button><Button size="sm" onClick={reload}>Refresh</Button></div>}>
      <div className={styles.stack}>
        {creditError && !creditPending ? <Notice tone="error" action={<Button onClick={() => void refetchCredit()}>Retry</Button>}>{creditError.message || 'Failed to load credit data'}</Notice> : credit || creditPending ? <>
          <div className={styles.tabKpis} role="group" aria-label="Credit figures">
            <AccountListMetric label="Credit Limit" value={fmt(credit?.creditLimit || 0)} note="Given to this agent" icon={<IconCreditCard size={18} />} hue="blu" loading={creditPending} />
            <AccountListMetric label="Credit Used" value={fmt(credit?.creditUsed || 0)} note={`${usagePercentage.toFixed(1)}% of the limit`} icon={<IconArrowUpRight size={18} />} hue="amb" loading={creditPending} />
            <AccountListMetric label="Credit Available" value={fmt(credit?.creditAvailable || 0)} note="Left to allocate" icon={<IconWallet size={18} />} hue="grn" loading={creditPending} />
            <AccountListMetric label="Players on Credit" value={players.length} note={`Given ${fmtPlayerCredit(givenToPlayers)}`} icon={<IconUsers size={18} />} hue="vio" loading={playersPending} />
          </div>
          <div className={styles.usage}>
            <div className={styles.usageHead}>
              <h3 className={styles.sectionTitle}>Credit Usage</h3>
              <div className={styles.actions}><span className={styles.muted}>{creditPending ? <Skeleton width={120} height={10} /> : `${usagePercentage.toFixed(1)}% used · alert at ${threshold}%`}</span><Button size="sm" onClick={() => { setThresholdValue(threshold); setThresholdError(undefined); setThresholdModalVisible(true) }}>Set Alert Threshold</Button></div>
            </div>
            {creditPending ? <Skeleton height={6} radius="pill" /> : <Meter label="Credit usage" value={usagePercentage} tone={credit.isOverLimit || usagePercentage >= 100 ? 'neg' : usagePercentage >= threshold ? 'warn' : 'acc'} />}
          </div>
          {credit?.isOverLimit && <Notice tone="error" title="Credit Limit Exceeded">The credit usage has exceeded the allocated limit. Please take immediate action.</Notice>}
          {credit?.isNearThreshold && !credit.isOverLimit && <Notice tone="warn" title="Approaching Credit Limit">Credit usage is at {usagePercentage.toFixed(1)}%, approaching the alert threshold of {threshold}%.</Notice>}
        </> : <EmptyState title="No credit data available" />}
        {visibleAlerts.map((alert: { id: string; alertType?: string; threshold?: number; currentValue?: number }) => <Notice key={alert.id} tone="warn" title={alertTitle(alert.alertType)} action={<div className={styles.actions}><Button size="sm" onClick={() => void resolveAlert({ variables: { alertId: alert.id } }).catch(() => undefined)}>Resolve</Button><Button size="sm" onClick={() => setDismissedAlerts(previous => new Set(previous).add(alert.id))}>Dismiss</Button></div>}>{alert.threshold && alert.currentValue ? `Current: ${fmt(alert.currentValue)} | Threshold: ${alert.threshold}%` : 'Active credit alert'}</Notice>)}
      </div>
    </Card>
    <Card title="Player Credit Allocations" sub={`${players.length} ${players.length === 1 ? 'player' : 'players'} on credit`} body="table" tools={<Button size="sm" onClick={() => void refetchPlayers()}>Refresh</Button>}>
      <DataTable label="Agent player credit allocations" columns={playerColumns} rows={players} rowKey={row => row.playerId} state={playersLoading ? 'loading' : playersError ? 'error' : 'ready'} error={playersError?.message || 'Failed to load players'} onRetry={() => void refetchPlayers()} empty={<EmptyState title="No players with credit allocations" />} pagination="client"
        density={isMobile ? 'compact' : undefined} width={isMobile ? 'fill' : undefined} />
    </Card>
    <Card title="Credit Transaction History" sub="Every credit movement, newest first" body="table" tools={<Button size="sm" onClick={() => void refetchTransactions()}>Refresh</Button>}>
      <DataTable label="Agent credit transactions" columns={transactionColumns} rows={transactions} rowKey={row => row.id} state={transactionsLoading ? 'loading' : transactionsError ? 'error' : 'ready'} error={transactionsError?.message || 'Failed to load transactions'} onRetry={() => void refetchTransactions()} empty={<EmptyState title="No credit transactions" />} sort={transactionSort} onSortChange={setTransactionSort}
        density={isMobile ? 'compact' : undefined} width={isMobile ? 'fill' : undefined}
        pagination={{ current: transactionsPage, pageSize: transactionsPageSize, total: transactionTotal, onChange: setTransactionsPage, onPageSizeChange: size => { setTransactionsPageSize(size); setTransactionsPage(1) }, pageSizeOptions: [10, 20, 50, 100], formatSummary: ({ start, end }) => `${start}-${end} of ${transactionTotal}` }} />
    </Card>
    <Dialog title="Set Credit Alert Threshold" open={thresholdModalVisible} onOpenChange={open => { if (!open && !updatingThreshold) { setThresholdModalVisible(false); setThresholdValue(null); setThresholdError(undefined) } }} dismissible={!updatingThreshold} size="sm" footer={<div className={styles.actions}><Button disabled={updatingThreshold} onClick={() => { setThresholdModalVisible(false); setThresholdValue(null); setThresholdError(undefined) }}>Cancel</Button><Button variant="primary" loading={updatingThreshold} onClick={() => void handleSetThreshold()}>Set Threshold</Button></div>}><NumberField label="Alert Threshold (%)" min={0} max={100} step={1} value={thresholdValue} onChange={setThresholdValue} suffix="%" error={thresholdError} /></Dialog>
    <Dialog title="Credit Reconciliation" open={reconciliationModalVisible} onOpenChange={setReconciliationModalVisible} size="lg"><Notice tone="info" title="Reconciliation Preview">Credit reconciliation features are available in the credit management section.</Notice></Dialog>
  </div>
}
