import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { IconInfoCircle, IconPercentage, IconPlus } from '@tabler/icons-react'
import {
  useMatkaDefaultRates,
  useMatkas,
  useReorderMatkas,
  useUpdateMatkaDefaultRates,
  useUpdateMatkaSettings,
} from '../../modules/matka'
import type { Matka } from '../../modules/matka/types'
import { MATKAS_QUERY } from '../../lib/graphql/matka'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useSearch } from '@/shared/hooks/useSearch'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { Drawer } from '@/ui/components/Drawer'
import { NumberField } from '@/ui/components/NumberField'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Pagination } from '@/ui/components/Pagination'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import { ActionsDrawer } from './components/ActionsDrawer'
import { FiltersBar } from './components/FiltersBar'
import { MatkasTable } from './components/MatkasTable'
import { MultiActions } from './components/MultiActions'
import { SettingsDrawer } from './components/SettingsDrawer'
import { StatsCards } from './components/StatsCards'
import { useSaveMatkaSettings } from './useSaveMatkaSettings'
import {
  BET_TYPES,
  MATKA_PAGE_SIZES,
  buildMatkaFilters,
  defaultRatesInput,
  hydrateRateRows,
  reorderMutationInput,
  sortMatkasByPriority,
  toggleCurrentPageSelection,
  toggleMatkaSelection,
  type DrawerStatus,
  type RateEntry,
  type RateRow,
  type SettingsTab,
  type SettingsValues,
} from './matkaManagementModel'
import styles from './ManagementPage.module.css'

const ACCESS_REQUIREMENT = [{ domain: 'matka.management', actions: ['view'] }]

interface RatesDrawerProps {
  open: boolean
  entries: RateEntry[]
  saving: boolean
  onClose: () => void
  onSave: (rows: RateRow[]) => Promise<void>
}

function RatesDrawer({ open, entries, saving, onClose, onSave }: RatesDrawerProps) {
  const [rows, setRows] = useState<RateRow[]>(() => hydrateRateRows(entries))

  useEffect(() => {
    if (open) setRows(hydrateRateRows(entries))
  }, [entries, open])

  const updateRow = (index: number, patch: Partial<RateRow>) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Rates Defaults"
      sub="Set default payout multipliers and odds limits"
      size="lg"
      footer={(
        <div className={styles.drawerFooter}>
          <span className={styles.footerHint}>
            <IconInfoCircle size={14} stroke={strokeFor(14)} aria-hidden="true" />{' '}
            Set payout multipliers above 0 to enable entries. A rate of 0 leaves that game unavailable.
          </span>
          <div className={styles.footerButtons}>
            <Button size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" loading={saving} onClick={() => void onSave(rows)}>Save</Button>
          </div>
        </div>
      )}
    >
      <div className={styles.drawerBody}>
        <div className={styles.drawerHero}>
          <div className={styles.drawerIdentity}>
            <span className={styles.drawerIcon} aria-hidden="true">
              <IconPercentage size={18} stroke={strokeFor(18)} />
            </span>
            <div className={styles.drawerHeading}>
              <span className={styles.drawerTitle}>Default Bet Type Rates</span>
              <span className={styles.drawerSub}>Set default payout multipliers and odds limits</span>
            </div>
          </div>
          <StatusPill status="Rates" tone="info">Rates</StatusPill>
        </div>

        <div className={styles.rateList}>
          {rows.map((row, index) => (
            <section key={row.betType} className={styles.rateCard} aria-labelledby={`rate-${row.betType}`}>
              <h3 className={styles.rateTitle} id={`rate-${row.betType}`}>{BET_TYPES[index]?.label ?? row.betType}</h3>
              <div className={styles.rateFields}>
                <NumberField
                  label="Payout x"
                  size="sm"
                  min={0}
                  step={0.1}
                  value={row.payoutMultiplier}
                  onChange={(value) => updateRow(index, { payoutMultiplier: value ?? 0 })}
                />
                <NumberField
                  label="Min Odds"
                  size="sm"
                  min={0}
                  step={0.1}
                  value={row.minOdds}
                  onChange={(value) => updateRow(index, { minOdds: value })}
                />
                <NumberField
                  label="Max Odds"
                  size="sm"
                  min={0}
                  step={0.1}
                  value={row.maxOdds}
                  onChange={(value) => updateRow(index, { maxOdds: value })}
                />
              </div>
            </section>
          ))}
        </div>
      </div>
    </Drawer>
  )
}

export default function MatkaManagementPage() {
  return (
    <RBACGuard required={ACCESS_REQUIREMENT}>
      <MatkaManagementPageContent />
    </RBACGuard>
  )
}

function MatkaManagementPageContent() {
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const ratesTriggerRef = useRef<HTMLButtonElement | null>(null)
  const { query, setQuery, debouncedQuery } = useSearch({ minLength: 2 })
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const filters = useMemo(
    () => buildMatkaFilters(debouncedQuery, status, page, pageSize),
    [debouncedQuery, page, pageSize, status],
  )
  const { data, loading, refetch } = useMatkas(filters)
  const [items, setItems] = useState<Matka[]>([])
  const total = data?.matkas?.total ?? 0

  useEffect(() => {
    if (data?.matkas?.items) setItems(sortMatkasByPriority(data.matkas.items))
  }, [data])

  const { data: allTotalData } = useMatkas({ page: 1, limit: 1 })
  const { data: activeTotalData } = useMatkas({ status: 'ACTIVE', page: 1, limit: 1 })
  const { data: inactiveTotalData } = useMatkas({ status: 'INACTIVE', page: 1, limit: 1 })
  const { data: suspendTotalData } = useMatkas({ status: 'SUSPEND', page: 1, limit: 1 })
  const statsTotals = {
    total: allTotalData?.matkas?.total ?? 0,
    active: activeTotalData?.matkas?.total ?? 0,
    inactive: inactiveTotalData?.matkas?.total ?? 0,
    suspended: suspendTotalData?.matkas?.total ?? 0,
  }

  const [reorderMatkas] = useReorderMatkas()
  const [updateSettings] = useUpdateMatkaSettings()
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  const [actionsOpen, setActionsOpen] = useState(false)
  const [selectedMatka, setSelectedMatka] = useState<Matka | null>(null)
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false)
  const [drawerActive, setDrawerActive] = useState<DrawerStatus>(true)
  const { save: persistSettings, saving: savingSettings } = useSaveMatkaSettings()

  const [ratesDrawerOpen, setRatesDrawerOpen] = useState(false)
  const { data: defaultRatesData } = useMatkaDefaultRates()
  const [updateDefaultRates, { loading: savingDefaults }] = useUpdateMatkaDefaultRates()
  const defaultEntries = (defaultRatesData?.matkaDefaultRates?.entries ?? []) as RateEntry[]

  useEffect(() => setPage(1), [query, status])

  const handleReorder = (reordered: Matka[]) => {
    setItems(reordered)
    reorderMatkas({
      variables: { input: reorderMutationInput(reordered) },
      context: { uiToast: 'message' },
      refetchQueries: [{ query: MATKAS_QUERY, variables: { filters } }],
      awaitRefetchQueries: true,
    }).catch(() => refetch())
  }

  const openSettings = (matka: Matka, tab: SettingsTab) => {
    navigate(`/matka/settings/${encodeURIComponent(matka.id)}?tab=${tab}`)
  }

  const saveSettings = async (values: SettingsValues) => {
    await persistSettings(items.filter(matka => selectedKeys.has(matka.id)), drawerActive, values)
    setSettingsDrawerOpen(false)
    setSelectedKeys(new Set())
    await refetch()
  }

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Matka Management"
        sub="Manage matka catalog and schedules"
        actions={(
          <div className={styles.headerActions}>
            <Button
              ref={ratesTriggerRef}
              icon={<IconPercentage size={16} stroke={strokeFor(16)} />}
              onClick={() => setRatesDrawerOpen(true)}
            >
              Rates Defaults
            </Button>
            <Link
              to="/matka/create"
              className={buttonClassName({ variant: 'primary' })}
            >
              <IconPlus size={16} stroke={strokeFor(16)} aria-hidden="true" />
              <span>Create Matka</span>
            </Link>
          </div>
        )}
      />

      <div className={styles.content}>
        <StatsCards totals={statsTotals} />
        {defaultRatesData && !defaultEntries.some(entry => Number(entry.payoutMultiplier) > 0) && (
          <div className={styles.rateSetupNotice} role="status">
            <div><strong>Default payout rates are not configured</strong><p>Markets without their own active rate version cannot accept entries. Configure Rates Defaults, then check each market's session settings before opening betting.</p></div>
            <Button size="sm" onClick={() => setRatesDrawerOpen(true)}>Configure rates</Button>
          </div>
        )}
        <FiltersBar
          query={query}
          status={status}
          onChangeQuery={setQuery}
          onChangeStatus={setStatus}
          onClearAll={() => {
            setQuery('')
            setStatus('')
            setPage(1)
            refetch()
          }}
        />
        <MatkasTable
          matkas={items}
          fetching={loading}
          selectedKeys={selectedKeys}
          onToggleSelect={(id) => setSelectedKeys((current) => toggleMatkaSelection(current, id))}
          onToggleSelectAll={() => setSelectedKeys((current) => toggleCurrentPageSelection(current, items))}
          onOpenRules={(matka) => openSettings(matka, 'bid')}
          onOpenActions={(matka) => openSettings(matka, 'stake')}
          onOpenDetails={(matka) => {
            setSelectedMatka(matka)
            setActionsOpen(true)
          }}
          onEdit={(matka) => navigate(`/matka/edit/${matka.id}`)}
          onReorder={handleReorder}
          onSaveMessage={async (matka, message) => {
            await updateSettings({ variables: { id: matka.id, settings: { ...(matka.settings ?? {}), message } } })
            await refetch()
          }}
          headerActions={(
            <MultiActions
              selectedCount={selectedKeys.size}
              onUpdate={() => {
                setSelectedMatka(null)
                setSettingsDrawerOpen(true)
              }}
              onClear={() => setSelectedKeys(new Set())}
            />
          )}
          footer={(
            <Pagination loading={loading}
              current={page}
              pageSize={pageSize}
              total={total}
              onChange={setPage}
              onPageSizeChange={setPageSize}
              itemName="matkas"
              pageSizeOptions={MATKA_PAGE_SIZES}
              variant="embedded"
            />
          )}
        />
      </div>

      <SettingsDrawer
        open={settingsDrawerOpen}
        onClose={() => {
          setSettingsDrawerOpen(false)
          setSelectedMatka(null)
        }}
        mode="bulk"
        matka={null}
        selectedMatkas={items.filter((matka) => selectedKeys.has(matka.id))}
        drawerActive={drawerActive}
        setDrawerActive={setDrawerActive}
        saving={savingSettings}
        initialTab="stake"
        onSave={saveSettings}
      />

      <RatesDrawer
        open={ratesDrawerOpen}
        entries={defaultEntries}
        saving={savingDefaults}
        onClose={() => setRatesDrawerOpen(false)}
        onSave={async (rows) => {
          await updateDefaultRates({ variables: { entries: defaultRatesInput(rows) } })
          setRatesDrawerOpen(false)
          refetch()
        }}
      />

      <ActionsDrawer
        matka={selectedMatka}
        open={actionsOpen}
        onClose={() => {
          setActionsOpen(false)
          setSelectedMatka(null)
        }}
        onRefetch={() => refetch()}
      />
    </Page>
  )
}
