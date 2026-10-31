import { useQuery } from '@apollo/client'
import { IconApi, IconChartBar, IconDeviceGamepad2, IconBuildingStore } from '@tabler/icons-react'
import { CASINO_API_PROVIDERS, CASINO_GAMES, CASINO_VENDORS } from '@/lib/graphql/casino'
import { useCasinoStore } from '@/state/casinoStore'
import { Stat } from '@/ui/components/Stat'
import { strokeFor } from '@/ui/components/icons'
import {
  casinoStats,
  type CasinoProvider,
  type CasinoVendor,
  type GamesPage,
} from '../casinoManagementModel'
import styles from '../ManagementPage.module.css'

interface ProviderData { casinoApiProviders: CasinoProvider[] }
interface VendorData { casinoVendors: CasinoVendor[] }
interface GamesData { casinoGames: GamesPage }

const ICON_SIZE = 18

export function CasinoStatsCards() {
  const { selectedProviderId, selectedCategory, selectedVendorId } = useCasinoStore()
  const providersQ = useQuery<ProviderData>(CASINO_API_PROVIDERS, { errorPolicy: 'all' })
  const vendorsQ = useQuery<VendorData>(CASINO_VENDORS, {
    variables:
      selectedProviderId && selectedCategory && selectedCategory !== 'ALL'
        ? { providerId: selectedProviderId, category: selectedCategory }
        : undefined,
    skip: !selectedProviderId || !selectedCategory || selectedCategory === 'ALL',
    errorPolicy: 'all',
  })
  const gamesQ = useQuery<GamesData>(CASINO_GAMES, {
    variables:
      selectedProviderId && selectedCategory && selectedCategory !== 'ALL' && selectedVendorId
        ? {
            input: {
              providerId: selectedProviderId,
              category: selectedCategory,
              vendorId: selectedVendorId,
              page: 1,
              pageSize: 1000,
            },
          }
        : undefined,
    skip: !selectedProviderId || !selectedCategory || selectedCategory === 'ALL' || !selectedVendorId,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  const stats = casinoStats(
    providersQ.data?.casinoApiProviders ?? [],
    vendorsQ.data?.casinoVendors ?? [],
    gamesQ.data?.casinoGames,
  )
  // Each card waits only on the query that feeds it; a refetch keeps the figures it has.
  const providersPending = providersQ.loading && !providersQ.data
  const vendorsPending = vendorsQ.loading && !vendorsQ.data
  const gamesPending = gamesQ.loading && !gamesQ.data

  return (
    <div className={styles.statsWrap}>
      <div
        className={styles.stats}
        role="group"
        aria-label="Casino statistics"
        aria-busy={providersPending || vendorsPending || gamesPending || undefined}
      >
        <Stat
          label="API Providers"
          value={stats.totalProviders}
          note={`${stats.activeProviders} active, ${stats.inactiveProviders} inactive`}
          icon={<IconApi size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
          hue="blu"
          loading={providersPending}
        />
        <Stat
          label="Vendors"
          value={stats.totalVendors}
          note={selectedVendorId ? '1 selected' : 'None selected'}
          icon={<IconBuildingStore size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
          hue="vio"
          loading={vendorsPending}
        />
        <Stat
          label="Games"
          value={stats.gamesTotal}
          note={`${stats.gamesEnabled} enabled, ${stats.gamesDisabled} disabled`}
          icon={<IconDeviceGamepad2 size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
          hue="grn"
          loading={gamesPending}
        />
        <Stat
          label="Active Rate"
          value={`${stats.activeRate}%`}
          note={`${stats.activeProviders} of ${stats.totalProviders}`}
          icon={<IconChartBar size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
          hue="blu"
          loading={providersPending}
        />
      </div>
    </div>
  )
}
