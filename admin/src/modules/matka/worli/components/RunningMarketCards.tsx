import { IconCalendarX, IconClock, IconEye } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import { sessionCardFigures, sessionTone, type WorliInstance } from '../runningMarketsModel'
import styles from '../RunningMarketsPage.module.css'

export interface RunningMarketCardsProps {
  items: WorliInstance[]
  loading?: boolean
  /** Why the markets could not be loaded; shown with Retry when there is nothing else to show. */
  error?: string | null
  onRetry?: () => void
  onView: (id: string) => void
}

/* The card view: one tile per session (OPEN and CLOSE apart, not grouped like the table). The tiles are
   content inside the page's markets card, so they draw a quiet inset tile rather than a second card. */
export function RunningMarketCards({ items, loading, error, onRetry, onView }: RunningMarketCardsProps) {
  const { formatDate, formatTime } = useFormatDate()
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  if (error && items.length === 0) {
    return (
      <div className={styles.cardsState}>
        <Notice tone="error" live="polite" action={onRetry ? <Button size="sm" onClick={onRetry}>Retry</Button> : undefined}>
          {error}
        </Notice>
      </div>
    )
  }

  if (!loading && items.length === 0) {
    return (
      <EmptyState
        inset="none"
        title="No markets found"
        description="Try changing filters or date"
        icon={<IconCalendarX size={20} stroke={strokeFor(20)} />}
      />
    )
  }

  if (loading && items.length === 0) {
    return <LoadingState label="Loading Worli markets" minHeight={192} />
  }

  return (
    <ul className={styles.cardGrid} aria-label="Worli sessions">
      {items.map((r) => {
        const figures = sessionCardFigures(r)
        return (
          <li key={r.id} className={styles.sessionCard}>
            <div className={styles.sessionCardHead}>
              <div className={styles.sessionCardTitleBlock}>
                <h3 className={styles.sessionCardTitle} title={figures.name}>{figures.name}</h3>
                <p className={styles.sessionCardMeta}>
                  Date: {r.runDate ? formatDate(r.runDate) : '—'} • {r.side}
                </p>
              </div>
              <StatusPill tone={sessionTone(r.status)}>{r.status}</StatusPill>
            </div>
            <p className={styles.sessionCardTimes}>
              <span className={styles.sessionCardTime}>
                <IconClock size={12} stroke={strokeFor(12)} aria-hidden="true" />
                Lock time {r.scheduledLockAt ? formatTime(r.scheduledLockAt, 'HH:mm') : '--'}
              </span>
              <span aria-hidden="true">•</span>
              <span className={styles.sessionCardTime}>
                <IconClock size={12} stroke={strokeFor(12)} aria-hidden="true" />
                Close time {r.scheduledCloseAt ? formatTime(r.scheduledCloseAt, 'HH:mm') : '--'}
              </span>
            </p>
            <dl className={styles.sessionCardFigures}>
              <div className={styles.sessionCardFigure}>
                <dt>Bets</dt>
                <dd>{figures.bets}</dd>
              </div>
              <div className={styles.sessionCardFigure}>
                <dt>Exposure</dt>
                <dd>{formatAmount(convertFromWhitelabelCurrency(figures.exposure))}</dd>
              </div>
            </dl>
            <Button
              variant="primary"
              size="sm"
              block
              icon={<IconEye size={15} stroke={strokeFor(15)} />}
              onClick={() => onView(r.id)}
            >
              View Details
            </Button>
          </li>
        )
      })}
    </ul>
  )
}

