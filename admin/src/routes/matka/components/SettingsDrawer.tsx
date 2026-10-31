import { useEffect, useMemo, useState, type ComponentProps, type FormEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconAdjustments,
  IconBan,
  IconInfoCircle,
  IconLayersLinked,
  IconPlus,
  IconRotate,
  IconCoin,
  IconListCheck,
  IconChartBar,
  IconShieldCheck,
} from '@tabler/icons-react'
import type { Matka } from '@/modules/matka/types'
import {
  useCreateMatkaBidRule,
  useDeleteMatkaBidRule,
  useMatkaBidRules,
  useUpdateMatkaBidRule,
} from '@/modules/matka'
import { useVIPTiers } from '@/modules/vip/hooks/useVIP'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Button } from '@/ui/components/Button'
import { Drawer } from '@/ui/components/Drawer'
import { NumberField } from '@/ui/components/NumberField'
import { Select } from '@/ui/components/Select'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { Table, TBody, TD, TH, THead, TR } from '@/ui/components/Table'
import { Tabs } from '@/ui/components/Tabs'
import { TextField } from '@/ui/components/TextField'
import { strokeFor } from '@/ui/components/icons'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import {
  APPLY_MODE_OPTIONS,
  BID_TYPE_OPTIONS,
  RISK_LEVEL_OPTIONS,
  bidRuleError,
  bidRuleInput,
  drawerStatusFor,
  emptySettingsValues,
  initialBidRuleDraft,
  settingsInitialValues,
  type ApplyMode,
  type BidRuleDraft,
  type DrawerStatus,
  type MatkaRecord,
  type SettingsTab,
  type SettingsValues,
} from '../matkaManagementModel'
import styles from '../ManagementPage.module.css'
import pageStyles from '../SettingsPage.module.css'

interface SettingsEditorProps {
  presentation?: 'drawer' | 'page'
  open: boolean
  onClose: () => void
  mode: 'single' | 'bulk'
  matka: MatkaRecord | null
  selectedMatkas: Matka[]
  drawerActive: DrawerStatus
  setDrawerActive: (active: DrawerStatus) => void
  onSave: (values: SettingsValues) => Promise<void>
  saving: boolean
  initialTab?: string
  onTabChange?: (tab: SettingsTab) => void
}

interface BidRuleRecord {
  id: string
  bidType: string
  percentage: number
  includeAll: boolean
  includedPlayers?: { playerIds?: string[] } | null
  status?: string | null
}

const TABS = [
  { value: 'stake', label: 'Stake Limits' },
  { value: 'bid', label: 'Bid Settings' },
  { value: 'exposure', label: 'Exposure Limits' },
  { value: 'risk', label: 'Risk' },
] satisfies Array<{ value: SettingsTab; label: string }>

const SECTION_DETAILS = {
  stake: { icon: IconCoin, description: 'Set the minimum and maximum stake allowed per entry.' },
  bid: { icon: IconListCheck, description: 'Manage bid capacity and player targeting. Bid configuration actions save immediately.' },
  exposure: { icon: IconChartBar, description: 'Set daily, weekly and overall exposure limits for this market.' },
  risk: { icon: IconShieldCheck, description: 'Choose the market risk level and the amount used as its risk threshold.' },
}

function tabFrom(value: string | undefined, mode: 'single' | 'bulk'): SettingsTab {
  if (value === 'bid' && mode === 'single') return 'bid'
  if (value === 'exposure' || value === 'risk' || value === 'stake') return value
  return 'stake'
}

function parsePlayerIds(value: string): string[] {
  return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)
}

export function SettingsEditor({
  presentation = 'drawer',
  open,
  onClose,
  mode,
  matka,
  selectedMatkas,
  drawerActive,
  setDrawerActive,
  onSave,
  saving,
  initialTab,
  onTabChange,
}: SettingsEditorProps) {
  const record = matka as MatkaRecord | null
  const { getCurrencySymbol } = useCurrency()
  const currencySymbol = getCurrencySymbol()
  const { data: vipData, loading: vipLoading } = useVIPTiers()
  const vipTierOptions = useMemo(() => [
    { label: 'Default', value: 'default' },
    ...((vipData?.vipTiers ?? []).map((tier: { id: string; name: string }) => ({
      label: tier.name,
      value: String(tier.id),
    }))),
  ], [vipData])

  const [values, setValues] = useState<SettingsValues>(emptySettingsValues)
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => tabFrom(initialTab, mode))
  const [bidPage, setBidPage] = useState(1)
  const bidLimit = 20
  const { data: bidData, loading: bidLoading, refetch: refetchBidRules } = useMatkaBidRules({
    matkaId: mode === 'single' ? record?.id : undefined,
    page: bidPage,
    limit: bidLimit,
  })
  const bidItems = (bidData?.matkaBidRules?.items ?? []) as BidRuleRecord[]
  const [createRule, { loading: creatingRule }] = useCreateMatkaBidRule()
  const [updateRule] = useUpdateMatkaBidRule()
  const [deleteRule, { loading: deletingRule }] = useDeleteMatkaBidRule()
  const [bidDraft, setBidDraft] = useState<BidRuleDraft>(initialBidRuleDraft)
  const [playerInput, setPlayerInput] = useState('')
  const [bidError, setBidError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (mode === 'single' && record) {
      setValues(settingsInitialValues(record))
      setDrawerActive(drawerStatusFor(record.status))
    } else {
      setValues(emptySettingsValues())
      setDrawerActive(true)
    }
  }, [mode, open, record, setDrawerActive])

  useEffect(() => {
    if (open) setActiveTab(tabFrom(initialTab, mode))
  }, [initialTab, mode, open])

  const setValue = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  const resetSettings = () => {
    if (mode === 'single' && record) {
      setValues(settingsInitialValues(record))
      setDrawerActive(drawerStatusFor(record.status))
    } else {
      setValues(emptySettingsValues())
      setDrawerActive(true)
    }
  }

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault()
    try {
      await onSave(values)
      if (presentation === 'drawer') resetSettings()
    } catch {
      // The owning page or mutation link displays the error; preserve the draft.
    }
  }

  const handleCreateRule = async (event: FormEvent) => {
    event.preventDefault()
    if (!record) return
    const nextDraft = { ...bidDraft, includedPlayers: parsePlayerIds(playerInput) }
    const error = bidRuleError(nextDraft)
    setBidError(error)
    if (error) return
    await createRule({
      variables: { input: bidRuleInput(record, nextDraft) },
      context: { uiToast: 'notification' },
    })
    setBidDraft(initialBidRuleDraft())
    setPlayerInput('')
    setBidError(null)
    refetchBidRules()
  }

  const visibleTabs = mode === 'single' ? TABS : TABS.filter((tab) => tab.value !== 'bid')
  const isPage = presentation === 'page'
  const dirty = JSON.stringify(values) !== JSON.stringify(mode === 'single' ? settingsInitialValues(record) : emptySettingsValues())
    || drawerActive !== (mode === 'single' ? drawerStatusFor(record?.status) : true)
  const applySettings = <section className={clsx(styles.settingsPanel, isPage && pageStyles.saveOptions)} aria-labelledby="apply-settings-heading">
    <div className={isPage ? pageStyles.optionsHeading : undefined}>
      <h3 className={styles.sectionTitle} id="apply-settings-heading">{isPage ? 'Save options' : 'Apply Settings'}</h3>
      {isPage && <p className={styles.settingsHelp}>Choose how these market settings are applied and who they apply to.</p>}
    </div>
    <div className={styles.settingsGrid}>
      <Select label="Apply Mode" layout={isPage ? 'stacked' : 'inline'} value={values.mode ?? 'overwrite'} options={APPLY_MODE_OPTIONS}
        onChange={value => setValue('mode', value as ApplyMode)} help="Overwrite changed values, fill empty fields only, or force every supplied value." />
      <Select label="VIP Tier" layout={isPage ? 'stacked' : 'inline'} value={values.tier ?? 'default'} options={vipTierOptions} loading={vipLoading}
        onChange={value => setValue('tier', value)} help="Default updates base settings; a tier scopes overrides to that tier." />
    </div>
  </section>
  const drawerTitle = mode === 'single' ? 'Edit Matka Settings' : 'Bulk Update Settings'
  const drawerSub = mode === 'single'
    ? 'Individual matka configuration'
    : 'Apply changes to multiple matkas'

  return (
    <SettingsFrame
      presentation={presentation}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={drawerTitle}
      sub={drawerSub}
      size="lg"
      footer={(
        <div className={clsx(styles.drawerFooter, isPage && pageStyles.actions)}>
          {isPage ? <div className={pageStyles.saveState}><strong>{saving ? 'Saving settings…' : dirty ? 'Unsaved changes' : 'No unsaved changes'}</strong><span>Apply Changes saves market status, limits and risk settings.</span></div>
            : <span className={styles.footerHint}>{mode === 'bulk' ? 'Changes will apply to all selected matkas' : 'Select Apply Changes to save your settings'}</span>}
          <div className={styles.footerButtons}>
            <Button
              size="sm"
              icon={<IconRotate size={15} stroke={strokeFor(15)} />}
              onClick={resetSettings}
              disabled={saving}
            >
              Reset
            </Button>
            <Button size="sm" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              variant="primary"
              loading={saving}
              disabled={mode === 'bulk' && selectedMatkas.length === 0}
              onClick={() => void handleSubmit()}
            >
              Apply Changes
            </Button>
          </div>
        </div>
      )}
    >
      <fieldset className={clsx(styles.drawerBody, styles.editorFields, isPage && pageStyles.form)} disabled={saving}>
        {isPage ? <section className={pageStyles.marketOverview} aria-label="Market overview">
          <div className={pageStyles.marketIdentity}>
            <span className={pageStyles.marketIcon} aria-hidden="true"><IconAdjustments size={23} stroke={strokeFor(23)} /></span>
            <div><p className={pageStyles.eyebrow}>Market configuration</p><h2>{record?.name || record?.code}</h2>
              <dl className={pageStyles.marketMeta}><div><dt>Code</dt><dd>{record?.code}</dd></div><div><dt>Timezone</dt><dd>{record?.timezone || '—'}</dd></div></dl>
            </div>
          </div>
          <div className={pageStyles.availability}>
            <h3 className={styles.sectionTitle}>Market status</h3>
            <Switch checked={drawerActive === true} onChange={setDrawerActive} label={drawerActive === true ? 'Active' : 'Inactive'} />
            <span className={styles.settingsHelp}>Saved with Apply Changes</span>
          </div>
        </section> : <div className={styles.drawerHero}>
          <div className={styles.drawerIdentity}>
            <span className={styles.drawerIcon} aria-hidden="true">
              {mode === 'single'
                ? <IconAdjustments size={18} stroke={strokeFor(18)} />
                : <IconLayersLinked size={18} stroke={strokeFor(18)} />}
            </span>
            <div className={styles.drawerHeading}>
              <span className={styles.drawerTitle}>
                {mode === 'single'
                  ? `Editing: ${record?.name || record?.code || ''}`
                  : `Bulk Update (${selectedMatkas.length} matkas)`}
              </span>
              <span className={styles.drawerSub}>
                {mode === 'single'
                  ? 'Individual matka configuration'
                  : selectedMatkas.map((item) => item.name || item.code).join(', ') || 'No matkas selected'}
              </span>
            </div>
          </div>
          <StatusPill status={mode === 'single' ? 'Single Edit' : 'Bulk Edit'} tone={mode === 'single' ? 'ok' : 'info'}>
            {mode === 'single' ? 'Single Edit' : 'Bulk Edit'}
          </StatusPill>
        </div>}

        {!isPage && <section className={styles.statusPanel} aria-labelledby="matka-status-heading">
          <div className={styles.drawerHeading}>
            <h3 className={styles.sectionTitle} id="matka-status-heading">
              {mode === 'single' ? 'Active state' : 'Bulk status'}
            </h3>
            <span className={styles.drawerSub}>
              {mode === 'single' ? 'Enable or disable matka' : 'Set status for all selected matkas'}
            </span>
          </div>
          {mode === 'single' ? (
            <Switch
              checked={drawerActive === true}
              onChange={setDrawerActive}
              label={drawerActive === true ? 'Active' : 'Inactive'}
            />
          ) : (
            <div className={styles.statusActions}>
              <Button
                size="sm"
                variant={drawerActive === true ? 'primary' : 'secondary'}
                onClick={() => setDrawerActive(true)}
              >
                Activate all
              </Button>
              <Button
                size="sm"
                variant={drawerActive === 'suspend' ? 'dangerSolid' : 'danger'}
                icon={<IconBan size={15} stroke={strokeFor(15)} />}
                onClick={() => setDrawerActive('suspend')}
              >
                Suspend all
              </Button>
            </div>
          )}
        </section>}

        {!isPage && applySettings}

        <section aria-label="Matka settings sections" className={isPage ? pageStyles.workspace : undefined}>
          <div className={isPage ? pageStyles.navigation : styles.tabBarScroll}>
            {isPage && <div className={pageStyles.navigationHeading}><h3>Settings</h3><span>{visibleTabs.length} sections</span></div>}
            <Tabs
              value={activeTab}
              items={visibleTabs.map(tab => { const Icon = SECTION_DETAILS[tab.value].icon; return { ...tab, icon: isPage ? <Icon size={17} stroke={strokeFor(17)} /> : undefined } })}
              onChange={tab => { setActiveTab(tab); onTabChange?.(tab) }}
              label="Matka settings"
              idPrefix="matka-settings"
              size="sm"
              orientation={isPage ? 'vertical' : 'horizontal'}
              className={isPage ? pageStyles.sectionTabs : undefined}
            />
            {isPage && <p className={pageStyles.navigationHint}>Move between sections without losing your edits.</p>}
          </div>

          <div className={isPage ? pageStyles.sectionContent : undefined}>
          {isPage && <header className={pageStyles.sectionHeading}>
            <p className={pageStyles.eyebrow}>Market settings</p>
            <h2>{visibleTabs.find(tab => tab.value === activeTab)?.label}</h2>
            <p>{SECTION_DETAILS[activeTab].description}</p>
          </header>}

          {activeTab === 'stake' ? (
            <div
              id={tabPanelId('matka-settings', 'stake')}
              role="tabpanel"
              aria-labelledby={tabId('matka-settings', 'stake')}
              className={clsx(styles.tabPanel, isPage && pageStyles.panel)}
            >
              <div className={styles.fieldGrid2}>
                <NumberField
                  label="Min Stake"
                  value={values.minBet == null ? null : Number(values.minBet)}
                  onChange={(value) => setValue('minBet', value)}
                  min={0}
                  step={0.01}
                  prefix={currencySymbol}
                  placeholder="1.00"
                />
                <NumberField
                  label="Max Stake"
                  value={values.maxBet == null ? null : Number(values.maxBet)}
                  onChange={(value) => setValue('maxBet', value)}
                  min={0}
                  step={0.01}
                  prefix={currencySymbol}
                  placeholder="10000"
                />
              </div>
            </div>
          ) : null}

          {activeTab === 'bid' && mode === 'single' ? (
            <div
              id={tabPanelId('matka-settings', 'bid')}
              role="tabpanel"
              aria-labelledby={tabId('matka-settings', 'bid')}
              className={clsx(styles.tabPanel, styles.bidStack, isPage && pageStyles.panel)}
            >
              <form className={styles.bidCard} onSubmit={(event) => void handleCreateRule(event)} noValidate>
                <div className={styles.bidHeader}>
                  <h3 className={styles.sectionTitle}>Create Bid Configuration</h3>
                  <IconPlus size={16} stroke={strokeFor(16)} aria-hidden="true" />
                </div>
                <div className={styles.fieldGrid3}>
                  <Select
                    label="Bid Type"
                    layout={isPage ? 'stacked' : 'inline'}
                    value={bidDraft.bidType}
                    placeholder="Select bid type"
                    options={BID_TYPE_OPTIONS}
                    onChange={(value) => {
                      setBidDraft((current) => ({ ...current, bidType: value }))
                      setBidError(null)
                    }}
                    error={bidError === 'Please select bid type' ? bidError : undefined}
                    required
                  />
                  <NumberField
                    label="Maximum Bid Capacity"
                    value={bidDraft.percentage}
                    onChange={(value) => {
                      setBidDraft((current) => ({ ...current, percentage: value }))
                      setBidError(null)
                    }}
                    min={0}
                    max={100}
                    step={0.01}
                    precision={2}
                    suffix="%"
                    placeholder="0.00"
                    error={bidError === 'Please enter percentage' ? bidError : undefined}
                    required
                  />
                  <Switch
                    checked={bidDraft.status}
                    onChange={(checked) => setBidDraft((current) => ({ ...current, status: checked }))}
                    label={`Status ${bidDraft.status ? 'ON' : 'OFF'}`}
                  />
                </div>
                <div className={styles.fieldGrid2}>
                  <Switch
                    checked={bidDraft.includeAll}
                    onChange={(checked) => {
                      setBidDraft((current) => ({ ...current, includeAll: checked }))
                      if (checked) setPlayerInput('')
                    }}
                    label={`Player Targeting: ${bidDraft.includeAll ? 'All' : 'Specific'}`}
                  />
                  <TextField
                    label="Select Players"
                    value={playerInput}
                    onChange={setPlayerInput}
                    placeholder={bidDraft.includeAll
                      ? "Enable 'Specific' targeting to select players"
                      : 'Type player IDs separated by commas'}
                    disabled={bidDraft.includeAll}
                    help={bidDraft.includeAll ? undefined : 'Separate multiple player IDs with commas or spaces.'}
                  />
                </div>
                <div className={styles.inlineActions}>
                  <Button
                    size="sm"
                    onClick={() => {
                      setBidDraft(initialBidRuleDraft())
                      setPlayerInput('')
                      setBidError(null)
                    }}
                  >
                    Reset
                  </Button>
                  <Button size="sm" variant="primary" type="submit" loading={creatingRule}>
                    Create Configuration
                  </Button>
                </div>
              </form>

              <div className={styles.bidHeader}>
                <h3 className={styles.sectionTitle}>Active Bid Configurations</h3>
                {bidItems.length ? <span className={styles.selectedCount}>({bidItems.length})</span> : null}
              </div>
              <div className={styles.bidTableWrap}>
                <Table caption="Active bid configurations" width="fill" inset>
                  <THead>
                    <TR>
                      <TH>Bid Type</TH>
                      <TH>Capacity</TH>
                      <TH>Players</TH>
                      <TH align="center">Status</TH>
                      <TH align="right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {bidLoading ? (
                      <TR><TD colSpan={5}>Loading...</TD></TR>
                    ) : bidItems.length === 0 ? (
                      <TR><TD colSpan={5}>No bid configurations yet</TD></TR>
                    ) : bidItems.map((rule) => (
                      <TR key={rule.id}>
                        <TD><span className={styles.bidTypeChip}>{String(rule.bidType).replace(/_/g, ' ')}</span></TD>
                        <TD emphasis="key">{rule.percentage}%</TD>
                        <TD>
                          <span className={rule.includeAll ? styles.targetChip : clsx(styles.targetChip, styles.targetSpecific)}>
                            {rule.includeAll
                              ? 'All Players'
                              : `${Array.isArray(rule.includedPlayers?.playerIds) ? rule.includedPlayers.playerIds.length : 0} Specific`}
                          </span>
                        </TD>
                        <TD align="center">
                          <Switch
                            checked={String(rule.status).toLowerCase() === 'active'}
                            hideLabel
                            label={`Toggle ${rule.bidType} status`}
                            size="sm"
                            onChange={async (checked) => {
                              await updateRule({
                                variables: { id: rule.id, patch: { status: checked ? 'active' : 'inactive' } },
                                context: { uiToast: 'message' },
                              })
                              refetchBidRules()
                            }}
                          />
                        </TD>
                        <TD align="right">
                          <Button
                            size="xs"
                            variant="danger"
                            loading={deletingRule}
                            onClick={async () => {
                              await deleteRule({ variables: { id: rule.id }, context: { uiToast: 'message' } })
                              refetchBidRules()
                            }}
                          >
                            Remove
                          </Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                {!bidLoading && bidItems.length > 0 ? (
                  <div className={styles.bidPager}>
                    <span>Page {bidPage}</span>
                    <div className={styles.inlineActions}>
                      <Button size="xs" disabled={bidPage <= 1} onClick={() => setBidPage(Math.max(1, bidPage - 1))}>Prev</Button>
                      <Button size="xs" disabled={bidItems.length < bidLimit} onClick={() => setBidPage(bidPage + 1)}>Next</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {activeTab === 'exposure' ? (
            <div
              id={tabPanelId('matka-settings', 'exposure')}
              role="tabpanel"
              aria-labelledby={tabId('matka-settings', 'exposure')}
              className={clsx(styles.tabPanel, isPage && pageStyles.panel)}
            >
              <div className={styles.fieldGrid3}>
                <NumberField
                  label="Daily Limit"
                  value={values.exposureDaily == null ? null : Number(values.exposureDaily)}
                  onChange={(value) => setValue('exposureDaily', value)}
                  min={0}
                  prefix={currencySymbol}
                  placeholder="50000"
                />
                <NumberField
                  label="Weekly Limit"
                  value={values.exposureWeekly == null ? null : Number(values.exposureWeekly)}
                  onChange={(value) => setValue('exposureWeekly', value)}
                  min={0}
                  prefix={currencySymbol}
                  placeholder="200000"
                />
                <NumberField
                  label="Exposure Cap"
                  value={values.exposureCap == null ? null : Number(values.exposureCap)}
                  onChange={(value) => setValue('exposureCap', value)}
                  min={0}
                  prefix={currencySymbol}
                  placeholder="1000000"
                />
              </div>
            </div>
          ) : null}

          {activeTab === 'risk' ? (
            <div
              id={tabPanelId('matka-settings', 'risk')}
              role="tabpanel"
              aria-labelledby={tabId('matka-settings', 'risk')}
              className={clsx(styles.tabPanel, isPage && pageStyles.panel)}
            >
              <div className={styles.fieldGrid2}>
                <Select
                  label="Risk Level"
                  layout={isPage ? 'stacked' : 'inline'}
                  value={values.riskLevel ?? ''}
                  options={RISK_LEVEL_OPTIONS}
                  onChange={(value) => setValue('riskLevel', value || null)}
                />
                <NumberField
                  label="Risk Threshold"
                  value={values.riskThreshold == null ? null : Number(values.riskThreshold)}
                  onChange={(value) => setValue('riskThreshold', value)}
                  min={0}
                  step={0.01}
                  prefix={currencySymbol}
                  placeholder="1000"
                />
              </div>
            </div>
          ) : null}
          {isPage && <div className={pageStyles.fieldNote}><IconInfoCircle size={16} stroke={strokeFor(16)} aria-hidden="true" /><p>Empty fields keep their current values. Use Apply Changes to save edits across all settings sections.</p></div>}
          {isPage && applySettings}
          </div>
        </section>

        <p className={styles.srOnly} role="status" aria-live="polite">
          {bidError ? `${bidError}.` : ''}
        </p>
        {!isPage && <p className={styles.settingsHelp}>
          <IconInfoCircle size={14} stroke={strokeFor(14)} aria-hidden="true" />{' '}
          Only fields with values are sent. Empty fields keep their current values.
        </p>}
      </fieldset>
    </SettingsFrame>
  )
}


function SettingsFrame({ presentation, children, footer, ...drawerProps }: {
  presentation: 'drawer' | 'page'
  children: ReactNode
  footer: ReactNode
} & Omit<ComponentProps<typeof Drawer>, 'children' | 'footer'>) {
  if (presentation === 'page') return (
    <section className={pageStyles.editor} aria-label="Individual matka configuration">
      {children}
      <div className={pageStyles.footer}>{footer}</div>
    </section>
  )
  return <Drawer {...drawerProps} footer={footer}>{children}</Drawer>
}

export function SettingsDrawer(props: Omit<SettingsEditorProps, 'presentation'>) {
  return <SettingsEditor {...props} presentation="drawer" />
}
