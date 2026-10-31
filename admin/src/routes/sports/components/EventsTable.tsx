import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { IconCalendarX, IconEye, IconFlame, IconStar, IconStarFilled } from '@tabler/icons-react'
import { useSportsEventsStore } from '@/state/sportsEventsStore'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { Pagination } from '@/ui/components/Pagination'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tooltip } from '@/ui/components/Tooltip'
import { strokeFor } from '@/ui/components/icons'
import { EventSportIcon } from './EventSportIcon'
import {
  DEFAULT_EVENT_PAGE_SIZE,
  EVENT_PAGE_SIZES,
  clampEventsPage,
  eventBetsLabel,
  eventDetailPath,
  eventStartTag,
  eventStatusBadge,
  formatCompactAmount,
  formatTimeSince,
  marketLevel,
  pageOfEvents,
  type SportsEvent,
} from '../eventsPageModel'
import styles from '../EventsPage.module.css'

export type { SportsEvent }

/* The row's View link wears the row-action button (.act M:1035-1042, kit Button xs). */
const VIEW_LINK_CLASS = clsx(buttonClassName({ variant: 'secondary', size: 'xs' }), styles.viewLink)

interface EventFavoriteButtonProps {
  event: SportsEvent
  /** The table's tooltip says "Add to favorites"; the cards' said only "Add". @default 'long' */
  tooltip?: 'long' | 'short'
  /** The table's bordered tile; the cards use the plain glyph button. @default false */
  bordered?: boolean
}

/** Adds the event to, or removes it from, the saved favourites the Favorite quick filter reads. */
export function EventFavoriteButton({ event, tooltip = 'long', bordered = false }: EventFavoriteButtonProps) {
  const { isFavorite, toggleFavorite } = useSportsEventsStore()
  const favorite = isFavorite(event.id)
  const tip =
    tooltip === 'short'
      ? favorite ? 'Remove' : 'Add'
      : favorite ? 'Remove from favorites' : 'Add to favorites'
  return (
    <Tooltip content={tip}>
      <IconButton
        size="sm"
        variant={bordered ? 'bordered' : 'plain'}
        className={clsx(styles.favorite, favorite && styles.favoriteOn)}
        label={favorite ? `Remove ${event.name} from favorites` : `Add ${event.name} to favorites`}
        icon={
          favorite ? (
            <IconStarFilled size={14} />
          ) : (
            <IconStar size={14} stroke={strokeFor(14)} />
          )
        }
        onClick={(clickEvent) => {
          clickEvent.stopPropagation()
          toggleFavorite(event.id)
        }}
      />
    </Tooltip>
  )
}

/** The legacy empty state, shared by the table and the cards. */
export function EventsEmpty() {
  return (
    <EmptyState
      title="No events found"
      description="Try adjusting your filters or search query"
      icon={<IconCalendarX size={20} stroke={strokeFor(20)} />}
    />
  )
}

/** The name opens the event; a live event carries the mockup's live dot (.live i M:869) beside it. */
function EventCell({ event }: { event: SportsEvent }) {
  return (
    <div className={styles.eventCell}>
      <EventSportIcon sport={event.sport} />
      <div className={styles.eventText}>
        <div className={styles.eventTitle}>
          {event.inPlay ? <span className={styles.liveDot} aria-hidden="true" /> : null}
          <Link to={eventDetailPath(event.id)} className={styles.eventLink} title={event.name}>
            {event.name}
          </Link>
        </div>
        <div className={styles.eventMeta}>
          <span className={styles.eventSport}>{event.sport}</span>
          <span className={styles.metaDot} aria-hidden="true">•</span>
          <span className={styles.eventCompetition}>{event.competition}</span>
        </div>
      </div>
    </div>
  )
}

const START_TAG_CLASS = {
  finished: styles.tag,
  live: clsx(styles.tag, styles.tagLive),
  soon: clsx(styles.tag, styles.tagSoon),
  plain: styles.tag,
} as const

interface EventsTableProps {
  events: SportsEvent[]
  loading?: boolean
  /** The list query's error message: the table says so and offers Retry. */
  error?: string
  onRetry?: () => void
}

export function EventsTable({ events, loading = false, error, onRetry }: EventsTableProps) {
  const { formatDate, formatDateTime } = useFormatDate()
  const { formatAmount, convertFromWhitelabelCurrency, getCurrencySymbol } = useCurrency()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_EVENT_PAGE_SIZE)

  // Client-side paging over the filtered events; a page past the end (the list shrank) shows the last one.
  const totalEvents = events.length
  const currentPage = clampEventsPage(page, totalEvents, pageSize)
  const paginatedEvents = pageOfEvents(events, currentPage, pageSize)
  const now = Date.now()

  // The display currency, with the legacy K and M short forms.
  const formatCurrency = (value: number) =>
    formatCompactAmount(convertFromWhitelabelCurrency(value), getCurrencySymbol(), formatAmount)

  const columns: DataTableColumn<SportsEvent>[] = [
    { key: 'event', header: 'Event Details', minWidth: 260, cell: (event) => <EventCell event={event} /> },
    {
      key: 'start',
      header: 'Start Time',
      cell: (event) => {
        const tag = eventStartTag(event, now)
        return (
          <div className={styles.stack}>
            <span className={styles.strong}>{formatDateTime(event.startTime, 'MMM d, HH:mm')}</span>
            <span className={START_TAG_CLASS[tag.kind]}>
              {tag.kind === 'soon' ? <IconFlame size={12} stroke={strokeFor(12)} aria-hidden="true" /> : null}
              {tag.label}
            </span>
          </div>
        )
      },
    },
    {
      key: 'markets',
      header: 'Markets',
      align: 'center',
      cell: (event) => (
        <div className={styles.stack}>
          <span className={styles.marketCount}>{event.marketCount}</span>
          <span className={styles.secondary}>{marketLevel(event.marketCount)}</span>
        </div>
      ),
    },
    {
      key: 'liability',
      header: 'Liability',
      align: 'right',
      cell: (event) => (
        <div className={styles.stack}>
          <span className={styles.liability}>{formatCurrency(event.totalLiquidity)}</span>
          <span className={styles.secondary}>{eventBetsLabel(event.betsCount)}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      cell: (event) => {
        const badge = eventStatusBadge(event)
        return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
      },
    },
    {
      key: 'activity',
      header: 'Recent Activity',
      cell: (event) =>
        event.lastBetAt ? (
          <div className={styles.stack}>
            <span className={styles.strong}>
              {formatTimeSince(event.lastBetAt, now, (instant) => formatDate(instant, 'MMM d'))}
            </span>
            <span className={styles.secondary}>{formatDateTime(event.lastBetAt, 'MMM d, HH:mm')}</span>
          </div>
        ) : (
          <span className={styles.noBets}>No bets yet</span>
        ),
    },
  ]

  return (
    <>
      <DataTable
        columns={columns}
        rows={paginatedEvents}
        rowKey={(event) => event.id}
        label="Events"
        state={error && !loading ? 'error' : loading ? 'loading' : 'ready'}
        error={error}
        onRetry={onRetry}
        width="wide"
        empty={<EventsEmpty />}
        rowActions={(event) => ({
          primary: (
            <>
              <EventFavoriteButton event={event} bordered />
              <Link to={eventDetailPath(event.id)} className={VIEW_LINK_CLASS} aria-label={`View ${event.name}`}>
                <IconEye size={13} stroke={strokeFor(13)} aria-hidden="true" />
                View
              </Link>
            </>
          ),
        })}
      />
      {totalEvents > 0 ? (
        <Pagination
          current={currentPage}
          pageSize={pageSize}
          total={totalEvents}
          onChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPage(1)
          }}
          itemName="events"
          pageSizeOptions={EVENT_PAGE_SIZES}
          variant="embedded"
        />
      ) : null}
    </>
  )
}
