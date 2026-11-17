import React from 'react'
import { useQuery, useMutation } from '@apollo/client'
import {
  IconBuildingStore,
  IconChevronRight,
  IconDeviceGamepad2,
  IconInbox,
  IconPlug,
} from '@tabler/icons-react'
import clsx from 'clsx'
import {
  PROVIDERS_WITH_VENDORS,
  WHITELABEL_CASINO_PROVIDER_SETTINGS,
  TOGGLE_WHITELABEL_CASINO_PROVIDER,
  WHITELABEL_CASINO_VENDOR_OVERRIDE_SETTINGS,
  SET_WHITELABEL_CASINO_VENDOR_SUPER_ADMIN_OVERRIDE,
  WHITELABEL_CASINO_GAME_OVERRIDE_SETTINGS,
  SET_WHITELABEL_CASINO_GAME_SUPER_ADMIN_OVERRIDE,
} from '@/lib/graphql/casino'
import { ProvidersDashboard } from './components/ProvidersDashboard'
import { VendorsDashboard } from './components/VendorsDashboard'
import { ProviderStatsCards } from './components/ProviderStatsCards'
import { VendorSharesDrawer } from './components/VendorSharesDrawer'
import { AnalyticsDrawer } from './components/AnalyticsDrawer'
import { useCasinoScopeStore, type CasinoScope } from '@/state/casinoScopeStore'
import { useAuthStore } from '@/shared/core/authStore'
import { useWhitelabels } from '@/shared/core/useWhitelabels'
import { notify } from '@/shared/services/notification'
import type { ProviderWithVendors } from '@/modules/casino/types'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Combobox } from '@/ui/components/Combobox'
import { StoredImage } from '@/ui/components/StoredImage'
import { EmptyState } from '@/ui/components/EmptyState'
import { FilterBar } from '@/ui/components/FilterBar'
import { strokeFor } from '@/ui/components/icons'
import { LoadingState } from '@/ui/components/LoadingState'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import { Spinner } from '@/ui/components/Spinner'
import { Switch } from '@/ui/components/Switch'
import { Table, TBody, TD, TH, THead, TR } from '@/ui/components/Table'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import {
  GAME_PAGE_SIZE,
  OVERRIDE_TABS,
  PAGE_SUB,
  PAGE_TITLE,
  VISIBILITY_HINT,
  VISIBILITY_TITLE,
  analyticsTitle,
  filterProviderSettings,
  filterVendorOverrides,
  gameCountLabel,
  gameOverridesEmptyText,
  gameSubLine,
  isSuperAdminRole,
  messageOr,
  overrideSwitchLabel,
  providerOptions,
  providerSettingsEmptyText,
  selectedProviderLabel,
  vendorOptionsFor,
  vendorOverridesEmptyText,
  whitelabelOptions,
  yesNo,
  type AnalyticsMode,
  type GameOverrideRow,
  type OverrideTab,
  type ProviderSettingRow,
  type VendorOverrideRow,
} from './providersPageModel'
import styles from './ProvidersPage.module.css'

const SCOPE_TABS_ID = 'casino-scope'
const VISIBILITY_TABS_ID = 'casino-visibility'

/* The legacy scope selector's glyphs: a plug for providers, a store for vendors. */
const SCOPE_TAB_ITEMS: readonly TabItem<CasinoScope>[] = [
  { value: 'providers', label: 'Providers', icon: <IconPlug size={15} stroke={strokeFor(15)} /> },
  { value: 'vendors', label: 'Vendors', icon: <IconBuildingStore size={15} stroke={strokeFor(15)} /> },
]

const OVERRIDE_TAB_ICONS: Record<OverrideTab, React.ReactNode> = {
  providers: <IconPlug size={14} stroke={strokeFor(14)} />,
  vendors: <IconBuildingStore size={14} stroke={strokeFor(14)} />,
  games: <IconDeviceGamepad2 size={14} stroke={strokeFor(14)} />,
}

const OVERRIDE_TAB_ITEMS: readonly TabItem<OverrideTab>[] = OVERRIDE_TABS.map((tab) => ({
  ...tab,
  icon: OVERRIDE_TAB_ICONS[tab.value],
}))

type VisibilityKind = 'provider' | 'vendor' | 'game'

const TILE_CLASS: Record<VisibilityKind, string> = {
  provider: styles.tileProvider,
  vendor: styles.tileVendor,
  game: styles.tileGame,
}

/* A visibility row's name: the legacy tile (a game's thumbnail when it has one) beside the name and its key. */
function VisibilityName({
  kind,
  name,
  sub,
  thumbnailUrl,
}: {
  kind: VisibilityKind
  name: string
  sub: string
  thumbnailUrl?: string | null
}) {
  const icon =
    kind === 'provider' ? (
      <IconPlug size={16} stroke={strokeFor(16)} />
    ) : kind === 'vendor' ? (
      <IconBuildingStore size={16} stroke={strokeFor(16)} />
    ) : (
      <IconDeviceGamepad2 size={16} stroke={strokeFor(16)} />
    )
  return (
    <div className={styles.entity}>
      <span className={clsx(styles.tile, TILE_CLASS[kind])} aria-hidden="true">
        {/* A game thumbnail that will not load shows the kind's icon, as no thumbnail does (SYS-18). */}
        {kind === 'game' ? <StoredImage src={thumbnailUrl} alt="" className={styles.thumb} fallback={icon} /> : icon}
      </span>
      <div className={styles.entityBody}>
        <span className={styles.entityName} title={kind === 'game' ? name : undefined}>{name}</span>
        <span className={styles.entitySub} title={kind === 'game' ? sub : undefined}>{sub}</span>
      </div>
    </div>
  )
}

/* The legacy Yes / No switch of the Disabled column. While any change of its list is saving, every switch of
   that list is inert (legacy `disabled={toggling}`), but it keeps its place in the tab order. */
function OverrideSwitch({
  name,
  checked,
  busy,
  onChange,
}: {
  name: string
  checked: boolean
  busy: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <span className={styles.switchCell}>
      <Switch
        checked={checked}
        onChange={onChange}
        label={overrideSwitchLabel(name)}
        hideLabel
        aria-disabled={busy ? true : undefined}
      />
      <span className={styles.switchState} aria-hidden="true">{yesNo(checked)}</span>
    </span>
  )
}

export default function ProvidersPage() {
  return (
    <RBACGuard required={[{ domain: 'casino.providers', actions: ['view'] }]}>
      <ProvidersPageContent />
    </RBACGuard>
  )
}

function ProvidersPageContent() {
  const pageEyebrow = usePageEyebrow()
  const { scope, setScope, selectedProviderId, setProviderId } = useCasinoScopeStore()
  const [sharesOpen, setSharesOpen] = React.useState(false)
  const [sharesProvider, setSharesProvider] = React.useState<ProviderWithVendors | null>(null)
  const [analyticsOpen, setAnalyticsOpen] = React.useState(false)
  const [analyticsMode, setAnalyticsMode] = React.useState<AnalyticsMode | null>(null)
  const [providerSettingsTenantId, setProviderSettingsTenantId] = React.useState<string | null>(null)
  const [overrideTabKey, setOverrideTabKey] = React.useState<OverrideTab>('providers')
  const [providerSearch, setProviderSearch] = React.useState('')
  const [vendorSearch, setVendorSearch] = React.useState('')
  const [vendorFilterProviderId, setVendorFilterProviderId] = React.useState<string | undefined>(undefined)
  const [gameOverrideProviderId, setGameOverrideProviderId] = React.useState<string | undefined>(undefined)
  const [gameOverrideVendorId, setGameOverrideVendorId] = React.useState<string | undefined>(undefined)
  const [gameSearch, setGameSearch] = React.useState('')
  const [gamePage, setGamePage] = React.useState(1)
  const [gameOverrideItems, setGameOverrideItems] = React.useState<GameOverrideRow[]>([])
  const [gameHasMore, setGameHasMore] = React.useState(false)
  const [gameTotal, setGameTotal] = React.useState(0)
  const gameListRef = React.useRef<HTMLDivElement>(null)
  const gameSentinelRef = React.useRef<HTMLDivElement>(null)

  const roles = useAuthStore((s) => s.roles) ?? []
  const isSuperAdmin = isSuperAdminRole(roles)
  const { whitelabels } = useWhitelabels()
  const whitelabelOptionList = React.useMemo(() => whitelabelOptions(whitelabels), [whitelabels])

  const { data } = useQuery(PROVIDERS_WITH_VENDORS, { errorPolicy: 'all', fetchPolicy: 'cache-and-network' })
  const providers: ProviderWithVendors[] = React.useMemo(() => data?.providersWithVendors ?? [], [data])
  const providerOptionList = React.useMemo(() => providerOptions(providers), [providers])
  const selectedProviderName = React.useMemo(
    () => selectedProviderLabel(providerOptionList, selectedProviderId),
    [providerOptionList, selectedProviderId],
  )

  const selectedProviderVendors = React.useMemo(
    () => vendorOptionsFor(providers, gameOverrideProviderId),
    [providers, gameOverrideProviderId],
  )

  const { data: providerSettingsData, loading: providerSettingsLoading } = useQuery(WHITELABEL_CASINO_PROVIDER_SETTINGS, {
    variables: { tenantId: providerSettingsTenantId ?? '' },
    skip: !providerSettingsTenantId,
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  })
  const providerSettingsRaw: ProviderSettingRow[] = React.useMemo(
    () => providerSettingsData?.whitelabelCasinoProviderSettings ?? [],
    [providerSettingsData],
  )
  const providerSettings = React.useMemo(
    () => filterProviderSettings(providerSettingsRaw, providerSearch),
    [providerSettingsRaw, providerSearch],
  )

  const { data: vendorOverrideData, loading: vendorOverrideLoading } = useQuery(WHITELABEL_CASINO_VENDOR_OVERRIDE_SETTINGS, {
    variables: { tenantId: providerSettingsTenantId ?? '' },
    skip: !providerSettingsTenantId || overrideTabKey !== 'vendors',
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  })
  const vendorOverrideSettingsRaw: VendorOverrideRow[] = React.useMemo(
    () => vendorOverrideData?.whitelabelCasinoVendorOverrideSettings ?? [],
    [vendorOverrideData],
  )
  const vendorOverrideSettings = React.useMemo(
    () => filterVendorOverrides(vendorOverrideSettingsRaw, vendorFilterProviderId, vendorSearch),
    [vendorOverrideSettingsRaw, vendorSearch, vendorFilterProviderId],
  )

  const { data: gameOverrideData, loading: gameOverrideLoading } = useQuery(WHITELABEL_CASINO_GAME_OVERRIDE_SETTINGS, {
    variables: {
      tenantId: providerSettingsTenantId ?? '',
      providerId: gameOverrideProviderId || null,
      vendorId: gameOverrideVendorId || null,
      search: gameSearch.trim() || null,
      page: gamePage,
      pageSize: GAME_PAGE_SIZE,
    },
    skip: !providerSettingsTenantId || overrideTabKey !== 'games',
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  })

  // A new list (search, filter or whitelabel) starts again at page 1. This runs before the copy below: when the
  // cache answers the new list, its page arrives in the same commit, and declared the other way round the reset
  // wiped the page just copied in. Clearing a search then left the list empty, and the identical network answer
  // never ran the copy again.
  React.useEffect(() => {
    setGamePage(1)
    setGameOverrideItems([])
  }, [providerSettingsTenantId, gameSearch, gameOverrideProviderId, gameOverrideVendorId])

  const gameOverridePageData = gameOverrideData?.whitelabelCasinoGameOverrideSettings
  // The list's own inputs are dependencies too, so whenever the reset above runs, the copy runs after it.
  React.useEffect(() => {
    if (!gameOverridePageData?.items) return
    if (gamePage === 1) {
      setGameOverrideItems(gameOverridePageData.items)
    } else {
      setGameOverrideItems((prev) => [...prev, ...gameOverridePageData.items])
    }
    setGameHasMore(gameOverridePageData.hasMore ?? false)
    setGameTotal(gameOverridePageData.total ?? 0)
  }, [gameOverridePageData, gamePage, providerSettingsTenantId, gameSearch, gameOverrideProviderId, gameOverrideVendorId])

  React.useEffect(() => {
    setGameOverrideVendorId(undefined)
  }, [gameOverrideProviderId])

  React.useEffect(() => {
    if (overrideTabKey !== 'games' || !gameHasMore || gameOverrideLoading) return
    const el = gameSentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setGamePage((p) => p + 1)
      },
      { root: gameListRef.current, rootMargin: '100px', threshold: 0.1 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [overrideTabKey, gameHasMore, gameOverrideLoading, gameOverrideItems.length])

  const [toggleProvider, { loading: toggling }] = useMutation(TOGGLE_WHITELABEL_CASINO_PROVIDER, {
    refetchQueries: [{ query: WHITELABEL_CASINO_PROVIDER_SETTINGS, variables: { tenantId: providerSettingsTenantId ?? '' } }],
    awaitRefetchQueries: true,
  })

  const [setVendorOverride, { loading: togglingVendor }] = useMutation(SET_WHITELABEL_CASINO_VENDOR_SUPER_ADMIN_OVERRIDE, {
    refetchQueries: [{ query: WHITELABEL_CASINO_VENDOR_OVERRIDE_SETTINGS, variables: { tenantId: providerSettingsTenantId ?? '' } }],
    awaitRefetchQueries: true,
  })

  const [setGameOverride, { loading: togglingGame }] = useMutation(SET_WHITELABEL_CASINO_GAME_SUPER_ADMIN_OVERRIDE, {
    refetchQueries: [
      {
        query: WHITELABEL_CASINO_GAME_OVERRIDE_SETTINGS,
        variables: {
          tenantId: providerSettingsTenantId ?? '',
          providerId: gameOverrideProviderId || null,
          vendorId: gameOverrideVendorId || null,
          search: gameSearch.trim() || null,
          page: 1,
          pageSize: GAME_PAGE_SIZE,
        },
      },
    ],
    awaitRefetchQueries: true,
  })

  const handleToggleProvider = async (providerId: string, enabled: boolean) => {
    if (!providerSettingsTenantId) return
    try {
      await toggleProvider({ variables: { tenantId: providerSettingsTenantId, providerId, enabled } })
    } catch (e) {
      notify.error(messageOr(e, 'Failed to update provider'))
    }
  }

  const handleToggleVendorOverride = async (vendorId: string, disabled: boolean) => {
    if (!providerSettingsTenantId) return
    try {
      await setVendorOverride({ variables: { tenantId: providerSettingsTenantId, vendorId, disabled } })
    } catch (e) {
      notify.error(messageOr(e, 'Failed to update vendor override'))
    }
  }

  const handleToggleGameOverride = async (gameId: string, disabled: boolean) => {
    if (!providerSettingsTenantId) return
    try {
      setGamePage(1)
      await setGameOverride({ variables: { tenantId: providerSettingsTenantId, gameId, disabled } })
    } catch (e) {
      notify.error(messageOr(e, 'Failed to update game override'))
    }
  }

  return (
    <Page maxWidth="wide">
      <PageHeader eyebrow={pageEyebrow} title={PAGE_TITLE} sub={PAGE_SUB} />

      <div className={styles.content}>
        <ProviderStatsCards />

        {isSuperAdmin && (
          <Card title={VISIBILITY_TITLE} tools={<span className={styles.cardNote}>Super Admin only</span>}>
            <div className={styles.visibility}>
              <Combobox
                label="Whitelabel"
                placeholder="Select whitelabel..."
                clearable
                size="sm"
                options={whitelabelOptionList}
                value={providerSettingsTenantId}
                onChange={(v) => setProviderSettingsTenantId(v ?? null)}
                className={styles.whitelabelField}
              />
              {providerSettingsTenantId && (
                <>
                  <Tabs
                    label={VISIBILITY_TITLE}
                    idPrefix={VISIBILITY_TABS_ID}
                    size="sm"
                    value={overrideTabKey}
                    items={OVERRIDE_TAB_ITEMS}
                    onChange={setOverrideTabKey}
                  />
                  <div
                    role="tabpanel"
                    id={tabPanelId(VISIBILITY_TABS_ID, overrideTabKey)}
                    aria-labelledby={tabId(VISIBILITY_TABS_ID, overrideTabKey)}
                    className={styles.tabPanel}
                  >
                    {overrideTabKey === 'providers' ? (
                      <>
                        <FilterBar
                          label="Provider visibility filters"
                          activeCount={providerSearch ? 1 : 0}
                          onClearAll={() => setProviderSearch('')}
                          search={(
                            <SearchField
                              label="Search providers"
                              placeholder="Search providers by name or key..."
                              size="sm"
                              value={providerSearch}
                              onChange={setProviderSearch}
                            />
                          )}
                        />
                        <div className={styles.listBox}>
                          {providerSettingsLoading ? (
                            <LoadingState label="Loading providers..." minHeight={192} />
                          ) : providerSettings.length === 0 ? (
                            <EmptyState
                              title={providerSettingsEmptyText(providerSearch)}
                              icon={<IconInbox size={20} stroke={strokeFor(20)} />}
                            />
                          ) : (
                            <Table caption="Provider visibility" width="fill">
                              <THead>
                                <TR>
                                  <TH>Provider</TH>
                                  <TH align="right">Disabled</TH>
                                </TR>
                              </THead>
                              <TBody>
                                {providerSettings.map((row) => (
                                  <TR key={row.id}>
                                    <TD>
                                      <VisibilityName kind="provider" name={row.providerName} sub={row.providerKey} />
                                    </TD>
                                    <TD align="right">
                                      <OverrideSwitch
                                        name={row.providerName}
                                        checked={!row.enabled}
                                        busy={toggling}
                                        onChange={(checked) => void handleToggleProvider(String(row.providerId), !checked)}
                                      />
                                    </TD>
                                  </TR>
                                ))}
                              </TBody>
                            </Table>
                          )}
                        </div>
                      </>
                    ) : overrideTabKey === 'vendors' ? (
                      <>
                        <FilterBar
                          label="Vendor visibility filters"
                          activeCount={[vendorSearch, vendorFilterProviderId].filter(Boolean).length}
                          onClearAll={() => {
                            setVendorSearch('')
                            setVendorFilterProviderId(undefined)
                          }}
                          search={(
                            <SearchField
                              label="Search vendors"
                              placeholder="Search vendors..."
                              size="sm"
                              value={vendorSearch}
                              onChange={setVendorSearch}
                            />
                          )}
                        >
                          <Select
                            label="Filter vendor visibility by provider"
                            hideLabel
                            size="sm"
                            value={vendorFilterProviderId ?? ''}
                            options={[{ value: '', label: 'Filter by provider' }, ...providerOptionList]}
                            onChange={(value) => setVendorFilterProviderId(value || undefined)}
                          />
                        </FilterBar>
                        <div className={styles.listBox}>
                          {vendorOverrideLoading ? (
                            <LoadingState label="Loading vendors..." minHeight={192} />
                          ) : vendorOverrideSettings.length === 0 ? (
                            <EmptyState
                              title={vendorOverridesEmptyText(vendorSearch, vendorFilterProviderId)}
                              icon={<IconInbox size={20} stroke={strokeFor(20)} />}
                            />
                          ) : (
                            <Table caption="Vendor visibility" width="fill">
                              <THead>
                                <TR>
                                  <TH>Vendor</TH>
                                  <TH align="right">Disabled</TH>
                                </TR>
                              </THead>
                              <TBody>
                                {vendorOverrideSettings.map((row) => (
                                  <TR key={row.id}>
                                    <TD>
                                      <VisibilityName kind="vendor" name={row.vendorName} sub={row.providerKey} />
                                    </TD>
                                    <TD align="right">
                                      <OverrideSwitch
                                        name={row.vendorName}
                                        checked={row.disabled}
                                        busy={togglingVendor}
                                        onChange={(checked) => void handleToggleVendorOverride(String(row.vendorId), checked)}
                                      />
                                    </TD>
                                  </TR>
                                ))}
                              </TBody>
                            </Table>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <FilterBar
                          label="Game visibility filters"
                          activeCount={[gameSearch, gameOverrideProviderId, gameOverrideVendorId].filter(Boolean).length}
                          onClearAll={() => {
                            setGameSearch('')
                            setGameOverrideProviderId(undefined)
                            setGameOverrideVendorId(undefined)
                          }}
                          search={(
                            <SearchField
                              label="Search games"
                              placeholder="Search games by name..."
                              size="sm"
                              value={gameSearch}
                              onChange={setGameSearch}
                            />
                          )}
                        >
                          <Select
                            label="Filter game visibility by provider"
                            hideLabel
                            size="sm"
                            value={gameOverrideProviderId ?? ''}
                            options={[{ value: '', label: 'Filter by provider' }, ...providerOptionList]}
                            onChange={(value) => setGameOverrideProviderId(value || undefined)}
                          />
                          <Select
                            label="Filter game visibility by vendor"
                            hideLabel
                            size="sm"
                            value={gameOverrideVendorId ?? ''}
                            options={[{ value: '', label: 'Filter by vendor' }, ...selectedProviderVendors]}
                            onChange={(value) => setGameOverrideVendorId(value || undefined)}
                            disabled={!gameOverrideProviderId}
                          />
                        </FilterBar>
                        <div ref={gameListRef} className={clsx(styles.listBox, styles.gameScroll)}>
                          {gameOverrideLoading && gamePage === 1 ? (
                            <LoadingState label="Loading games..." minHeight={192} />
                          ) : gameOverrideItems.length === 0 ? (
                            <EmptyState
                              title={gameOverridesEmptyText(gameSearch, gameOverrideProviderId, gameOverrideVendorId)}
                              icon={<IconInbox size={20} stroke={strokeFor(20)} />}
                            />
                          ) : (
                            <>
                              <Table
                                caption="Game visibility"
                                width="fill"
                                className={styles.gameTable}
                                wrapperClassName={styles.gameTableWrap}
                              >
                                <THead className={styles.stickyHead}>
                                  <TR>
                                    <TH>Game</TH>
                                    <TH align="right" className={styles.switchCol}>Disabled</TH>
                                  </TR>
                                </THead>
                                <TBody>
                                  {gameOverrideItems.map((row) => (
                                    <TR key={row.id}>
                                      <TD>
                                        <VisibilityName
                                          kind="game"
                                          name={row.gameName}
                                          sub={gameSubLine(row)}
                                          thumbnailUrl={row.thumbnailUrl}
                                        />
                                      </TD>
                                      <TD align="right">
                                        <OverrideSwitch
                                          name={row.gameName}
                                          checked={row.disabled}
                                          busy={togglingGame}
                                          onChange={(checked) => void handleToggleGameOverride(String(row.gameId), checked)}
                                        />
                                      </TD>
                                    </TR>
                                  ))}
                                </TBody>
                              </Table>
                              <div ref={gameSentinelRef} className={styles.sentinel} aria-hidden="true" />
                              <div className={styles.gameFoot}>
                                <span aria-live="polite">{gameCountLabel(gameOverrideItems.length, gameTotal)}</span>
                                {gameOverrideLoading && gamePage > 1 && <Spinner size="sm" label="Loading more games" />}
                              </div>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
              {!providerSettingsTenantId && <p className={styles.hint}>{VISIBILITY_HINT}</p>}
            </div>
          </Card>
        )}

        <div className={styles.scope}>
          <Tabs
            label="Scope selector"
            idPrefix={SCOPE_TABS_ID}
            value={scope}
            items={SCOPE_TAB_ITEMS}
            onChange={setScope}
          />
          <div
            role="tabpanel"
            id={tabPanelId(SCOPE_TABS_ID, scope)}
            aria-labelledby={tabId(SCOPE_TABS_ID, scope)}
            className={styles.scopePanel}
          >
            {scope === 'vendors' ? (
              <>
                <div className={styles.scopeFilter}>
                  <Combobox
                    label="Filter by provider"
                    hideLabel
                    placeholder="Select provider..."
                    clearable
                    size="sm"
                    options={providerOptionList}
                    value={selectedProviderId ?? null}
                    onChange={(v) => setProviderId(v ?? undefined)}
                    className={styles.scopeProvider}
                  />
                  <nav aria-label="Breadcrumb">
                    <ol className={styles.crumbs}>
                      <li className={styles.crumb}>
                        <Button
                          variant="link"
                          size="xs"
                          icon={<IconPlug size={13} stroke={strokeFor(13)} />}
                          onClick={() => setScope('providers')}
                        >
                          Providers
                        </Button>
                      </li>
                      {selectedProviderId && (
                        <li className={styles.crumb}>
                          <span className={styles.crumbSeparator} aria-hidden="true">
                            <IconChevronRight size={12} stroke={strokeFor(12)} />
                          </span>
                          <span className={styles.crumbCurrent} aria-current="location">
                            <span className={styles.crumbIcon} aria-hidden="true">
                              <IconBuildingStore size={13} stroke={strokeFor(13)} />
                            </span>
                            {selectedProviderName || 'Provider'}
                          </span>
                        </li>
                      )}
                    </ol>
                  </nav>
                </div>
                <VendorsDashboard
                  onViewAnalytics={(vendorId, providerId, vendorName) => {
                    setAnalyticsMode({
                      type: 'vendor',
                      vendorId,
                      providerId,
                      title: analyticsTitle(vendorName),
                    })
                    setAnalyticsOpen(true)
                  }}
                />
              </>
            ) : (
              <ProvidersDashboard
                onManageShares={(p) => {
                  setSharesProvider(p)
                  setSharesOpen(true)
                }}
                onViewAnalytics={(p) => {
                  setAnalyticsMode({
                    type: 'provider',
                    providerId: p.id,
                    title: analyticsTitle(p.name),
                  })
                  setAnalyticsOpen(true)
                }}
                onNavigateToVendors={(p) => {
                  setProviderId(p.id)
                  setScope('vendors')
                }}
              />
            )}
          </div>
        </div>
      </div>

      <VendorSharesDrawer
        open={sharesOpen}
        onClose={() => setSharesOpen(false)}
        provider={sharesProvider}
        onSaved={() => {
          /* rely on Apollo cache */
        }}
      />

      <AnalyticsDrawer
        open={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
        mode={analyticsMode}
      />
    </Page>
  )
}
