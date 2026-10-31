import {
  IconAlertCircleFilled,
  IconAlertTriangle,
  IconCalendar,
  IconCircleCheck,
  IconCircleCheckFilled,
  IconClock,
} from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Notice } from '@/ui/components/Notice'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import {
  ERRORS_NOTE,
  formatLastJobComplete,
  formatNextRunLocal,
  lastJobNote,
  missingDaysNote,
  nextRunNote,
  pipelineStatus,
  summaryHues,
  type SnapshotHealthSummary,
} from '../snapshotHealthModel'
import styles from '../SnapshotHealthPage.module.css'

export type { SnapshotHealthSummary } from '../snapshotHealthModel'

export function SnapshotHealthSummaryCards({
  summary,
  loading,
  error,
  onRetry,
}: {
  summary?: SnapshotHealthSummary | null
  loading: boolean
  /** The summary query's failure; shown only when there is no summary to show. */
  error?: string | null
  onRetry?: () => void
}) {
  // Until the first answer the card keeps its layout; the hidden notes are fillers shaped like the loaded ones.
  if (loading && !summary) {
    return (
      <Card title="Pipeline status" aria-busy="true">
        <div className={styles.statsFrame}>
          <div className={styles.statGrid}>
            <Stat variant="bare" label="Next daily run (local)" value={null} icon={<IconCalendar size={18} stroke={strokeFor(18)} />} hue="blu" note="TZ · cron local" loading />
            <Stat variant="bare" label="Errors (24h)" value={null} icon={<IconAlertTriangle size={18} stroke={strokeFor(18)} />} hue="ind" note={ERRORS_NOTE} loading />
            <Stat variant="bare" label="Missing snapshot days" value={null} icon={<IconClock size={18} stroke={strokeFor(18)} />} hue="ind" note="Lookback · daily window" loading />
            <Stat variant="bare" label="Last job complete" value={null} icon={<IconCircleCheck size={18} stroke={strokeFor(18)} />} hue="grn" note="Health cron" loading />
          </div>
        </div>
      </Card>
    )
  }

  if (!summary) {
    if (!error) return null
    return (
      <Notice
        tone="error"
        icon={<IconAlertTriangle size={18} stroke={strokeFor(18)} />}
        title="Pipeline status could not be loaded"
        action={onRetry ? <Button size="sm" onClick={onRetry}>Retry</Button> : undefined}
      >
        {error}
      </Notice>
    )
  }

  const status = pipelineStatus(summary)
  const hues = summaryHues(summary)

  return (
    <Card
      title="Pipeline status"
      tools={(
        <StatusPill
          tone={status.tone}
          icon={status.key === 'healthy'
            ? <IconCircleCheckFilled size={13} />
            : <IconAlertCircleFilled size={13} />}
        >
          {status.label}
        </StatusPill>
      )}
    >
      <div className={styles.statsFrame}>
        <div className={styles.statGrid}>
          <Stat
            variant="bare"
            label="Next daily run (local)"
            value={formatNextRunLocal(summary.nextRunAtIso, summary.snapshotTimezone)}
            icon={<IconCalendar size={18} stroke={strokeFor(18)} />}
            hue={hues.nextRun}
            note={nextRunNote(summary)}
          />
          <Stat
            variant="bare"
            label="Errors (24h)"
            value={summary.errorsLast24h}
            icon={<IconAlertTriangle size={18} stroke={strokeFor(18)} />}
            hue={hues.errors}
            note={ERRORS_NOTE}
          />
          <Stat
            variant="bare"
            label="Missing snapshot days"
            value={summary.missingDaysCount}
            icon={<IconClock size={18} stroke={strokeFor(18)} />}
            hue={hues.missing}
            note={missingDaysNote(summary)}
          />
          <Stat
            variant="bare"
            label="Last job complete"
            value={formatLastJobComplete(summary.lastJobCompleteAt)}
            icon={<IconCircleCheck size={18} stroke={strokeFor(18)} />}
            hue={hues.lastJob}
            note={lastJobNote(summary)}
          />
        </div>
      </div>
    </Card>
  )
}
