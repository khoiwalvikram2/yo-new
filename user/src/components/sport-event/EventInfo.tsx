import { Clock } from 'lucide-react'
import { getDefaultLocale } from '@/lib/currency'
import type { EventDetails } from './types'
import cricketImg from '../../assets/images/cricket.png'

interface EventInfoProps {
  event: EventDetails
  timeRemaining: string
  status: EventDetails['status']
  headerStyle: 'glow' | 'glass' | 'stripe'
  onHeaderStyleChange: (style: 'glow' | 'glass' | 'stripe') => void
  onOpenAnalytics?: () => void
}

export default function EventInfo({
  event,
  timeRemaining,
  status,
  headerStyle,
  onHeaderStyleChange,
}: EventInfoProps) {
  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString)
    return {
      date: date.toLocaleDateString(getDefaultLocale(), { 
        weekday: 'short', 
        day: '2-digit', 
        month: 'short' 
      }),
      time: date.toLocaleTimeString(getDefaultLocale(), { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      })
    }
  }

  const { date, time } = formatDateTime(event.startTime)
  const [hh, mm, ss] = (timeRemaining || '00:00:00').split(':')

  return (
    <div
      className={
        `relative overflow-hidden rounded-2xl p-5 sm:p-6 border mb-0 z-1 ` +
        (headerStyle === 'glass'
          ? 'border-[color:var(--border)]/60 bg-[color:var(--surface)]/55 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.30)]'
          : 'border-[color:var(--border)] bg-gradient-to-br from-[color:var(--surface-2)] to-[color:var(--surface)] shadow-[0_10px_30px_rgba(0,0,0,0.25)]')
      }
    >
      {/* Decorative Layers */}
      {headerStyle !== 'glass' && (
        <div className="pointer-events-none absolute -top-16 -right-16 w-64 h-64 rounded-[5px] bg-[color:var(--brand-accent)]/12 blur-2xl" />
      )}
      {headerStyle === 'glow' && (
        <div className="pointer-events-none absolute -bottom-20 -left-20 w-64 h-64 rounded-[5px] bg-[color:var(--brand-primary)]/10 blur-2xl" />
      )}
      {headerStyle === 'stripe' && (
        <div className="pointer-events-none absolute inset-0 bg-stripe-pattern" />
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--brand-primary)]/40 to-transparent" />

      {/* Style Toggle (DEV only) */}
      {import.meta.env.DEV && (
        <div className="absolute top-3 right-3 hidden sm:flex items-center gap-1 bg-[color:var(--surface)]/70 border border-[color:var(--border)] rounded-md p-1 z-10">
          {(['glow','glass','stripe'] as const).map(v => (
            <button
              key={v}
              onClick={() => onHeaderStyleChange(v)}
              className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors ${headerStyle===v ? 'bg-[color:var(--brand-primary)]/20 text-[color:var(--text)] border border-[color:var(--brand-primary)]/30' : 'text-[color:var(--subtle)] hover:text-[color:var(--text)]'}`}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      {/* Event Row (single name + sport icon + timer/live) */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 mb-4">
        {/* Event name with sport icon */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-[color:var(--surface)] border border-[color:var(--border)] grid place-items-center shadow-sm overflow-hidden">
            <img src={cricketImg} alt="sport" className="w-6 h-6 opacity-90 sport-img" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base sm:text-lg md:text-xl font-semibold text-[color:var(--text)]">
              {event.homeTeam.name} vs {event.awayTeam.name}
            </h2>
            <div className="text-xs sm:text-sm md:text-base text-[color:var(--subtle)]">
              {event.league}
            </div>
          </div>
        </div>

        {/* Timer / Live */}
        <div className="w-full sm:flex-1 flex justify-start sm:justify-end">
          {status === 'upcoming' ? (
            <div className="inline-flex items-center bg-[color:var(--surface)] border border-[color:var(--border)] rounded-lg px-4 py-2 shadow-sm">
              <span className="text-lg sm:text-xl md:text-2xl font-bold font-mono tabular-nums text-[color:var(--text)]">{hh}</span>
              <span className="text-[color:var(--subtle)] font-bold mx-2">:</span>
              <span className="text-lg sm:text-xl md:text-2xl font-bold font-mono tabular-nums text-[color:var(--text)]">{mm}</span>
              <span className="text-[color:var(--subtle)] font-bold mx-2">:</span>
              <span className="text-lg sm:text-xl md:text-2xl font-bold font-mono tabular-nums text-[color:var(--text)]">{ss}</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-500/10 to-red-600/10 border border-red-500/30 shadow-lg">
              <span className="relative inline-flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-[5px] bg-red-500 opacity-60 animate-ping" />
                <span className="relative inline-flex rounded-[5px] h-2.5 w-2.5 bg-red-500" />
              </span>
              <span className="text-red-500 font-bold text-sm sm:text-base tracking-wide">LIVE</span>
            </div>
          )}
        </div>
      </div>

      {/* Match Info Row - Date & Time (Analytics moved to top header) */}
      <div className="flex items-center justify-between pt-4 border-t border-[color:var(--border)]/50 text-sm gap-4">
        <div className="flex items-center gap-2 text-[color:var(--subtle)]">
          <Clock className="h-4 w-4" />
          <span className="font-medium">{date} • {time}</span>
        </div>
      </div>
    </div>
  )
}
