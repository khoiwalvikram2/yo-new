import {
  IconAlertCircle,
  IconAlertTriangle,
  IconChartLine,
  IconCircleCheck,
  IconPercentage,
  IconWallet,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { Grid } from '@/ui/components/LayoutPrimitives'
import { Meter } from '@/ui/components/Meter'
import { Notice } from '@/ui/components/Notice'
import { Skeleton } from '@/ui/components/Skeleton'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import {
  creditUsageFigures,
  formatCreditPercent,
  getCreditUsageStatus,
  type CreditUsageLevel,
  type WhitelabelCredit,
} from '../creditManagementModel'
import styles from '../CreditManagementPage.module.css'

const FIGURE_TONE_CLASS: Record<CreditUsageLevel, string> = {
  critical: styles.toneNeg,
  warning: styles.toneWarn,
  healthy: styles.toneOk,
}

/* The legacy banner icon followed the status: a triangle when critical, a circle when warning. */
function BannerIcon({ level }: { level: CreditUsageLevel }) {
  if (level === 'critical') return <IconAlertTriangle size={18} stroke={strokeFor(18)} />
  if (level === 'warning') return <IconAlertCircle size={18} stroke={strokeFor(18)} />
  return <IconCircleCheck size={18} stroke={strokeFor(18)} />
}

export interface CreditOverviewPanelProps {
  credit: WhitelabelCredit | null | undefined
  loading: boolean
}

/** The Overview tab: the near-limit banner, the four credit figures and the utilisation bar. */
export function CreditOverviewPanel({ credit, loading }: CreditOverviewPanelProps) {
  const { formatAmount } = useCurrency()
  // Until the first answer the figures and the bar hold their own height with placeholders.
  const pending = loading && !credit

  if (!pending && !credit) {
    return <Notice tone="error" icon={<IconAlertCircle size={18} stroke={strokeFor(18)} />} title="Unable to load credit information" />
  }

  const { usagePercentage, availablePercentage } = creditUsageFigures(credit ?? {})
  const status = getCreditUsageStatus(usagePercentage, credit?.creditAlertThreshold ?? 0)
  const usage = formatCreditPercent(usagePercentage)
  const available = formatCreditPercent(availablePercentage)

  return (
    <>
      {credit?.isNearLimit ? (
        <Notice
          tone={status.noticeTone}
          icon={<BannerIcon level={status.level} />}
          title="Credit Limit Warning"
        >
          You are using {usage}% of your credit limit.
        </Notice>
      ) : null}

      <Grid cols={{ base: 1, md: 2 }} gap={12} aria-label="Credit figures" aria-busy={pending || undefined}>
        <Stat
          label="Credit Limit"
          value={formatAmount(credit?.creditLimit ?? 0)}
          note="Total allocated credit"
          icon={<IconWallet size={18} stroke={strokeFor(18)} />}
          hue="blu"
          loading={pending}
        />
        <Stat
          label="Credit Used"
          value={formatAmount(credit?.creditUsed ?? 0)}
          note={`${usage}% of limit`}
          icon={<IconChartLine size={18} stroke={strokeFor(18)} />}
          hue="red"
          loading={pending}
        />
        <Stat
          label="Available Credit"
          value={formatAmount(credit?.creditAvailable ?? 0)}
          note={`${available}% remaining`}
          icon={<IconCircleCheck size={18} stroke={strokeFor(18)} />}
          hue="grn"
          loading={pending}
        />
        <Stat
          label="Usage Status"
          value={`${usage}%`}
          note={(
            <>
              {/* while pending the pill keeps its height but claims no status */}
              <StatusPill tone={status.pillTone}>{pending ? ' ' : status.label}</StatusPill>
              {' '}
              Threshold: {credit?.creditAlertThreshold}%
            </>
          )}
          icon={<IconPercentage size={18} stroke={strokeFor(18)} />}
          hue="vio"
          loading={pending}
        />
      </Grid>

      <Card
        title="Credit Utilization"
        sub={pending ? <Skeleton width={96} height={10} /> : `${available}% available`}
        tools={<span className={clsx(styles.usedFigure, FIGURE_TONE_CLASS[status.level])}>{pending ? <Skeleton width={56} height={10} /> : `${usage}% used`}</span>}
        aria-busy={pending || undefined}
      >
        <Meter value={usagePercentage} tone={status.meterTone} />
        <p className={styles.scale}>
          <span>0%</span>
          <span>Alert Threshold: {pending ? <Skeleton width={28} height={10} /> : `${credit?.creditAlertThreshold}%`}</span>
          <span>100%</span>
        </p>
      </Card>
    </>
  )
}
