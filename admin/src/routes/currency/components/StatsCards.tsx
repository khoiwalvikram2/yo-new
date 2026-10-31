import { IconChartLine, IconCircleCheck, IconCurrencyDollar } from '@tabler/icons-react'
import type { Currency } from '@/shared/types/currency'
import { strokeFor } from '@/ui/components/icons'
import { Grid } from '@/ui/components/LayoutPrimitives'
import { Stat } from '@/ui/components/Stat'
import { currencyStats } from '../currencyManagementModel'

interface StatsCardsProps {
  currencies: Currency[]
  activeCurrencies: Currency[]
  inactiveCurrencies: Currency[]
  loading?: boolean
}

/* The four legacy figures over every currency (the filters do not touch them). The legacy Active Rate bar
   never rendered (DashboardStatCard draws it only when `tight` is false, and it defaults to true), so no
   Meter replaces it. Hues are the decorative ramp, never a status. */
export function StatsCards({
  currencies,
  activeCurrencies,
  inactiveCurrencies,
  loading,
}: StatsCardsProps) {
  const stats = currencyStats(currencies, activeCurrencies, inactiveCurrencies)
  // The list is empty until the first answer; a refetch keeps the figures it has instead of blanking them.
  const pending = Boolean(loading) && currencies.length === 0

  return (
    <Grid
      cols={{ base: 1, md: 2, xl: 4 }}
      gap={12}
      role="group"
      aria-label="Currency statistics"
      aria-busy={pending || undefined}
    >
      <Stat
        label="Total Currencies"
        value={stats.total}
        note={`${stats.active} active, ${stats.inactive} inactive`}
        icon={<IconCurrencyDollar size={18} stroke={strokeFor(18)} />}
        hue="blu"
        loading={pending}
      />
      <Stat
        label="Exchange Rates"
        value={stats.withRates}
        note={`${stats.missingRates} missing`}
        icon={<IconChartLine size={18} stroke={strokeFor(18)} />}
        hue="grn"
        loading={pending}
      />
      <Stat
        label="Active Currencies"
        value={stats.active}
        note={`${stats.activeWithRates} with rates`}
        icon={<IconCircleCheck size={18} stroke={strokeFor(18)} />}
        hue="ind"
        loading={pending}
      />
      <Stat
        label="Active Rate"
        value={`${stats.activeRate}%`}
        note={`${stats.active} of ${stats.total}`}
        icon={<IconChartLine size={18} stroke={strokeFor(18)} />}
        hue="blu"
        loading={pending}
      />
    </Grid>
  )
}
