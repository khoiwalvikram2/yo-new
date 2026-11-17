import { useQuery } from '@apollo/client'
import { IconApi, IconChartBar, IconDeviceGamepad2, IconBuildingStore } from '@tabler/icons-react'
import { CASINO_API_PROVIDERS, CASINO_GAMES, CASINO_VENDORS } from '@/lib/graphql/casino'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { useCasinoStore } from '@/state/casinoStore'
import { Stat } from '@/ui/components/Stat'
import { strokeFor } from '@/ui/components/icons'
import {
  casinoGameCounts,
  casinoScopeCountInput,
  casinoStats,
  isCoreModeView,
  isWhitelabelAdminRole,
  vendorVariables,
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
  const roles = useAuthStore((state) => state.roles)
  const isWhitelabelAdmin = isWhitelabelAdminRole(roles)
  const directorMode = useUIStore((state) => state.directorMode)
  const coreMode = isCoreModeView(roles, directorMode)
  const providersQ = useQuery<ProviderData>(CASINO_API_PROVIDERS, { errorPolicy: 'all' })
  /* B002: the cards read only with a provider, one category and a vendor all chosen, so the default All view said
     "Vendors 0" and "Games 0" over a table of 12,520 games. They now count the table's own scope (a whitelabel
     admin's tenant, or the chosen provider; the category and vendor when chosen), without its search, status or
     VIP filters: the whole catalogue by default, the narrowed figures once a category or vendor is chosen. */
  const vendorsQ = useQuery<VendorData>(CASINO_VENDORS, {
    // The vendor list's own read (CasinoDashboard), so the card shares its answer.
    variables: vendorVariables(selectedProviderId, selectedCategory, isWhitelabelAdmin),
    skip: !isWhitelabelAdmin && !selectedProviderId,
    errorPolicy: 'all',
  })
  const countInput = casinoScopeCountInput(selectedProviderId, selectedCategory, selectedVendorId, isWhitelabelAdmin)
  const countsReady = Boolean(selectedCategory) && (isWhitelabelAdmin || Boolean(selectedProviderId))
  const gamesQ = useQuery<GamesData>(CASINO_GAMES, {
    variables: { input: countInput },
    skip: !countsReady,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })
  const enabledQ = useQuery<GamesData>(CASINO_GAMES, {
    variables: { input: { ...countInput, enabled: true } },
    skip: !countsReady,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  const stats = {
    ...casinoStats(providersQ.data?.casinoApiProviders ?? [], vendorsQ.data?.casinoVendors ?? [], null, coreMode),
    ...casinoGameCounts(gamesQ.data?.casinoGames?.total, enabledQ.data?.casinoGames?.total),
  }
  // Each card waits only on the query that feeds it; a refetch keeps the figures it has.
  const providersPending = providersQ.loading && !providersQ.data
  const vendorsPending = vendorsQ.loading && !vendorsQ.data
  const gamesPending = (gamesQ.loading && !gamesQ.data) || (enabledQ.loading && !enabledQ.data)

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
          note={coreMode
            ? `${stats.gamesEnabled} active, ${stats.gamesDisabled} blocked`
            : `${stats.gamesEnabled} enabled, ${stats.gamesDisabled} disabled`}
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
