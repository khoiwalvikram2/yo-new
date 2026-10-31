import { useState } from 'react'
import { useQuery, gql } from '@apollo/client'
import { useNavigate } from 'react-router-dom'
import { IconUsers, IconCurrencyDollar, IconCheck, IconPercentage } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { environmentConfig } from '@/shared/config/environment'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { CopyButton } from '@/ui/components/CopyButton'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { DescriptionList, type DescriptionListItem } from '@/ui/components/DescriptionList'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { EmptyState } from '@/ui/components/EmptyState'
import styles from '../PlayerProfile.module.css'

const PLAYER_REFERRAL_PROFILE_QUERY = gql`
  query PlayerReferralProfile($playerId: ID!) {
    playerReferralProfile(playerId: $playerId) {
      totalEarnings
      grossEarnings
      totalReferrals
      activeReferrals
      totalClicks
      totalAttributions
      conversionRate
      earningsByRuleType {
        ruleType
        totalEarnings
        count
      }
      referralLink {
        id
        tenant
        userId
        agentId
        code
        qrCodeUrl
        utmParams
        isActive
        totalClicks
        totalSignups
        conversionRate
        createdAt
        updatedAt
      }
      referredBy {
        id
        username
        name
        phone
      }
      referees {
        id
        name
        phone
        username
      }
      earnings {
        id
        tenant
        attributionId
        ruleId
        referrerId
        refereeId
        referrerName
        referrerPhone
        refereeName
        refereePhone
        tier
        ruleType
        grossAmount
        netAmount
        currency
        eventData
        calculatedAt
      }
      settlements {
        id
        tenant
        earningId
        referrerId
        payoutType
        cashAmount
        bonusAmount
        currency
        status
        escrowStatus
        walletTransactionId
        bonusAwardId
        settledAt
        createdAt
      }
    }
  }
`

interface Referee { id: string; name?: string; phone?: string; username?: string }
interface Earning { id: string; tenant?: string; attributionId?: string; ruleId?: string; referrerId?: string; refereeId?: string; referrerName?: string; referrerPhone?: string; refereeName?: string; refereePhone?: string; tier?: number; ruleType: string; grossAmount?: number; netAmount?: number; currency: string; calculatedAt?: string; eventData?: Record<string, unknown> }
interface Settlement { id: string; tenant?: string; earningId?: string; referrerId?: string; payoutType: string; cashAmount?: number; bonusAmount?: number; currency: string; status: string; escrowStatus?: string; walletTransactionId?: string; bonusAwardId?: string; settledAt?: string; createdAt?: string }
interface ReferralLink { id?: string; tenant?: string; userId?: string; agentId?: string; code: string; qrCodeUrl?: string; utmParams?: Record<string, unknown>; isActive?: boolean; totalClicks?: number; totalSignups?: number; conversionRate?: number; createdAt?: string; updatedAt?: string }
interface RuleEarning { ruleType: string; totalEarnings?: number; count?: number }
interface ReferralProfile { totalEarnings?: number; grossEarnings?: number; totalReferrals?: number; activeReferrals?: number; totalClicks?: number; conversionRate?: number; earningsByRuleType?: RuleEarning[]; referralLink?: ReferralLink; referredBy?: Referee; referees?: Referee[]; earnings?: Earning[]; settlements?: Settlement[] }
type SubTab = 'referees' | 'earnings' | 'settlements'
const RULE_LABELS: Record<string, string> = { SIGNUP_CPA: 'Signup CPA', FIRST_DEPOSIT_PCT: 'First Deposit %', RELOAD_DEPOSITS_PCT: 'Reload Deposit %', REVSHARE: 'Revenue Share', LOSS_SHARE: 'Loss Share', TURNOVER_MILESTONE: 'Turnover Milestone', DEPOSITS_WINDOW_PCT: 'Deposits Window %', ACTIVITY_MILESTONE: 'Activity Milestone' }
export function ReferralBonusTab({ playerId }: { playerId: string }) {
  return <RBACGuard required={[{ domain: 'players.referral-bonus', actions: ['view'] }]}><ReferralBonusTabContent playerId={playerId} /></RBACGuard>
}
function ReferralBonusTabContent({ playerId }: { playerId: string }) {
  const { formatAmount } = useCurrency()
  const { formatDate, formatTime, formatDateTime } = useFormatDate()
  const navigate = useNavigate()
  const [subTab, setSubTab] = useState<SubTab>('referees')
  const [networkErrorSkip, setNetworkErrorSkip] = useState(false)
  const [expandedRefereeId, setExpandedRefereeId] = useState<string | null>(null)
  const [expandedEarningId, setExpandedEarningId] = useState<string | null>(null)
  const [expandedSettlementId, setExpandedSettlementId] = useState<string | null>(null)
  const { data, loading, error, refetch } = useQuery<{ playerReferralProfile?: ReferralProfile }>(PLAYER_REFERRAL_PROFILE_QUERY, {
    variables: { playerId }, skip: networkErrorSkip, errorPolicy: 'all', fetchPolicy: 'network-only', notifyOnNetworkStatusChange: false,
    onError: (cause) => { if (cause.networkError) setNetworkErrorSkip(true) },
  })
  const profile = data?.playerReferralProfile
  const retry = () => { setNetworkErrorSkip(false); void refetch() }
  const getUserFrontendUrl = () => {
    if (environmentConfig.userFrontendUrl) {
      return environmentConfig.userFrontendUrl.replace(/\/$/, '')
    }
    const origin = window.location.origin
    if (origin.includes('admin.')) {
      return origin.replace('admin.', '')
    }
    return origin
  }

  const getReferralFullUrl = (code: string) => (code ? `${getUserFrontendUrl()}/r?ref=${code}` : '')


  const settledTotal = (profile?.settlements || []).filter((row) => row.status === 'completed').reduce((sum, row) => sum + Number(row.cashAmount || 0) + Number(row.bonusAmount || 0), 0)
  const pendingTotal = (profile?.settlements || []).filter((row) => row.status === 'pending' || row.status === 'processing').reduce((sum, row) => sum + Number(row.cashAmount || 0) + Number(row.bonusAmount || 0), 0)
  const rule = (type: string) => <StatusPill tone="neutral">{RULE_LABELS[type] || type.replace(/_/g, ' ')}</StatusPill>
  const date = (value?: string, fallback = '—') => value ? <span>{formatDate(value, 'dd MMM yyyy')}<span className={styles.subtle}> · {formatTime(value, 'HH:mm')}</span></span> : fallback
  const byRuleColumns: DataTableColumn<RuleEarning>[] = [
    { key: 'ruleType', header: 'Rule type', cell: (row) => rule(row.ruleType) },
    { key: 'totalEarnings', header: 'Total earnings', align: 'right', cell: (row) => formatAmount(row.totalEarnings ?? 0) },
    { key: 'count', header: 'Count', align: 'right', cell: (row) => row.count ?? 0 },
  ]
  const refereeColumns: DataTableColumn<Referee>[] = [
    { key: 'id', header: 'ID', emphasis: 'id', cell: (row) => `#${row.id}` },
    { key: 'username', header: 'Username', cell: (row) => <Button variant="link" size="xs" onClick={() => navigate(`/players/profile/${row.id}`)}>{row.username || '-'}</Button> },
    { key: 'name', header: 'Name', cell: (row) => row.name || '-' },
    { key: 'phone', header: 'Phone', cell: (row) => row.phone || '-' },
  ]
  const earningColumns: DataTableColumn<Earning>[] = [
    { key: 'ruleType', header: 'Rule Type', minWidth: 170, cell: (row) => rule(row.ruleType) },
    { key: 'attributionRule', header: 'Attrib./Rule', minWidth: 140, align: 'center', cell: (row) => row.attributionId != null || row.ruleId != null ? `#${row.attributionId ?? '-'} / #${row.ruleId ?? '-'}` : '-' },
    { key: 'referee', header: 'Referee', minWidth: 140, cell: (row) => <span>{row.refereeName || '-'}<span className={styles.subtle}> {row.refereePhone || ''}</span></span> },
    { key: 'referrer', header: 'Referrer', minWidth: 140, cell: (row) => <span>{row.referrerName || '-'}<span className={styles.subtle}> {row.referrerPhone || ''}</span></span> },
    { key: 'tier', header: 'Tier', align: 'center', cell: (row) => row.tier },
    { key: 'gross', header: 'Gross', align: 'right', minWidth: 130, cell: (row) => formatAmount(row.grossAmount || 0, row.currency) },
    { key: 'net', header: 'Net', align: 'right', minWidth: 130, cell: (row) => formatAmount(row.netAmount || 0, row.currency) },
    { key: 'currency', header: 'Currency', align: 'center', cell: (row) => row.currency },
    { key: 'date', header: 'Date', minWidth: 155, cell: (row) => date(row.calculatedAt) },
  ]
  const settlementColumns: DataTableColumn<Settlement>[] = [
    { key: 'id', header: 'ID', emphasis: 'id', cell: (row) => `#${row.id}` },
    { key: 'earningId', header: 'Earning ID', cell: (row) => row.earningId ?? '-' },
    { key: 'referrerId', header: 'Referrer ID', cell: (row) => row.referrerId ?? '-' },
    { key: 'payoutType', header: 'Payout Type', cell: (row) => <StatusPill tone="neutral">{row.payoutType}</StatusPill> },
    { key: 'cashAmount', header: 'Cash', align: 'right', minWidth: 130, cell: (row) => formatAmount(row.cashAmount || 0, row.currency) },
    { key: 'bonusAmount', header: 'Bonus', align: 'right', minWidth: 130, cell: (row) => formatAmount(row.bonusAmount || 0, row.currency) },
    { key: 'currency', header: 'Currency', align: 'center', cell: (row) => row.currency },
    { key: 'status', header: 'Status', cell: (row) => <StatusPill status={row.status}>{row.status}</StatusPill> },
    { key: 'escrow', header: 'Escrow', cell: (row) => row.escrowStatus === 'none' ? '-' : row.escrowStatus },
    { key: 'settledAt', header: 'Settled', minWidth: 155, cell: (row) => date(row.settledAt, 'Pending') },
    { key: 'createdAt', header: 'Created', minWidth: 155, cell: (row) => date(row.createdAt) },
  ]
  const referralLinkDetails = (link: ReferralLink) => {
    const items: DescriptionListItem[] = []
    if (link.id) items.push({ term: 'Link ID', value: `#${link.id}` })
    if (link.userId != null) items.push({ term: 'User ID', value: link.userId })
    if (link.agentId) items.push({ term: 'Agent ID', value: link.agentId })
    if (link.totalClicks != null) items.push({ term: 'Clicks', value: link.totalClicks })
    if (link.totalSignups != null) items.push({ term: 'Signups', value: link.totalSignups })
    if (link.conversionRate != null) items.push({ term: 'Conv. rate', value: `${link.conversionRate.toFixed(1)}%` })
    if (link.createdAt) items.push({ term: 'Created', value: formatDateTime(link.createdAt, 'dd MMM yyyy HH:mm') })
    if (link.updatedAt) items.push({ term: 'Updated', value: formatDateTime(link.updatedAt, 'dd MMM yyyy HH:mm') })
    return <div className={styles.stack}>
      {link.code ? <DescriptionList items={[{ term: 'Complete URL', value: <span className={styles.row}><code className={styles.text}>{getReferralFullUrl(link.code)}</code><CopyButton value={getReferralFullUrl(link.code)} label="Copy full URL" copiedLabel="Referral URL copied" errorLabel="Failed to copy" /></span> }]} /> : null}
      <p className={styles.subtle}>Share this link so users can register with this referral.</p>
      <span className={styles.row}><code className={styles.text}>{link.code}</code><CopyButton value={link.code} label="Copy code" copiedLabel="Copied!" /><StatusPill tone={link.isActive ? 'ok' : 'muted'}>{link.isActive ? 'Active' : 'Inactive'}</StatusPill></span>
      <DescriptionList items={items} />
      {link.qrCodeUrl ? <DescriptionList.Section title="QR Code"><img src={link.qrCodeUrl} alt="Referral QR" className={styles.qr} /></DescriptionList.Section> : null}
      {link.utmParams && typeof link.utmParams === 'object' && Object.keys(link.utmParams).length ? <DescriptionList.Section title="UTM params"><pre className={styles.json}>{JSON.stringify(link.utmParams, null, 2)}</pre></DescriptionList.Section> : null}
    </div>
  }
  const state = loading ? 'loading' : error || networkErrorSkip ? 'error' : 'ready'
  return <div className={styles.stack}>
    <div className={styles.financialGrid}>
      <Stat label="Total Referrals" value={loading ? '-' : profile?.totalReferrals ?? 0} note={loading ? undefined : `${profile?.activeReferrals ?? 0} active`} icon={<IconUsers size={18} />} hue="blu" />
      <Stat label="Total Earnings" value={<span className={styles.moneyValue}>{loading ? '-' : formatAmount(profile?.grossEarnings ?? 0)}</span>} note={loading ? undefined : `Net: ${formatAmount(profile?.totalEarnings ?? 0)}`} icon={<IconCurrencyDollar size={18} />} hue="grn" />
      <Stat label="Settled" value={<span className={styles.moneyValue}>{loading ? '-' : formatAmount(settledTotal)}</span>} note={loading ? undefined : `${formatAmount(pendingTotal)} pending`} icon={<IconCheck size={18} />} hue="vio" />
      <Stat label="Conversion Rate" value={loading ? '-' : `${(profile?.conversionRate ?? 0).toFixed(1)}%`} note={loading ? undefined : `${profile?.totalClicks ?? 0} clicks`} icon={<IconPercentage size={18} />} hue="amb" />
    </div>
    {!loading && profile?.earningsByRuleType?.length ? <Card title="Earnings by rule type" body="table"><DataTable label="Earnings by referral rule type" rows={profile.earningsByRuleType} columns={byRuleColumns} rowKey={(row) => row.ruleType} /></Card> : null}
    {!loading && profile ? <div className={styles.fields}>
      <Card title="Referral Link">{profile.referralLink ? referralLinkDetails(profile.referralLink) : <p className={styles.subtle}>No referral link generated</p>}</Card>
      <Card title="Referred By">{profile.referredBy ? <div className={styles.stack}><Button variant="link" onClick={() => navigate(`/players/profile/${profile.referredBy?.id}`)}>{profile.referredBy.name || profile.referredBy.username || 'Unknown'}</Button><p className={styles.subtle}>{profile.referredBy.phone || profile.referredBy.username || ''}</p></div> : <p className={styles.subtle}>Not referred by anyone</p>}</Card>
    </div> : null}
    <SegmentedControl label="Referral details" value={subTab} size="sm" onChange={setSubTab} options={[{ value: 'referees', label: `Referees (${profile?.referees?.length ?? 0})` }, { value: 'earnings', label: `Earnings (${profile?.earnings?.length ?? 0})` }, { value: 'settlements', label: `Settlements (${profile?.settlements?.length ?? 0})` }]} />
    <Card title="Referral Details" sub="View referees, earnings, and settlements" body="table">
      {subTab === 'referees' ? <DataTable label="Referred players" columns={refereeColumns} rows={state === 'error' ? [] : profile?.referees || []} rowKey={(row) => row.id} state={state} error="Error loading referral data" onRetry={retry} empty={<EmptyState title="No referees found" />} expandable={{ expanded: new Set(expandedRefereeId ? [expandedRefereeId] : []), onToggle: (id) => setExpandedRefereeId(id === expandedRefereeId ? null : id), render: (row) => <div className={styles.detail}><DescriptionList.Section title="Referee details"><DescriptionList items={[{ term: 'ID', value: `#${row.id}` }, { term: 'Username', value: row.username || '-' }, { term: 'Name', value: row.name || '-' }, { term: 'Phone', value: row.phone || '-' }]} /></DescriptionList.Section><Button variant="primary" size="sm" onClick={() => navigate(`/players/profile/${row.id}`)}>View profile</Button></div> }} /> : null}
      {subTab === 'earnings' ? <DataTable label="Referral earnings" columns={earningColumns} rows={state === 'error' ? [] : profile?.earnings || []} rowKey={(row) => row.id} width="wide" state={state} error="Error loading referral data" onRetry={retry} empty={<EmptyState title="No earnings found" />} expandable={{ expanded: new Set(expandedEarningId ? [expandedEarningId] : []), onToggle: (id) => setExpandedEarningId(id === expandedEarningId ? null : id), render: (row) => <div className={styles.detail}><DescriptionList.Section title="Earning details"><DescriptionList items={[{ term: 'ID', value: `#${row.id}` }, { term: 'Attribution ID', value: row.attributionId ?? '-' }, { term: 'Rule ID', value: row.ruleId ?? '-' }, { term: 'Referrer ID', value: row.referrerId ?? '-' }, { term: 'Referee ID', value: row.refereeId ?? '-' }, { term: 'Tenant', value: row.tenant ?? '-' }]} /></DescriptionList.Section>{row.eventData && typeof row.eventData === 'object' && Object.keys(row.eventData).length ? <DescriptionList.Section title="Event data (JSON)"><pre className={styles.json}>{JSON.stringify(row.eventData, null, 2)}</pre></DescriptionList.Section> : null}</div> }} /> : null}
      {subTab === 'settlements' ? <DataTable label="Referral settlements" columns={settlementColumns} rows={state === 'error' ? [] : profile?.settlements || []} rowKey={(row) => row.id} width="wide" state={state} error="Error loading referral data" onRetry={retry} empty={<EmptyState title="No settlements found" />} expandable={{ expanded: new Set(expandedSettlementId ? [expandedSettlementId] : []), onToggle: (id) => setExpandedSettlementId(id === expandedSettlementId ? null : id), render: (row) => <div className={styles.detail}><DescriptionList.Section title="Settlement details"><DescriptionList items={[{ term: 'ID', value: `#${row.id}` }, { term: 'Tenant', value: row.tenant ?? '-' }, { term: 'Earning ID', value: row.earningId ?? '-' }, { term: 'Referrer ID', value: row.referrerId ?? '-' }, { term: 'Wallet transaction ID', value: row.walletTransactionId ?? '-' }, { term: 'Bonus award ID', value: row.bonusAwardId ?? '-' }, { term: 'Payout type', value: row.payoutType }, { term: 'Status', value: <StatusPill status={row.status}>{row.status}</StatusPill> }, { term: 'Escrow status', value: row.escrowStatus ?? '-' }, { term: 'Created', value: row.createdAt ? formatDateTime(row.createdAt, 'dd MMM yyyy HH:mm') : '—' }, ...(row.settledAt ? [{ term: 'Settled at', value: formatDateTime(row.settledAt, 'dd MMM yyyy HH:mm') }] : [])]} /></DescriptionList.Section></div> }} /> : null}
    </Card>
  </div>
}
