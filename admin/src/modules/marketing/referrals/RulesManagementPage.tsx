import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useQuery, useMutation, gql } from '@apollo/client'
import {
  IconCheck,
  IconFileText,
  IconInfoCircle,
  IconListDetails,
  IconPencil,
  IconPlus,
  IconRotate2,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Drawer } from '@/ui/components/Drawer'
import { EmptyState } from '@/ui/components/EmptyState'
import { Form, FormField, FormSection } from '@/ui/components/Form'
import { IconButton } from '@/ui/components/IconButton'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Select } from '@/ui/components/Select'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { Tooltip } from '@/ui/components/Tooltip'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import { useForm } from '@/ui/form/useForm'
import {
  activeRuleCount,
  buildRuleInput,
  cleanDecimal,
  createRuleFormSchema,
  createRuleInitialValues,
  displayedRules,
  formatRuleValue,
  payoutTypeHue,
  payoutTypeOptions,
  programTiers,
  ruleDrawerCopy,
  ruleFormSummary,
  ruleToFormValues,
  ruleTypeChangePatch,
  ruleTypeHue,
  ruleTypeLabel,
  ruleTypeOptions,
  rulesCountLabel,
  tierCaption,
  tierRatesHelp,
  tierRatesLabel,
  type ReferralRule,
  type RuleFormValues,
  type RuleHue,
} from './referralRulesModel'
import styles from './RulesManagementPage.module.css'

const REFERRAL_PROGRAM_QUERY = gql`
  query ReferralProgram {
    referralProgramByTenant {
      id
      maxDepth
    }
  }
`

const REFERRAL_RULES_QUERY = gql`
  query ReferralRules($programId: ID) {
    referralRules(programId: $programId) {
      id
      ruleType
      tierRates
      fixedAmounts
      caps
      thresholds
      payoutType
      splitRatio
      escrow
      reloadDepositsCount
      reloadMinDeposit
      isActive
      createdAt
      updatedAt
    }
  }
`

const UPSERT_REFERRAL_RULE_MUTATION = gql`
  mutation UpsertReferralRule($input: ReferralRuleInput!) {
    upsertReferralRules(input: $input) {
      success
      message
      rule {
        id
        ruleType
        isActive
      }
    }
  }
`

interface ReferralProgramData {
  referralProgramByTenant: { id: string; maxDepth: number | null } | null
}

interface ReferralRulesData {
  referralRules: ReferralRule[] | null
}

interface UpsertReferralRuleData {
  upsertReferralRules: {
    success: boolean
    message: string | null
    rule: { id: string; ruleType: string; isActive: boolean } | null
  }
}

/* antd notifications counted seconds: 3 for the saved message, 5 for a failure. */
const SAVED_TOAST_MS = 3000
const FAILED_TOAST_MS = 5000

/* The decorative hue ramp (the KPI tile hues, M:828-831): it tells the rule types apart and never reads as a
   status. */
const HUE_CLASS: Record<RuleHue, string> = {
  blu: styles.hueBlu,
  grn: styles.hueGrn,
  ind: styles.hueInd,
  vio: styles.hueVio,
  red: styles.hueRed,
  amb: styles.hueAmb,
}

export default function RulesManagementPage() {
  return (
    <RBACGuard required={[{ domain: 'referrals.rules', actions: ['view'] }]}>
      <RulesManagementPageContent />
    </RBACGuard>
  )
}

function RulesManagementPageContent() {
  const pageEyebrow = usePageEyebrow()
  const { formatAmount, getCurrencySymbol } = useCurrency()
  const { formatDate, formatTime } = useFormatDate()
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [editingRule, setEditingRule] = useState<ReferralRule | null>(null)
  // The control that opened the drawer: the drawer takes its theme and gives focus back to it.
  const drawerTriggerRef = useRef<HTMLElement | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const formId = `referral-rule-${useId().replace(/:/g, '')}`
  /* The form outlives each opening (useForm keeps its failed-submit revision through reset), so each
     opening records the revision reached; the summary needs a failed submit beyond it. */
  const [summaryFloor, setSummaryFloor] = useState(0)

  const { data: programData } = useQuery<ReferralProgramData>(REFERRAL_PROGRAM_QUERY, {
    errorPolicy: 'all',
  })

  const { data, loading, error, refetch } = useQuery<ReferralRulesData>(REFERRAL_RULES_QUERY, {
    errorPolicy: 'all',
  })

  // Check if tiers are enabled (maxDepth > 1)
  const maxDepth = programData?.referralProgramByTenant?.maxDepth
  const tiers = useMemo(() => programTiers(maxDepth), [maxDepth])

  const [upsertRule, { loading: saving }] = useMutation<UpsertReferralRuleData>(
    UPSERT_REFERRAL_RULE_MUTATION,
    {
      // Reported below; the global mutation toast said each outcome a second time (MAR-06).
      context: { skipNotification: true },
      onCompleted: (result) => {
        if (result.upsertReferralRules.success) {
          toast({
            message: result.upsertReferralRules.message || 'Rule saved successfully',
            tone: 'ok',
            duration: SAVED_TOAST_MS,
          })
          // antd also reset the form here; every opening resets it now, so closing is what is left.
          setDrawerVisible(false)
          setEditingRule(null)
          void refetch()
        } else {
          toast({
            message: result.upsertReferralRules.message || 'Failed to save rule',
            tone: 'error',
            duration: FAILED_TOAST_MS,
          })
        }
      },
      onError: (mutationError) => {
        toast({
          message: mutationError.message || 'Failed to save rule',
          tone: 'error',
          duration: FAILED_TOAST_MS,
        })
      },
    }
  )

  const schema = useMemo(() => createRuleFormSchema(tiers), [tiers])
  const form = useForm<RuleFormValues>({
    schema,
    initialValues: createRuleInitialValues(),
    // Runs only once the form is valid (the legacy validateFields). The mutation reports its own outcome.
    onSubmit: async (values) => {
      await upsertRule({
        variables: { input: buildRuleInput(values, editingRule?.id, tiers) },
      })
    },
  })
  const { errorAnnouncementRevision, reset } = form

  /* useForm focuses the first invalid control without scrolling (kit default); the drawer body scrolls, so
     bring it into view, as Create Bonus does. */
  useEffect(() => {
    if (errorAnnouncementRevision === 0) return
    const focused = document.activeElement
    if (focused instanceof HTMLElement && formRef.current?.contains(focused)) {
      focused.scrollIntoView?.({ block: 'nearest' })
    }
  }, [errorAnnouncementRevision])

  /* When the program's tier settings arrive or change while a rule is open for editing, the legacy drawer
     re-applied that rule's values, so a Loss Share rule gets one field per tier. */
  const tierSignature = `${tiers.enabled}:${tiers.count}`
  const appliedTierSignature = useRef(tierSignature)
  useEffect(() => {
    if (appliedTierSignature.current === tierSignature) return
    appliedTierSignature.current = tierSignature
    if (drawerVisible && editingRule) reset(ruleToFormValues(editingRule, tiers))
  }, [drawerVisible, editingRule, reset, tierSignature, tiers])

  const rules = data?.referralRules || []
  const rulesDisplay = displayedRules(rules)
  const activeRules = activeRuleCount(rulesDisplay)

  // Every opening starts from its own values: the rule's when editing (handleEdit), the blank form when adding.
  const openDrawer = (trigger: HTMLElement, rule: ReferralRule | null) => {
    drawerTriggerRef.current = trigger
    setSummaryFloor(errorAnnouncementRevision)
    setEditingRule(rule)
    reset(rule ? ruleToFormValues(rule, tiers) : createRuleInitialValues())
    setDrawerVisible(true)
  }

  const handleAdd = (event: MouseEvent<HTMLElement>) => openDrawer(event.currentTarget, null)

  const handleEdit = (rule: ReferralRule, event: MouseEvent<HTMLElement>) => {
    openDrawer(event.currentTarget, rule)
  }

  const closeDrawer = () => {
    setDrawerVisible(false)
    setEditingRule(null)
  }

  const columns: DataTableColumn<ReferralRule>[] = [
    {
      key: 'ruleType',
      header: 'Rule Type',
      cell: (rule) => (
        <div className={styles.ruleCell}>
          <span className={clsx(styles.ruleTile, HUE_CLASS[ruleTypeHue(rule.ruleType)])} aria-hidden="true">
            <IconFileText size={16} stroke={strokeFor(16)} />
          </span>
          <div className={styles.ruleCopy}>
            <span className={styles.ruleName}>{ruleTypeLabel(rule.ruleType)}</span>
            <span className={styles.ruleConfig}>
              <span className={styles.configTerm}>Config:</span>
              <span className={styles.configValue}>{formatRuleValue(rule, formatAmount)}</span>
            </span>
          </div>
        </div>
      ),
    },
    {
      key: 'payoutType',
      header: 'Payout Type',
      cell: (rule) => (
        <span className={clsx(styles.tag, HUE_CLASS[payoutTypeHue(rule.payoutType)])}>{rule.payoutType}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (rule) => (
        <StatusPill status={rule.isActive ? 'active' : 'inactive'}>
          {rule.isActive ? 'Active' : 'Inactive'}
        </StatusPill>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      cell: (rule) => (rule.createdAt ? (
        <div className={styles.stack}>
          <span className={styles.date}>{formatDate(rule.createdAt, 'MMM d, yyyy')}</span>
          <span className={styles.secondary}>{formatTime(rule.createdAt, 'HH:mm')}</span>
        </div>
      ) : (
        <span className={styles.secondary}>—</span>
      )),
    },
  ]

  const editing = editingRule !== null
  const values = form.values
  const drawerRuleType = editingRule?.ruleType ?? values.ruleType
  const copy = ruleDrawerCopy(editing, drawerRuleType)
  const tableState = loading ? 'loading' : error && rulesDisplay.length === 0 ? 'error' : 'ready'
  const showNoRulesNotice = rulesDisplay.length === 0 && !loading && !error
  const showFormSummary = errorAnnouncementRevision > summaryFloor && form.errorCount > 0

  const ruleTypeField = form.field('ruleType')
  const payoutTypeField = form.field('payoutType')
  const fixedAmount = form.field('fixedAmount')
  const firstDepositPercent = form.field('firstDepositPercent')
  const reloadDepositsPercent = form.field('reloadDepositsPercent')
  const reloadDepositsCount = form.field('reloadDepositsCount')
  const reloadMinDeposit = form.field('reloadMinDeposit')
  const turnoverPercent = form.field('turnoverPercent')
  const turnoverTarget = form.field('turnoverTarget')
  const tierNumbers = Array.from({ length: tiers.count }, (_, index) => index + 1)

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Referral Rules"
        sub="Configure reward rules for your referral program"
        actions={(
          <Button
            variant="primary"
            icon={<IconPlus size={16} stroke={strokeFor(16)} />}
            onClick={handleAdd}
          >
            Add Rule
          </Button>
        )}
      />

      <div className={styles.content}>
        {showNoRulesNotice ? (
          <Notice
            tone="info"
            icon={<IconInfoCircle size={18} stroke={strokeFor(18)} />}
            title="No Rules Configured"
            action={(
              <Button
                variant="primary"
                size="sm"
                icon={<IconPlus size={15} stroke={strokeFor(15)} />}
                onClick={handleAdd}
              >
                Create Rule
              </Button>
            )}
          >
            Create your first referral rule to start earning rewards. Rules define how referrers are rewarded for
            different actions.
          </Notice>
        ) : null}

        {/* O7: the card repeats the page title, as the mockup draws it (M:3366); legacy "Referral Rules List". */}
        <Card title="Referral Rules" sub={rulesCountLabel(activeRules, rulesDisplay.length)} body="table">
          <DataTable
            columns={columns}
            rows={rulesDisplay}
            rowKey={(rule) => String(rule.id)}
            label="Referral rules"
            state={tableState}
            error={`Could not load rules. ${error?.message ?? ''}`.trim()}
            onRetry={() => void refetch()}
            empty={(
              <EmptyState
                title="No rules configured"
                icon={<IconListDetails size={20} stroke={strokeFor(20)} />}
              />
            )}
            rowActions={(rule) => ({
              primary: (
                <Tooltip content="Edit Rule">
                  <IconButton
                    size="sm"
                    label={`Edit ${ruleTypeLabel(rule.ruleType)} rule`}
                    icon={<IconPencil size={15} stroke={strokeFor(15)} />}
                    onClick={(event) => handleEdit(rule, event)}
                  />
                </Tooltip>
              ),
            })}
          />
        </Card>
      </div>

      {/* Rule Editor Drawer */}
      <Drawer
        title={copy.title}
        size="md"
        open={drawerVisible}
        onOpenChange={(open) => {
          if (!open) closeDrawer()
        }}
        themeFrom={drawerTriggerRef}
        restoreFocusTo={drawerTriggerRef}
        footer={(
          <div className={styles.drawerFooter}>
            <p className={styles.footerHint}>
              <IconInfoCircle size={15} stroke={strokeFor(15)} aria-hidden="true" />
              {copy.hint}
            </p>
            <div className={styles.footerActions}>
              {/* Named change: Reset returns to the values this opening started from (the rule's when
                  editing). antd's resetFields also blanked Rule Type, which left an edit unsavable. */}
              <Button size="sm" icon={<IconRotate2 size={15} stroke={strokeFor(15)} />} onClick={() => reset()}>
                Reset
              </Button>
              <Button size="sm" onClick={closeDrawer}>
                Cancel
              </Button>
              {/* In the drawer's footer, outside the form element, so it names its form. */}
              <Button
                type="submit"
                form={formId}
                variant="primary"
                size="sm"
                icon={<IconCheck size={15} stroke={strokeFor(15)} />}
                loading={saving || form.submitting}
              >
                {copy.submitLabel}
              </Button>
            </div>
          </div>
        )}
      >
        <Form
          ref={formRef}
          id={formId}
          onSubmit={form.handleSubmit}
          errorAnnouncement={form.errorAnnouncement}
          errorAnnouncementRevision={errorAnnouncementRevision}
        >
          {/* BEYOND-LEGACY: antd only outlined the fields. After a failed submit in this opening this says
              why, and its count follows the remaining errors. */}
          {showFormSummary ? (
            <Notice tone="error" title="Rule not saved">
              {ruleFormSummary(form.errorCount)}
            </Notice>
          ) : null}

          {/* Header Card */}
          <section className={styles.ruleSummary} aria-label="Rule">
            <span className={clsx(styles.summaryTile, HUE_CLASS[ruleTypeHue(drawerRuleType)])} aria-hidden="true">
              <IconFileText size={18} stroke={strokeFor(18)} />
            </span>
            <div className={styles.summaryCopy}>
              <strong className={styles.summaryHeading}>{copy.heading}</strong>
              <span className={styles.summarySub}>{copy.sub}</span>
            </div>
            <span className={clsx(styles.tag, editing ? styles.hueGrn : styles.hueBlu)}>{copy.mode}</span>
          </section>

          {/* Rule Type Selection */}
          <div className={styles.tile}>
            <Select
              id={ruleTypeField.id}
              name={ruleTypeField.name}
              label="Rule Type"
              layout="stacked"
              placeholder="Select rule type"
              options={ruleTypeOptions(rulesDisplay, editing, values.ruleType)}
              value={values.ruleType}
              // Rule-specific fields restart from their initial values, as the legacy onChange reset them.
              onChange={(ruleType) => form.setValues(ruleTypeChangePatch(ruleType, tiers))}
              onBlur={ruleTypeField.onBlur}
              error={ruleTypeField.error}
              help="Choose the type of reward this rule will provide"
              disabled={editing}
              required
            />
          </div>

          {/* Rule Configuration Card */}
          {values.ruleType ? (
            <div className={styles.tile}>
              <FormSection
                title="Rule Configuration"
                description={`Configure reward parameters for ${ruleTypeLabel(values.ruleType)}`}
                gap={16}
              >
                {values.ruleType === 'SIGNUP_CPA' ? (
                  <NumberField
                    {...fixedAmount}
                    onChange={(value) => fixedAmount.onChange(cleanDecimal(value))}
                    className={styles.fullRow}
                    label="Fixed Amount (CPA)"
                    placeholder="Enter fixed amount"
                    help="Fixed bonus amount given to referrer when referee signs up"
                    min={0}
                    step={0.01}
                    grouping="en-IN"
                    prefix={getCurrencySymbol()}
                    required
                  />
                ) : null}

                {values.ruleType === 'FIRST_DEPOSIT_PCT' ? (
                  <NumberField
                    {...firstDepositPercent}
                    onChange={(value) => firstDepositPercent.onChange(cleanDecimal(value))}
                    className={styles.fullRow}
                    label="First Deposit Percentage (%)"
                    placeholder="Enter percentage"
                    help="Percentage of referee's first deposit given to referrer"
                    min={0}
                    max={100}
                    step={0.1}
                    suffix="%"
                    required
                  />
                ) : null}

                {values.ruleType === 'RELOAD_DEPOSITS_PCT' ? (
                  <>
                    <NumberField
                      {...reloadDepositsPercent}
                      onChange={(value) => reloadDepositsPercent.onChange(cleanDecimal(value))}
                      label="Reload Deposits Percentage (%)"
                      placeholder="Enter percentage"
                      help="Percentage of referee's reload deposits"
                      min={0}
                      max={100}
                      step={0.1}
                      suffix="%"
                      required
                    />
                    <NumberField
                      {...reloadDepositsCount}
                      label="Number of Last Deposits"
                      placeholder="0 (unlimited)"
                      help="0 = unlimited, 1-30 = specific count"
                      min={0}
                      max={30}
                      required
                    />
                    <NumberField
                      {...reloadMinDeposit}
                      className={styles.fullRow}
                      label="Minimum Deposit Amount"
                      placeholder="0 (no minimum)"
                      help="Minimum deposit required for bonus to process (0 = no minimum)"
                      min={0}
                      step={100}
                      grouping="en-IN"
                      prefix={getCurrencySymbol()}
                    />
                  </>
                ) : null}

                {values.ruleType === 'LOSS_SHARE' && tiers.enabled ? (
                  <FormField
                    className={styles.fullRow}
                    label={tierRatesLabel(tiers)}
                    help={tierRatesHelp(tiers)}
                    required
                  >
                    <div className={styles.tierGrid}>
                      {tierNumbers.map((tier) => {
                        const tierField = form.field(`tierRates.${tier - 1}` as const)
                        return (
                          <NumberField
                            key={tier}
                            {...tierField}
                            value={tierField.value ?? null}
                            onChange={(value) => tierField.onChange(cleanDecimal(value))}
                            label={`Tier ${tier}`}
                            placeholder="0"
                            help={tierCaption(tier)}
                            min={0}
                            max={100}
                            step={0.1}
                            suffix="%"
                            aria-required
                          />
                        )
                      })}
                    </div>
                  </FormField>
                ) : null}

                {values.ruleType === 'LOSS_SHARE' && !tiers.enabled ? (() => {
                  const directField = form.field('tierRates.0')
                  return (
                    <NumberField
                      {...directField}
                      value={directField.value ?? null}
                      onChange={(value) => directField.onChange(cleanDecimal(value))}
                      className={styles.fullRow}
                      label={tierRatesLabel(tiers)}
                      placeholder="0"
                      help={tierRatesHelp(tiers)}
                      min={0}
                      max={100}
                      step={0.1}
                      suffix="%"
                      required
                    />
                  )
                })() : null}

                {values.ruleType === 'TURNOVER_MILESTONE' ? (
                  <>
                    <NumberField
                      {...turnoverPercent}
                      onChange={(value) => turnoverPercent.onChange(cleanDecimal(value))}
                      label="Turnover Percentage (%)"
                      placeholder="Enter percentage"
                      help="Percentage of turnover given as reward"
                      min={0}
                      max={100}
                      step={0.1}
                      suffix="%"
                      required
                    />
                    <NumberField
                      {...turnoverTarget}
                      onChange={(value) => turnoverTarget.onChange(cleanDecimal(value))}
                      label="Turnover Target"
                      placeholder="Enter turnover target"
                      help="Target turnover amount to trigger reward"
                      min={0}
                      step={0.01}
                      grouping="en-IN"
                      prefix={getCurrencySymbol()}
                      required
                    />
                  </>
                ) : null}
              </FormSection>
            </div>
          ) : null}

          {/* Payout & Status Settings Card */}
          <div className={styles.tile}>
            <FormSection
              title="Payout & Status Settings"
              description="Configure how rewards are paid and rule status"
              gap={16}
            >
              <Select
                id={payoutTypeField.id}
                name={payoutTypeField.name}
                label="Payout Type"
                layout="stacked"
                options={payoutTypeOptions(values.payoutType)}
                value={values.payoutType}
                onChange={payoutTypeField.onChange}
                onBlur={payoutTypeField.onBlur}
                help="How rewards will be paid out"
              />
              <FormField label="Status" help="Enable or disable this rule">
                <span className={styles.statusRow}>
                  <Switch
                    label="Active"
                    hideLabel
                    checked={values.isActive}
                    onChange={(checked) => form.setValue('isActive', checked)}
                  />
                  <span className={styles.statusText}>{values.isActive ? 'Active' : 'Inactive'}</span>
                </span>
              </FormField>
            </FormSection>
          </div>
        </Form>
      </Drawer>
    </Page>
  )
}
