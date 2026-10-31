import { useQuery } from '@apollo/client'
import { IconTrophy, IconCircleCheck, IconBan, IconActivity } from '@tabler/icons-react'
import { LIST_SPORTS } from '@/lib/graphql/sports'
import { Stat } from '@/ui/components/Stat'
import { strokeFor } from '@/ui/components/icons'
import styles from './SportsConfiguration.module.css'
export function SportsStatsCards() {
  const { data, loading } = useQuery<{ sports: { status?: string }[] }>(LIST_SPORTS, { errorPolicy: 'all' })
  const sports = data?.sports || []
  const active = sports.filter(s => s.status === 'active' || s.status === 'ACTIVE').length
  const suspended = sports.length - active
  const rate = sports.length ? Math.round(active / sports.length * 100) : 0
  // Until the first answer the cards hold their height with placeholders; a refetch keeps the last figures.
  const pending = loading && !data
  return <div className={styles.metrics} aria-busy={pending || undefined}><Stat label="Total Sports" value={sports.length} note={active + ' active, ' + suspended + ' suspended'} icon={<IconTrophy size={18} stroke={strokeFor(18)} />} hue="blu" loading={pending} /><Stat label="Active Sports" value={active} note={'of ' + sports.length + ' total'} icon={<IconCircleCheck size={18} stroke={strokeFor(18)} />} hue="grn" loading={pending} /><Stat label="Suspended" value={suspended} note={sports.length ? Math.round(suspended / sports.length * 100) + '% of total' : '—'} icon={<IconBan size={18} stroke={strokeFor(18)} />} hue="red" loading={pending} /><Stat label="Active Rate" value={rate + '%'} note={active + ' of ' + sports.length} icon={<IconActivity size={18} stroke={strokeFor(18)} />} hue="blu" loading={pending} /></div>
}

