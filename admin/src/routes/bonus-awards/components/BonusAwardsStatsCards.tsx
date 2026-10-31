import { useId, useMemo, type ReactNode } from 'react'
import { useQuery } from '@apollo/client'
import {
  IconAlertCircle,
  IconArrowsExchange,
  IconBan,
  IconBolt,
  IconCash,
  IconChartBar,
  IconChartLine,
  IconChartPie,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconFlag,
  IconGift,
  IconHourglass,
  IconInfoCircle,
  IconTrendingUp,
  IconTrophy,
  IconUser,
  IconWallet,
} from '@tabler/icons-react'
import {
  BONUS_AWARDS_PAGE_STATS_QUERY,
  BONUS_KPIS_QUERY,
  type BonusAwardsPageFiltersInput,
} from '@/lib/graphql/bonusAwardsPage'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { strokeFor } from '@/ui/components/icons'
import { Notice } from '@/ui/components/Notice'
import { Stat } from '@/ui/components/Stat'
import { buildCardStats, buildLedgerStats, type BonusStatDef } from '../bonusAwardsModel'
import styles from '../BonusAwardsListPage.module.css'

const TILE = 18
const NOTICE = 16

/* The legacy Ant icons, each replaced by the Tabler glyph of the same meaning. Decorative. */
const STAT_ICONS: Record<string, ReactNode> = {
  bonusRevenue: <IconChartLine size={TILE} stroke={strokeFor(TILE)} />,
  bonusWagering: <IconChartBar size={TILE} stroke={strokeFor(TILE)} />,
  totalIssued: <IconGift size={TILE} stroke={strokeFor(TILE)} />,
  totalRedeemedLedger: <IconCircleCheck size={TILE} stroke={strokeFor(TILE)} />,
  outstandingLiability: <IconAlertCircle size={TILE} stroke={strokeFor(TILE)} />,
  bonusRoi: <IconTrophy size={TILE} stroke={strokeFor(TILE)} />,
  totalExpired: <IconHourglass size={TILE} stroke={strokeFor(TILE)} />,
  totalCancelledLedger: <IconCircleX size={TILE} stroke={strokeFor(TILE)} />,
  awardRedemptionCounts: <IconChartPie size={TILE} stroke={strokeFor(TILE)} />,
  ledgerPlayerCount: <IconUser size={TILE} stroke={strokeFor(TILE)} />,
  totalBonusPaid: <IconCash size={TILE} stroke={strokeFor(TILE)} />,
  bonusWallet: <IconWallet size={TILE} stroke={strokeFor(TILE)} />,
  wageringRemaining: <IconFlag size={TILE} stroke={strokeFor(TILE)} />,
  bonusToCash: <IconArrowsExchange size={TILE} stroke={strokeFor(TILE)} />,
  bonusUses: <IconTrendingUp size={TILE} stroke={strokeFor(TILE)} />,
  total: <IconGift size={TILE} stroke={strokeFor(TILE)} />,
  pending: <IconClock size={TILE} stroke={strokeFor(TILE)} />,
  active: <IconBolt size={TILE} stroke={strokeFor(TILE)} />,
  completed: <IconCircleCheck size={TILE} stroke={strokeFor(TILE)} />,
  expired: <IconHourglass size={TILE} stroke={strokeFor(TILE)} />,
  cancelled: <IconBan size={TILE} stroke={strokeFor(TILE)} />,
}

/** One legacy stat group: its caption is the group's h2. */
function StatSection({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId()
  return (
    <section className={styles.statSection} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.statSectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function StatTiles({ stats, loading = false }: { stats: readonly BonusStatDef[]; loading?: boolean }) {
  return (
    <div className={styles.statGrid} aria-busy={loading || undefined}>
      {stats.map((stat) => (
        <Stat
          key={stat.key}
          label={stat.label}
          value={stat.value}
          note={stat.note}
          hue={stat.hue}
          icon={STAT_ICONS[stat.key]}
          loading={loading}
        />
      ))}
    </div>
  )
}

export type BonusAwardsStatsCardsProps = {
  /** Same filters as the table — stats cover the full filtered set, not only the current page. */
  filters: BonusAwardsPageFiltersInput
  /** When true, ledger KPIs are hidden — they are whitelabel-wide; card stats below stay downline-scoped. */
  isAgent?: boolean
}

export function BonusAwardsStatsCards({ filters, isAgent = false }: BonusAwardsStatsCardsProps) {
  const { formatAmount, getWhitelabelBaseCurrencyCode } = useCurrency()
  const displayCurrency = getWhitelabelBaseCurrencyCode()

  const variables = useMemo(() => ({ filters }), [filters])
  const { data, loading } = useQuery(BONUS_AWARDS_PAGE_STATS_QUERY, {
    variables,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  const bonusKpiFilter = useMemo(
    () => ({
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      currency: displayCurrency,
      ...(filters.campaignId != null ? { campaignId: String(filters.campaignId) } : {}),
      ...(filters.domain?.trim() ? { domain: filters.domain.trim() } : {}),
    }),
    [filters.dateFrom, filters.dateTo, filters.campaignId, filters.domain, displayCurrency],
  )

  const { data: kpiData, loading: kpiLoading, error: kpiError } = useQuery(BONUS_KPIS_QUERY, {
    variables: { filter: bonusKpiFilter },
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
    skip: isAgent,
  })

  const s = data?.bonusAwardsPageStats
  const k = kpiData?.bonusKPIs

  // The tiles are static metadata, so both groups keep their full height with placeholders until they answer.
  const cardsPending = loading && !data
  const ledgerPending = kpiLoading && !kpiData

  const ledgerStats = buildLedgerStats(k, formatAmount, displayCurrency)
  const cardStats = buildCardStats(s, formatAmount, displayCurrency)

  return (
    <div className={styles.stats}>
      <StatSection title="Period metrics (whitelabel-wide, awarded in range)">
        {isAgent ? (
          <Notice
            tone="info"
            icon={<IconInfoCircle size={NOTICE} stroke={strokeFor(NOTICE)} />}
            title="Whitelabel ledger KPIs are hidden for agent login"
          >
            These metrics aggregate all bonus awards for the whole whitelabel. The section below reflects your
            downline bonus cards only.
          </Notice>
        ) : kpiError ? (
          <Notice
            tone="error"
            live="polite"
            icon={<IconAlertCircle size={NOTICE} stroke={strokeFor(NOTICE)} />}
            title="Could not load ledger KPIs"
          >
            {kpiError.message}
          </Notice>
        ) : (
          <StatTiles stats={ledgerStats} loading={ledgerPending} />
        )}
      </StatSection>

      <StatSection title="Bonus cards (filtered list scope)">
        <StatTiles stats={cardStats} loading={cardsPending} />
      </StatSection>
    </div>
  )
}
