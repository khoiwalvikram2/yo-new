import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { IconCoins, IconCrown, IconUserCheck, IconUsers } from '@tabler/icons-react'
import { useVIPTiers, useVIPStats, useVIPNearNext, useVIPValidate } from '@/modules/vip'
import type { VIPTier } from '@/modules/vip/types'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useTableExport } from '@/shared/hooks/useTableExport'
import type { TableExportColumn } from '@/shared/utils/tableExport'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import { strokeFor } from '@/ui/components/icons'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { StatusPill } from '@/ui/components/StatusPill'
import { Notice } from '@/ui/components/Notice'
import { EmptyState } from '@/ui/components/EmptyState'
import { useVipTierActions } from './useVipTierActions'
import { tierStatusChange } from './vipTierActionsModel'
import styles from './TiersPage.module.css'

// GraphQL String serializes a Date as a millisecond timestamp. Also accept
// ISO dates so both API representations render/export in the tenant timezone.
function tierCreatedDate(value?: string): Date | null {
  if (!value) return null
  const date = new Date(/^-?\d{13}$/.test(value) ? Number(value) : value)
  return Number.isFinite(date.getTime()) ? date : null
}

export default function VIPTiersPage() {
  return <RBACGuard required={[{ domain: 'vip.tiers', actions: ['view'] }]}><VIPTiersPageContent /></RBACGuard>
}

function VIPTiersPageContent() {
  const eyebrow = usePageEyebrow()
  const { data: tiersData, loading, error, refetch } = useVIPTiers()
  const { data: statsData } = useVIPStats()
  // Preserve the existing near-next query scope. Its legacy view is a placeholder.
  useVIPNearNext(0.2, 8)
  const { data: validateData, refetch: refetchValidate, loading: validating } = useVIPValidate()
  // A status change or delete reshapes the ladder, so the Validation card is read again.
  const tierActions = useVipTierActions({ onChanged: () => { void refetchValidate() } })
  const { formatAmount, convertFromWhitelabelCurrency, getWhitelabelBaseCurrencyCode } = useCurrency()
  const { formatDate, formatTime } = useFormatDate()
  const tiers = useMemo(() => [...(tiersData?.vipTiers || [])].sort((a, b) => a.level - b.level), [tiersData?.vipTiers])
  const active = tiers.filter((tier) => tier.status === 'active').length
  const stats = statsData?.vipStats
  const exportColumns = useMemo<TableExportColumn<VIPTier>[]>(() => [
    { header: 'Name', key: 'name', width: 20, getter: (tier) => tier.name ?? '' },
    { header: 'Level', key: 'level', width: 8, getter: (tier) => tier.level ?? 0 },
    { header: 'Min Monthly Deposit', key: 'minMonthlyDeposit', width: 18, getter: (tier) => tier.minMonthlyDeposit ?? null },
    { header: 'Benefits Count', key: 'benefitsCount', width: 14, getter: (tier) => tier.benefits?.length ?? 0 },
    { header: 'Perks Count', key: 'perksCount', width: 12, getter: (tier) => tier.perks?.length ?? 0 },
    { header: 'Status', key: 'status', width: 10, getter: (tier) => tier.status ?? '' },
    { header: 'Created', key: 'createdAt', width: 20, getter: (tier) => {
      const created = tierCreatedDate(tier.createdAt)
      return created ? formatDate(created) : ''
    } },
  ], [formatDate])
  const { exporting, handleExport } = useTableExport({ data: tiers, columns: exportColumns,
    filename: 'VIP-Tiers', sheetName: 'VIP Tiers', title: `VIP Tiers — ${tiers.length} tier(s)` })
  const columns: DataTableColumn<VIPTier>[] = [
    { key: 'tier', header: 'Tier Details', cell: (tier) => <div className={styles.identity}>
      <span className={styles.swatch} style={{ backgroundColor: tier.color }} aria-hidden="true" />
      <div><div className={styles.name}><Link to={`/vip/tiers/${tier.id}`} className={styles.nameLink}>{tier.name}</Link></div><div className={styles.secondary}>Benefits: {tier.benefits.length}</div>
        <div className={styles.secondary}>Perks: {tier.perks.length}</div></div></div> },
    { key: 'level', header: 'Level', cell: (tier) => <StatusPill>Level {tier.level}</StatusPill> },
    { key: 'deposit', header: 'Min Monthly Deposit', align: 'right',
      cell: (tier) => formatAmount(convertFromWhitelabelCurrency(tier.minMonthlyDeposit), getWhitelabelBaseCurrencyCode()) },
    { key: 'members', header: 'Members', align: 'right', cell: (tier) => {
      const distribution = stats?.tierDistribution.find((item) => item.tierId === tier.id)
      return <div><strong>{distribution?.memberCount || 0}</strong>{distribution ? <div className={styles.secondary}>{distribution.percentage.toFixed(1)}%</div> : null}</div>
    } },
    { key: 'status', header: 'Status', cell: (tier) => <StatusPill tone={tier.status === 'active' ? 'ok' : 'muted'}>{tier.status === 'active' ? 'Active' : 'Inactive'}</StatusPill> },
    { key: 'created', header: 'Created', cell: (tier) => {
      const created = tierCreatedDate(tier.createdAt)
      return created ? <div>{formatDate(created, 'MMM d, yyyy')}<div className={styles.secondary}>{formatTime(created, 'HH:mm')}</div></div> : '—'
    } },
    { key: 'actions', header: 'Actions', align: 'right', sticky: 'end', cell: (tier) => {
      const change = tierStatusChange(tier)
      return <div className={styles.rowActions}>
        <Link to={`/vip/tiers/${tier.id}/edit`} className={buttonClassName({ size: 'sm' })} aria-label={`Edit ${tier.name}`}>Edit</Link>
        {tierActions.canChangeStatus ? <Button size="sm" aria-label={`${change.label} ${tier.name}`}
          onClick={() => tierActions.requestStatusChange(tier)}>{change.label}</Button> : null}
        {tierActions.canDelete ? <Button size="sm" variant="danger" aria-label={`Delete ${tier.name}`}
          onClick={() => tierActions.requestDelete(tier)}>Delete</Button> : null}
      </div>
    } },
  ]
  const issues: { code: string; message: string }[] = validateData?.vipTierValidate || []
  return <Page maxWidth="wide">
    <PageHeader title="VIP Tiers Management" eyebrow={eyebrow} sub="Configure VIP tiers, benefits, and perks for your loyalty program"
      actions={<Link to="/vip/tiers/create" className={buttonClassName({ variant: 'primary' })}>Add Tier</Link>} />
    <div className={styles.workspace}>
      <div className={styles.stats}>
        <Stat label="Active Tiers" value={active} icon={<IconCrown size={18} stroke={strokeFor(18)} />} hue="amb" />
        <Stat label="Total Members" value={stats?.totalMembers?.toLocaleString() ?? '—'} icon={<IconUsers size={18} stroke={strokeFor(18)} />} hue="blu" />
        <Stat label="Active Members" value={stats?.activeMembers?.toLocaleString() ?? '—'} icon={<IconUserCheck size={18} stroke={strokeFor(18)} />} hue="grn" />
        <Stat label="Points Awarded" value={stats?.totalPointsAwarded?.toLocaleString() ?? '—'} icon={<IconCoins size={18} stroke={strokeFor(18)} />} hue="vio" />
      </div>
      {!tiers.length && !loading ? <Notice tone="info" title="No VIP Tiers Configured"
        action={<Link to="/vip/tiers/create" className={buttonClassName({ variant: 'primary', size: 'sm' })}>Create Tier</Link>}>
        Create your first VIP tier to start the loyalty program. VIP tiers define different levels of benefits and perks for your players.
      </Notice> : null}
      {error && tiers.length ? <Notice tone="error">{error.message}</Notice> : null}
      <Card title="VIP Tiers List" sub={`${active} of ${tiers.length} ${tiers.length === 1 ? 'tier' : 'tiers'} active`} body="table"
        tools={<Button loading={exporting} aria-disabled={!tiers.length || loading} onClick={handleExport}>Export Excel</Button>}>
        <DataTable columns={columns} rows={tiers} rowKey={(tier) => tier.id} label="VIP Tiers"
          state={loading ? 'loading' : error && !tiers.length ? 'error' : 'ready'} error={error?.message}
          onRetry={() => void refetch()} empty={<EmptyState title="No VIP tiers configured" />} pagination={false} width="wide" />
      </Card>
      <Card title="Validation" tools={<Button loading={validating} onClick={() => { void refetchValidate() }}>Re-run</Button>}>
        {issues.length ? <ul className={styles.issues}>{issues.map((issue, index) => <li key={index}><strong>[{issue.code}]</strong> {issue.message}</li>)}</ul> :
          <Notice tone="ok">All good. No validation issues.</Notice>}
      </Card>
    </div>
  </Page>
}
