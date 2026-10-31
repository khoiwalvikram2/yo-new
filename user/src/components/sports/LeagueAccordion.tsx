import { ChevronDown } from 'lucide-react'
import { ListRow } from './LeaguesEventsList'
import type { EventItem } from '@/types'

interface LeagueAccordionProps {
  league: string
  events: EventItem[]
}

export default function LeagueAccordion({ league, events }: LeagueAccordionProps) {
  return (
    <details open className="group border border-[color:var(--ds-color-slate-600)] rounded-[5px] bg-[color:var(--ds-color-slate-850)] overflow-hidden transition-all duration-300">
      <summary className="px-4 py-3 cursor-pointer flex items-center justify-between hover:bg-[color:var(--ds-color-slate-800)] transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ds-color-slate-500)] group-open:bg-[color:var(--ds-color-slate-800)]">
        <div className="flex items-center gap-2.5">
          <div className="h-2 w-2 rounded-[5px] bg-[color:var(--brand-primary)] shrink-0" aria-hidden />
          <span className="text-sm font-semibold text-[color:var(--ds-color-slate-100)] tracking-wide uppercase">{league}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[color:var(--ds-color-slate-400)]">{events.length}</span>
          <div className="h-6 w-6 rounded-[5px] bg-[color:var(--ds-color-slate-750)] border border-[color:var(--ds-color-slate-600)] flex items-center justify-center group-hover:bg-[color:var(--ds-color-slate-700)] transition-colors">
            <ChevronDown className="h-3.5 w-3.5 text-[color:var(--ds-color-slate-300)] transition-transform duration-300 group-open:rotate-180" />
          </div>
        </div>
      </summary>
      <div className="border-t border-[color:var(--ds-color-slate-700)]">
        {events.map((e, idx) => (
          <div key={idx}>
            <ListRow e={e} compact />
            {idx < events.length - 1 && (
              <div className="h-px bg-[color:var(--ds-color-slate-700)] mx-3" />
            )}
          </div>
        ))}
      </div>
    </details>
  )
}
