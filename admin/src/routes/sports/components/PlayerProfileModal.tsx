import { useRef, useState, type ReactNode } from 'react'
import { useQuery, useMutation, type FetchResult } from '@apollo/client'
import { gql } from '@apollo/client'
import { IconFlag, IconBan, IconDownload } from '@tabler/icons-react'
import { GET_PLAYER_PROFILE_QUERY, VOID_BET_MUTATION, FLAG_PLAYER_MUTATION, UNFLAG_PLAYER_MUTATION } from '@/lib/graphql/playerIntelligence'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { DateField } from '@/ui/components/DateField'
import { DescriptionList, type DescriptionListItem } from '@/ui/components/DescriptionList'
import { Dialog } from '@/ui/components/Dialog'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { Popover } from '@/ui/components/Popover'
import { Select } from '@/ui/components/Select'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { TextField } from '@/ui/components/TextField'
import { Textarea } from '@/ui/components/Textarea'
import { Tooltip } from '@/ui/components/Tooltip'
import { filterProfileBets, profileBetPnL, profileBetsCsv, riskTone, type PlayerIntelligenceProfile, type ProfileBet } from './eventDetailModel'
import { PatternBadge } from './PatternBadge'
import styles from './EventDetailUi.module.css'

const SET_USER_STATUS_MUTATION = gql`
  mutation SetUserStatus($id: ID!, $status: PlayerStatus!) {
    setUserStatus(id: $id, status: $status) {
      success
      message
      user {
        id
        status
      }
    }
  }
`;

interface PlayerProfileModalProps { open: boolean; onClose: () => void; userId: string }
interface MutationData { [key: string]: { success?: boolean; message?: string | null } | null }
type ProfileTab = 'overview' | 'history' | 'statistics' | 'risk' | 'devices' | 'agents'
type Feedback = { tone: 'ok' | 'error' | 'warn'; message: string }

export function PlayerProfileModal({ open, onClose, userId }: PlayerProfileModalProps) {
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview')
  const [flagOpen, setFlagOpen] = useState(false)
  const [suspendOpen, setSuspendOpen] = useState(false)
  const [flag, setFlag] = useState('')
  const [flagReason, setFlagReason] = useState('')
  const [suspendReason, setSuspendReason] = useState('')
  const [busy, setBusy] = useState(false)
  const actionLock = useRef(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [filter, setFilter] = useState({ search: '', status: '', from: '', to: '' })
  const [historyPage, setHistoryPage] = useState(1)
  const [historySize, setHistorySize] = useState(20)
  const [devicePage, setDevicePage] = useState(1)
  const [deviceSize, setDeviceSize] = useState(10)
  const { formatAmount } = useCurrency()
  const { formatDate, formatDateTime } = useFormatDate()
  const permissions = useAuthStore(state => state.permissions)
  const agentLogin = useAuthStore(state => state.agent)
  const canViewWallet = !!agentLogin || hasPermissionWithNested(permissions, 'players.wallet', 'view')
  const canViewCredit = !!agentLogin || hasPermissionWithNested(permissions, 'players.credit', 'view')
  const walletMask = '••••'
  const { data, loading, error, refetch } = useQuery<{ sportsPlayerProfile?: PlayerIntelligenceProfile | null }>(GET_PLAYER_PROFILE_QUERY, {
    variables: { userId }, skip: !open || !userId, errorPolicy: 'all',
  })
  const [voidBet] = useMutation<MutationData>(VOID_BET_MUTATION)
  const [flagPlayer] = useMutation<MutationData>(FLAG_PLAYER_MUTATION)
  const [unflagPlayer] = useMutation<MutationData>(UNFLAG_PLAYER_MUTATION)
  const [setUserStatus] = useMutation<MutationData>(SET_USER_STATUS_MUTATION)
  const profile = data?.sportsPlayerProfile
  const { user, statistics, patterns, riskProfile } = profile || {}
  const devices = profile?.devices || []
  const relatedPlayers = profile?.relatedPlayers || []
  const agentChain = profile?.agentChain || []
  const recentBets = profile?.recentBets || []
  const filteredBets = filterProfileBets(recentBets, filter, value => formatDate(value, 'yyyy-MM-dd'))

  async function runAction(name: string, responseKey: string, operation: () => Promise<FetchResult<MutationData>>, onSuccess?: () => void) {
    if (actionLock.current) return false
    actionLock.current = true
    setBusy(true)
    setFeedback(null)
    try {
      const result = await operation()
      const response = result.data?.[responseKey]
      if (result.errors?.length) throw new Error(result.errors.map(item => item.message).join('; '))
      if (response?.success !== true) throw new Error(response?.message || `${name} was not accepted`)
      onSuccess?.()
      setFeedback({ tone: 'ok', message: name === 'Player suspended' ? `Player suspended. Reason: ${suspendReason}` : name })
      void refetch().catch(() => setFeedback({ tone: 'warn', message: 'The action completed, but the profile could not be refreshed. Retry loading the profile.' }))
      return true
    } catch (reason) {
      setFeedback({ tone: 'error', message: reason instanceof Error ? reason.message : `Failed: ${name}` })
      return false
    } finally {
      actionLock.current = false
      setBusy(false)
    }
  }

  function changeFilter(key: keyof typeof filter, value: string) { setFilter(current => ({ ...current, [key]: value })); setHistoryPage(1) }
  function exportBets() {
    const url = URL.createObjectURL(new Blob([profileBetsCsv(filteredBets)], { type: 'text/csv;charset=utf-8;' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `player-${userId}-recent-bets.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const context = { uiToast: 'notification' }
  const historyColumns: DataTableColumn<ProfileBet>[] = [
    { key: 'createdAt', header: 'Time', width: 150, cell: bet => bet.createdAt ? formatDateTime(bet.createdAt, 'yyyy-MM-dd HH:mm:ss') : '—' },
    { key: 'marketId', header: 'Market', width: 100, cell: bet => `${bet.marketId?.substring(0, 8) || ''}...` },
    { key: 'selectionId', header: 'Selection', width: 100, cell: bet => bet.selectionId },
    { key: 'stake', header: 'Stake', width: 100, cell: bet => formatAmount(bet.stake || 0) },
    { key: 'price', header: 'Odds', width: 80, cell: bet => bet.price?.toFixed(2) },
    { key: 'side', header: 'Side', width: 80, cell: bet => <StatusPill tone={bet.side === 'back' ? 'info' : 'warn'}>{bet.side?.toUpperCase()}</StatusPill> },
    { key: 'status', header: 'Status', width: 100, cell: bet => <StatusPill tone={bet.status?.toLowerCase() === 'won' ? 'ok' : bet.status?.toLowerCase() === 'lost' ? 'neg' : bet.status?.toLowerCase() === 'matched' ? 'info' : bet.status?.toLowerCase() === 'unmatched' ? 'warn' : ['void', 'cancelled'].includes(String(bet.status || '').toLowerCase()) ? 'muted' : 'neutral'}>{bet.status?.toUpperCase()}</StatusPill> },
    { key: 'pnl', header: 'P&L', width: 100, cell: bet => {
      if (!['won', 'lost'].includes(String(bet.status || '').toLowerCase())) return '—'
      const pnl = profileBetPnL(bet)
      return <span className={pnl > 0 ? styles.positive : pnl < 0 ? styles.negative : styles.muted}>{pnl > 0 ? '+' : ''}{formatAmount(pnl)}</span>
    } },
    { key: 'actions', header: 'Actions', width: 80, cell: bet => <Popover label={`Void bet ${bet.id}`} trigger={<Button variant="danger" size="xs" disabled={busy}>Void</Button>}>
      {({ close }) => <div className={styles.popover}>
        <Notice tone="warn">Void this bet? This uses the existing manual-void action and reason.</Notice>
        <div className={styles.row}><Button disabled={busy} onClick={close}>Cancel</Button>
          <Button variant="dangerSolid" loading={busy} onClick={() => void runAction('Bet voided', 'voidBet', () => voidBet({ variables: { betId: bet.id, reason: 'Manual void from player profile' }, context }), close)}>Confirm void</Button></div>
      </div>}
    </Popover> },
  ]
  const deviceColumns: DataTableColumn<(typeof devices)[number]>[] = [
    { key: 'ipAddress', header: 'IP Address', width: 150, cell: row => row.ipAddress },
    { key: 'userAgent', header: 'User Agent', width: 200, cell: row => row.userAgent },
    { key: 'location', header: 'Location', width: 150, cell: row => row.location },
    { key: 'country', header: 'Country', width: 100, cell: row => row.country },
    { key: 'firstUsed', header: 'First Used', width: 150, cell: row => row.firstUsed ? formatDate(row.firstUsed, 'MMM d, yyyy') : '—' },
    { key: 'lastUsed', header: 'Last Used', width: 150, cell: row => row.lastUsed ? formatDate(row.lastUsed, 'MMM d, yyyy') : '—' },
    { key: 'betCount', header: 'Bet Count', width: 100, cell: row => row.betCount },
  ]
  const tabs: TabItem<ProfileTab>[] = [{ value: 'overview', label: 'Overview' }]
  if (recentBets.length) tabs.push({ value: 'history', label: `Betting History (${recentBets.length})` })
  if (patterns) tabs.push({ value: 'statistics', label: 'Statistics & Patterns' })
  if (riskProfile) tabs.push({ value: 'risk', label: `Risk Profile${(riskProfile.suspiciousActivityCount || 0) > 0 ? ` (${riskProfile.suspiciousActivityCount})` : ''}` })
  if (devices.length) tabs.push({ value: 'devices', label: `Devices & Locations (${devices.length})` })
  if (agentChain.length) tabs.push({ value: 'agents', label: `Agent Hierarchy (${agentChain.length})` })
  const selectedTab = tabs.some(item => item.value === activeTab) ? activeTab : 'overview'
  const patternDetails: DescriptionListItem[] = []
  if (patterns?.peakBettingHours?.length) patternDetails.push({ term: 'Peak Betting Hours', value: patterns.peakBettingHours.join(', ') })
  if (patterns?.averageSessionDuration !== undefined) patternDetails.push({ term: 'Average Session Duration', value: `${patterns.averageSessionDuration.toFixed(1)} minutes` })
  if (patterns?.typicalStakeRange) patternDetails.push({ term: 'Typical Stake Range', value: `${formatAmount(patterns.typicalStakeRange.min || 0)} – ${formatAmount(patterns.typicalStakeRange.max || 0)}` })
  if (patterns?.bettingSidePreference) patternDetails.push({ term: 'Betting Side Preference', value: <StatusPill tone={patterns.bettingSidePreference === 'back' ? 'info' : 'warn'}>{patterns.bettingSidePreference.toUpperCase()}</StatusPill> })
  if (patterns?.streakBehavior) patternDetails.push(
    { term: 'Chasing Losses', value: patterns.streakBehavior.chasingLosses ? 'Yes' : 'No' },
    { term: 'Stop After Win', value: patterns.streakBehavior.stopAfterWin ? 'Yes' : 'No' },
    { term: 'Average Streak Length', value: patterns.streakBehavior.averageStreakLength?.toFixed(1) || '0' },
  )
  let content: ReactNode
  if (selectedTab === 'overview') content = <>
    <Card title="Player Information" headingLevel={3}><DescriptionList items={[
      { term: 'Name', value: user?.name || 'N/A' }, { term: 'Username', value: user?.username || 'N/A' },
      { term: 'Email', value: user?.email || 'N/A' }, { term: 'Phone', value: user?.phone || 'N/A' },
      { term: 'Status', value: <StatusPill tone={user?.status?.toUpperCase() === 'ACTIVE' ? 'ok' : 'neg'}>{user?.status?.toUpperCase() || 'UNKNOWN'}</StatusPill> },
      { term: 'Risk Type', value: <StatusPill tone={riskTone(riskProfile?.riskLevel)}>{riskProfile?.riskLevel || 'UNKNOWN'}</StatusPill> },
    ]} /></Card>
    {statistics && <div className={styles.metrics}>
      <Stat label="Total Bets" value={statistics.totalBets || 0} size="compact" />
      <Stat label="Win Rate" value={`${(statistics.winRate || 0).toFixed(1)}%`} size="compact" />
      <Stat label="Net Profit" value={canViewWallet ? <span className={(statistics.netProfit || 0) < 0 ? styles.negative : styles.positive}>{formatAmount(0).replace(/[\d.,]/g, '')}{(statistics.netProfit || 0).toFixed(2)}</span> : walletMask} size="compact" />
      <Stat label="ROI" value={`${(statistics.roi || 0).toFixed(1)}%`} size="compact" />
    </div>}
    <Card title="Quick Actions" headingLevel={3}><div className={styles.row}>
      <Popover label="Flag Player" placement="bottom-start" open={flagOpen} onOpenChange={next => { if (!busy) setFlagOpen(next) }} trigger={<Button disabled={busy} icon={<IconFlag size={16} />}>Flag Player</Button>}>
        <form className={styles.popover} onSubmit={event => { event.preventDefault(); if (flag.trim() && flagReason.trim()) void runAction('Player flagged', 'flagPlayer', () => flagPlayer({ variables: { userId, flag, reason: flagReason }, context }), () => { setFlag(''); setFlagReason(''); setFlagOpen(false) }) }}>
          <TextField label="Flag Name" value={flag} onChange={setFlag} placeholder="e.g., SUSPICIOUS, HIGH_RISK" required disabled={busy} />
          <Textarea label="Reason" value={flagReason} onChange={setFlagReason} rows={3} required disabled={busy} />
          <div className={styles.row}><Button disabled={busy} onClick={() => { setFlag(''); setFlagReason(''); setFlagOpen(false) }}>Cancel</Button><Button variant="primary" type="submit" loading={busy}>Flag Player</Button></div>
        </form>
      </Popover>
      <Popover label="Suspend Player" placement="bottom-start" open={suspendOpen} onOpenChange={next => { if (!busy) setSuspendOpen(next) }} trigger={<Button variant="danger" disabled={busy} icon={<IconBan size={16} />}>Suspend</Button>}>
        <form className={styles.popover} onSubmit={event => { event.preventDefault(); if (suspendReason.trim()) void runAction('Player suspended', 'setUserStatus', () => setUserStatus({ variables: { id: userId, status: 'SUSPENDED' }, context }), () => { setSuspendReason(''); setSuspendOpen(false) }) }}>
          <Textarea label="Reason" value={suspendReason} onChange={setSuspendReason} rows={3} required disabled={busy} />
          <Notice tone="warn">This will suspend the player and prevent them from accessing their account.</Notice>
          <p className={styles.muted}>The existing suspension API changes account status only. The reason is shown in confirmation, not saved by that API.</p>
          <div className={styles.row}><Button disabled={busy} onClick={() => { setSuspendReason(''); setSuspendOpen(false) }}>Cancel</Button><Button variant="dangerSolid" type="submit" loading={busy}>Suspend Player</Button></div>
        </form>
      </Popover>
    </div></Card>
    {(riskProfile?.manualFlags?.length || riskProfile?.patternFlags?.length) ? <Card title="Active Flags" headingLevel={3}><div className={styles.stack}>
      {!!riskProfile.manualFlags?.length && <div className={styles.stack}><p className={styles.muted}>Manual Flags (Removable)</p><div className={styles.row}>
        {riskProfile.manualFlags.map((manualFlag, index) => <Popover key={`${manualFlag}-${index}`} label="Remove Flag" trigger={<Button size="sm" variant="danger" disabled={busy} aria-label={`Remove ${manualFlag} flag`}>{manualFlag}</Button>}>
          {({ close }) => <div className={styles.popover}><p>Are you sure you want to remove the "{manualFlag}" flag?</p><div className={styles.row}>
            <Button disabled={busy} onClick={close}>Cancel</Button><Button variant="dangerSolid" loading={busy} onClick={() => void runAction('Flag removed', 'unflagPlayer', () => unflagPlayer({ variables: { userId, flag: manualFlag }, context }), close)}>Yes, Remove</Button>
          </div></div>}
        </Popover>)}
      </div></div>}
      {!!riskProfile.patternFlags?.length && <div className={styles.stack}><p className={styles.muted}>Pattern-Based Flags (Auto-detected)</p><div className={styles.row}>
        {riskProfile.patternFlags.map((patternFlag, index) => <Tooltip key={`${patternFlag}-${index}`} content="This flag is derived from detected betting patterns and cannot be removed directly. Dismiss the pattern to remove this flag."><span tabIndex={0}><StatusPill tone="warn">{patternFlag}</StatusPill></span></Tooltip>)}
      </div></div>}
    </div></Card> : null}
  </>
  else if (selectedTab === 'history') content = <>
    <Notice tone="info">Filters and CSV export apply only to the recent bets loaded in this profile, not the full account history.</Notice>
    <div className={styles.filters}>
      <TextField label="Search recent bets" value={filter.search} onChange={value => changeFilter('search', value)} clearable />
      <Select label="Status" layout="stacked" value={filter.status} onChange={value => changeFilter('status', value)} options={[{ value: '', label: 'All' }, ...['won', 'lost', 'matched', 'unmatched'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))]} />
      <DateField label="From" value={filter.from} onChange={value => changeFilter('from', value)} max={filter.to || undefined} />
      <DateField label="To" value={filter.to} onChange={value => changeFilter('to', value)} min={filter.from || undefined} />
      <Button icon={<IconDownload size={16} />} onClick={exportBets} disabled={!filteredBets.length}>Export CSV</Button>
    </div>
    <Card body="table"><DataTable columns={historyColumns} rows={filteredBets.slice((historyPage - 1) * historySize, historyPage * historySize)} rowKey={bet => bet.id} label="Recent player bets" width="wide"
      pagination={{ current: historyPage, pageSize: historySize, total: filteredBets.length, onChange: setHistoryPage, onPageSizeChange: size => { setHistorySize(size); setHistoryPage(1) }, pageSizeOptions: [20, 50, 100], itemName: 'bets' }} /></Card>
  </>
  else if (selectedTab === 'statistics') content = <>
    <Card title="Betting Patterns" headingLevel={3}><DescriptionList items={patternDetails} /></Card>
    {!!patterns?.marketPreferences?.length && <Card title="Market Preferences" headingLevel={3}><ul className={styles.list}>{patterns.marketPreferences.map((preference, index) => <li key={`${preference.marketType}-${index}`} className={styles.between}><span>{preference.marketType}</span><span>{preference.percentage?.toFixed(1)}% <span className={styles.muted}>({preference.totalBets} bets)</span></span></li>)}</ul></Card>}
  </>
  else if (selectedTab === 'risk') content = <>
    <Card title="Current Risk Level" headingLevel={3}><div className={styles.row}><StatusPill tone={riskTone(riskProfile?.riskLevel)}>{riskProfile?.riskLevel || 'UNKNOWN'}</StatusPill><span>Suspicious Activity Count: {riskProfile?.suspiciousActivityCount || 0}</span>{riskProfile?.lastReviewedAt && <span className={styles.muted}>Last Reviewed: {formatDateTime(riskProfile.lastReviewedAt, 'MMM d, yyyy HH:mm')}</span>}</div></Card>
    {riskProfile?.patterns?.length ? <Card title={`Detected Patterns (${riskProfile.patterns.length})`} headingLevel={3}><ul className={styles.list}>{riskProfile.patterns.map(pattern => <li key={pattern.id} className={styles.listItem}><div className={styles.between}><div className={styles.row}><PatternBadge patternType={pattern.patternType} severity={pattern.severity} /><span>{pattern.patternType.replace(/_/g, ' ')}</span><StatusPill tone={riskTone(pattern.severity)}>{pattern.severity}</StatusPill></div><span className={styles.muted}>{pattern.detectedAt ? formatDateTime(pattern.detectedAt, 'MMM d, HH:mm') : '—'}</span></div></li>)}</ul></Card> : <EmptyState title="No patterns detected" />}
    <Card title="Notes" headingLevel={3}><Textarea label="Player risk notes" value={riskProfile?.notes || ''} onChange={() => {}} rows={3} readOnly help="Read-only notes supplied by the risk profile." />{riskProfile?.notes && <p className={styles.muted}>Last updated: {riskProfile.lastReviewedAt ? formatDateTime(riskProfile.lastReviewedAt, 'MMM d, yyyy HH:mm') : 'N/A'}</p>}</Card>
  </>
  else if (selectedTab === 'devices') content = <>
    <Card body="table"><DataTable columns={deviceColumns} rows={devices.slice((devicePage - 1) * deviceSize, devicePage * deviceSize)} rowKey={device => `${device.ipAddress}-${device.firstUsed}`} label="Player devices and locations" width="wide" pagination={{ current: devicePage, pageSize: deviceSize, total: devices.length, onChange: setDevicePage, onPageSizeChange: size => { setDeviceSize(size); setDevicePage(1) }, itemName: 'devices' }} /></Card>
    {!!relatedPlayers.length && <Card title={`Related Players (${relatedPlayers.length})`} headingLevel={3}><ul className={styles.list}>{relatedPlayers.map((related, index) => <li key={`${related.userId}-${index}`} className={styles.listItem}><div className={styles.between}><span>{related.userName} <span className={styles.muted}>({related.relationshipType})</span></span><StatusPill tone="warn">Confidence: {(related.confidence * 100).toFixed(0)}%</StatusPill></div></li>)}</ul></Card>}
  </>
  else content = <Card title="Agent Hierarchy" headingLevel={3}><ol className={styles.list}>{agentChain.map(agent => <li key={agent.agentId} className={styles.listItem}><strong>{agent.agentName}</strong><div className={styles.row}>
    {!!agent.commissionRate && <span>Commission: {agent.commissionRate}%</span>}
    {/* A CREDIT agent's credit limit is its credit reference now (spec 2026-11-02); "credit used" is retired. */}
    {!!agent.creditLimit && <span>Credit ref: {canViewCredit ? formatAmount(agent.creditLimit) : walletMask}</span>}
  </div></li>)}</ol></Card>

  return <Dialog open={open} onOpenChange={next => { if (!next && !busy) onClose() }} dismissible={!busy} title={`Player Profile${user?.name ? ` — ${user.name}` : ''}`} size="xl">
    {loading ? <LoadingState label="Loading player profile..." minHeight={192} /> : !profile ? <EmptyState title={error ? 'Unable to load player profile' : 'Player not found'} description={error?.message} action={error ? <Button onClick={() => void refetch().catch(() => undefined)}>Retry</Button> : undefined} /> : <div className={styles.stack}>
      {feedback && <Notice tone={feedback.tone} live={feedback.tone === 'error' ? 'assertive' : 'polite'}>{feedback.message}</Notice>}
      {error && <Notice tone="warn">Some profile data could not be loaded: {error.message}</Notice>}
      <div className={styles.tabs}><Tabs value={selectedTab} onChange={setActiveTab} items={tabs} label="Player intelligence tabs" idPrefix="event-player-profile" /></div>
      <div role="tabpanel" id={`event-player-profile-panel-${selectedTab}`} aria-labelledby={`event-player-profile-tab-${selectedTab}`} className={styles.stack}>{content}</div>
    </div>}
  </Dialog>
}

