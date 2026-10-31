import { useEffect } from 'react'
import { useQuery } from '@apollo/client'
import { IconArrowsExchange, IconBook, IconListDetails, IconRestore } from '@tabler/icons-react'
import { SPORTS_RESULT_STATS } from '../../../../modules/sports/results/graphql'
import { Notice } from '@/ui/components/Notice'
import { Button } from '@/ui/components/Button'
import { Stat, type StatHue } from '@/ui/components/Stat'
import { strokeFor } from '@/ui/components/icons'
import { manualResultStatCards, type ManualResultStats } from '../manualResultsModel'
import styles from '../ManualResultsPage.module.css'

const STAT_META: Record<string, { hue: StatHue; icon: typeof IconListDetails }> = {
  total: { hue: 'blu', icon: IconListDetails },
  exchange: { hue: 'grn', icon: IconArrowsExchange },
  bookmaker: { hue: 'vio', icon: IconBook },
  rolledBack: { hue: 'red', icon: IconRestore },
}

export function StatsCards({ revision = 0 }: { revision?: number }) {
  const { data, loading, error, refetch } = useQuery<{ sportsResultStats: ManualResultStats }>(SPORTS_RESULT_STATS, {
    errorPolicy: 'all', fetchPolicy: 'cache-and-network', pollInterval: 30000,
  })
  useEffect(() => { if (revision > 0) void refetch().catch(() => {}) }, [revision, refetch])
  const stats = data?.sportsResultStats ?? { total: 0, today: 0, exchange: 0, bookmaker: 0, fancy: 0, rolledBack: 0 }
  const cards = manualResultStatCards(stats)
  if (error && !data?.sportsResultStats) return <Notice tone="error" title="Statistics unavailable" action={<Button onClick={() => void refetch()}>Retry stats</Button>}>{error.message}</Notice>

  // Until the first answer the cards hold their height with placeholders; a refetch keeps the last figures.
  const pending = loading && !data

  return (
    <div className={styles.stats} aria-busy={pending || undefined}>
      {cards.map((card) => {
        const meta = STAT_META[card.key]
        const Icon = meta.icon
        return (
          <Stat
            key={card.key}
            label={card.label}
            value={card.value}
            note={card.note}
            hue={meta.hue}
            icon={<Icon size={18} stroke={strokeFor(18)} />}
            loading={pending}
          />
        )
      })}
    </div>
  )
}
