import React from 'react'
import { useQuery } from '@apollo/client'
import {
  IconBuildingStore,
  IconCashBanknote,
  IconChartBar,
  IconChartLine,
  IconCoins,
  IconInbox,
  IconInfoCircle,
  IconMinus,
  IconReceipt,
  IconTrendingDown,
  IconTrendingUp,
  IconUsers,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { PROVIDER_ANALYTICS, VENDOR_ANALYTICS } from '@/lib/graphql/casino'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Button } from '@/ui/components/Button'
import { DateRangeField } from '@/ui/components/DateRangeField'
import type { DateRangeApply } from '@/ui/components/DateRangePanel'
import { Drawer } from '@/ui/components/Drawer'
import { EmptyState } from '@/ui/components/EmptyState'
import { strokeFor } from '@/ui/components/icons'
import { istDayOf } from '@/ui/components/istDate'
import { ListRow } from '@/ui/components/ListRow'
import { LoadingState } from '@/ui/components/LoadingState'
import { Meter } from '@/ui/components/Meter'
import { Stat, type StatHue } from '@/ui/components/Stat'
import {
  ANALYTICS_CUSTOM,
  ANALYTICS_PRESETS,
  PROVIDER_GGR_TREND,
  PROVIDER_SHARE_TREND,
  analyticsDrawerTitle,
  avgBet,
  contributionPercent,
  deltaDirection,
  ggrTrend,
  playersFigure,
  presetRange,
  providerAnalyticsSummary,
  rangeLabel,
  rangeVariables,
  trendText,
  trendWord,
  vendorGgrTrend,
  vendorShareTrend,
  type AnalyticsMode,
  type AnalyticsRange,
  type FixedTrend,
  type Trend,
  type VendorBreakdownEntry,
} from '../providersPageModel'
import styles from '../ProvidersPage.module.css'

type Props = {
  open: boolean
  onClose: () => void
  mode?: AnalyticsMode | null
}

const CHIP_CLASS: Record<Trend, string | undefined> = {
  up: styles.chipUp,
  down: styles.chipDown,
  neutral: undefined,
}

/* A headline figure with the legacy trend badge. The badge figures are fixed in the legacy page (not computed);
   they are kept verbatim and listed for the owner. The kit states the direction in words. */
function MetricStat({
  label,
  value,
  subtitle,
  trend,
  icon,
  hue,
}: {
  label: string
  value: string
  subtitle: string
  trend: FixedTrend
  icon: React.ReactNode
  hue: StatHue
}) {
  return (
    <Stat
      label={label}
      value={value}
      icon={icon}
      hue={hue}
      size="compact"
      delta={{ value: trendText(trend), dir: deltaDirection(trend.direction), note: subtitle }}
    />
  )
}

function TrendChip({ trend }: { trend: Trend }) {
  return (
    <span className={clsx(styles.trendChip, CHIP_CLASS[trend])}>
      <span aria-hidden="true">
        {trend === 'up' ? (
          <IconTrendingUp size={12} stroke={strokeFor(12)} />
        ) : trend === 'down' ? (
          <IconTrendingDown size={12} stroke={strokeFor(12)} />
        ) : (
          <IconMinus size={12} stroke={strokeFor(12)} />
        )}
      </span>
      <span className={styles.srOnly}>{trendWord(trend)}</span>
    </span>
  )
}

const VendorBreakdownItem: React.FC<{
  vendor: VendorBreakdownEntry
  formatAmount: (val: number) => string
  convertFromWhitelabelCurrency: (val: number) => number
  totalGGR: number
}> = ({ vendor, formatAmount, convertFromWhitelabelCurrency, totalGGR }) => {
  const ggr = Number(vendor.ggr)
  const shareAmount = Number(vendor.shareAmount)
  const percentage = contributionPercent(ggr, totalGGR)

  return (
    <li className={styles.listItem}>
      <div className={styles.itemHead}>
        <span className={clsx(styles.tile, styles.tileVendor)} aria-hidden="true">
          <IconBuildingStore size={15} stroke={strokeFor(15)} />
        </span>
        <div className={styles.entityBody}>
          <span className={styles.entityName}>{vendor.vendorName}</span>
          <span className={styles.entitySub}>{vendor.transactionCount} transactions</span>
        </div>
        <TrendChip trend={ggrTrend(ggr)} />
      </div>

      <div className={styles.section}>
        <div className={styles.contribution}>
          <span>Contribution</span>
          <span className={styles.figure}>{percentage.toFixed(1)}%</span>
        </div>
        <Meter value={percentage} className={styles.meter} />
      </div>

      <dl className={clsx(styles.pairs, styles.pairsTwo)}>
        <div className={styles.pair}>
          <dt className={styles.pairTerm}>GGR</dt>
          <dd className={styles.pairValue}>{formatAmount(convertFromWhitelabelCurrency(ggr))}</dd>
        </div>
        <div className={styles.pair}>
          <dt className={styles.pairTerm}>Share Amount</dt>
          <dd className={clsx(styles.pairValue, styles.pairAccent)}>
            {formatAmount(convertFromWhitelabelCurrency(shareAmount))}
          </dd>
        </div>
      </dl>
    </li>
  )
}

export const AnalyticsDrawer: React.FC<Props> = ({ open, onClose, mode }) => {
  const breakdownId = React.useId()
  const detailsId = React.useId()
  // "Today" is fixed when the page opens, in IST, as the legacy drawer's was.
  const today = React.useMemo(() => istDayOf(new Date()), [])
  // The range outlives the drawer (it is kept between openings, as before); Today until another is applied.
  const [range, setRange] = React.useState<AnalyticsRange>(() => presetRange('1', today))

  const { start, end } = rangeVariables(range)
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const amount = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))

  const applyRange = (payload: DateRangeApply) => {
    if (payload.kind === 'custom') {
      setRange({ preset: ANALYTICS_CUSTOM, from: payload.from, to: payload.to })
    } else {
      setRange(presetRange(payload.preset, today))
    }
  }

  const providerQ = useQuery(PROVIDER_ANALYTICS, {
    variables: mode?.type === 'provider' ? { providerId: mode.providerId, start, end } : undefined,
    skip: mode?.type !== 'provider',
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  })
  const vendorQ = useQuery(VENDOR_ANALYTICS, {
    variables: mode?.type === 'vendor' ? { providerId: mode.providerId, vendorId: mode.vendorId, start, end } : undefined,
    skip: mode?.type !== 'vendor',
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  })

  let body: React.ReactNode = null

  if (!mode) {
    body = (
      <EmptyState
        title="Select a provider or vendor to view analytics"
        icon={<IconChartLine size={20} stroke={strokeFor(20)} />}
        inset="none"
      />
    )
  } else if (mode.type === 'provider') {
    const k = providerQ.data?.providerAnalytics
    const totalGGR: number = k?.totalGGR ?? 0
    const breakdown: VendorBreakdownEntry[] = k?.vendorBreakdown ?? []
    const summary = providerAnalyticsSummary(totalGGR, breakdown)

    body = providerQ.loading ? (
      <LoadingState label="Loading analytics..." minHeight={192} />
    ) : (
      <>
        <div className={styles.metrics}>
          <MetricStat
            label="Total GGR"
            value={amount(totalGGR)}
            subtitle="Gross Gaming Revenue"
            trend={PROVIDER_GGR_TREND}
            icon={<IconCoins size={16} stroke={strokeFor(16)} />}
            hue="grn"
          />
          <MetricStat
            label="Total Share Amount"
            value={amount(summary.totalShare)}
            subtitle="Your commission"
            trend={PROVIDER_SHARE_TREND}
            icon={<IconCashBanknote size={16} stroke={strokeFor(16)} />}
            hue="blu"
          />
        </div>

        <ul className={styles.figures}>
          <ListRow
            variant="stat"
            icon={<IconBuildingStore size={16} stroke={strokeFor(16)} />}
            label="Active Vendors"
            sub={`of ${breakdown.length} total`}
            value={summary.activeVendors}
          />
          <ListRow
            variant="stat"
            icon={<IconReceipt size={16} stroke={strokeFor(16)} />}
            label="Transactions"
            sub="today"
            value={summary.totalTransactions.toLocaleString()}
          />
          <ListRow
            variant="stat"
            icon={<IconChartBar size={16} stroke={strokeFor(16)} />}
            label="Avg/Vendor"
            sub="per vendor"
            value={amount(summary.avgPerVendor)}
          />
        </ul>

        <section className={styles.section} aria-labelledby={breakdownId}>
          <h3 id={breakdownId} className={styles.sectionTitle}>Vendor Performance Breakdown</h3>
          {breakdown.length > 0 ? (
            <ul className={styles.list}>
              {breakdown.map((v) => (
                <VendorBreakdownItem
                  key={v.vendorId}
                  vendor={v}
                  formatAmount={formatAmount}
                  convertFromWhitelabelCurrency={convertFromWhitelabelCurrency}
                  totalGGR={totalGGR}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No vendor data available"
              icon={<IconInbox size={20} stroke={strokeFor(20)} />}
              inset="none"
            />
          )}
        </section>
      </>
    )
  } else {
    const k = vendorQ.data?.vendorAnalytics
    const ggr: number = k?.ggr ?? 0
    const shareAmount: number = k?.shareAmount ?? 0
    const txCount: number = k?.transactionCount ?? 0

    body = vendorQ.loading ? (
      <LoadingState label="Loading analytics..." minHeight={192} />
    ) : (
      <>
        <div className={styles.metrics}>
          <MetricStat
            label="GGR"
            value={amount(ggr)}
            subtitle="Gross Gaming Revenue"
            trend={vendorGgrTrend(ggr)}
            icon={<IconCoins size={16} stroke={strokeFor(16)} />}
            hue="grn"
          />
          <MetricStat
            label="Your Share"
            value={amount(shareAmount)}
            subtitle="Commission amount"
            trend={vendorShareTrend(shareAmount)}
            icon={<IconCashBanknote size={16} stroke={strokeFor(16)} />}
            hue="blu"
          />
        </div>

        <ul className={styles.figures}>
          <ListRow
            variant="stat"
            icon={<IconReceipt size={16} stroke={strokeFor(16)} />}
            label="Transactions"
            sub="today"
            value={txCount.toLocaleString()}
          />
          <ListRow
            variant="stat"
            icon={<IconChartLine size={16} stroke={strokeFor(16)} />}
            label="Avg Bet"
            sub="per transaction"
            value={amount(avgBet(ggr, txCount))}
          />
          <ListRow
            variant="stat"
            icon={<IconUsers size={16} stroke={strokeFor(16)} />}
            label="Players"
            sub="distinct players not tracked"
            value={playersFigure(txCount)}
          />
        </ul>

        <section className={styles.section} aria-labelledby={detailsId}>
          <h3 id={detailsId} className={styles.sectionTitle}>Performance Details</h3>
          <p className={styles.sectionSub}>
            Win rate, retention and uptime require additional tracking; show when available.
          </p>
        </section>
      </>
    )
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={analyticsDrawerTitle(mode)}
      size="md"
      footer={(
        <div className={styles.drawerFooter}>
          <p className={styles.footerHint}>
            <IconInfoCircle size={15} stroke={strokeFor(15)} aria-hidden="true" />
            View real-time performance metrics and analytics
          </p>
          <div className={styles.footerActions}>
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    >
      <div className={styles.drawerBody}>
        <div className={styles.rangeRow}>
          <span className={styles.rangeCaption} aria-hidden="true">Date Range</span>
          <DateRangeField
            label="Date Range"
            presets={ANALYTICS_PRESETS}
            appliedPreset={range.preset}
            appliedFrom={range.from}
            appliedTo={range.to}
            customValue={ANALYTICS_CUSTOM}
            valueLabel={rangeLabel(range)}
            onApply={applyRange}
            onReset={() => setRange(presetRange('1', today))}
          />
        </div>
        {body}
      </div>
    </Drawer>
  )
}
