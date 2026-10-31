import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useBreakpoint } from '@/shared/hooks/useBreakpoint'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable } from '@/ui/components/DataTable'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { Meter } from '@/ui/components/Meter'
import { StatusPill } from '@/ui/components/StatusPill'
import { AgentKpiGrid, type ProfileStatsPeriod } from './AgentKpiGrid'
import { profileLevelNames, profileSchemeLabels, profileSchemeNotes, type ProfileAgent, type ProfileStats } from './agentProfileModel'
import styles from './AgentProfileComponents.module.css'

interface OverviewTabProps {
  agent: ProfileAgent
  stats: ProfileStats | null | undefined
  statsLoading: boolean
  /** The stats request failed: the page shows its retry; the Overview keeps the agent's own facts. */
  statsFailed?: boolean
  period: ProfileStatsPeriod
  onPresetChange: (preset: string) => void
  onCustomRange: (from: string | null, to: string | null) => void
  onRetryStats: () => void
  onTabChange: (tab: string) => void
  hasSubAgents: boolean
}

const PRODUCTS = ['sports', 'casino', 'matka'] as const
type Product = typeof PRODUCTS[number]
interface ProductRow { product: Product; label: string; allowed: boolean; ggr: number; pl: number; rate: number | null }
const domainName = (domain: string) => domain.charAt(0).toUpperCase() + domain.slice(1)
// Placeholders hold each card's height until the stats answer, so the page does not jump.
const CARD_HEIGHT = 200

/**
 * The Overview (2026-10-28 redesign, the approved agent-profile mockup): the period's figures on the left
 * (headline KPIs, each product, downline money), the agent's setup and network on the right. Everything comes
 * from the profile and dashboard-stats queries: no other tab's data loads here.
 */
export function OverviewTab({ agent, stats, statsLoading, statsFailed, period, onPresetChange, onCustomRange, onRetryStats, onTabChange, hasSubAgents }: OverviewTabProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatDateTime } = useFormatDate()
  const pending = statsLoading && !stats
  // On a phone the products table keeps the two money columns; the rates have their own card.
  const { isMobile } = useBreakpoint()
  const safe = (n: number) => (Number.isFinite(n) ? n : 0)
  const money = (value: number | undefined) => safe(convertFromWhitelabelCurrency(Number(value ?? 0)))
  const count = (value: number | undefined) => Number(value ?? 0).toLocaleString('en-IN')
  const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '-' : '') + formatAmount(Math.abs(v))
  const tone = (v: number) => v > 0 ? styles.positive : v < 0 ? styles.negative : undefined
  const link = (label: string, tab: string) => <Button variant="link" size="sm" onClick={() => onTabChange(tab)}>{label}</Button>

  const isCommission = agent.schemeType === 'COMMISSION'
  const isCredit = agent.schemeType === 'CREDIT'
  const domains = agent.allowedDomains ?? []
  const rates = isCommission ? agent.commissionRates : agent.sharingRates
  const rateOf = (domain: string) => { const rate = rates?.find(item => item.domain === domain)?.rate; return typeof rate === 'number' ? rate : null }
  const showRates = domains.length > 0 && Boolean(rates?.length)

  const rows: ProductRow[] = PRODUCTS.map(product => ({
    product, label: domainName(product), allowed: domains.includes(product),
    ggr: money(stats?.[`${product}Ggr`]), pl: money(stats?.[`${product}Pl`]), rate: rateOf(product),
  }))
  const totalGgr = rows.reduce((sum, row) => sum + row.ggr, 0)
  const totalPl = rows.reduce((sum, row) => sum + row.pl, 0)

  const head = !stats && !statsLoading
    ? statsFailed ? null : <EmptyState title="No stats available" description="Check the date range or try again." action={<Button size="sm" onClick={onRetryStats}>Retry stats</Button>} />
    : <AgentKpiGrid stats={stats} loading={pending} period={period} onPresetChange={onPresetChange} onCustomRange={onCustomRange} />

  const products = <Card title="Performance by product" sub="GGR and players' P/L in the period" body="table">
    {pending ? <LoadingState height={CARD_HEIGHT} label="Loading product figures" /> : <DataTable<ProductRow> label="Performance by product" rows={rows} rowKey={row => row.product} pagination={false} density={isMobile ? 'compact' : undefined} width={isMobile ? 'fill' : undefined} columns={[
      { key: 'product', header: 'Product', cell: row => <span className={styles.inlineValue}><strong>{row.label}</strong>{row.allowed ? null : <StatusPill tone="muted">Off</StatusPill>}</span>, footer: <strong>Total</strong> },
      { key: 'ggr', header: 'GGR', align: 'right', cell: row => signed(row.ggr), footer: signed(totalGgr) },
      { key: 'pl', header: "Players' P/L", align: 'right', cell: row => <span className={tone(row.pl)}>{signed(row.pl)}</span>, footer: <span className={tone(totalPl)}>{signed(totalPl)}</span> },
      ...(showRates ? [{ key: 'rate', header: isCommission ? 'Commission rate' : 'Sharing rate', align: 'right' as const, hidden: isMobile, cell: (row: ProductRow) => row.allowed && row.rate != null ? `${row.rate.toFixed(2)}%` : '—' }] : []),
    ]} />}
  </Card>

  const flow: Array<{ label: string; value: number; note: string }> = [
    { label: 'Deposits', value: money(stats?.totalDeposits), note: 'All players' },
    { label: 'Withdrawals', value: money(stats?.totalWithdrawals), note: 'All players' },
    { label: 'Direct deposits', value: money(stats?.directDeposits), note: "This agent's own players" },
    { label: 'Direct withdrawals', value: money(stats?.directWithdrawals), note: "This agent's own players" },
    { label: 'Manual deposits', value: money(stats?.manualDeposits), note: 'Added by an operator' },
    { label: 'Manual withdrawals', value: money(stats?.manualWithdrawals), note: 'Taken by an operator' },
  ]
  const downline = <Card title="Downline money" sub="Money in and out of the agent's players in the period" body="flush">
    {pending ? <LoadingState height={150} label="Loading downline money" /> : <dl className={styles.figureGrid}>{flow.map(item => <div key={item.label} className={styles.figureCell}>
      <dt className={styles.stripLabel}>{item.label}</dt>
      <dd className={styles.figureValue}>{formatAmount(item.value)}</dd>
      <dd className={styles.stripNote}>{item.note}</dd>
    </div>)}</dl>}
  </Card>

  const details = <Card title="Agent details">
    <DescriptionList items={[
      { term: 'Scheme', value: <span className={styles.rowDetails}><StatusPill tone="info">{profileSchemeLabels[agent.schemeType] || 'Unknown'}</StatusPill><span className={styles.muted}>{profileSchemeNotes[agent.schemeType] || ''}</span></span> },
      { term: 'Level', value: agent.levelIndex ? `L${agent.levelIndex} · ${profileLevelNames[agent.levelIndex] || `Level ${agent.levelIndex}`}` : 'No level assigned' },
      { term: 'Position', value: agent.parentAgentId ? 'Under a parent agent' : 'Top level' },
      { term: 'Domains', value: domains.length ? <span className={styles.pills}>{domains.map(domain => <StatusPill key={domain} tone="ok">{domainName(domain)}</StatusPill>)}</span> : 'None' },
      { term: 'Tally', value: agent.tallyEnabled ? `On${agent.tallyDomains?.length ? ` · ${agent.tallyDomains.map(domainName).join(', ')}` : ''}` : 'Off' },
      { term: 'Created', value: agent.createdAt ? formatDateTime(agent.createdAt, "MMM d, yyyy 'at' HH:mm") : '—' },
      { term: 'Agent ID', value: <span className={styles.mono}>{agent.id}</span> },
      { term: 'Tenant', value: agent.tenantId || '—' },
    ]} />
  </Card>

  const rateCard = showRates ? <Card title={isCommission ? 'Commission rates' : 'Sharing rates'} body="flush" tools={isCommission ? link('Commission', 'commission') : !isCredit ? link('Sharing', 'sharing') : null}>
    <div className={styles.rateTiles}>{domains.map(domain => { const rate = rateOf(domain); return <div key={domain} className={styles.figureCell}>
      <span className={styles.stripLabel}>{domainName(domain)}</span>
      <strong className={styles.figureValue}>{rate != null ? `${rate.toFixed(2)}%` : '—'}</strong>
    </div> })}</div>
  </Card> : null

  const creditLimit = Number(agent.creditLimit || 0)
  const creditUsed = Number(agent.creditUsed || 0)
  const usedShare = creditLimit > 0 ? Math.min(100, Math.round((creditUsed / creditLimit) * 100)) : 0
  const creditCard = isCredit ? <Card title="Credit" tools={link('Credit', 'credit')}>
    <DescriptionList items={[
      { term: 'Limit', value: formatAmount(creditLimit) },
      { term: 'Used', value: <span className={styles.share}><Meter value={usedShare} tone={usedShare > 80 ? 'warn' : 'acc'} className={styles.shareMeter} /><span>{usedShare}%</span></span> },
      { term: 'Available', value: formatAmount(Number(agent.creditAvailable || 0)) },
      { term: 'Alert at', value: agent.creditAlertThreshold != null ? `${agent.creditAlertThreshold}% used` : 'Not set' },
    ]} />
  </Card> : null

  const network = <Card title="Network" tools={<span className={styles.inlineValue}>{link('Players', 'players')}{hasSubAgents ? link('Sub-Agents', 'sub-agents') : null}</span>}>
    {pending ? <LoadingState height={CARD_HEIGHT} label="Loading network" /> : <DescriptionList items={[
      { term: 'Players', value: stats ? count(stats.totalPlayers) : '—' },
      { term: 'Direct', value: stats ? count(stats.directPlayerCount) : '—' },
      { term: 'Under sub-agents', value: stats ? count(stats.subAgentPlayerCount) : '—' },
      { term: 'Active (24h)', value: stats ? count(stats.activePlayers24h) : '—' },
      { term: 'New today', value: stats ? count(stats.newPlayersToday) : '—' },
      { term: 'Sub-agents', value: stats ? count(stats.totalSubAgents) : '—' },
      ...(isCredit ? [
        { term: 'Downline balance', value: stats ? formatAmount(money(stats.totalDownlineBalance)) : '—' },
        { term: 'Downline exposure', value: stats ? formatAmount(money(stats.totalDownlineExposure)) : '—' },
      ] : []),
    ]} />}
  </Card>

  return <div className={styles.overview}>
    <div className={styles.overviewMain}>
      {head}
      {stats || pending ? <>{products}{downline}</> : null}
    </div>
    <aside className={styles.overviewSide} aria-label="Agent details">
      {details}
      {rateCard}
      {creditCard}
      {network}
    </aside>
  </div>
}
