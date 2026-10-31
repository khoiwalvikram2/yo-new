import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Checkbox } from '@/ui/components/Checkbox'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { StatusPill } from '@/ui/components/StatusPill'
import { useFormatDate } from '@/shared/core/useFormatDate'
import type { Event, League, Sport } from './types'
import styles from './Builder.module.css'
interface EventsSectionProps {
  events: Event[]; leagues: League[]; selectedSports: Sport[]; eventsExpanded: Record<string, boolean>
  onToggleSportEvents: (key: string) => void; onToggleLeagueEvents: (key: string, checked: boolean) => void
  onToggleEvent: (id: string) => void; onExpandAll: () => void; onCollapseAll: () => void
  eventsLoadingByLeague?: Record<string, boolean>
}
export function EventsSection(props: EventsSectionProps) {
  const { formatDate, formatTime } = useFormatDate()
  return <Card title="Select Events" sub="Review and manage events from selected leagues" tools={<div className={styles.actions}>
    <Button size="sm" onClick={props.onExpandAll}>Expand all</Button><Button size="sm" onClick={props.onCollapseAll}>Collapse all</Button>
  </div>}><div className={styles.stack}>
    {!props.leagues.some(league => league.selected && props.selectedSports.some(sport => sport.key === league.sportKey)) && <EmptyState title="No leagues selected" description="Select leagues in the previous step to see events" />}
    {props.selectedSports.map(sport => {
      const leagues = props.leagues.filter(league => league.sportKey === sport.key && league.selected)
      if (!leagues.length) return null
      const expanded = Boolean(props.eventsExpanded[sport.key])
      return <section key={sport.key} className={styles.group}>
        <Button className={styles.disclosure} aria-expanded={expanded} onClick={() => props.onToggleSportEvents(sport.key)}>{sport.name} · {leagues.length} leagues · {props.events.filter(event => event.sportKey === sport.key).length} events · {expanded ? 'Hide' : 'Show'}</Button>
        {expanded && <div className={styles.groupBody}><div className={styles.eventGrid}>{leagues.map(league => {
          const events = props.events.filter(event => event.leagueKey === league.key)
          const all = events.length > 0 && events.every(event => event.selected)
          return <section key={league.key} className={styles.group}>
            <div className={styles.groupBody}>
              <Checkbox label={league.name} aria-label={`Toggle all events for ${league.name}`} checked={all} indeterminate={!all && events.some(event => event.selected)} onChange={() => props.onToggleLeagueEvents(league.key, !all)} description={`${events.length} events · ${events.filter(event => event.selected).length} selected`} />
              {league.alreadyAdded && <StatusPill className={styles.marker} tone="info">Already added</StatusPill>}
              {props.eventsLoadingByLeague?.[league.key] && <LoadingState label={`Loading ${league.name} events`} />}
              {!events.length && !props.eventsLoadingByLeague?.[league.key] && <EmptyState title="No events available" />}
              {events.map(event => <div className={styles.choice} key={event.id}>
                <Checkbox label={event.name} aria-label={`Select event ${event.name}`} checked={event.selected} onChange={() => props.onToggleEvent(event.id)} description={event.startTime ? `${formatDate(event.startTime, 'MMM d')} · ${formatTime(event.startTime, 'HH:mm')}` : 'TBD'} />
                {event.alreadyAdded && <StatusPill tone="info">Already added</StatusPill>}
              </div>)}
            </div>
          </section>
        })}</div></div>}
      </section>
    })}
  </div></Card>
}

