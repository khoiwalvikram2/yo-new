import { useQuery, gql } from '@apollo/client'
import { IconStarFilled } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useAuthStore } from '@/shared/core/authStore'
import { useBreakpoint } from '@/shared/hooks/useBreakpoint'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable } from '@/ui/components/DataTable'
import { DescriptionList, DescriptionListSection } from '@/ui/components/DescriptionList'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { Meter } from '@/ui/components/Meter'
import { Notice } from '@/ui/components/Notice'
import { Spinner } from '@/ui/components/Spinner'
import { StatusPill, type StatusPillTone } from '@/ui/components/StatusPill'
import { profilePlayerType, type PlayerProfile, type ProfileOverview } from '../profileModel'
import { PROFILE_PRODUCTS, PROFILE_PRODUCT_LABELS, profileActivityEntries, profileProductRows, type ProfileActivityEntry, type ProfileProductRow } from '../overviewModel'
import { KpiGrid } from './KpiGrid'
import styles from '../PlayerProfile.module.css'

const TRANSFER_HISTORY_QUERY = gql`
  query PlayerAgentTransferHistory($playerId: ID!, $limit: Int) {
    playerAgentTransferHistory(playerId: $playerId, limit: $limit) {
      id
      timestamp
      performedBy
      fromAgentId
      fromAgentUsername
      toAgentId
      toAgentUsername
      reason
    }
  }
`

const RECENT_ROWS = 5
// Placeholders hold each card's height until the overview answers, so the page does not jump.
const CARD_HEIGHT = 220

interface OverviewTabProps {
  playerId: string
  profile: PlayerProfile
  overview?: ProfileOverview
  loading: boolean
  error?: { message: string } | null
  onRetry: () => void
  onTabChange: (tab: string) => void
}

const titleCase = (value: string) => value.toLowerCase().replace(/(^|[\s_-])(\w)/g, (_, gap: string, letter: string) => `${gap === '_' ? ' ' : gap}${letter.toUpperCase()}`)
const betTone = (status?: string): StatusPillTone => {
  const value = (status || '').toLowerCase()
  return value === 'won' ? 'ok' : value === 'lost' ? 'neg' : value === 'open' || value === 'pending' || value === 'matched' ? 'info' : value === 'cancelled' || value === 'void' || value === 'voided' ? 'muted' : 'neutral'
}

/**
 * The Overview (2026-10-28 redesign, the approved mockup): the period's figures on the left (headline
 * KPIs, each product, money in and out, recent bets and transactions), the player's account, bonus and
 * limits on the right. Everything comes from the profile and overview queries: no other tab's data loads here.
 */
export function OverviewTab({ playerId, profile, overview, loading, error, onRetry, onTabChange }: OverviewTabProps) {
  const pending = loading && !overview
  const kpis = overview?.kpis
  // On a phone a table keeps only the columns that fit, and fills the card instead of its 560px minimum;
  // the rest stay one tap away in their tabs.
  const { isMobile } = useBreakpoint()
  const { formatAmount } = useCurrency()
  const { formatDate, formatDateTime } = useFormatDate()
  const permissions = useAuthStore((state) => state.permissions)
  const agent = useAuthStore((state) => state.agent)
  const canViewWallet = !!agent || hasPermissionWithNested(permissions, 'players.wallet', 'view')
  const canViewBonuses = !!agent || hasPermissionWithNested(permissions, 'players.bonuses', 'view')
  const mask = '••••'
  const money = (value: number | null | undefined, allowed = canViewWallet) => allowed ? formatAmount(Number(value || 0)) : mask
  const signed = (value: number, allowed = canViewWallet) => allowed ? `${value > 0 ? '+' : value < 0 ? '-' : ''}${formatAmount(Math.abs(value))}` : mask
  // A balance-like figure that can go below zero: the minus before the currency, no plus.
  const net = (value: number, allowed = canViewWallet) => allowed ? `${value < 0 ? '-' : ''}${formatAmount(Math.abs(value))}` : mask
  const tone = (value: number, allowed = canViewWallet) => !allowed ? undefined : value > 0 ? styles.positive : value < 0 ? styles.negative : undefined
  const count = (value: number | null | undefined) => Number(value || 0).toLocaleString('en-IN')
  const when = (value?: string) => value ? formatDateTime(value, 'MMM d, h:mm a') : '—'
  const link = (label: string, tab: string) => <Button variant="link" size="sm" onClick={() => onTabChange(tab)}>{label}</Button>

  const rows = profileProductRows(kpis, overview?.topProducts, overview?.exposureByProduct)
  const total = rows.reduce((sum, row) => ({ bets: sum.bets + (row.bets ?? 0), stake: sum.stake + row.stake, open: sum.open + row.openStake, ggr: sum.ggr + row.ggr, pl: sum.pl + row.pl }), { bets: 0, stake: 0, open: 0, ggr: 0, pl: 0 })
  const activity = profileActivityEntries(overview?.recentActivity)
  const bets = activity.filter((entry) => entry.kind === 'bet').slice(0, RECENT_ROWS)
  const transactions = activity.filter((entry) => entry.kind === 'deposit' || entry.kind === 'withdrawal').slice(0, RECENT_ROWS)

  const head = error && !overview
    ? <Notice title="Failed to load stats." tone="error" action={<Button size="sm" onClick={onRetry}>Retry</Button>}>{error.message}</Notice>
    : !pending && !kpis
      ? <EmptyState title="No stats available" description="Check date range or try again." action={<Button size="sm" onClick={onRetry}>Retry</Button>} />
      : <KpiGrid playerId={playerId} kpis={kpis} wallet={profile.wallet} loading={pending} />
  const figures = pending || !!kpis

  const products = <Card title="Performance by product" sub="Bets placed in the period" body="table">
    {pending ? <LoadingState height={CARD_HEIGHT} label="Loading product figures" /> : <DataTable<ProfileProductRow> label="Performance by product" rows={rows} rowKey={(row) => row.product} pagination={false} density={isMobile ? 'compact' : undefined} width={isMobile ? 'fill' : undefined} columns={[
      { key: 'product', header: 'Product', cell: (row) => isMobile ? <span className={styles.cellStack}><strong>{row.label}</strong><span className={styles.subtle}>{row.bets == null ? 'No count' : `${count(row.bets)} bets`}</span></span> : <strong>{row.label}</strong>,
        footer: isMobile ? <span className={styles.cellStack}><strong>Total</strong><span className={styles.subtle}>{count(total.bets)} bets</span></span> : <strong>Total</strong> },
      { key: 'bets', header: 'Bets', align: 'right', hidden: isMobile, cell: (row) => row.bets == null ? '—' : count(row.bets), footer: count(total.bets) },
      { key: 'stake', header: 'Stake', align: 'right', cell: (row) => money(row.stake), footer: money(total.stake) },
      { key: 'open', header: 'Open stake', align: 'right', hidden: isMobile, cell: (row) => row.openStake ? money(row.openStake) : '—', footer: money(total.open) },
      { key: 'ggr', header: 'GGR', align: 'right', hidden: isMobile, cell: (row) => signed(row.ggr), footer: signed(total.ggr) },
      { key: 'pl', header: 'Player P/L', align: 'right', cell: (row) => <span className={tone(row.pl)}>{signed(row.pl)}</span>, footer: <span className={tone(total.pl)}>{signed(total.pl)}</span> },
      { key: 'share', header: 'Share of stake', minWidth: 170, hidden: isMobile, cell: (row) => <span className={styles.share}><Meter value={row.share} className={styles.shareMeter} /><span>{row.share}%</span></span> },
    ]} />}
  </Card>

  // Money in and out as one grid of figures (the header's wallet strip, two rows): the amount, then its count.
  const flow: Array<{ label: string; value: string; note: string }> = [
    { label: 'Deposits', value: money(kpis?.depositVolume), note: `${count(kpis?.depositCount)} txn` },
    { label: 'Withdrawals', value: money(kpis?.withdrawalVolume), note: `${count(kpis?.withdrawalCount)} txn` },
    { label: 'Net deposits', value: net(Number(kpis?.netDeposits ?? Number(kpis?.depositVolume || 0) - Number(kpis?.withdrawalVolume || 0))), note: 'In minus out, manual included' },
    { label: 'Manual deposits', value: money(kpis?.manualDepositVolume), note: `${count(kpis?.manualDepositCount)} txn` },
    { label: 'Manual withdrawals', value: money(kpis?.manualWithdrawalVolume), note: `${count(kpis?.manualWithdrawalCount)} txn` },
    { label: 'Lifetime deposits', value: money(kpis?.lifetimeValue), note: 'Since joining' },
  ]
  const moneyFlow = <Card title="Money flow" tools={link('Transactions', 'transactions')} body="flush">
    {pending ? <LoadingState height={150} label="Loading money flow" /> : <dl className={styles.figureGrid}>{flow.map((item) => <div key={item.label} className={styles.figureCell}>
      <dt className={styles.walletLabel}>{item.label}</dt>
      <dd className={styles.figureValue}>{item.value}</dd>
      <dd className={styles.figureNote}>{item.note}</dd>
    </div>)}</dl>}
  </Card>

  const wagering = kpis?.wageringCompletionPercent != null ? Math.max(0, Math.min(100, Number(kpis.wageringCompletionPercent))) : null
  const plBonus = Number(kpis?.plByWalletType?.bonus || 0)
  const plReferral = Number(kpis?.plByWalletType?.referralBonus || 0)
  const bonusReferral = <Card title="Bonus & referral" tools={link('Bonuses', 'bonuses')}>
    {pending ? <LoadingState height={CARD_HEIGHT} label="Loading bonus figures" /> : <div className={styles.cardSections}>
      <DescriptionListSection title="Bonus">
        <DescriptionList items={[
          { term: 'Wallet', value: money(profile.wallet?.bonus, canViewBonuses) },
          { term: 'Wagering', value: wagering == null ? 'No wagering due' : <span className={styles.share}><Meter value={wagering} className={styles.shareMeter} /><span>{wagering}%</span></span> },
          { term: 'Active bonuses', value: count(kpis?.activeBonusesCount) },
          { term: 'P/L', value: <span className={tone(plBonus, canViewBonuses)}>{signed(plBonus, canViewBonuses)}</span> },
          { term: 'Moved to cash', value: money(kpis?.bonusToCashTransfer, canViewBonuses) },
          { term: 'Bets', value: count(kpis?.settledBetCountByWalletType?.bonus) },
        ]} />
      </DescriptionListSection>
      <DescriptionListSection title="Referral">
        <DescriptionList items={[
          { term: 'Wallet', value: money(profile.wallet?.referralBonusBalance) },
          { term: 'P/L', value: <span className={tone(plReferral)}>{signed(plReferral)}</span> },
          { term: 'Moved to cash', value: money(kpis?.referralToCashTransfer) },
          { term: 'Bets', value: count(kpis?.settledBetCountByWalletType?.referralBonus) },
        ]} />
      </DescriptionListSection>
    </div>}
  </Card>

  const recentBets = <Card title="Recent bets" body="table" tools={link('All bets', 'bets')}>
    {pending ? <LoadingState height={CARD_HEIGHT} label="Loading recent bets" /> : <DataTable<ProfileActivityEntry> label="Recent bets" rows={bets} rowKey={(entry) => entry.id} pagination={false} density={isMobile ? 'compact' : undefined} width={isMobile ? 'fill' : undefined} empty="No bets in this period." columns={[
      // The time sits under the product, so the stake keeps its column on a phone.
      { key: 'bet', header: 'Bet', cell: (entry) => <span className={styles.cellStack}><strong>{entry.product ? PROFILE_PRODUCT_LABELS[entry.product as keyof typeof PROFILE_PRODUCT_LABELS] ?? titleCase(entry.product) : 'Bet'}</strong><span className={styles.subtle}>{when(entry.timestamp)}</span></span> },
      { key: 'status', header: 'Status', cell: (entry) => entry.status ? <StatusPill tone={betTone(entry.status)}>{titleCase(entry.status)}</StatusPill> : '—' },
      { key: 'stake', header: 'Stake', align: 'right', cell: (entry) => entry.amount == null ? '—' : money(entry.amount) },
    ]} />}
  </Card>

  const recentTransactions = <Card title="Recent transactions" body="table" tools={link('All transactions', 'transactions')}>
    {pending ? <LoadingState height={CARD_HEIGHT} label="Loading recent transactions" /> : <DataTable<ProfileActivityEntry> label="Recent transactions" rows={transactions} rowKey={(entry) => entry.id} pagination={false} density={isMobile ? 'compact' : undefined} width={isMobile ? 'fill' : undefined} empty="No deposits or withdrawals in this period." columns={[
      { key: 'transaction', header: 'Transaction', cell: (entry) => <span className={styles.cellStack}><strong>{entry.kind === 'deposit' ? 'Deposit' : 'Withdrawal'}</strong><span className={styles.subtle}>{when(entry.timestamp)}</span></span> },
      { key: 'method', header: 'Method', cell: (entry) => entry.method || '—' },
      { key: 'amount', header: 'Amount', align: 'right', cell: (entry) => entry.amount == null ? '—' : <span className={entry.kind === 'deposit' && canViewWallet ? styles.positive : undefined}>{entry.kind === 'deposit' ? '+' : '-'}{money(entry.amount)}</span> },
    ]} />}
  </Card>

  const kyc = [profile.kycStatus ? titleCase(profile.kycStatus) : null, profile.kycLevel != null && profile.kycLevel !== '' ? `level ${profile.kycLevel}` : null].filter(Boolean).join(' · ')
  const account = <Card title="Account">
    <DescriptionList items={[
      { term: 'Player type', value: profilePlayerType(profile.playerType) },
      { term: 'VIP tier', value: <span className={styles.inlineValue}>{profile.vipTierName ? <StatusPill tone="warn" icon={<IconStarFilled size={12} aria-hidden />}>{profile.vipTierName}</StatusPill> : 'No tier'}{link('VIP status', 'vip')}</span> },
      { term: 'KYC', value: kyc || '—' },
      { term: 'Risk', value: profile.riskType ? titleCase(profile.riskType) : '—' },
      { term: 'Currency', value: profile.wallet?.currency || '—' },
      { term: 'Joined', value: profile.createdAt ? formatDate(profile.createdAt, 'MMM d, yyyy') : '—' },
      { term: 'First deposit', value: profile.firstDeposit ? formatDate(profile.firstDeposit, 'MMM d, yyyy') : 'None yet' },
      { term: 'Last login', value: profile.lastLogin ? formatDateTime(profile.lastLogin, 'MMM d, yyyy h:mm a') : 'Never' },
      { term: 'Last bet', value: profile.lastBet ? formatDateTime(profile.lastBet, 'MMM d, yyyy h:mm a') : 'No bets yet' },
    ]} />
  </Card>

  const access = profile.access
  const limits = profile.limits
  const limit = (value: number | null | undefined) => value == null ? 'No limit' : formatAmount(Number(value))
  const maxBets: Array<[string, number | null | undefined]> = [['Sports', limits?.maxBetSports], ['Casino', limits?.maxBetCasino], ['Matka', limits?.maxBetMatka]]
  const allowed = (label: string, value: boolean | undefined) => <StatusPill key={label} tone={value === false ? 'neg' : value ? 'ok' : 'muted'}>{value === false ? `${label} off` : label}</StatusPill>
  const limitsCard = <Card title="Limits & access" tools={link('Responsible gaming', 'responsible-gaming')}>
    <DescriptionList items={[
      { term: 'Betting', value: <span className={styles.pills}>{PROFILE_PRODUCTS.map((product) => {
        const domain = access?.[product]
        const label = PROFILE_PRODUCT_LABELS[product]
        return <StatusPill key={product} tone={domain?.canBet ? 'ok' : domain?.visible ? 'warn' : 'muted'}>{domain?.canBet ? label : domain?.visible ? `${label} view only` : `${label} hidden`}</StatusPill>
      })}</span> },
      { term: 'Account', value: <span className={styles.pills}>{[allowed('Login', access?.canLogin), allowed('Deposit', access?.canDeposit), allowed('Withdraw', access?.canWithdraw), allowed('Bonus', access?.bonusEligible)]}</span> },
      { term: 'Max bet', value: maxBets.every(([, value]) => value == null) ? 'No limit' : <span className={styles.lines}>{maxBets.map(([label, value]) => <span key={label}>{label} {limit(value)}</span>)}</span> },
      { term: 'Stake limits', value: limits?.dailyStakeLimit == null && limits?.weeklyStakeLimit == null ? 'No limit' : <span className={styles.lines}><span>{limits?.dailyStakeLimit == null ? 'No daily limit' : `${limit(limits.dailyStakeLimit)} a day`}</span><span>{limits?.weeklyStakeLimit == null ? 'No weekly limit' : `${limit(limits.weeklyStakeLimit)} a week`}</span></span> },
      { term: 'Exposure cap', value: limit(limits?.exposureCapOverride) },
      { term: 'Bet cooldown', value: limits?.cooldownSeconds ? `${limits.cooldownSeconds}s` : 'None' },
    ]} />
  </Card>

  return <div className={styles.overview}>
    <div className={styles.overviewMain}>
      {head}
      {figures ? <>
        {products}
        {moneyFlow}
        <div className={styles.tablePair}>{recentBets}{recentTransactions}</div>
      </> : null}
      {!pending && profile.playerType === 'COMMISSION_AGENT_PLAYER' ? <AgentTransferHistory playerId={profile.id} /> : null}
    </div>
    <aside className={styles.overviewSide} aria-label="Player details">
      {account}
      {figures ? bonusReferral : null}
      {limitsCard}
    </aside>
  </div>
}
interface AgentTransfer { id: string; timestamp?: string; performedBy?: string; fromAgentId?: string; fromAgentUsername?: string; toAgentId?: string; toAgentUsername?: string; reason?: string }
function AgentTransferHistory({ playerId }: { playerId: string }) {
  const permissions = useAuthStore((state) => state.permissions)
  const canView = hasPermissionWithNested(permissions, 'players.move-agent', 'view')
  const { data, loading, error, refetch } = useQuery<{ playerAgentTransferHistory: AgentTransfer[] }>(TRANSFER_HISTORY_QUERY, { variables: { playerId: String(playerId), limit: 20 }, skip: !playerId || !canView, fetchPolicy: 'cache-and-network', errorPolicy: 'all' })
  if (!canView) return null
  const transfers = data?.playerAgentTransferHistory || []
  return <Card title="Agent Transfer History" sub="History of player moves between commission agents">
    {loading ? <div className={styles.loading} role="status"><Spinner /> Loading transfers…</div> : null}
    {error ? <Notice tone="error" title="Transfer history unavailable" action={<Button onClick={() => void refetch()}>Retry</Button>}>{error.message}</Notice> : null}
    {!loading && !error && !transfers.length ? <EmptyState title="No agent transfers recorded" /> : null}
    {!loading && transfers.length ? <ol className={styles.timeline}>{transfers.map((transfer) => <li key={transfer.id} className={styles.timelineItem}>
      <div className={styles.row}><StatusPill>{transfer.fromAgentUsername || transfer.fromAgentId}</StatusPill><span aria-label="to">→</span><StatusPill>{transfer.toAgentUsername || transfer.toAgentId}</StatusPill></div>
      {transfer.reason ? <p className={styles.text}>Reason: {transfer.reason}</p> : null}
      <p className={styles.subtle}>{transfer.timestamp ? new Date(transfer.timestamp).toLocaleString() : '—'}{transfer.performedBy ? ` by ${transfer.performedBy}` : ''}</p>
    </li>)}</ol> : null}
  </Card>
}
