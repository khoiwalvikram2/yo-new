import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useQuery } from '@apollo/client'
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCrown,
  IconEdit,
  IconInfoCircle,
  IconStack2,
  IconLockOpen,
  IconPlus,
  IconPower,
  IconRefresh,
  IconStar,
  IconTrash,
  IconUser,
  IconUsers,
  IconX,
} from '@tabler/icons-react'
import { CASINO_GAME_BET_SETTINGS } from '@/lib/graphql/casino'
import { useCurrency as useCurrencyCtx } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useFormatLocale } from '@/shared/core/useFormatLocale'
import { notify } from '@/shared/services/notification'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { Drawer } from '@/ui/components/Drawer'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { LoadingState } from '@/ui/components/LoadingState'
import { type ListboxOption } from '@/ui/components/Combobox'
import { MultiSelect } from '@/ui/components/MultiSelect'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { confirm } from '@/ui/components/confirm'
import { strokeFor } from '@/ui/components/icons'
import {
  EMPTY_BET_VALUES,
  betSettingsVariables,
  betTargetIds,
  betValuesFromSetting,
  enabledVipTierIds,
  groupBetSettings,
  toggleSelection,
  vipTierDiff,
  type BetSetting,
  type BetSettingGroup,
  type BetTargetPlayer,
  type BetTargetTab,
  type BetValues,
  type DrawerMode,
  type DrawerTab,
  type GameRow,
  type GameVipTier,
  type VipTier,
} from '../casinoManagementModel'
import { PlayerSearchSelect } from './PlayerSearchSelect'
import styles from '../ManagementPage.module.css'

interface MutationOptions {
  variables?: Record<string, unknown>
  context?: Record<string, unknown>
}
type MutationRunner = (options?: MutationOptions) => Promise<unknown>

interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
  restoreFocusTo: RefObject<HTMLElement | null>
  drawerMode: DrawerMode
  drawerGame: GameRow | null
  drawerTab: DrawerTab
  setDrawerTab: (tab: DrawerTab) => void
  drawerActive: boolean
  setDrawerActive: (active: boolean) => void
  drawerPremiumOnly: boolean
  setDrawerPremiumOnly: (premium: boolean) => void
  bulkVipTiers: Set<string>
  setBulkVipTiers: (tiers: Set<string> | ((current: Set<string>) => Set<string>)) => void
  singleVipTiers: Set<string>
  setSingleVipTiers: (tiers: Set<string> | ((current: Set<string>) => Set<string>)) => void
  selectedKeys: Set<string>
  vipTiers: VipTier[]
  gameVipTiers: GameVipTier[]
  gameVipTiersLoading: boolean
  refetchGameVipTiers: () => Promise<unknown>
  isWhitelabelAdmin: boolean
  updateGameSettings: MutationRunner
  bulkUpdateGameSettings: MutationRunner
  toggleVipTierGame: MutationRunner
  bulkUpdateVipTierGames: MutationRunner
  upsertBetSettings: MutationRunner
  deleteBetSettings: MutationRunner
  refetchBetSettings: () => Promise<unknown>
  refetchGames: () => Promise<unknown>
}

interface BetSettingsData { casinoGameBetSettings: BetSetting[] }

const DRAWER_TABS: TabItem<DrawerTab>[] = [
  { value: 'main', label: 'Access Settings' },
  { value: 'betSettings', label: 'Bet Settings' },
]
const TARGET_TABS: TabItem<BetTargetTab>[] = [
  { value: 'all', label: 'All Players' },
  { value: 'specific', label: 'Specific players' },
]

export function SettingsDrawer({
  open,
  onClose,
  restoreFocusTo,
  drawerMode,
  drawerGame,
  drawerTab,
  setDrawerTab,
  drawerActive,
  setDrawerActive,
  drawerPremiumOnly,
  setDrawerPremiumOnly,
  bulkVipTiers,
  setBulkVipTiers,
  singleVipTiers,
  setSingleVipTiers,
  selectedKeys,
  vipTiers,
  gameVipTiers,
  gameVipTiersLoading,
  refetchGameVipTiers,
  isWhitelabelAdmin,
  updateGameSettings,
  bulkUpdateGameSettings,
  toggleVipTierGame,
  bulkUpdateVipTierGames,
  upsertBetSettings,
  deleteBetSettings,
  refetchBetSettings,
  refetchGames,
}: SettingsDrawerProps) {
  const { data: betSettingsData, loading: betSettingsLoading } = useQuery<BetSettingsData>(
    CASINO_GAME_BET_SETTINGS,
    {
      variables: { gameId: drawerGame?.id || '' },
      skip: !drawerGame?.id || drawerMode !== 'single' || !open,
      fetchPolicy: 'network-only',
    },
  )
  const { getCurrencySymbol } = useCurrencyCtx()
  const currencySymbol = getCurrencySymbol()
  const formatLocale = useFormatLocale()
  const { formatDate, formatDateTime } = useFormatDate()
  const [targetPlayerTab, setTargetPlayerTab] = useState<BetTargetTab>('all')
  const [targetPlayers, setTargetPlayers] = useState<BetTargetPlayer[]>([])
  const [betValues, setBetValues] = useState<BetValues>({ ...EMPTY_BET_VALUES })
  const [editingSettingId, setEditingSettingId] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [betFormCollapsed, setBetFormCollapsed] = useState(true)
  const [playersDialogGroup, setPlayersDialogGroup] = useState<BetSettingGroup | null>(null)
  const [accessSaving, setAccessSaving] = useState(false)
  const [betSaving, setBetSaving] = useState(false)
  const [busyGroup, setBusyGroup] = useState<string | null>(null)
  const betFormRef = useRef<HTMLElement | null>(null)

  const resetBetForm = useCallback((collapse = false) => {
    setTargetPlayerTab('all')
    setTargetPlayers([])
    setBetValues({ ...EMPTY_BET_VALUES })
    setEditingSettingId(null)
    if (collapse) setBetFormCollapsed(true)
  }, [])

  useEffect(() => {
    if (!open) return
    resetBetForm(true)
    setCollapsedGroups(new Set())
  }, [open, resetBetForm])

  useEffect(() => {
    if (!open || drawerTab !== 'betSettings' || drawerMode !== 'single' || !drawerGame?.id) return
    const settings = betSettingsData?.casinoGameBetSettings
    if (!settings) return
    if (targetPlayerTab === 'all') {
      setBetValues(betValuesFromSetting(settings.find((setting) => setting.playerId == null)))
      return
    }
    if (targetPlayers.length === 0) {
      setBetValues({ ...EMPTY_BET_VALUES })
      return
    }
    if (targetPlayers.length === 1) {
      setBetValues(betValuesFromSetting(settings.find((setting) => setting.playerId === targetPlayers[0].id)))
    }
  }, [
    open,
    drawerTab,
    drawerMode,
    drawerGame?.id,
    targetPlayerTab,
    targetPlayers,
    betSettingsData?.casinoGameBetSettings,
  ])

  const addTargetPlayer = useCallback((detail: BetTargetPlayer) => {
    setTargetPlayers((current) => {
      if (current.some((player) => player.id === detail.id)) {
        notify.info('This player is already in the list')
        return current
      }
      return [...current, detail]
    })
    setTargetPlayerTab('specific')
  }, [])
  const groups = useMemo(
    () => groupBetSettings(betSettingsData?.casinoGameBetSettings ?? []),
    [betSettingsData?.casinoGameBetSettings],
  )
  const drawerTitle = drawerMode === 'single'
    ? `Edit Game Settings${drawerGame?.name ? ` - ${drawerGame.name}` : ''}`
    : 'Bulk Update Settings'

  const resetAccess = () => {
    if (drawerMode === 'single' && drawerGame) {
      setDrawerActive(drawerGame.tenantEnabled === true)
      setDrawerPremiumOnly(Boolean(drawerGame.premiumOnly))
      setSingleVipTiers(enabledVipTierIds(gameVipTiers))
    } else {
      setDrawerActive(true)
      setDrawerPremiumOnly(false)
      setBulkVipTiers(new Set())
    }
  }

  const saveAccess = async () => {
    if (drawerMode === 'bulk' && selectedKeys.size === 0) return
    setAccessSaving(true)
    try {
      if (drawerMode === 'single' && drawerGame?.id) {
        await updateGameSettings({
          variables: { gameId: drawerGame.id, enabled: drawerActive },
          context: { skipNotification: true },
        })
        await updateGameSettings({
          variables: { gameId: drawerGame.id, premiumOnly: drawerPremiumOnly },
          context: { skipNotification: true },
        })
        const changes = vipTierDiff(enabledVipTierIds(gameVipTiers), singleVipTiers)
        await Promise.all([
          ...changes.enable.map((tierId) => toggleVipTierGame({
            variables: { tierId, gameId: drawerGame.id, enabled: true },
            context: { skipNotification: true },
          })),
          ...changes.disable.map((tierId) => toggleVipTierGame({
            variables: { tierId, gameId: drawerGame.id, enabled: false },
            context: { skipNotification: true },
          })),
        ])
        await refetchGameVipTiers()
        notify.success('Access settings updated successfully')
      } else if (drawerMode === 'bulk') {
        const gameIds = [...selectedKeys]
        await bulkUpdateGameSettings({
          variables: { gameIds, enabled: drawerActive },
          context: { skipNotification: true },
        })
        if (gameIds.length > 0) {
          await bulkUpdateGameSettings({
            variables: { gameIds, premiumOnly: drawerPremiumOnly },
            context: { skipNotification: true },
          })
        }
        for (const tierId of bulkVipTiers) {
          await bulkUpdateVipTierGames({
            variables: { tierId, gameIds, enabled: true },
            context: { skipNotification: true },
          })
        }
        notify.success(`Access settings updated for ${gameIds.length} game${gameIds.length === 1 ? '' : 's'}`)
      }
      onClose()
      setBulkVipTiers(new Set())
      setSingleVipTiers(new Set())
      await refetchGames()
    } catch (reason) {
      notify.error(reason instanceof Error && reason.message ? reason.message : 'Failed to update access settings')
    } finally {
      setAccessSaving(false)
    }
  }

  const saveBetSetting = async () => {
    if (targetPlayerTab === 'specific' && targetPlayers.length === 0) {
      notify.warning('Add at least one player in the Specific players tab before saving.')
      return
    }
    const targets = betTargetIds(targetPlayerTab, targetPlayers)
    const wasEditing = Boolean(editingSettingId)
    setBetSaving(true)
    try {
      if (drawerMode === 'single' && drawerGame?.id) {
        for (const playerId of targets) {
          await upsertBetSettings({ variables: betSettingsVariables(drawerGame.id, playerId, betValues) })
        }
        await refetchBetSettings()
        resetBetForm(true)
        notify.success(
          targets.length > 1
            ? `Bet settings applied to ${targets.length} players successfully!`
            : wasEditing ? 'Bet setting updated successfully!' : 'Bet setting added successfully!',
        )
      } else if (drawerMode === 'bulk') {
        const gameIds = [...selectedKeys]
        for (const gameId of gameIds) {
          for (const playerId of targets) {
            await upsertBetSettings({ variables: betSettingsVariables(gameId, playerId, betValues) })
          }
        }
        resetBetForm(true)
        notify.success(`Bet settings applied to ${gameIds.length} game(s) × ${targets.length} target(s) successfully!`)
      }
    } catch (reason) {
      notify.error(reason instanceof Error && reason.message ? reason.message : 'Failed to save bet settings')
    } finally {
      setBetSaving(false)
    }
  }

  const formatMoney = (value: number | null | undefined) => value == null
    ? '—'
    : `${currencySymbol}${Number(value).toLocaleString(formatLocale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`

  const footer = drawerTab === 'main' ? (
    <div className={styles.drawerFooter}>
      <span className={styles.drawerHint}>
        <IconInfoCircle size={13} stroke={strokeFor(13)} aria-hidden="true" />
        {drawerMode === 'bulk' ? 'Changes will apply to all selected games' : 'Changes will save immediately'}
      </span>
      <div className={styles.drawerFooterActions}>
        <Button size="sm" icon={<IconRefresh size={14} stroke={strokeFor(14)} />} onClick={resetAccess}>Reset</Button>
        <Button size="sm" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          variant="primary"
          loading={accessSaving}
          disabled={drawerMode === 'bulk' && selectedKeys.size === 0}
          icon={<IconCheck size={14} stroke={strokeFor(14)} />}
          onClick={() => void saveAccess()}
        >
          {drawerMode === 'bulk' ? 'Update Settings' : 'Apply Changes'}
        </Button>
      </div>
    </div>
  ) : (
    <div className={styles.drawerFooter}>
      <span className={styles.drawerHint}>
        <IconInfoCircle size={13} stroke={strokeFor(13)} aria-hidden="true" />
        Configure betting limits and rules for casino games
      </span>
      <Button size="sm" onClick={onClose}>Close</Button>
    </div>
  )

  return (
    <>
      <Drawer
        title={drawerTitle}
        size="lg"
        open={open}
        onOpenChange={(next) => { if (!next) onClose() }}
        themeFrom={restoreFocusTo}
        restoreFocusTo={restoreFocusTo}
        footer={footer}
      >
        <div className={styles.drawerBody}>
          <Tabs
            value={drawerTab}
            items={DRAWER_TABS}
            onChange={setDrawerTab}
            label="Game settings"
            idPrefix="casino-game-settings"
          />
          <div
            role="tabpanel"
            id={tabPanelId('casino-game-settings', drawerTab)}
            aria-labelledby={tabId('casino-game-settings', drawerTab)}
            className={styles.drawerPanel}
          >
            {drawerTab === 'main' ? (
              <AccessSettings
                drawerMode={drawerMode}
                drawerGame={drawerGame}
                drawerActive={drawerActive}
                setDrawerActive={setDrawerActive}
                drawerPremiumOnly={drawerPremiumOnly}
                setDrawerPremiumOnly={setDrawerPremiumOnly}
                bulkVipTiers={bulkVipTiers}
                setBulkVipTiers={setBulkVipTiers}
                singleVipTiers={singleVipTiers}
                setSingleVipTiers={setSingleVipTiers}
                selectedCount={selectedKeys.size}
                vipTiers={vipTiers}
                gameVipTiersLoading={gameVipTiersLoading}
                isWhitelabelAdmin={isWhitelabelAdmin}
              />
            ) : (
              <div className={styles.betSettings}>
                <section ref={betFormRef} className={styles.betFormCard} aria-labelledby="bet-form-title">
                  <header className={styles.betFormHeader}>
                    <div className={styles.sectionHeading}>
                      <span className={styles.sectionIcon} aria-hidden="true">
                        {editingSettingId ? <IconEdit size={16} stroke={strokeFor(16)} /> : <IconPlus size={16} stroke={strokeFor(16)} />}
                      </span>
                      <div>
                        <h3 id="bet-form-title">{editingSettingId ? 'Edit Bet Setting' : 'New Bet Setting'}</h3>
                        <p>{editingSettingId ? 'Update existing configuration' : 'Configure betting limits and rules'}</p>
                      </div>
                    </div>
                    <div className={styles.sectionActions}>
                      {editingSettingId ? (
                        <Button size="xs" variant="ghost" icon={<IconX size={13} stroke={strokeFor(13)} />} onClick={() => resetBetForm(true)}>
                          Cancel Edit
                        </Button>
                      ) : null}
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={betFormCollapsed
                          ? <IconChevronDown size={13} stroke={strokeFor(13)} />
                          : <IconChevronUp size={13} stroke={strokeFor(13)} />}
                        onClick={() => setBetFormCollapsed((value) => !value)}
                        aria-expanded={!betFormCollapsed}
                      >
                        {betFormCollapsed ? 'Expand' : 'Collapse'}
                      </Button>
                    </div>
                  </header>
                  {!betFormCollapsed ? (
                    <div className={styles.betFormBody}>
                      <Tabs
                        value={targetPlayerTab}
                        items={TARGET_TABS}
                        onChange={(tab) => {
                          setTargetPlayerTab(tab)
                          if (tab === 'all') {
                            setTargetPlayers([])
                            setEditingSettingId(null)
                          }
                        }}
                        label="Target players"
                        idPrefix="casino-bet-target"
                        size="sm"
                      />
                      <div
                        role="tabpanel"
                        id={tabPanelId('casino-bet-target', targetPlayerTab)}
                        aria-labelledby={tabId('casino-bet-target', targetPlayerTab)}
                        className={styles.targetPanel}
                      >
                        {targetPlayerTab === 'all' ? (
                          <p className={styles.helpCopy}>
                            One shared rule for all players on this game. A player-specific row overrides these defaults for that player only.
                          </p>
                        ) : (
                          <div className={styles.playerPicker}>
                            <p className={styles.helpCopy}>Search and select players one by one; the same limits apply to everyone selected.</p>
                            <PlayerSearchSelect
                              key="casino-bet-target-search"
                              multiple={false}
                              showValueInInput={false}
                              onSelectDetail={(detail) => { if (detail) addTargetPlayer(detail) }}
                            />
                            {targetPlayers.length > 0 ? (
                              <ul className={styles.selectedPlayers} aria-label="Selected players">
                                {targetPlayers.map((player) => (
                                  <li key={player.id}>
                                    <span>{player.label}</span>
                                    <IconButton
                                      label={`Remove ${player.label}`}
                                      size="sm"
                                      icon={<IconX size={13} stroke={strokeFor(13)} />}
                                      onClick={() => setTargetPlayers((current) => current.filter((item) => item.id !== player.id))}
                                    />
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        )}
                      </div>
                      <div className={styles.limitGrid}>
                        <NumberField
                          label="Minimum"
                          value={betValues.minStake}
                          onChange={(value) => setBetValues((current) => ({ ...current, minStake: value }))}
                          min={0}
                          step={0.01}
                          precision={2}
                          prefix={currencySymbol}
                          placeholder="0.00"
                        />
                        <NumberField
                          label="Maximum"
                          value={betValues.maxStake}
                          onChange={(value) => setBetValues((current) => ({ ...current, maxStake: value }))}
                          min={0}
                          step={0.01}
                          precision={2}
                          prefix={currencySymbol}
                          placeholder="0.00"
                        />
                        <NumberField
                          label="Max Win (daily)"
                          value={betValues.maxWin}
                          onChange={(value) => setBetValues((current) => ({ ...current, maxWin: value }))}
                          min={0}
                          step={0.01}
                          precision={2}
                          prefix={currencySymbol}
                          placeholder="0.00"
                        />
                      </div>
                      <div className={styles.betFormFooter}>
                        <Switch
                          checked={betValues.betEnabled}
                          onChange={(checked) => setBetValues((current) => ({ ...current, betEnabled: checked }))}
                          label="Betting enabled"
                        />
                        <div className={styles.sectionActions}>
                          <Button size="sm" icon={<IconRefresh size={14} stroke={strokeFor(14)} />} onClick={() => resetBetForm(false)}>Reset</Button>
                          <Button
                            size="sm"
                            variant="primary"
                            loading={betSaving}
                            icon={editingSettingId
                              ? <IconEdit size={14} stroke={strokeFor(14)} />
                              : <IconPlus size={14} stroke={strokeFor(14)} />}
                            onClick={() => void saveBetSetting()}
                          >
                            {editingSettingId ? 'Update' : 'Add Setting'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>

                <div className={styles.settingsDivider}><span>Configured Settings</span></div>
                {drawerMode === 'single' && drawerGame?.id ? (
                  betSettingsLoading && !betSettingsData ? (
                    <LoadingState label="Loading bet settings" minHeight={192} />
                  ) : groups.length > 0 ? (
                    <div className={styles.settingGroups}>
                      {groups.map((group, index) => (
                        <BetSettingCard
                          key={group.key}
                          group={group}
                          index={index}
                          formatMoney={formatMoney}
                          formatDate={formatDate}
                          formatDateTime={formatDateTime}
                          collapsed={collapsedGroups.has(group.key)}
                          busy={busyGroup === group.key}
                          onToggleCollapsed={() => setCollapsedGroups((current) => toggleSelection(current, group.key))}
                          onShowPlayers={() => setPlayersDialogGroup(group)}
                          onStatusChange={async (checked) => {
                            setBusyGroup(group.key)
                            try {
                              for (const setting of group.settings) {
                                await upsertBetSettings({
                                  variables: betSettingsVariables(drawerGame.id, setting.playerId ?? null, {
                                    betEnabled: checked,
                                    minStake: setting.minStake ?? null,
                                    maxStake: setting.maxStake ?? null,
                                    maxWin: setting.maxWin ?? null,
                                  }),
                                })
                              }
                              await refetchBetSettings()
                              notify.success('Status updated')
                            } finally {
                              setBusyGroup(null)
                            }
                          }}
                          onEdit={() => {
                            const setting = group.settings[0]
                            setTargetPlayerTab(group.isAllPlayers ? 'all' : 'specific')
                            setTargetPlayers(group.isAllPlayers ? [] : group.settings.map((item) => ({
                              id: String(item.playerId),
                              label: item.playerName ?? `User #${item.playerId}`,
                            })))
                            setEditingSettingId(String(setting.id))
                            setBetValues(betValuesFromSetting(setting))
                            setBetFormCollapsed(false)
                            window.requestAnimationFrame(() => betFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
                          }}
                          onDelete={() => {
                            void confirm({
                              title: group.settings.length > 1
                                ? `Delete this setting for ${group.settings.length} players?`
                                : 'Delete Bet Setting?',
                              description: 'This action cannot be undone. The bet setting will be permanently deleted.',
                              confirmLabel: 'Delete',
                              tone: 'danger',
                              onConfirm: async () => {
                                for (const setting of group.settings) {
                                  await deleteBetSettings({
                                    variables: { gameId: drawerGame.id, playerId: setting.playerId },
                                  })
                                }
                                await refetchBetSettings()
                                if (editingSettingId && group.settings.some((setting) => String(setting.id) === editingSettingId)) {
                                  resetBetForm(false)
                                }
                                notify.success(group.settings.length > 1
                                  ? `Deleted setting for ${group.settings.length} players`
                                  : 'Setting deleted')
                              },
                            })
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title="No bet settings configured"
                      description="Add your first bet setting using the form above"
                      icon={<IconStack2 size={22} stroke={strokeFor(22)} />}
                      inset="none"
                    />
                  )
                ) : (
                  <Notice tone="info" icon={<IconStack2 size={17} stroke={strokeFor(17)} />} title="Bulk Configuration Mode">
                    Settings will be applied to all {selectedKeys.size} selected games
                  </Notice>
                )}
              </div>
            )}
          </div>
        </div>
      </Drawer>

      <Dialog
        title="Players with this setting"
        open={Boolean(playersDialogGroup)}
        onOpenChange={(next) => { if (!next) setPlayersDialogGroup(null) }}
        size="sm"
        footer={<Button size="sm" onClick={() => setPlayersDialogGroup(null)}>Close</Button>}
      >
        <ul className={styles.playersDialogList}>
          {(playersDialogGroup?.settings ?? []).map((setting) => (
            <li key={setting.id}>
              <span className={styles.playerAvatar} aria-hidden="true"><IconUser size={15} stroke={strokeFor(15)} /></span>
              <span>
                <strong>{setting.playerName || `User #${setting.playerId}`}</strong>
                <small>{setting.playerPhone || 'No phone'}</small>
              </span>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  )
}

interface AccessSettingsProps {
  drawerMode: DrawerMode
  drawerGame: GameRow | null
  drawerActive: boolean
  setDrawerActive: (active: boolean) => void
  drawerPremiumOnly: boolean
  setDrawerPremiumOnly: (premium: boolean) => void
  bulkVipTiers: Set<string>
  setBulkVipTiers: (tiers: Set<string> | ((current: Set<string>) => Set<string>)) => void
  singleVipTiers: Set<string>
  setSingleVipTiers: (tiers: Set<string> | ((current: Set<string>) => Set<string>)) => void
  selectedCount: number
  vipTiers: VipTier[]
  gameVipTiersLoading: boolean
  isWhitelabelAdmin: boolean
}

function AccessSettings({
  drawerMode,
  drawerGame,
  drawerActive,
  setDrawerActive,
  drawerPremiumOnly,
  setDrawerPremiumOnly,
  bulkVipTiers,
  setBulkVipTiers,
  singleVipTiers,
  setSingleVipTiers,
  selectedCount,
  vipTiers,
  gameVipTiersLoading,
  isWhitelabelAdmin,
}: AccessSettingsProps) {
  const chosenTiers = drawerMode === 'single' ? singleVipTiers : bulkVipTiers
  const setChosenTiers = drawerMode === 'single' ? setSingleVipTiers : setBulkVipTiers
  const tierOptions: ListboxOption[] = vipTiers.map((tier) => ({
    value: tier.id,
    label: tier.level == null ? tier.name : `${tier.name} · Level ${tier.level}`,
  }))
  return (
    <div className={styles.accessSettings}>
      {isWhitelabelAdmin && drawerMode === 'single' && drawerGame && !drawerGame.isActive ? (
        <Notice tone="error" icon={<IconAlertTriangle size={17} stroke={strokeFor(17)} />} title="Game Disabled by Platform">
          This game has been globally disabled by the platform administrator. You cannot enable it until the platform administrator reactivates it.
        </Notice>
      ) : null}
      <section className={styles.settingSection}>
        <div className={styles.settingIntro}>
          <span className={styles.settingIcon} aria-hidden="true">
            {drawerMode === 'single'
              ? <IconPower size={18} stroke={strokeFor(18)} />
              : <IconStack2 size={18} stroke={strokeFor(18)} />}
          </span>
          <span>
            <strong>{drawerMode === 'single' ? 'Active state' : 'Bulk status'}</strong>
            <small>{drawerMode === 'single' ? 'Enable or disable game' : 'Set status for all selected games'}</small>
          </span>
        </div>
        {drawerMode === 'single' ? (
          <Switch
            checked={drawerActive}
            label={drawerActive ? 'Enabled' : 'Disabled'}
            disabled={Boolean(isWhitelabelAdmin && drawerGame && !drawerGame.isActive)}
            onChange={setDrawerActive}
          />
        ) : (
          <div className={styles.choiceActions}>
            <Button size="sm" variant={drawerActive ? 'primary' : 'secondary'} onClick={() => setDrawerActive(true)}>Enable all</Button>
            <Button size="sm" variant={!drawerActive ? 'dangerSolid' : 'secondary'} onClick={() => setDrawerActive(false)}>Disable all</Button>
          </div>
        )}
      </section>
      <section className={styles.settingSection}>
        <div className={styles.settingIntro}>
          <span className={styles.settingIcon} aria-hidden="true"><IconStar size={18} stroke={strokeFor(18)} /></span>
          <span>
            <strong>{drawerMode === 'single' ? 'Premium Game' : 'Bulk premium'}</strong>
            <small>{drawerMode === 'single' ? 'Mark this casino game as premium' : 'Set premium status for all selected games'}</small>
          </span>
        </div>
        {drawerMode === 'single' ? (
          <Switch
            checked={drawerPremiumOnly}
            label={drawerPremiumOnly ? 'Premium' : 'Standard'}
            onChange={setDrawerPremiumOnly}
          />
        ) : (
          <div className={styles.choiceActions}>
            <Button size="sm" variant={drawerPremiumOnly ? 'primary' : 'secondary'} onClick={() => setDrawerPremiumOnly(true)}>Set Premium</Button>
            <Button size="sm" variant={!drawerPremiumOnly ? 'primary' : 'secondary'} onClick={() => setDrawerPremiumOnly(false)}>Set Standard</Button>
          </div>
        )}
      </section>
      <section className={styles.vipSection}>
        <div className={styles.vipHeader}>
          <div className={styles.settingIntro}>
            <span className={styles.settingIcon} aria-hidden="true"><IconCrown size={18} stroke={strokeFor(18)} /></span>
            <span>
              <strong>VIP Tier Access</strong>
              <small>
                {drawerMode === 'single'
                  ? chosenTiers.size === 0 ? 'Available to all VIP tiers (default)' : 'Restricted to selected VIP tiers'
                  : `Select VIP tiers for ${selectedCount} selected games`}
              </small>
            </span>
          </div>
          {chosenTiers.size > 0 ? (
            <Button size="xs" icon={<IconLockOpen size={13} stroke={strokeFor(13)} />} onClick={() => setChosenTiers(new Set())}>
              {drawerMode === 'single' ? 'Set as Available to All' : 'Clear Selection'}
            </Button>
          ) : null}
        </div>
        {gameVipTiersLoading && drawerMode === 'single' ? (
          <LoadingState label="Loading VIP tier access" minHeight={192} />
        ) : vipTiers.length === 0 ? (
          <EmptyState title="No VIP tiers configured" inset="none" />
        ) : (
          <>
            {chosenTiers.size === 0 ? (
              <Notice tone={drawerMode === 'single' ? 'ok' : 'info'} title={drawerMode === 'single' ? 'Available to All VIP Tiers' : 'No VIP Tiers Selected'}>
                {drawerMode === 'single'
                  ? 'This game is accessible to all VIP members and non-VIP users by default'
                  : 'Selected games will remain available to all VIP tiers by default'}
              </Notice>
            ) : null}
            <MultiSelect
              label="VIP tiers"
              options={tierOptions}
              value={[...chosenTiers]}
              onChange={(values) => setChosenTiers(new Set(values))}
              placeholder="Select VIP tiers..."
              clearable
              searchable
            />
          </>
        )}
      </section>
    </div>
  )
}

interface BetSettingCardProps {
  group: BetSettingGroup
  index: number
  formatMoney: (value: number | null | undefined) => string
  formatDate: (value: string, pattern?: string) => string
  formatDateTime: (value: string, pattern?: string) => string
  collapsed: boolean
  busy: boolean
  onToggleCollapsed: () => void
  onShowPlayers: () => void
  onStatusChange: (checked: boolean) => Promise<void>
  onEdit: () => void
  onDelete: () => void
}

function BetSettingCard({
  group,
  index,
  formatMoney,
  formatDate,
  formatDateTime,
  collapsed,
  busy,
  onToggleCollapsed,
  onShowPlayers,
  onStatusChange,
  onEdit,
  onDelete,
}: BetSettingCardProps) {
  const setting = group.settings[0]
  const count = group.settings.length
  return (
    <article className={styles.settingGroup}>
      <header className={styles.settingGroupHeader}>
        <button type="button" className={styles.settingGroupSummary} onClick={onToggleCollapsed} aria-expanded={!collapsed}>
          <span className={styles.groupIndex}>{index + 1}</span>
          <StatusPill tone={group.isAllPlayers ? 'ok' : 'info'} icon={group.isAllPlayers
            ? <IconUsers size={12} stroke={strokeFor(12)} />
            : <IconUser size={12} stroke={strokeFor(12)} />}>
            {group.isAllPlayers
              ? 'All players'
              : count === 1 ? setting.playerName || `User #${setting.playerId}` : `Same limits for ${count} players`}
          </StatusPill>
          <span className={styles.groupDate}>{setting.createdAt ? formatDate(setting.createdAt, 'MMM d') : '—'}</span>
        </button>
        <div className={styles.groupTools}>
          {!group.isAllPlayers && count > 1 ? <Button size="xs" variant="link" onClick={onShowPlayers}>{count} players</Button> : null}
          <Switch
            checked={setting.betEnabled}
            label={`Bet setting ${setting.betEnabled ? 'enabled' : 'disabled'}`}
            hideLabel
            size="sm"
            disabled={busy}
            onChange={(checked) => void onStatusChange(checked)}
          />
          <IconButton
            size="sm"
            label={collapsed ? 'Expand setting' : 'Collapse setting'}
            icon={collapsed
              ? <IconChevronDown size={13} stroke={strokeFor(13)} />
              : <IconChevronUp size={13} stroke={strokeFor(13)} />}
            onClick={onToggleCollapsed}
          />
        </div>
      </header>
      {!collapsed ? (
        <div className={styles.settingGroupBody}>
          <dl className={styles.limitList}>
            <div><dt>Min Stake</dt><dd>{formatMoney(setting.minStake)}</dd></div>
            <div><dt>Max Stake</dt><dd>{formatMoney(setting.maxStake)}</dd></div>
            <div><dt>Max Win <small>(per day)</small></dt><dd>{formatMoney(setting.maxWin)}</dd></div>
          </dl>
          {setting.minStake == null && setting.maxStake == null && setting.maxWin == null ? (
            <p className={styles.noLimits}>No limits configured</p>
          ) : null}
          {setting.updatedAt ? <p className={styles.updatedAt}>Updated: {formatDateTime(setting.updatedAt, 'MMM d, HH:mm')}</p> : null}
          <div className={styles.groupActions}>
            <Button size="xs" variant="link" icon={<IconEdit size={13} stroke={strokeFor(13)} />} onClick={onEdit}>Edit</Button>
            <Button size="xs" variant="danger" icon={<IconTrash size={13} stroke={strokeFor(13)} />} onClick={onDelete}>Delete</Button>
          </div>
        </div>
      ) : null}
    </article>
  )
}
