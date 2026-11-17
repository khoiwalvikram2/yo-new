import { useMemo, useState } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import {
  IconAlertCircle,
  IconBuildingStore,
  IconCheck,
  IconCircleCheck,
  IconCircleX,
  IconInbox,
  IconX,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { CASINO_VENDORS_WITH_SETTINGS, CASINO_API_PROVIDERS, TOGGLE_CASINO_VENDOR_ENABLED, BULK_UPDATE_VENDOR_SETTINGS } from '@/lib/graphql/casino'
import { useAuthStore } from '@/shared/core/authStore'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useUIStore } from '@/shared/core/uiStore'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Checkbox } from '@/ui/components/Checkbox'
import { confirm } from '@/ui/components/confirm'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { FilterBar } from '@/ui/components/FilterBar'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { Grid } from '@/ui/components/LayoutPrimitives'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Pagination } from '@/ui/components/Pagination'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import { Spinner } from '@/ui/components/Spinner'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { toast } from '@/ui/components/toast'
import { Tooltip } from '@/ui/components/Tooltip'
import { isCoreModeView } from './casinoManagementModel'
import {
  BULK_ERROR_FALLBACK,
  CATEGORY_OPTIONS,
  CATEGORY_PLACEHOLDER,
  CORE_MODE_VENDOR_HINT,
  DEFAULT_PAGE_SIZE,
  MESSAGE_DURATION_MS,
  NOTIFICATION_DURATION_MS,
  PAGE_SIZE_OPTIONS,
  PAGE_SUB,
  PAGE_TITLE,
  PROVIDER_PLACEHOLDER,
  TOGGLE_ERROR_FALLBACK,
  buildBulkVariables,
  buildToggleVariables,
  bulkButtonLabel,
  bulkConfirmCopy,
  bulkEmptySelectionWarning,
  clampPage,
  countVendorFilters,
  filterVendors,
  isVendorCategory,
  isVendorEnabled,
  isWhitelabelAdminRoles,
  mutationErrorMessage,
  pageSlice,
  providerOptions,
  rowToggleLabel,
  selectAllState,
  statusSwitchLabel,
  toggleAllVendors,
  toggleVendorSelection,
  totalVendorGames,
  vendorCountLabel,
  vendorStats,
  vendorStatusLabel,
  rowToggleTarget,
  type BulkUpdateVendorSettingsData,
  type CasinoApiProvider,
  type CasinoApiProvidersData,
  type CasinoVendorsWithSettingsData,
  type ToggleCasinoVendorEnabledData,
  type VendorCategory,
  type VendorStats,
  type VendorWithSettings,
} from './vendorManagementModel'
import styles from './VendorManagementPage.module.css'

const VENDORS_ACCESS_REQUIREMENT = [{ domain: 'casino.vendors', actions: ['view'] }]

/** Columns that are one whitelabel's settings; core mode has no whitelabel, so it shows none of them. */
const WHITELABEL_COLUMNS = new Set(['enabledGamesCount', 'status', 'actions'])

function VendorStatsGrid({ stats, coreMode, totalGames }: { stats: VendorStats; coreMode: boolean; totalGames: number }) {
  return (
    <Grid cols={{ base: 1, md: 3 }} gap={12} role="group" aria-label="Vendor statistics">
      <Stat
        label="Total Vendors"
        value={stats.total}
        icon={<IconBuildingStore size={18} stroke={strokeFor(18)} />}
        hue="blu"
      />
      {coreMode ? (
        <Stat
          label="Total Games"
          value={totalGames}
          icon={<IconCircleCheck size={18} stroke={strokeFor(18)} />}
          hue="grn"
        />
      ) : (
        <>
          <Stat
            label="Enabled"
            value={stats.enabled}
            icon={<IconCircleCheck size={18} stroke={strokeFor(18)} />}
            hue="grn"
          />
          <Stat
            label="Disabled"
            value={stats.disabled}
            icon={<IconCircleX size={18} stroke={strokeFor(18)} />}
            hue="vio"
          />
        </>
      )}
    </Grid>
  )
}

function VendorDetailsCell({
  vendor,
  selected,
  onSelect,
  coreMode,
}: {
  vendor: VendorWithSettings
  selected: boolean
  onSelect: (checked: boolean) => void
  coreMode: boolean
}) {
  const status = vendorStatusLabel(vendor.enabled)
  return (
    <div className={styles.vendorCell}>
      {!coreMode ? <Checkbox checked={selected} onChange={onSelect} label={`Select ${vendor.name}`} hideLabel /> : null}
      <div className={styles.vendorBody}>
        <span className={styles.vendorName} title={vendor.name}>{vendor.name}</span>
        {!coreMode ? <StatusPill status={status}>{status}</StatusPill> : null}
      </div>
    </div>
  )
}

/* The switch and the row action share one busy flag: while a vendor's toggle is in flight both are inert,
   as the legacy disabled+loading switch and loading button were. */
function VendorStatusSwitch({
  vendor,
  busy,
  onToggle,
}: {
  vendor: VendorWithSettings
  busy: boolean
  onToggle: (enabled: boolean) => void
}) {
  return (
    <span className={styles.statusCell}>
      <Switch
        size="sm"
        checked={isVendorEnabled(vendor.enabled)}
        onChange={onToggle}
        label={statusSwitchLabel(vendor.name)}
        hideLabel
        aria-disabled={busy ? true : undefined}
        aria-busy={busy ? true : undefined}
      />
      <span className={styles.statusBusy}>{busy ? <Spinner size="sm" decorative /> : null}</span>
    </span>
  )
}

function VendorRowToggle({
  vendor,
  busy,
  onToggle,
}: {
  vendor: VendorWithSettings
  busy: boolean
  onToggle: () => void
}) {
  const icon = busy ? (
    <Spinner size="sm" decorative />
  ) : isVendorEnabled(vendor.enabled) ? (
    <IconX size={15} stroke={strokeFor(15)} />
  ) : (
    <IconCheck size={15} stroke={strokeFor(15)} />
  )
  return (
    <Tooltip content="Toggle Status">
      <IconButton
        size="sm"
        label={rowToggleLabel(vendor.name, vendor.enabled)}
        icon={icon}
        aria-disabled={busy ? true : undefined}
        aria-busy={busy ? true : undefined}
        onClick={onToggle}
      />
    </Tooltip>
  )
}

export default function VendorManagementPage() {
  return (
    <RBACGuard required={VENDORS_ACCESS_REQUIREMENT}>
      <VendorManagementPageContent />
    </RBACGuard>
  )
}

function VendorManagementPageContent() {
  const pageEyebrow = usePageEyebrow()
  const roles = useAuthStore((s) => s.roles)
  const isWhitelabelAdmin = isWhitelabelAdminRoles(roles)
  const directorMode = useUIStore((s) => s.directorMode)
  const coreMode = isCoreModeView(roles, directorMode)

  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>()
  const [selectedCategory, setSelectedCategory] = useState<VendorCategory | undefined>()
  const [searchText, setSearchText] = useState('')
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  const [loadingVendors, setLoadingVendors] = useState<Set<string>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const { data: providersData } = useQuery<CasinoApiProvidersData>(CASINO_API_PROVIDERS, {
    errorPolicy: 'all',
    skip: isWhitelabelAdmin, // Don't fetch providers for whitelabel admin
  })

  const { data, loading, error, refetch } = useQuery<CasinoVendorsWithSettingsData>(CASINO_VENDORS_WITH_SETTINGS, {
    variables: {
      providerId: isWhitelabelAdmin ? undefined : selectedProviderId,
      category: selectedCategory,
    },
    errorPolicy: 'all',
  })

  const [toggleVendor] = useMutation<ToggleCasinoVendorEnabledData>(TOGGLE_CASINO_VENDOR_ENABLED, {
    onCompleted: (data) => {
      if (data?.toggleCasinoVendorEnabled?.success) {
        toast({
          title: 'Success',
          message: data.toggleCasinoVendorEnabled.message ?? '',
          tone: 'ok',
          duration: NOTIFICATION_DURATION_MS,
        })
        void refetch()
      }
    },
    onError: (error) => {
      toast({
        title: 'Error',
        message: mutationErrorMessage(error, TOGGLE_ERROR_FALLBACK),
        tone: 'error',
        duration: NOTIFICATION_DURATION_MS,
      })
    },
  })

  const [bulkUpdate] = useMutation<BulkUpdateVendorSettingsData>(BULK_UPDATE_VENDOR_SETTINGS, {
    onCompleted: (data) => {
      if (data?.bulkUpdateVendorSettings?.success) {
        toast({
          title: 'Success',
          message: data.bulkUpdateVendorSettings.message ?? '',
          tone: 'ok',
          duration: NOTIFICATION_DURATION_MS,
        })
        setSelectedRowKeys([])
        void refetch()
      }
    },
    onError: (error) => {
      toast({
        title: 'Error',
        message: mutationErrorMessage(error, BULK_ERROR_FALLBACK),
        tone: 'error',
        duration: NOTIFICATION_DURATION_MS,
      })
    },
  })

  const handleToggleVendor = async (vendorId: string, enabled: boolean) => {
    setLoadingVendors((prev) => new Set(prev).add(vendorId))
    try {
      await toggleVendor({
        variables: buildToggleVariables(vendorId, enabled),
      })
    } finally {
      setLoadingVendors((prev) => {
        const next = new Set(prev)
        next.delete(vendorId)
        return next
      })
    }
  }

  /* The legacy enable and disable handlers, merged on their one difference. The empty-selection warning
     cannot be reached from the page (the bulk buttons show only with a selection) and is kept as it was. */
  const handleBulkUpdate = async (enabled: boolean) => {
    if (selectedRowKeys.length === 0) {
      toast({ message: bulkEmptySelectionWarning(enabled), tone: 'warn', duration: MESSAGE_DURATION_MS })
      return
    }
    await bulkUpdate({
      variables: buildBulkVariables(selectedRowKeys, enabled),
    })
  }

  // The legacy Popconfirm, now a modal confirmation (D5) with the same copy. It stays open, busy, until
  // the server answers; the outcome is reported by the toasts above.
  const requestBulkUpdate = (enabled: boolean) => {
    void confirm({
      ...bulkConfirmCopy(enabled),
      onConfirm: () => handleBulkUpdate(enabled),
    })
  }

  const vendors = useMemo<VendorWithSettings[]>(() => data?.casinoVendorsWithSettings || [], [data])
  const providers: CasinoApiProvider[] = providersData?.casinoApiProviders || []

  const filteredVendors = useMemo(() => filterVendors(vendors, searchText), [vendors, searchText])

  const page = clampPage(currentPage, filteredVendors.length, pageSize)
  const paginatedVendors = useMemo(
    () => pageSlice(filteredVendors, page, pageSize),
    [filteredVendors, page, pageSize],
  )

  const stats = useMemo(() => vendorStats(vendors), [vendors])
  const totalGames = useMemo(() => totalVendorGames(vendors), [vendors])

  if (error) {
    return (
      <Page maxWidth="wide">
        <PageHeader eyebrow={pageEyebrow} title={PAGE_TITLE} sub={PAGE_SUB} />
        <Notice
          tone="error"
          live="assertive"
          icon={<IconAlertCircle size={18} stroke={strokeFor(18)} />}
          title="Error loading vendors"
          action={(
            <Button size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          )}
        >
          {error.message}
        </Notice>
      </Page>
    )
  }

  const selectedCount = coreMode ? 0 : selectedRowKeys.length
  const allState = selectAllState(filteredVendors, selectedRowKeys)

  const allColumns: DataTableColumn<VendorWithSettings>[] = [
    {
      key: 'vendor',
      header: coreMode ? 'Vendor Details' : (
        <span className={styles.selectHead}>
          <Checkbox
            checked={allState.checked}
            indeterminate={allState.indeterminate}
            onChange={(checked) => setSelectedRowKeys(toggleAllVendors(filteredVendors, checked))}
            label="Select all vendors"
            hideLabel
          />
          <span>Vendor Details</span>
        </span>
      ),
      cell: (vendor) => (
        <VendorDetailsCell
          vendor={vendor}
          selected={selectedRowKeys.includes(vendor.id)}
          onSelect={(checked) =>
            setSelectedRowKeys((previous) => toggleVendorSelection(previous, vendor.id, checked))
          }
          coreMode={coreMode}
        />
      ),
    },
    { key: 'slug', header: 'Slug', emphasis: 'dim', cell: (vendor) => vendor.slug },
    {
      key: 'gamesCount',
      header: 'Total Games',
      align: 'right',
      cell: (vendor) => <span className={styles.count}>{vendor.gamesCount}</span>,
    },
    {
      key: 'enabledGamesCount',
      header: 'Enabled Games',
      align: 'right',
      cell: (vendor) => (
        <span className={clsx(styles.count, vendor.enabledGamesCount > 0 ? styles.countOn : styles.countOff)}>
          {vendor.enabledGamesCount}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      cell: (vendor) => (
        <VendorStatusSwitch
          vendor={vendor}
          busy={loadingVendors.has(vendor.id)}
          onToggle={(checked) => void handleToggleVendor(vendor.id, checked)}
        />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      sticky: 'end',
      cell: (vendor) => (
        <VendorRowToggle
          vendor={vendor}
          busy={loadingVendors.has(vendor.id)}
          onToggle={() => void handleToggleVendor(vendor.id, rowToggleTarget(vendor.enabled))}
        />
      ),
    },
  ]
  const columns = coreMode ? allColumns.filter((column) => !WHITELABEL_COLUMNS.has(column.key)) : allColumns

  return (
    <Page maxWidth="wide">
      <PageHeader eyebrow={pageEyebrow} title={PAGE_TITLE} sub={PAGE_SUB} />

      <div className={styles.content}>
        {coreMode ? <Notice tone="info" title="Core mode">{CORE_MODE_VENDOR_HINT}</Notice> : null}
        <VendorStatsGrid stats={stats} coreMode={coreMode} totalGames={totalGames} />

        <FilterBar
          label="Filters"
          activeCount={countVendorFilters(searchText, selectedProviderId, selectedCategory)}
          onClearAll={() => {
            setSearchText('')
            setSelectedProviderId(undefined)
            setSelectedCategory(undefined)
          }}
          search={(
            <SearchField
              label="Search vendors"
              placeholder="Search vendors..."
              size="sm"
              value={searchText}
              onChange={setSearchText}
            />
          )}
        >
          {!isWhitelabelAdmin && (
            <Select
              label={PROVIDER_PLACEHOLDER}
              hideLabel
              size="sm"
              value={selectedProviderId ?? ''}
              options={[{ value: '', label: PROVIDER_PLACEHOLDER }, ...providerOptions(providers)]}
              onChange={(value) => setSelectedProviderId(value || undefined)}
              className={styles.filterSelect}
            />
          )}
          <Select
            label={CATEGORY_PLACEHOLDER}
            hideLabel
            size="sm"
            value={selectedCategory ?? ''}
            options={[{ value: '', label: CATEGORY_PLACEHOLDER }, ...CATEGORY_OPTIONS]}
            onChange={(value) => setSelectedCategory(isVendorCategory(value) ? value : undefined)}
            className={styles.filterSelect}
          />
        </FilterBar>

        <Card title={PAGE_TITLE} sub={vendorCountLabel(filteredVendors.length)} body="table">
          {selectedCount > 0 ? (
            <div className={styles.bulk} role="group" aria-label="Bulk actions">
              <span className={styles.bulkCount}>{selectedCount.toLocaleString()} selected</span>
              <div className={styles.bulkActions}>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<IconCheck size={15} stroke={strokeFor(15)} />}
                  onClick={() => requestBulkUpdate(true)}
                >
                  {bulkButtonLabel(true, selectedCount)}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  icon={<IconX size={15} stroke={strokeFor(15)} />}
                  onClick={() => requestBulkUpdate(false)}
                >
                  {bulkButtonLabel(false, selectedCount)}
                </Button>
              </div>
            </div>
          ) : null}
          <DataTable
            columns={columns}
            rows={paginatedVendors}
            rowKey={(vendor) => vendor.id}
            label="Vendors"
            state={loading ? 'loading' : 'ready'}
            width="wide"
            empty={(
              <EmptyState title="No vendors found" icon={<IconInbox size={20} stroke={strokeFor(20)} />} />
            )}
          />
          {filteredVendors.length > 0 ? (
            <Pagination
              current={page}
              pageSize={pageSize}
              total={filteredVendors.length}
              onChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              itemName="vendors"
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              variant="embedded"
            />
          ) : null}
        </Card>
      </div>
    </Page>
  )
}

