import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { IconChartBar, IconClock, IconEye, IconFlame } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { LoadingState } from '@/ui/components/LoadingState'
import { Meter } from '@/ui/components/Meter'
import { Notice } from '@/ui/components/Notice'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import { EventSportIcon } from './EventSportIcon'
import { EventFavoriteButton, EventsEmpty } from './EventsTable'
import {
  cardStartTag,
  cardStatusPill,
  eventDetailPath,
  formatCompactAmount,
  formatTimeSince,
  liquidityHealth,
  type SportsEvent,
} from '../eventsPageModel'
import styles from '../EventsPage.module.css'

/* The card's call to action, the full-width primary button (kit Button primary sm, block). */
const VIEW_DETAILS_CLASS = clsx(buttonClassName({ variant: 'primary', size: 'sm', block: true }), styles.viewLink)

interface EventCardsProps {
  events: SportsEvent[]
  loading?: boolean
  /** The list query's error message: the cards say so and offer Retry. */
  error?: string
  onRetry?: () => void
}

/** The cards view: one tile per filtered event, every event at once (the cards never paged). */
export function EventCards({ events, loading = false, error, onRetry }: EventCardsProps) {
  const { formatDate, formatDateTime } = useFormatDate()
  const { formatAmount, convertFromWhitelabelCurrency, getCurrencySymbol } = useCurrency()
  const now = Date.now()

  // The display currency, with the legacy K and M short forms.
  const formatCurrency = (value: number) =>
    formatCompactAmount(convertFromWhitelabelCurrency(value), getCurrencySymbol(), formatAmount)

  const errorNotice =
    error && !loading ? (
      <Notice
        tone="error"
        live="polite"
        action={
          onRetry ? (
            <Button size="sm" variant="danger" onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      >
        {error}
      </Notice>
    ) : null

  if (errorNotice && events.length === 0) {
    return <div className={styles.cardsState}>{errorNotice}</div>
  }

  if (!loading && events.length === 0) {
    return <EventsEmpty />
  }

  if (loading && events.length === 0) {
    return <LoadingState label="Loading Events" />
  }

  return (
    <div className={styles.cardsFrame}>
      {errorNotice}
      <ul className={styles.cardsGrid} aria-label="Events">
        {events.map((event) => {
          const tag = cardStartTag(event, now)
          const status = cardStatusPill(event.status)
          const health = liquidityHealth(event.totalLiquidity, event.matchedVolume || 0)
          return (
            <li key={event.id} className={styles.eventTile}>
              <div className={styles.tileHead}>
                <span className={styles.tileIcon}>
                  <EventSportIcon sport={event.sport} size="lg" />
                  {event.inPlay ? <span className={styles.tileLiveDot} aria-hidden="true" /> : null}
                </span>
                <div className={styles.tileText}>
                  <div className={styles.tileTitleRow}>
                    <h3 className={styles.tileTitle}>
                      <Link to={eventDetailPath(event.id)} className={styles.tileLink} title={event.name}>
                        {event.name}
                      </Link>
                    </h3>
                    <EventFavoriteButton event={event} tooltip="short" />
                  </div>
                  <div className={styles.eventMeta}>
                    <span className={styles.eventSport}>{event.sport}</span>
                    <span className={styles.metaDot} aria-hidden="true">•</span>
                    <span className={styles.eventCompetition}>{event.competition}</span>
                  </div>
                </div>
              </div>

              <div className={styles.tileStatusRow}>
                {event.inPlay ? (
                  <span className={styles.liveNow}>
                    <span className={styles.liveNowDot} aria-hidden="true" />
                    Live Now
                  </span>
                ) : (
                  <span className={styles.tileStart}>
                    <IconClock size={12} stroke={strokeFor(12)} aria-hidden="true" />
                    {formatDateTime(event.startTime, 'MMM d, HH:mm')}
                  </span>
                )}
                <span className={clsx(styles.tag, tag.soon && styles.tagSoon)}>
                  {tag.soon ? <IconFlame size={12} stroke={strokeFor(12)} aria-hidden="true" /> : null}
                  {tag.label}
                </span>
              </div>

              <div className={styles.tileFacts}>
                <div className={styles.tileFact}>
                  <span className={styles.factLabel}>
                    <IconChartBar size={12} stroke={strokeFor(12)} aria-hidden="true" />
                    Markets
                  </span>
                  <span className={styles.marketCount}>{event.marketCount}</span>
                </div>
                <div className={styles.tileFact}>
                  <span className={styles.factLabel}>Status</span>
                  <span>
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  </span>
                </div>
                {event.lastBetAt ? (
                  <div className={clsx(styles.tileFact, styles.tileFactRow)}>
                    <span className={styles.factLabel}>
                      <IconClock size={12} stroke={strokeFor(12)} aria-hidden="true" />
                      Last Bet
                    </span>
                    <span className={styles.lastBet}>
                      {formatTimeSince(event.lastBetAt, now, (instant) => formatDate(instant, 'MMM d'))}
                    </span>
                  </div>
                ) : null}
                <div className={clsx(styles.tileFact, styles.tileFactWide)}>
                  <div className={styles.factLine}>
                    <span className={styles.factLabel}>Liability</span>
                    <span className={styles.liability}>{formatCurrency(event.totalLiquidity)}</span>
                  </div>
                  <Meter
                    className={styles.tileMeter}
                    value={health.percent}
                    tone={health.tone}
                    label="Liquidity health"
                  />
                  {event.betsCount !== undefined && event.betsCount !== null ? (
                    <div className={clsx(styles.factLine, styles.factLineRule)}>
                      <span className={styles.factLabel}>Total Bets</span>
                      <span className={styles.strong}>{event.betsCount.toLocaleString()}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <Link to={eventDetailPath(event.id)} className={VIEW_DETAILS_CLASS} aria-label={`View details for ${event.name}`}>
                <IconEye size={14} stroke={strokeFor(14)} aria-hidden="true" />
                View Details
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

