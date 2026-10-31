import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { StatusPill } from '@/ui/components/StatusPill'
import { useFormatDate } from '@/shared/core/useFormatDate'
import type { Sport, League, Event } from './types'
import styles from './Builder.module.css'
interface ReviewSectionProps { selectedSports: Sport[]; leagues: League[]; events: Event[]; reviewExpanded: Record<string, boolean>; leagueExpanded: Record<string, boolean>; onToggleSport: (key: string) => void; onToggleLeague: (key: string) => void }
export default function ReviewSection(props: ReviewSectionProps) {
  const { formatDate, formatTime } = useFormatDate()
  const leagues = props.leagues.filter(league => league.selected)
  const events = props.events.filter(event => event.selected)
  return <Card title="Review Selections" sub="Review all your selections before submitting" tools={<div className={styles.actions}>
    <StatusPill tone="info">{props.selectedSports.length} Sports</StatusPill><StatusPill tone="ok">{leagues.length} Leagues</StatusPill><StatusPill tone="neutral">{events.length} Events</StatusPill>
  </div>}><div className={styles.stack}>
    {!props.selectedSports.length && !leagues.length && !events.length && <EmptyState title="No selections made yet" />}
    {props.selectedSports.map(sport => {
      const sportLeagues = leagues.filter(league => league.sportKey === sport.key)
      if (!sportLeagues.length && !events.some(event => event.sportKey === sport.key)) return null
      const expanded = Boolean(props.reviewExpanded[sport.key])
      return <section key={sport.key} className={styles.group}>
        <Button className={styles.disclosure} aria-expanded={expanded} onClick={() => props.onToggleSport(sport.key)}>{sport.name} · {sportLeagues.length} leagues · {events.filter(event => event.sportKey === sport.key).length} events · {expanded ? 'Hide' : 'Show'}</Button>
        {expanded && <div className={styles.groupBody}>{sportLeagues.map(league => {
          const selectedEvents = events.filter(event => event.leagueKey === league.key)
          const leagueOpen = Boolean(props.leagueExpanded[league.key])
          return <section key={league.key} className={styles.group}>
            <Button className={styles.disclosure} aria-expanded={leagueOpen} onClick={() => props.onToggleLeague(league.key)}>{league.name} · {selectedEvents.length} events</Button>
            {league.alreadyAdded && <StatusPill tone="info">Already added</StatusPill>}
            {leagueOpen && selectedEvents.length > 0 && <div className={styles.groupBody}>{selectedEvents.map(event => <div key={event.id} className={styles.choice}>
              <div className={styles.stack}><span>{event.name}</span>{event.startTime && <span className={styles.muted}>{formatDate(event.startTime, 'MMM d')} · {formatTime(event.startTime, 'HH:mm')}</span>}</div>
              {event.alreadyAdded && <StatusPill tone="info">Already added</StatusPill>}
            </div>)}</div>}
          </section>
        })}</div>}
      </section>
    })}
  </div></Card>
}

