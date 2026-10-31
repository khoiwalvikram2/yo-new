import { useEffect, useMemo, useState } from 'react'
import { gql, useMutation, useQuery } from '@apollo/client'
import { IconCheck, IconInfoCircle, IconList, IconPlus, IconRotate, IconTrash } from '@tabler/icons-react'
import { LIST_EVENTS, LIST_LEAGUES, LIST_SPORTS } from '@/lib/graphql/sports'
import { Button } from '@/ui/components/Button'
import { Combobox } from '@/ui/components/Combobox'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Drawer } from '@/ui/components/Drawer'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { Notice } from '@/ui/components/Notice'
import { Switch } from '@/ui/components/Switch'
import { Tabs } from '@/ui/components/Tabs'
import { confirm } from '@/ui/components/confirm'
import { strokeFor } from '@/ui/components/icons'
import { tabPanelId } from '@/ui/components/tabIds'
import { toast } from '@/ui/components/toast'
import {
  CRICKET_ONLY_TOGGLE,
  autoResultsSaveBlocker,
  buildAutoResultsInput,
  findExactSetting,
  namedOptions,
  offToggles,
  scopeDisplay,
  scopeSportCode,
  settingIsCricket,
  toggleRefused,
  type AutoResultsSetting,
  type MarketToggles,
  type MarketType,
} from '../manualResultsModel'
import styles from '../ManualResultsPage.module.css'

const SPORTS_AUTO_RESULTS_SETTINGS = gql`
  query SportsAutoResultsSettings($filters: SportsAutoResultsSettingsQuery) {
    sportsAutoResultsSettings(filters: $filters) {
      id
      sportId
      leagueId
      eventId
      exchangeEnabled
      bookmakerEnabled
      fancyEnabled
      createdAt
      updatedAt
      sport {
        id
        name
      }
      league {
        id
        name
      }
      event {
        id
        name
      }
    }
  }
`

const UPSERT_SPORTS_AUTO_RESULTS_SETTINGS = gql`
  mutation UpsertSportsAutoResultsSettings($input: SportsAutoResultsSettingsInput!) {
    upsertSportsAutoResultsSettings(input: $input) {
      success
      message
    }
  }
`

const TOGGLE_AUTO_RESULT_MARKET_TYPE = gql`
  mutation ToggleAutoResultMarketType($input: ToggleAutoResultMarketTypeInput!) {
    toggleAutoResultMarketType(input: $input) {
      success
      message
    }
  }
`

const DELETE_SPORTS_AUTO_RESULTS_SETTINGS = gql`
  mutation DeleteSportsAutoResultsSettings($id: ID!) {
    deleteSportsAutoResultsSettings(id: $id) {
      success
      message
    }
  }
`

interface AutoResultsSettingsDrawerProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  restoreFocusTo?: { readonly current: HTMLElement | null }
}

interface SportItem { id: string; name: string; sportCode?: string | null }
interface LeagueItem { id: string; name: string; sportId?: string | null }
interface EventItem { id: string; name: string }
interface SportsData { sports?: SportItem[] }
interface LeaguesData { leagues?: LeagueItem[] }
interface EventsData { events?: EventItem[] }
interface SettingsData { sportsAutoResultsSettings?: AutoResultsSetting[] }

type SettingsTab = 'make' | 'all'

const TAB_ITEMS = [
  { value: 'make', label: 'Make Settings', icon: <IconPlus size={15} stroke={strokeFor(15)} /> },
  { value: 'all', label: 'All Settings', icon: <IconList size={15} stroke={strokeFor(15)} /> },
] as const

export function AutoResultsSettingsDrawer({ open, onClose, onSuccess, restoreFocusTo }: AutoResultsSettingsDrawerProps) {
  const [selectedSportId, setSelectedSportId] = useState<string | undefined>()
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | undefined>()
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>()
  const [toggles, setToggles] = useState<MarketToggles>(offToggles)
  const [activeTab, setActiveTab] = useState<SettingsTab>('make')

  const { data: sportsData, loading: sportsLoading } = useQuery<SportsData>(LIST_SPORTS, { errorPolicy: 'all' })
  const { data: leaguesData, loading: leaguesLoading } = useQuery<LeaguesData>(LIST_LEAGUES, {
    variables: { sportId: selectedSportId || '' },
    skip: !selectedSportId,
    errorPolicy: 'all',
  })
  const { data: eventsData, loading: eventsLoading } = useQuery<EventsData>(LIST_EVENTS, {
    variables: { leagueId: selectedLeagueId || '' },
    skip: !selectedLeagueId,
    errorPolicy: 'all',
  })
  const { data: settingsData, loading: settingsLoading, refetch: refetchSettings } = useQuery<SettingsData>(SPORTS_AUTO_RESULTS_SETTINGS, {
    errorPolicy: 'all',
  })
  const [upsertSettings, { loading: saving }] = useMutation(UPSERT_SPORTS_AUTO_RESULTS_SETTINGS, {
    refetchQueries: [{ query: SPORTS_AUTO_RESULTS_SETTINGS }],
  })
  const [toggleMarketType, { loading: toggling }] = useMutation(TOGGLE_AUTO_RESULT_MARKET_TYPE, {
    refetchQueries: [{ query: SPORTS_AUTO_RESULTS_SETTINGS }],
  })
  const [deleteSettings, { loading: deleting }] = useMutation(DELETE_SPORTS_AUTO_RESULTS_SETTINGS, {
    refetchQueries: [{ query: SPORTS_AUTO_RESULTS_SETTINGS }],
  })

  const sports = useMemo(() => sportsData?.sports ?? [], [sportsData?.sports])
  const leagues = useMemo(() => leaguesData?.leagues ?? [], [leaguesData?.leagues])
  const events = useMemo(() => eventsData?.events ?? [], [eventsData?.events])
  const settings = useMemo(
    () => settingsData?.sportsAutoResultsSettings ?? [],
    [settingsData?.sportsAutoResultsSettings],
  )
  const sportCode = scopeSportCode(sports, leagues, selectedSportId, selectedLeagueId)
  const isCricket = sportCode === '4'

  useEffect(() => {
    if (!selectedSportId && !selectedLeagueId && !selectedEventId) return
    const existing = findExactSetting(settings, selectedSportId, selectedLeagueId, selectedEventId)
    setToggles(existing ? {
      exchangeEnabled: existing.exchangeEnabled,
      bookmakerEnabled: existing.bookmakerEnabled,
      fancyEnabled: existing.fancyEnabled,
    } : offToggles())
  }, [selectedSportId, selectedLeagueId, selectedEventId, settings])

  useEffect(() => {
    if (open) setToggles(offToggles())
  }, [open])

  const resetForm = () => {
    setSelectedSportId(undefined)
    setSelectedLeagueId(undefined)
    setSelectedEventId(undefined)
    setToggles(offToggles())
  }

  const close = () => {
    resetForm()
    onClose()
  }

  const save = async () => {
    const blocker = autoResultsSaveBlocker({
      sportId: selectedSportId,
      leagueId: selectedLeagueId,
      eventId: selectedEventId,
      isCricket,
      toggles,
    })
    if (blocker) {
      toast({ title: 'Error', message: blocker, tone: 'error' })
      return
    }
    try {
      const response = await upsertSettings({
        variables: { input: buildAutoResultsInput({ sportId: selectedSportId, leagueId: selectedLeagueId, eventId: selectedEventId, isCricket, toggles }) },
        context: { uiToast: 'notification' },
      })
      if (response.data?.upsertSportsAutoResultsSettings?.success) {
        resetForm()
        setActiveTab('all')
        onSuccess?.()
        void refetchSettings()
      }
    } catch {
      // The Apollo notification link owns mutation failure feedback, as before.
    }
  }

  const toggleSaved = async (id: string, marketType: MarketType, enabled: boolean) => {
    if (toggleRefused(settings, id, marketType, enabled, sports)) {
      toast({ title: 'Error', message: CRICKET_ONLY_TOGGLE, tone: 'error' })
      return
    }
    try {
      const response = await toggleMarketType({
        variables: { input: { id, marketType, enabled } },
        context: { uiToast: 'notification' },
      })
      if (response.data?.toggleAutoResultMarketType?.success) void refetchSettings()
    } catch {
      // The Apollo notification link owns mutation failure feedback, as before.
    }
  }

  const deleteSaved = async (id: string) => {
    try {
      const response = await deleteSettings({ variables: { id }, context: { uiToast: 'notification' } })
      if (response.data?.deleteSportsAutoResultsSettings?.success) void refetchSettings()
    } catch {
      // The Apollo notification link owns mutation failure feedback, as before.
    }
  }

  const askDelete = (setting: AutoResultsSetting) => {
    void confirm({
      title: 'Delete Settings',
      description: 'Are you sure you want to delete these settings?',
      confirmLabel: 'Yes',
      cancelLabel: 'No',
      tone: 'danger',
      onConfirm: () => deleteSaved(setting.id),
    })
  }

  const columns: DataTableColumn<AutoResultsSetting>[] = [
    {
      key: 'scope',
      header: 'Scope',
      cell: (setting) => <span className={styles.scopeSetting}>{scopeDisplay(setting)}</span>,
    },
    {
      key: 'exchange',
      header: 'Exchange',
      align: 'center',
      width: 100,
      cell: (setting) => (
        <span className={styles.switchCell}>
          <Switch
            checked={setting.exchangeEnabled}
            label={`Exchange for ${scopeDisplay(setting)}`}
            hideLabel
            disabled={toggling}
            onChange={(enabled) => void toggleSaved(setting.id, 'exchange', enabled)}
          />
        </span>
      ),
    },
    {
      key: 'bookmaker',
      header: 'Bookmaker',
      align: 'center',
      width: 120,
      cell: (setting) => settingIsCricket(setting, sports) ? (
        <span className={styles.switchCell}>
          <Switch
            checked={setting.bookmakerEnabled}
            label={`Bookmaker for ${scopeDisplay(setting)}`}
            hideLabel
            disabled={toggling}
            onChange={(enabled) => void toggleSaved(setting.id, 'bookmaker', enabled)}
          />
        </span>
      ) : null,
    },
    {
      key: 'fancy',
      header: 'Fancy',
      align: 'center',
      width: 100,
      cell: (setting) => settingIsCricket(setting, sports) ? (
        <span className={styles.switchCell}>
          <Switch
            checked={setting.fancyEnabled}
            label={`Fancy for ${scopeDisplay(setting)}`}
            hideLabel
            disabled={toggling}
            onChange={(enabled) => void toggleSaved(setting.id, 'fancy', enabled)}
          />
        </span>
      ) : null,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      width: 92,
      sticky: 'end',
      cell: (setting) => (
        <span className={styles.actionCell}>
          <IconButton
            size="sm"
            className={styles.deleteButton}
            label={`Delete settings for ${scopeDisplay(setting)}`}
            icon={<IconTrash size={15} stroke={strokeFor(15)} />}
            disabled={deleting}
            onClick={() => askDelete(setting)}
          />
        </span>
      ),
    },
  ]

  return (
    <Drawer
      title="Auto Results Settings"
      size="md"
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      themeFrom={restoreFocusTo}
      restoreFocusTo={restoreFocusTo}
      footer={(
        <div className={styles.drawerFooter}>
          <p className={styles.footerHint}>
            <IconInfoCircle size={15} stroke={strokeFor(15)} aria-hidden="true" />
            Configure automatic result declaration for sports markets
          </p>
          <div className={styles.footerActions}>
            <Button size="sm" icon={<IconRotate size={15} stroke={strokeFor(15)} />} onClick={resetForm}>Reset</Button>
            <Button size="sm" onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              icon={<IconCheck size={15} stroke={strokeFor(15)} />}
              loading={saving}
              onClick={() => void save()}
            >
              Save Settings
            </Button>
          </div>
        </div>
      )}
    >
      <div className={styles.drawerStack}>
        <Tabs
          value={activeTab}
          items={TAB_ITEMS}
          onChange={setActiveTab}
          label="Auto results settings tabs"
          idPrefix="auto-results-settings"
          className={styles.tabs}
        />

        {activeTab === 'make' ? (
          <div
            id={tabPanelId('auto-results-settings', 'make')}
            role="tabpanel"
            aria-labelledby="auto-results-settings-tab-make"
            className={styles.tabPanel}
          >
            <Notice tone="info" title="Configure automatic result declaration for sports markets">
              Select a scope (Sport, League, or Event) and enable market types. At least one market type must be enabled.
            </Notice>
            <div className={styles.settingsPanel}>
              <Combobox
                label="Sport (Optional)"
                placeholder="Select sport (optional)"
                loading={sportsLoading}
                clearable
                options={namedOptions(sports)}
                value={selectedSportId ?? null}
                onChange={(value) => {
                  const sportId = value ?? undefined
                  setSelectedSportId(sportId)
                  setSelectedLeagueId(undefined)
                  setSelectedEventId(undefined)
                  const sport = sports.find((item) => item.id === sportId)
                  if (sport && sport.sportCode !== '4') {
                    setToggles((current) => ({ ...current, bookmakerEnabled: false, fancyEnabled: false }))
                  }
                }}
              />
              <Combobox
                label="League (Optional)"
                placeholder="Select league (optional)"
                loading={leaguesLoading}
                clearable
                disabled={!selectedSportId}
                options={namedOptions(leagues)}
                value={selectedLeagueId ?? null}
                onChange={(value) => {
                  setSelectedLeagueId(value ?? undefined)
                  setSelectedEventId(undefined)
                }}
              />
              <Combobox
                label="Event (Optional)"
                placeholder="Select event (optional)"
                loading={eventsLoading}
                clearable
                disabled={!selectedLeagueId}
                options={namedOptions(events)}
                value={selectedEventId ?? null}
                onChange={(value) => setSelectedEventId(value ?? undefined)}
              />

              <section className={styles.marketSwitches} aria-labelledby="auto-result-market-types">
                <h3 id="auto-result-market-types" className={styles.sectionTitle}>Market Types</h3>
                <div className={styles.marketSwitch}>
                  <span>Exchange</span>
                  <Switch
                    checked={toggles.exchangeEnabled}
                    label="Exchange"
                    hideLabel
                    onChange={(exchangeEnabled) => setToggles((current) => ({ ...current, exchangeEnabled }))}
                  />
                </div>
                {isCricket ? (
                  <>
                    <div className={styles.marketSwitch}>
                      <span>Bookmaker</span>
                      <Switch
                        checked={toggles.bookmakerEnabled}
                        label="Bookmaker"
                        hideLabel
                        onChange={(bookmakerEnabled) => setToggles((current) => ({ ...current, bookmakerEnabled }))}
                      />
                    </div>
                    <div className={styles.marketSwitch}>
                      <span>Fancy</span>
                      <Switch
                        checked={toggles.fancyEnabled}
                        label="Fancy"
                        hideLabel
                        onChange={(fancyEnabled) => setToggles((current) => ({ ...current, fancyEnabled }))}
                      />
                    </div>
                  </>
                ) : null}
              </section>
            </div>
          </div>
        ) : (
          <div
            id={tabPanelId('auto-results-settings', 'all')}
            role="tabpanel"
            aria-labelledby="auto-results-settings-tab-all"
            className={styles.tabPanel}
          >
            <div className={styles.settingsTable}>
              <DataTable
                columns={columns}
                rows={settings}
                rowKey={(setting) => setting.id}
                label="Auto result settings"
                state={settingsLoading ? 'loading' : 'ready'}
                density="compact"
                width="wide"
                empty={<EmptyState title="No settings saved yet" />}
              />
            </div>
          </div>
        )}
      </div>
    </Drawer>
  )
}
