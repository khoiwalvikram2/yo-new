import { useMemo } from 'react'
import { IconCircleCheck, IconCoins, IconFileText, IconPlayerPause } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { strokeFor } from '@/ui/components/icons'
import { Grid } from '@/ui/components/LayoutPrimitives'
import { Stat } from '@/ui/components/Stat'
import { activeShareNote, bonusCampaignStats, pausedShareNote } from '../bonusesListModel'

type CampaignItem = { status?: string; budgetNumeric?: string | number | null; endDate?: string | null }

interface StatsCardsProps {
  campaigns: CampaignItem[]
  loading?: boolean
}

/* Four kit Stat tiles (the generic page has none; the KPI anatomy is M:811-850). The legacy grey Draft
   card takes the indigo ramp step: hues are decorative (Task 141 did the same). */
export function StatsCards({ campaigns, loading }: StatsCardsProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  const stats = useMemo(() => bonusCampaignStats(campaigns), [campaigns])

  // The list is empty until the first answer; a refetch keeps the figures it has instead of blanking them.
  const pending = Boolean(loading) && campaigns.length === 0

  return (
    <Grid
      cols={{ base: 1, md: 2, xl: 4 }}
      gap={12}
      role="group"
      aria-label="Bonus campaign statistics"
      aria-busy={pending || undefined}
    >
      <Stat
        label="Active"
        value={stats.active}
        note={activeShareNote(stats)}
        icon={<IconCircleCheck size={18} stroke={strokeFor(18)} />}
        hue="grn"
        loading={pending}
      />
      <Stat
        label="Draft"
        value={stats.draft}
        note={`${stats.draft} drafts, ${stats.total} total`}
        icon={<IconFileText size={18} stroke={strokeFor(18)} />}
        hue="ind"
        loading={pending}
      />
      <Stat
        label="Paused"
        value={stats.paused}
        note={pausedShareNote(stats)}
        icon={<IconPlayerPause size={18} stroke={strokeFor(18)} />}
        hue="red"
        loading={pending}
      />
      <Stat
        label="Total Budget"
        value={formatAmount(convertFromWhitelabelCurrency(stats.totalBudget))}
        note={`${stats.total} campaigns`}
        icon={<IconCoins size={18} stroke={strokeFor(18)} />}
        hue="blu"
        loading={pending}
      />
    </Grid>
  )
}
