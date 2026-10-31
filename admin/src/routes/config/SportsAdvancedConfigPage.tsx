import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, gql } from '@apollo/client'
import { IconAlertCircle, IconBallFootball, IconDeviceFloppy, IconList } from '@tabler/icons-react'
import clsx from 'clsx'
import { LIST_SPORTS, LIST_LEAGUES } from '@/lib/graphql/sports'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Combobox } from '@/ui/components/Combobox'
import { Divider } from '@/ui/components/Divider'
import { EmptyState } from '@/ui/components/EmptyState'
import { Form, FormActions, FormSection } from '@/ui/components/Form'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Select } from '@/ui/components/Select'
import { Switch } from '@/ui/components/Switch'
import { Tabs } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import { useForm, type FormApi } from '@/ui/form/useForm'
import {
  ALERT_CHANNEL_OPTIONS,
  ALERT_RATE_LIMIT_FIELD,
  BACK_TO_BASIC_CONFIG,
  COMMISSION_FIELDS,
  DEFAULT_TIER_ID,
  DELAY_FIELDS,
  EXPOSURE_GROUPS,
  ODDS_FIELDS,
  RISK_LEVEL_OPTIONS,
  RISK_NUMBER_FIELDS,
  STAKE_GROUPS,
  TAB_ITEMS,
  configuringLabel,
  fixFieldsText,
  leagueSaveOutcome,
  leagueSettingsVariables,
  pickerOptions,
  seedKey,
  settingsFormValues,
  settingsSchema,
  sportSaveOutcome,
  sportSettingsVariables,
  thrownMessage,
  withRetainedOption,
  type ChoiceFieldName,
  type ChoiceOption,
  type NamedRow,
  type NumberFieldSpec,
  type SettingsFormValues,
  type SettingsTab,
  type SwitchFieldName,
} from './sportsAdvancedConfigModel'
import styles from './SportsAdvancedConfigPage.module.css'

/* /config/sports-advanced on the UI kit (W7 Task 198). The four GraphQL documents below, the two list queries,
   every query and mutation option, the RBAC guard, the fixed tier, the navigation target and every label,
   placeholder, rule and message are the legacy page's; the field specs, rules, seeding and variables live in
   ./sportsAdvancedConfigModel. */

const GET_SPORT_SETTINGS = gql`
  query GetSportSettings($sportId: ID!, $tierId: ID) {
    sportSettings(sportId: $sportId, tierId: $tierId) {
      sportId
      tierId
      exchangeMinStake
      exchangeMaxStake
      bookmakerMinStake
      bookmakerMaxStake
      fancyMinStake
      fancyMaxStake
      exchangeDelay
      bookmakerDelay
      fancyDelay
      exchangeCooldown
      bookmakerCooldown
      fancyCooldown
      exchangeMinOdds
      exchangeMaxOdds
      exchangeCommission
      bookmakerCommission
      fancyCommission
      exchangeExposureDaily
      exchangeExposureWeekly
      exchangeExposureCap
      bookmakerExposureDaily
      bookmakerExposureWeekly
      bookmakerExposureCap
      fancyExposureDaily
      fancyExposureWeekly
      fancyExposureCap
      cashoutActive
      riskLevel
      riskThreshold
      volatilityThreshold
      alertOnBreach
      alertChannel
      alertRateLimit
    }
  }
`

const GET_LEAGUE_SETTINGS = gql`
  query GetLeagueSettings($leagueId: ID!, $tierId: ID) {
    leagueSettings(leagueId: $leagueId, tierId: $tierId) {
      id
      leagueId
      tierId
      exchangeMinStake
      exchangeMaxStake
      bookmakerMinStake
      bookmakerMaxStake
      fancyMinStake
      fancyMaxStake
      exchangeDelay
      bookmakerDelay
      fancyDelay
      exchangeCooldown
      bookmakerCooldown
      fancyCooldown
      exchangeMinOdds
      exchangeMaxOdds
      exchangeCommission
      bookmakerCommission
      fancyCommission
      exchangeExposureDaily
      exchangeExposureWeekly
      exchangeExposureCap
      bookmakerExposureDaily
      bookmakerExposureWeekly
      bookmakerExposureCap
      fancyExposureDaily
      fancyExposureWeekly
      fancyExposureCap
      cashoutActive
      riskLevel
      riskThreshold
      volatilityThreshold
      alertOnBreach
      alertChannel
      alertRateLimit
    }
  }
`

const UPSERT_SPORT_SETTINGS = gql`
  mutation UpsertSportSettings($input: UpsertSportSettingsInput!) {
    upsertSportSettings(input: $input) {
      success
      message
    }
  }
`

const UPSERT_LEAGUE_SETTINGS = gql`
  mutation UpsertLeagueSettings($leagueIds: [ID!]!, $input: UpsertLeagueSettingsInput!) {
    upsertLeagueSettings(leagueIds: $leagueIds, input: $input) {
      success
      message
    }
  }
`

const MESSAGE_MS = 3000 // antd message's default three seconds
const TABS_ID = 'sports-advanced'
const ICON_SIZE = 18

interface SettingsFormProps {
  initialValues: SettingsFormValues
  saving: boolean
  onSave: (values: SettingsFormValues) => Promise<void>
  onReset?: () => void
}

/**
 * The 33 settings, mounted only once the record they edit has loaded (or the query finished without one), so
 * `useForm` reads the stored values as its initial values on its first render.
 */
function SettingsForm({ initialValues, saving, onSave, onReset }: SettingsFormProps) {
  const { getCurrencySymbol } = useCurrency()
  const formId = `sports-settings-${useId().replace(/:/g, '')}`
  const formRef = useRef<HTMLFormElement>(null)
  const form: FormApi<SettingsFormValues> = useForm<SettingsFormValues>({
    schema: settingsSchema,
    initialValues,
    // Runs only once the form is valid (the legacy validateFields); the page's handler reports the outcome.
    onSubmit: onSave,
  })
  const { values, errorAnnouncementRevision } = form
  const currencySymbol = getCurrencySymbol()
  /* BEYOND-LEGACY: legacy toasted "Failed to save settings" after a refused validation; the same words now head
     a summary in the form, with the count of fields to fix. */
  const showSummary = errorAnnouncementRevision > 0 && form.errorCount > 0

  /* useForm focuses the first invalid control without scrolling (kit default); bring it into view, as Create
     Bonus does. */
  useEffect(() => {
    if (errorAnnouncementRevision === 0) return
    const focused = document.activeElement
    if (focused instanceof HTMLElement && formRef.current?.contains(focused)) {
      focused.scrollIntoView?.({ block: 'nearest' })
    }
  }, [errorAnnouncementRevision])

  const numberField = (spec: NumberFieldSpec) => {
    const binding = form.field(spec.name)
    return (
      <NumberField
        key={spec.name}
        id={binding.id}
        name={binding.name}
        label={spec.label}
        value={binding.value ?? null}
        onChange={binding.onChange}
        onBlur={binding.onBlur}
        error={binding.error}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        placeholder={spec.placeholder}
        prefix={spec.currency ? currencySymbol : undefined}
        suffix={spec.percent ? '%' : undefined}
      />
    )
  }

  const choiceField = (name: ChoiceFieldName, label: string, placeholder: string, options: readonly ChoiceOption[]) => {
    const binding = form.field(name)
    return (
      <Select
        id={binding.id}
        name={binding.name}
        label={label}
        layout="stacked"
        placeholder={placeholder}
        value={binding.value ?? ''}
        onChange={binding.onChange}
        onBlur={binding.onBlur}
        error={binding.error}
        options={withRetainedOption(options, binding.value)}
      />
    )
  }

  const switchField = (name: SwitchFieldName, label: string) => (
    <div className={styles.fullRow}>
      <Switch label={label} checked={values[name] === true} onChange={(next) => form.setValue(name, next)} />
    </div>
  )

  return (
    <Form
      ref={formRef}
      id={formId}
      className={styles.form}
      onSubmit={form.handleSubmit}
      errorAnnouncement={form.errorAnnouncement}
      errorAnnouncementRevision={errorAnnouncementRevision}
    >
      {showSummary ? (
        <Notice
          tone="error"
          icon={<IconAlertCircle size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
          title="Failed to save settings"
        >
          {fixFieldsText(form.errorCount)}
        </Notice>
      ) : null}

      <FormSection title="Commission Rates (%)" cols={{ base: 1, md: 3 }} gap={16}>
        {COMMISSION_FIELDS.map(numberField)}
      </FormSection>

      <Divider />

      <FormSection title="Stake Limits" cols={{ base: 1 }} gap={16}>
        {STAKE_GROUPS.map((group) => (
          <FormSection
            key={group.title}
            title={group.title}
            cols={{ base: 1, md: 2 }}
            gap={16}
            className={styles.subsection}
          >
            {group.fields.map(numberField)}
          </FormSection>
        ))}
      </FormSection>

      <Divider />

      <FormSection title="Exposure Limits" cols={{ base: 1 }} gap={16}>
        {EXPOSURE_GROUPS.map((group) => (
          <FormSection
            key={group.title}
            title={group.title}
            cols={{ base: 1, md: 3 }}
            gap={16}
            className={styles.subsection}
          >
            {group.fields.map(numberField)}
          </FormSection>
        ))}
      </FormSection>

      <Divider />

      <FormSection title="Bet Delays & Cooldowns (seconds)" cols={{ base: 1, md: 3 }} gap={16}>
        {DELAY_FIELDS.map(numberField)}
      </FormSection>

      <Divider />

      <FormSection title="Odds Limits" cols={{ base: 1, md: 2 }} gap={16}>
        {ODDS_FIELDS.map(numberField)}
      </FormSection>

      <Divider />

      <FormSection title="Risk Settings" cols={{ base: 1, md: 3 }} gap={16}>
        {choiceField('riskLevel', 'Risk Level', 'Select risk level', RISK_LEVEL_OPTIONS)}
        {RISK_NUMBER_FIELDS.map(numberField)}
      </FormSection>

      <Divider />

      <FormSection title="Other Settings" cols={{ base: 1, md: 2 }} gap={16}>
        {switchField('cashoutActive', 'Cashout Active')}
        {switchField('alertOnBreach', 'Alert on Risk Breach')}
        {choiceField('alertChannel', 'Alert Channel', 'Select channel', ALERT_CHANNEL_OPTIONS)}
        {numberField(ALERT_RATE_LIMIT_FIELD)}
      </FormSection>

      {/* The legacy sticky save bar. */}
      <FormActions>
        {onReset ? (
          /* Named change: Reset returns the form to the values last loaded and refetches them. antd's
             resetFields blanked every field, and the refetch refilled them only when the stored values had
             changed meanwhile. */
          <Button
            onClick={() => {
              form.reset()
              onReset()
            }}
          >
            Reset
          </Button>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          icon={<IconDeviceFloppy size={16} stroke={strokeFor(16)} />}
          loading={saving || form.submitting}
        >
          Save Settings
        </Button>
      </FormActions>
    </Form>
  )
}

/** A settings query that failed: the form is not offered over values that never arrived. */
function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice
      tone="error"
      icon={<IconAlertCircle size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
      title="Settings could not be loaded"
      action={
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      {message}
    </Notice>
  )
}

export default function SportsAdvancedConfigPage() {
  return (
    <RBACGuard required={[{ domain: 'config.sports-advanced', actions: ['view'] }]}>
      <SportsAdvancedConfigPageContent />
    </RBACGuard>
  )
}

function SportsAdvancedConfigPageContent() {
  const pageEyebrow = usePageEyebrow()
  const [activeTab, setActiveTab] = useState<SettingsTab>('sport')
  const [selectedSportId, setSelectedSportId] = useState<string | null>(null)
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null)
  const [selectedSportIdForLeagues, setSelectedSportIdForLeagues] = useState<string | null>(null)
  const [tierId] = useState<string>(DEFAULT_TIER_ID)

  const { data: sportsData, loading: sportsLoading } = useQuery(LIST_SPORTS)
  const { data: leaguesData, loading: leaguesLoading } = useQuery(LIST_LEAGUES, {
    variables: { sportId: selectedSportIdForLeagues || '' },
    skip: !selectedSportIdForLeagues,
  })

  const {
    data: sportSettingsData,
    loading: sportSettingsLoading,
    error: sportSettingsError,
    refetch: refetchSportSettings,
  } = useQuery(
    GET_SPORT_SETTINGS,
    {
      variables: { sportId: selectedSportId || '', tierId },
      skip: !selectedSportId,
    }
  )

  const {
    data: leagueSettingsData,
    loading: leagueSettingsLoading,
    error: leagueSettingsError,
    refetch: refetchLeagueSettings,
  } = useQuery(
    GET_LEAGUE_SETTINGS,
    {
      variables: { leagueId: selectedLeagueId || '', tierId },
      skip: !selectedLeagueId,
    }
  )

  const [upsertSportSettings, { loading: savingSport }] = useMutation(UPSERT_SPORT_SETTINGS)
  const [upsertLeagueSettings, { loading: savingLeague }] = useMutation(UPSERT_LEAGUE_SETTINGS)

  const sports = useMemo<NamedRow[]>(() => sportsData?.sports || [], [sportsData])
  const leagues = useMemo<NamedRow[]>(() => leaguesData?.leagues || [], [leaguesData])
  const sportOptions = useMemo(() => pickerOptions(sports), [sports])
  const leagueOptions = useMemo(() => pickerOptions(leagues), [leagues])

  /* What each form is seeded with: the stored record's fields, or nothing when none is stored (legacy
     :657-673 filled the antd form from the same data). The form below mounts only once the query has
     answered, and remounts when a refetch brings different values (a save, Reset). */
  const sportSeed = useMemo(() => settingsFormValues(sportSettingsData?.sportSettings), [sportSettingsData])
  const leagueSeed = useMemo(() => settingsFormValues(leagueSettingsData?.leagueSettings), [leagueSettingsData])

  /* Named change: one toast per save, the outcome's own. The legacy form also raised "Settings saved
     successfully" after every save, even one that had failed. */
  const handleSaveSportSettings = async (values: SettingsFormValues) => {
    if (!selectedSportId) {
      toast({ message: 'Please select a sport first', tone: 'error', duration: MESSAGE_MS })
      return
    }

    try {
      const result = await upsertSportSettings({
        variables: sportSettingsVariables(selectedSportId, tierId, values),
      })
      const outcome = sportSaveOutcome(result.data?.upsertSportSettings)
      if (outcome.ok) {
        toast({ message: outcome.message, tone: 'ok', duration: MESSAGE_MS })
        void refetchSportSettings()
      } else {
        toast({ message: outcome.message, tone: 'error', duration: MESSAGE_MS })
      }
    } catch (err: unknown) {
      toast({ message: thrownMessage(err, 'Failed to save sport settings'), tone: 'error', duration: MESSAGE_MS })
    }
  }

  const handleSaveLeagueSettings = async (values: SettingsFormValues) => {
    if (!selectedLeagueId) {
      toast({ message: 'Please select a league first', tone: 'error', duration: MESSAGE_MS })
      return
    }

    try {
      const result = await upsertLeagueSettings({
        variables: leagueSettingsVariables(selectedLeagueId, tierId, values),
      })
      const outcome = leagueSaveOutcome(result.data?.upsertLeagueSettings)
      if (outcome.ok) {
        toast({ message: outcome.message, tone: 'ok', duration: MESSAGE_MS })
        void refetchLeagueSettings()
      } else {
        toast({ message: outcome.message, tone: 'error', duration: MESSAGE_MS })
      }
    } catch (err: unknown) {
      toast({ message: thrownMessage(err, 'Failed to save league settings'), tone: 'error', duration: MESSAGE_MS })
    }
  }

  /* Named change: while a record loads the panel says so, and a failed load offers a retry; legacy showed the
     form empty until the values arrived, and kept it empty (and savable) after a failed load. */
  const sportBody = !selectedSportId ? (
    <EmptyState
      inset="none"
      icon={<IconBallFootball size={20} stroke={strokeFor(20)} />}
      title="Please select a sport to configure its settings"
    />
  ) : sportSettingsLoading ? (
    <LoadingState label="Loading sport settings" minHeight={192} />
  ) : sportSettingsError ? (
    <LoadFailed message={sportSettingsError.message} onRetry={() => void refetchSportSettings()} />
  ) : null

  const leagueBody = !selectedLeagueId ? (
    <EmptyState
      inset="none"
      icon={<IconList size={20} stroke={strokeFor(20)} />}
      title="Please select a sport and league to configure settings"
    />
  ) : leagueSettingsLoading ? (
    <LoadingState label="Loading league settings" minHeight={192} />
  ) : leagueSettingsError ? (
    <LoadFailed message={leagueSettingsError.message} onRetry={() => void refetchLeagueSettings()} />
  ) : null

  return (
    <Page>
      <PageHeader
        eyebrow={pageEyebrow}
        title="Advanced Sports Configuration"
        sub="Configure detailed settings per sport and league. These settings override global defaults."
        back={{ to: BACK_TO_BASIC_CONFIG, label: 'Back to Basic Config' }}
      />

      <Card body="flush" className={styles.card}>
        <div className={styles.tabsBar}>
          <Tabs value={activeTab} items={TAB_ITEMS} onChange={setActiveTab} label="Settings level" idPrefix={TABS_ID} />
        </div>

        {/* Both panels stay mounted, as antd kept a visited pane, so a half-edited form survives a tab switch. */}
        <div
          role="tabpanel"
          id={tabPanelId(TABS_ID, 'sport')}
          aria-labelledby={tabId(TABS_ID, 'sport')}
          hidden={activeTab !== 'sport'}
          className={styles.panel}
        >
          <div className={styles.panelHead}>
            <div className={styles.pickers}>
              <Combobox
                label="Select Sport"
                required
                placeholder="Select a sport to configure"
                loading={sportsLoading}
                options={sportOptions}
                value={selectedSportId}
                // The settings form remounts for the new sport (legacy: resetFields()).
                onChange={(value) => setSelectedSportId(value)}
              />
            </div>
            {selectedSportId ? (
              <span className={clsx(styles.configuring, styles.hueBlu)}>{configuringLabel(sports, selectedSportId)}</span>
            ) : null}
          </div>
          {sportBody ? (
            <div className={styles.panelState}>{sportBody}</div>
          ) : selectedSportId ? (
            <SettingsForm
              key={`${selectedSportId}:${seedKey(sportSeed)}`}
              initialValues={sportSeed}
              saving={savingSport}
              onSave={handleSaveSportSettings}
              onReset={() => void refetchSportSettings()}
            />
          ) : null}
        </div>

        <div
          role="tabpanel"
          id={tabPanelId(TABS_ID, 'league')}
          aria-labelledby={tabId(TABS_ID, 'league')}
          hidden={activeTab !== 'league'}
          className={styles.panel}
        >
          <div className={styles.panelHead}>
            <div className={clsx(styles.pickers, styles.pickersPair)}>
              <Combobox
                label="Select Sport (to load leagues)"
                required
                placeholder="Select sport first"
                loading={sportsLoading}
                options={sportOptions}
                value={selectedSportIdForLeagues}
                onChange={(value) => {
                  setSelectedSportIdForLeagues(value)
                  setSelectedLeagueId(null)
                }}
              />
              <Combobox
                label="Select League"
                required
                placeholder="Select a league to configure"
                loading={leaguesLoading}
                options={leagueOptions}
                value={selectedLeagueId}
                onChange={(value) => setSelectedLeagueId(value)}
                disabled={!selectedSportIdForLeagues}
              />
            </div>
            {selectedLeagueId ? (
              <span className={clsx(styles.configuring, styles.hueGrn)}>{configuringLabel(leagues, selectedLeagueId)}</span>
            ) : null}
          </div>
          {leagueBody ? (
            <div className={styles.panelState}>{leagueBody}</div>
          ) : selectedLeagueId ? (
            <SettingsForm
              key={`${selectedLeagueId}:${seedKey(leagueSeed)}`}
              initialValues={leagueSeed}
              saving={savingLeague}
              onSave={handleSaveLeagueSettings}
              onReset={() => void refetchLeagueSettings()}
            />
          ) : null}
        </div>
      </Card>
    </Page>
  )
}

