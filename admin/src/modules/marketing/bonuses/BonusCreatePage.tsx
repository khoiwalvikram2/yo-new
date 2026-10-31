import { useCallback, useEffect, useRef } from 'react'
import { gql, useMutation } from '@apollo/client'
import { useNavigate } from 'react-router-dom'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DateTimeField } from '@/ui/components/DateTimeField'
import { Divider } from '@/ui/components/Divider'
import { Form, FormActions, FormSection } from '@/ui/components/Form'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { RadioGroup } from '@/ui/components/RadioGroup'
import { Select, type SelectOption } from '@/ui/components/Select'
import { TextField } from '@/ui/components/TextField'
import { toast } from '@/ui/components/toast'
import { useForm } from '@/ui/form/useForm'
import {
  OFFERED_BONUS_TYPES,
  bonusCreateSchema,
  bonusTypeChangePatch,
  createBonusInitialValues,
  getBonusCreateVisibility,
  serializeBonusCreate,
  withRetainedOption,
  type BonusCampaignCreateInput,
  type BonusCreateValues,
  type BonusDomain,
  type BonusType,
  type DepositConditionType,
  type DistributionType,
  type ReleaseType,
} from './bonusCreateModel'
import styles from './BonusCreatePage.module.css'

const CREATE_BONUS_CAMPAIGN_MUTATION = gql`
  mutation CreateBonusCampaign($input: BonusCampaignCreateInput!) {
    createBonusCampaignV2(input: $input) {
      success
      message
      campaign {
        id
        name
        domain
        type
        status
      }
    }
  }
`

interface CreateBonusCampaignData {
  createBonusCampaignV2: {
    success: boolean
    message: string
    campaign: { id: string }
  }
}

interface CreateBonusCampaignVariables {
  input: BonusCampaignCreateInput
}

const BONUS_TYPE_LABELS: Record<(typeof OFFERED_BONUS_TYPES)[number], string> = {
  deposit: 'Deposit',
  daily_first_deposit: 'First Day First Time Deposit',
  signup: 'Signup',
  direct_amount: 'Direct Bonus',
  losing_bonus: 'Losing Bonus',
  special: 'Special Bonus',
}

const BONUS_TYPE_OPTIONS: readonly SelectOption[] = OFFERED_BONUS_TYPES.map((value) => ({
  value,
  label: BONUS_TYPE_LABELS[value],
}))

const DOMAIN_OPTIONS: readonly SelectOption[] = [
  { label: 'All', value: 'global' },
  { label: 'Sports', value: 'sports' },
  { label: 'Casino', value: 'casino' },
  { label: 'Matka', value: 'matka' },
]

const DEPOSIT_CONDITION_OPTIONS: readonly SelectOption[] = [
  { label: 'Greater Than', value: 'greater_than' },
  { label: 'Equal To', value: 'equal_to' },
]

const RELEASE_TYPE_OPTIONS: readonly SelectOption[] = [
  { label: 'Bonus Amount Only', value: 'bonus_amount_only' },
  { label: 'Total Amount in Bonus Wallet', value: 'total_bonus_wallet' },
]

const AMOUNT_TYPE_OPTIONS = [
  { label: 'Fixed', value: 'fixed' },
  { label: 'Percentage', value: 'percentage' },
] as const

const DEPOSIT_REQUIRED_OPTIONS = [
  { label: 'Yes', value: true },
  { label: 'No', value: false },
] as const

const LOSING_DISTRIBUTION_OPTIONS: readonly SelectOption[] = [{ label: 'Roll Over', value: 'roll_over' }]

/** The legacy Distribution Type list: Roll Over disabled for Signup, Instant Cash dropped for Special. */
function distributionOptions(bonusType: BonusCreateValues['bonusType']): readonly SelectOption[] {
  return [
    { label: 'Instant OTP', value: 'instant_otp' },
    { label: 'Instant Cash', value: 'instant_cash' },
    {
      label: 'Roll Over',
      value: 'roll_over',
      disabled: bonusType === 'signup' || bonusType === 'referral_deposit',
    },
  ].filter((option) => !(bonusType === 'special' && option.value === 'instant_cash'))
}

/* The page raised antd notifications, whose default was 4.5 seconds; shared/services/notification.ts
   keeps that timing for every converted notification, and so does this page. */
const NOTIFICATION_DURATION_MS = 4500

const ACCESS_REQUIREMENT = [{ domain: 'bonuses.create', actions: ['view', 'create'] }]

export default function BonusCreatePageWrapper() {
  return (
    <RBACGuard required={ACCESS_REQUIREMENT}>
      <BonusCreatePageContent />
    </RBACGuard>
  )
}

function BonusCreatePageContent() {
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const { currencies, getWhitelabelBaseCurrencyCode } = useCurrency()
  const defaultCurrency = getWhitelabelBaseCurrencyCode()
  const [createCampaign, mutationState] = useMutation<
    CreateBonusCampaignData,
    CreateBonusCampaignVariables
  >(CREATE_BONUS_CAMPAIGN_MUTATION)

  const submitCampaign = useCallback(async (values: BonusCreateValues) => {
    try {
      const { data } = await createCampaign({ variables: { input: serializeBonusCreate(values) } })
      if (data?.createBonusCampaignV2.success) {
        toast({
          title: 'Success',
          message: data.createBonusCampaignV2.message,
          tone: 'ok',
          duration: NOTIFICATION_DURATION_MS,
        })
        navigate(`/bonuses/${data.createBonusCampaignV2.campaign.id}`)
      } else {
        toast({
          title: 'Error',
          message: data?.createBonusCampaignV2.message || 'Failed to create campaign',
          tone: 'error',
          duration: NOTIFICATION_DURATION_MS,
        })
      }
    } catch (error: unknown) {
      toast({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to create campaign',
        tone: 'error',
        duration: NOTIFICATION_DURATION_MS,
      })
    }
  }, [createCampaign, navigate])

  const form = useForm({
    schema: bonusCreateSchema,
    initialValues: createBonusInitialValues(defaultCurrency),
    onSubmit: submitCampaign,
  })
  const { errorAnnouncementRevision, getValue, setValue, setValues, validate } = form

  /* The base currency is the default, and it follows the whitelabel's base currency when that
     arrives or changes after mount. Named change: the legacy effect keyed on the context getter's
     identity, so any CurrencyProvider re-render (a topbar display-currency switch, a currencies
     refetch) also overwrote a currency the admin had already chosen; only a new base code does now. */
  const appliedDefaultCurrency = useRef(defaultCurrency)
  useEffect(() => {
    if (appliedDefaultCurrency.current === defaultCurrency) return
    appliedDefaultCurrency.current = defaultCurrency
    setValue('currency', defaultCurrency)
  }, [defaultCurrency, setValue])

  /* useForm focuses the first invalid control without scrolling (kit default). A failed submit
     usually comes from the sticky footer, so bring that control into view as well. */
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (errorAnnouncementRevision === 0) return
    const focused = document.activeElement
    if (focused instanceof HTMLElement && formRef.current?.contains(focused)) {
      focused.scrollIntoView?.({ block: 'nearest' })
    }
  }, [errorAnnouncementRevision])

  const visibility = getBonusCreateVisibility(form.values)
  const currencyOptions = withRetainedOption(
    currencies
      .filter((currency) => currency.isActive)
      .map((currency) => ({
        value: currency.code,
        label: `${currency.symbol} ${currency.code} - ${currency.name}`,
      })),
    form.values.currency,
  )
  const distributionChoices = visibility.isLosingBonus
    ? LOSING_DISTRIBUTION_OPTIONS
    : withRetainedOption(distributionOptions(form.values.bonusType), form.values.distributionType)
  // Each legacy antd Row began a new line; the first visible control of the amount row does here.
  const amountStartsRow = !visibility.showAmountType && visibility.showAmount
  const percentageStartsRow = !visibility.showAmountType && !visibility.showAmount

  const campaignName = form.field('campaignName')
  const currency = form.field('currency')
  const bonusType = form.field('bonusType')
  const domain = form.field('domain')
  const depositRequired = form.field('depositRequired')
  const depositConditionType = form.field('depositConditionType')
  const depositConditionAmount = form.field('depositConditionAmount')
  const distributionType = form.field('distributionType')
  const wagering = form.field('wagering')
  const releaseType = form.field('releaseType')
  const amountType = form.field('amountType')
  const amount = form.field('amount')
  const percentage = form.field('percentage')
  const numberOfPlayers = form.field('numberOfPlayers')
  const usagePerPlayer = form.field('usagePerPlayer')
  const expiryBonusDays = form.field('expiryBonusDays')
  const startDate = form.field('startDate')
  const endDate = form.field('endDate')

  return (
    <Page>
      <PageHeader
        eyebrow={pageEyebrow}
        title="Create Bonus Campaign"
        sub="Configure a new bonus campaign with all settings"
      />

      <Card body="flush" className={styles.card}>
        <Form
          ref={formRef}
          className={styles.form}
          onSubmit={form.handleSubmit}
          errorAnnouncement={form.errorAnnouncement}
          errorAnnouncementRevision={errorAnnouncementRevision}
        >
          {/* BEYOND-LEGACY: antd only outlined the fields. After a failed submit this says why,
              and its count follows the remaining errors until they are fixed. */}
          {errorAnnouncementRevision > 0 && form.errorCount > 0 ? (
            <Notice tone="error" title="Campaign not created">
              {`Fix ${form.errorCount} highlighted ${form.errorCount === 1 ? 'field' : 'fields'} and submit again.`}
            </Notice>
          ) : null}

          <FormSection title="Basic Information">
            <TextField
              {...campaignName}
              label="Campaign Name"
              placeholder="e.g., Welcome Bonus 2024"
              required
            />
            <Select
              id={currency.id}
              name={currency.name}
              label="Currency"
              layout="stacked"
              placeholder="Select currency"
              options={currencyOptions}
              value={currency.value}
              onChange={currency.onChange}
              onBlur={currency.onBlur}
              error={currency.error}
              required
            />
            <Select
              id={bonusType.id}
              name={bonusType.name}
              className={styles.rowStart}
              label="Bonus Type"
              layout="stacked"
              placeholder="Select bonus type"
              options={BONUS_TYPE_OPTIONS}
              value={bonusType.value}
              onChange={(value) => {
                setValues(bonusTypeChangePatch({ releaseType: getValue('releaseType') }, value as BonusType))
              }}
              onBlur={bonusType.onBlur}
              error={bonusType.error}
              required
            />
            {visibility.isLosingBonus ? (
              <Select
                id={domain.id}
                name={domain.name}
                className={styles.rowStart}
                label="Domain"
                layout="stacked"
                placeholder="Select domain (All / Sports / Casino / Matka)"
                options={DOMAIN_OPTIONS}
                value={domain.value}
                onChange={(value) => domain.onChange(value as BonusDomain)}
                onBlur={domain.onBlur}
                error={domain.error}
                required
              />
            ) : null}
            {visibility.showDepositRequired ? (
              <RadioGroup
                {...depositRequired}
                className={styles.rowStart}
                label="Deposit Required"
                options={DEPOSIT_REQUIRED_OPTIONS}
                help="If yes, bonus card stays locked until user makes first deposit"
              />
            ) : null}
            {visibility.showDepositConditions ? (
              <>
                <Select
                  id={depositConditionType.id}
                  name={depositConditionType.name}
                  className={styles.rowStart}
                  label="Deposit Condition Type"
                  layout="stacked"
                  placeholder="Select condition type"
                  options={DEPOSIT_CONDITION_OPTIONS}
                  value={depositConditionType.value}
                  onChange={(value) => depositConditionType.onChange(value as DepositConditionType)}
                  onBlur={depositConditionType.onBlur}
                  error={depositConditionType.error}
                  required
                />
                {/* Grouping follows the admin's Indian convention (mockup grp(), M:1943-1948):
                    10,00,000 where the legacy formatter drew 1,000,000. Display only. */}
                <NumberField
                  {...depositConditionAmount}
                  label="Deposit Condition Amount"
                  placeholder="Enter amount"
                  min={0}
                  grouping="en-IN"
                  required
                />
              </>
            ) : null}
          </FormSection>

          {/* The legacy card ruled off each of its three section headers. */}
          <Divider />

          <FormSection title="Distribution & Amount">
            <Select
              id={distributionType.id}
              name={distributionType.name}
              label="Distribution Type"
              layout="stacked"
              // The legacy "Roll Over" placeholder never showed under the forced value; a native
              // select would list it as a second, disabled Roll Over.
              placeholder={visibility.isLosingBonus ? undefined : 'Select distribution type'}
              options={distributionChoices}
              value={distributionType.value}
              onChange={(value) => distributionType.onChange(value as DistributionType)}
              onBlur={distributionType.onBlur}
              error={distributionType.error}
              disabled={visibility.isLosingBonus}
              required={form.values.bonusType === 'special'}
            />
            {visibility.showWagering ? (
              <NumberField
                {...wagering}
                label="Wagering Requirement"
                placeholder="e.g., 1.0, 2.0, 5.0"
                help="Multiplier for bonus amount. wagering_required = bonus_amount × wagering"
                min={0}
                step={0.1}
                required
              />
            ) : null}
            {visibility.showReleaseType ? (
              <Select
                id={releaseType.id}
                name={releaseType.name}
                label="Bonus Amount Release Type"
                layout="stacked"
                placeholder="Select release type"
                options={RELEASE_TYPE_OPTIONS}
                value={releaseType.value}
                onChange={(value) => releaseType.onChange(value as ReleaseType)}
                onBlur={releaseType.onBlur}
                error={releaseType.error}
                help="What amount to release to cash wallet when wagering is complete"
                required
              />
            ) : null}
            {visibility.showAmountType ? (
              <RadioGroup
                {...amountType}
                className={styles.rowStart}
                label="Amount Type"
                options={AMOUNT_TYPE_OPTIONS}
                required
              />
            ) : null}
            {visibility.showAmount ? (
              <NumberField
                {...amount}
                className={amountStartsRow ? styles.rowStart : undefined}
                label="Amount"
                placeholder="Enter amount"
                help={form.values.bonusType === 'special'
                  ? 'Optional at campaign level; amount is set per grant from player list'
                  : undefined}
                min={0}
                grouping="en-IN"
                required={form.values.bonusType !== 'special'}
              />
            ) : null}
            {visibility.showPercentage ? (
              <NumberField
                {...percentage}
                className={percentageStartsRow ? styles.rowStart : undefined}
                label="Percentage"
                placeholder="Enter percentage (0-100)"
                min={0}
                max={100}
                step={0.01}
                suffix="%"
                required
              />
            ) : null}
          </FormSection>

          <Divider />

          <FormSection title="Limits & Schedule">
            <NumberField
              {...numberOfPlayers}
              label="Number of Players"
              placeholder="Unlimited if empty"
              help="Maximum number of players who can use this bonus (leave empty for unlimited)"
              min={1}
              step={1}
            />
            {!visibility.hideUsagePerPlayer ? (
              <NumberField
                {...usagePerPlayer}
                label="Usage Per Player"
                placeholder="Enter usage limit"
                help={form.values.bonusType === 'daily_first_deposit'
                  ? 'Max times each player can receive this bonus in total; still at most once per calendar day (whitelabel timezone).'
                  : 'How many times each player can use this bonus'}
                min={1}
                step={1}
              />
            ) : null}
            <NumberField
              {...expiryBonusDays}
              className={styles.rowStart}
              label="Expiry bonus (days)"
              placeholder="e.g. 7, 30"
              help="Bonus must be used within this many days after being awarded. Leave empty for no expiry."
              min={1}
              step={1}
            />
            {/* W1-S3: the values are IST calendar times, converted to UTC only in the mutation
                input, so the help says which clock they read (the legacy pickers used the
                browser's own zone and said nothing). */}
            <DateTimeField
              {...startDate}
              className={styles.rowStart}
              label="Start Date"
              help="Calendar time in Asia/Kolkata (IST)."
              onChange={(value) => {
                startDate.onChange(value)
                // antd re-validated End Date whenever Start Date changed (dependencies).
                if (getValue('endDate')) void validate(['endDate'])
              }}
            />
            <DateTimeField
              {...endDate}
              label="End Date"
              help="Calendar time in Asia/Kolkata (IST)."
            />
          </FormSection>

          <FormActions>
            <Button onClick={() => navigate('/bonuses')}>Cancel</Button>
            <Button
              type="submit"
              variant="primary"
              loading={mutationState.loading || form.submitting}
            >
              Create Campaign
            </Button>
          </FormActions>
        </Form>
      </Card>
    </Page>
  )
}
