import clsx from 'clsx'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from './Builder.module.css'
export interface AutoRunInfoProps { lastRunAt?: string | null; nextRunAt?: string | null; className?: string }
export function AutoRunInfo({ lastRunAt, nextRunAt, className }: AutoRunInfoProps) {
  const { formatDateTime } = useFormatDate()
  const next = nextRunAt ? new Date(nextRunAt).getTime() : Number.NaN
  const difference = next - Date.now()
  const minutes = Math.floor(Math.abs(difference) / 60000); const hours = Math.floor(minutes / 60); const days = Math.floor(hours / 24)
  const span = days > 0 ? `${days}d ${hours % 24}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
  return <div className={clsx(styles.stack, className)}>
    <span title={lastRunAt ?? undefined}>Last: {lastRunAt ? formatDateTime(lastRunAt, 'MMM d, yyyy h:mm a') : '—'}</span>
    <span title={nextRunAt ?? undefined}>Next: {nextRunAt ? formatDateTime(nextRunAt, 'MMM d, yyyy h:mm a') : '—'}</span>
    {Number.isFinite(next) && <StatusPill tone="info">{difference < 0 ? `${span} ago` : `in ${span}`}</StatusPill>}
  </div>
}

