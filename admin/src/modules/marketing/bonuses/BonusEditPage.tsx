import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useMutation, type MutationTuple } from '@apollo/client'
import { gql } from '@apollo/client'
import { useNavigate, useParams } from 'react-router-dom'
import { IconAlertCircle } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DateTimeField } from '@/ui/components/DateTimeField'
import { Divider } from '@/ui/components/Divider'
import { EmptyState } from '@/ui/components/EmptyState'
import { Form, FormActions, FormSection } from '@/ui/components/Form'
import { strokeFor } from '@/ui/components/icons'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { RadioGroup } from '@/ui/components/RadioGroup'
import { Select } from '@/ui/components/Select'
import { TextField } from '@/ui/components/TextField'
import { toast } from '@/ui/components/toast'
import { useForm } from '@/ui/form/useForm'
import {
  EDIT_BONUS_TYPE_OPTIONS,
  EDIT_DEPOSIT_CONDITION_OPTIONS,
  EDIT_DOMAIN_OPTIONS,
  EDIT_RELEASE_TYPE_OPTIONS,
  EDIT_STATUS_OPTIONS,
  LOSING_DISTRIBUTION_OPTIONS,
  bonusEditSchema,
  bonusEditTypeChangePatch,
  createBonusEditBaseline,
  editChoices,
  editDistributionOptions,
  getBonusEditVisibility,
  serializeBonusEdit,
  type BonusCampaignRecord,
  type BonusCampaignUpdateInput,
  type BonusEditBaseline,
  type BonusEditValues,
} from './bonusEditModel'
import styles from './BonusEditPage.module.css'

const GET_BONUS_CAMPAIGN_QUERY = gql`
  query GetBonusCampaign($id: ID!) {
    bonusCampaign(id: $id) {
      id
      name
      domain
      type
      status
      currency
      budgetNumeric
      depositConditionType
      depositConditionAmount
      distributionType
      amountType
      depositRequired
      releaseType
      amount
      percentage
      numberOfPlayers
      usagePerPlayer
      startDate
      endDate
      wagering
      expiryBonusDays
    }
  }
`

const UPDATE_BONUS_CAMPAIGN_MUTATION = gql`
  mutation UpdateBonusCampaign($input: BonusCampaignUpdateInput!) {
    updateBonusCampaign(input: $input) {
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

interface BonusCampaignData {
  bonusCampaign: BonusCampaignRecord | null
}

interface UpdateBonusCampaignData {
  updateBonusCampaign: {
    success: boolean
    message: string
    campaign: { id: string; name: string; domain: string; type: string; status: string } | null
  }
}

interface UpdateBonusCampaignVariables {
  input: BonusCampaignUpdateInput
}

type UpdateCampaign = MutationTuple<UpdateBonusCampaignData, UpdateBonusCampaignVariables>[0]

/* The page raised antd notifications, whose default was 4.5 seconds; the kit toasts keep that timing,
   as the Create Bonus page does. */
const NOTIFICATION_DURATION_MS = 4500

const ACCESS_REQUIREMENT = [{ domain: 'bonuses.detail', actions: ['view', 'update'] }]

const DEPOSIT_REQUIRED_OPTIONS = [
  { label: 'Yes', value: true },
  { label: 'No', value: false },
] as const

const AMOUNT_TYPE_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Fixed', value: 'fixed' },
  { label: 'Percentage', value: 'percentage' },
]

export default function BonusEditPage() {
  return (
    <RBACGuard required={ACCESS_REQUIREMENT}>
      <BonusEditPageContent />
    </RBACGuard>
  )
}

function BonusEditPageContent() {
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const { id } = useParams<{ id: string }>()

  const { data, loading: queryLoading } = useQuery<BonusCampaignData>(GET_BONUS_CAMPAIGN_QUERY, {
    variables: { id },
    errorPolicy: 'all',
    skip: !id,
  })

  const [updateCampaign, { loading: updating }] = useMutation<UpdateBonusCampaignData, UpdateBonusCampaignVariables>(
    UPDATE_BONUS_CAMPAIGN_MUTATION,
    {
      refetchQueries: [{ query: GET_BONUS_CAMPAIGN_QUERY, variables: { id } }],
      // The form toasts the outcome itself; the global mutation toast said it a second time (MAR-06).
      context: { skipNotification: true },
    },
  )

  const campaign = data?.bonusCampaign
  /* The legacy initialiser loaded a campaign only when it was the one the route names. A record for
     another id (a route id the API normalises, such as 042) left that form empty and unsaveable; it
     now reads as not found instead. */
  const record = campaign && id && String(campaign.id) === id ? campaign : null

  let body: ReactNode
  if (queryLoading) {
    body = (
      <Card body="flush">
        <LoadingState label="Loading bonus campaign" />
      </Card>
    )
  } else if (!record || !id) {
    body = (
      <Card body="flush">
        <EmptyState
          title="Campaign not found"
          icon={<IconAlertCircle size={20} stroke={strokeFor(20)} />}
          action={<Button onClick={() => navigate('/bonuses')}>Back to List</Button>}
        />
      </Card>
    )
  } else {
    /* The form mounts only once the record is here: useForm reads its initial values on its first
       render, so the first commit already shows the campaign (records/task-105.md, "Flaky load
       test"). It is keyed by the route id, so another campaign gets a fresh form; a refetch of this
       one does not reload it, as the legacy formInitialized flag ensured. */
    body = (
      <BonusEditForm
        key={id}
        id={id}
        record={record}
        updateCampaign={updateCampaign}
        updating={updating}
      />
    )
  }

  return (
    <Page>
      <PageHeader eyebrow={pageEyebrow} title="Edit Bonus Campaign" sub="Update bonus campaign settings" />
      {body}
    </Page>
  )
}

interface BonusEditFormProps {
  id: string
  record: BonusCampaignRecord
  updateCampaign: UpdateCampaign
  updating: boolean
}

function BonusEditForm({ id, record, updateCampaign, updating }: BonusEditFormProps) {
  const navigate = useNavigate()
  const { currencies } = useCurrency()
  // The loaded values, read once: they seed the form and tell the update what the admin changed.
  const [baseline] = useState<BonusEditBaseline>(() => createBonusEditBaseline(id, record))

  const submitCampaign = useCallback(async (values: BonusEditValues) => {
    try {
      const input = serializeBonusEdit(values, baseline)
      const { data: updateData } = await updateCampaign({ variables: { input } })

      if (updateData?.updateBonusCampaign.success) {
        toast({
          title: 'Success',
          message: updateData.updateBonusCampaign.message,
          tone: 'ok',
          duration: NOTIFICATION_DURATION_MS,
        })
        navigate(`/bonuses/${id}`)
      } else {
        toast({
          title: 'Error',
          message: updateData?.updateBonusCampaign.message || 'Failed to update campaign',
          tone: 'error',
          duration: NOTIFICATION_DURATION_MS,
        })
      }
    } catch (err: unknown) {
      toast({
        title: 'Error',
        message: err instanceof Error ? err.message : 'Failed to update campaign',
        tone: 'error',
        duration: NOTIFICATION_DURATION_MS,
      })
    }
  }, [baseline, id, navigate, updateCampaign])

  const form = useForm({
    schema: bonusEditSchema,
    initialValues: baseline.values,
    onSubmit: submitCampaign,
  })
  const { errorAnnouncementRevision, getValue, setValues, validate } = form

  /* useForm focuses the first invalid control without scrolling (kit default). A failed submit
     usually comes from the sticky footer, so bring that control into view as well (as Create does). */
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (errorAnnouncementRevision === 0) return
    const focused = document.activeElement
    if (focused instanceof HTMLElement && formRef.current?.contains(focused)) {
      focused.scrollIntoView?.({ block: 'nearest' })
    }
  }, [errorAnnouncementRevision])

  const visibility = getBonusEditVisibility(form.values)
  const activeCurrencies = useMemo(
    () => currencies
      .filter((currency) => currency.isActive)
      .map((currency) => ({
        value: currency.code,
        label: `${currency.symbol} ${currency.code} - ${currency.name}`,
      })),
    [currencies],
  )
  const currencyOptions = editChoices(activeCurrencies, form.values.currency)
  const bonusTypeOptions = editChoices(EDIT_BONUS_TYPE_OPTIONS, form.values.bonusType)
  const statusOptions = editChoices(EDIT_STATUS_OPTIONS, form.values.status)
  const domainOptions = editChoices(EDIT_DOMAIN_OPTIONS, form.values.domain)
  const conditionOptions = editChoices(EDIT_DEPOSIT_CONDITION_OPTIONS, form.values.depositConditionType)
  const releaseOptions = editChoices(EDIT_RELEASE_TYPE_OPTIONS, form.values.releaseType)
  /* Losing Bonus shows a disabled Roll Over, the value the update always sends for it. Named change:
     the legacy disabled select showed whatever distribution the campaign still held. */
  const distributionChoices = visibility.isLosingBonus
    ? LOSING_DISTRIBUTION_OPTIONS
    : editChoices(editDistributionOptions(form.values.bonusType), form.values.distributionType)
  // Each legacy antd Row began a new line; the first visible control of the amount row does here.
  const amountStartsRow = !visibility.showAmountType && visibility.showAmount
  const percentageStartsRow = !visibility.showAmountType && !visibility.showAmount

  const campaignName = form.field('campaignName')
  const currency = form.field('currency')
  const bonusType = form.field('bonusType')
  const status = form.field('status')
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
  const budgetNumeric = form.field('budgetNumeric')

  return (
    <Card body="flush" className={styles.card}>
      <Form
        ref={formRef}
        className={styles.form}
        onSubmit={form.handleSubmit}
        errorAnnouncement={form.errorAnnouncement}
        errorAnnouncementRevision={errorAnnouncementRevision}
      >
        {/* BEYOND-LEGACY (the Create Bonus idiom): antd only outlined the fields. After a failed submit
            this says why, and its count follows the remaining errors until they are fixed. */}
        {errorAnnouncementRevision > 0 && form.errorCount > 0 ? (
          <Notice tone="error" title="Campaign not updated">
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
            label="Bonus Type"
            layout="stacked"
            placeholder="Select bonus type"
            options={bonusTypeOptions}
            value={bonusType.value}
            onChange={(value) => setValues(bonusEditTypeChangePatch(value))}
            onBlur={bonusType.onBlur}
            error={bonusType.error}
            required
          />
          <Select
            id={status.id}
            name={status.name}
            label="Status"
            layout="stacked"
            placeholder="Select status"
            options={statusOptions}
            value={status.value}
            onChange={status.onChange}
            onBlur={status.onBlur}
            error={status.error}
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
              options={domainOptions}
              value={domain.value}
              onChange={domain.onChange}
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
                options={conditionOptions}
                value={depositConditionType.value}
                onChange={depositConditionType.onChange}
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
            // The legacy "Roll Over" placeholder never showed under the forced value; a native select
            // would list it as a second, disabled Roll Over.
            placeholder={visibility.isLosingBonus ? undefined : 'Select distribution type'}
            options={distributionChoices}
            value={visibility.isLosingBonus ? 'roll_over' : distributionType.value}
            onChange={distributionType.onChange}
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
              options={releaseOptions}
              value={releaseType.value}
              onChange={releaseType.onChange}
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
          {/* W1-S3: the values are IST calendar times, converted to UTC only in the mutation input;
              a date left as loaded goes back as the stored instant, as before. */}
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
          {/* Grouping as the amounts above (mockup grp(), M:1943-1948). */}
          <NumberField
            {...budgetNumeric}
            label="Budget"
            placeholder="Enter budget amount"
            min={0}
            grouping="en-IN"
          />
        </FormSection>

        <FormActions>
          <Button onClick={() => navigate(`/bonuses/${id}`)}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            loading={updating || form.submitting}
          >
            Update Campaign
          </Button>
        </FormActions>
      </Form>
    </Card>
  )
}
