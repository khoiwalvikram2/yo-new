import LeagueAccordion from './LeagueAccordion'
import type { EventItem } from '@/types'
import { Calendar } from 'lucide-react'

interface EventsListProps {
  groupedEvents: Record<string, EventItem[]>
}

export default function EventsList({ groupedEvents }: EventsListProps) {
  if (Object.keys(groupedEvents).length === 0) {
    return (
      <div className="mx-auto text-center">
        <div className="rounded-[5px] border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-850)] p-6 sm:p-8">
          <div className="mx-auto mb-4 h-12 w-12 rounded-[5px] bg-[color:var(--ds-color-slate-800)] border border-[color:var(--ds-color-slate-600)] grid place-items-center">
            <Calendar className="h-6 w-6 text-[color:var(--ds-color-slate-400)]" />
          </div>
          <h3 className="text-base font-semibold text-[color:var(--ds-color-slate-100)]">No events available</h3>
          <p className="mt-1 text-sm text-[color:var(--ds-color-slate-400)]">Try switching the tab or selecting a different sport.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {Object.entries(groupedEvents).map(([league, events]) => (
        <LeagueAccordion key={league} league={league} events={events} />
      ))}
    </div>
  )
}
