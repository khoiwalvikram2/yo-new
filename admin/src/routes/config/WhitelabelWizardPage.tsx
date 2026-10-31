import { useEffect, useRef, useState } from 'react'
import { gql, useMutation } from '@apollo/client'
import { useNavigate } from 'react-router-dom'
import { IconBolt, IconCircleCheck } from '@tabler/icons-react'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { notify } from '@/shared/services/notification'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { Form, FormActions } from '@/ui/components/Form'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Steps } from '@/ui/components/Steps'
import { strokeFor } from '@/ui/components/icons'
import { useForm } from '@/ui/form/useForm'
import WhitelabelEditAccount from './components/WhitelabelEditAccount'
import WhitelabelEditBasicInfo from './components/WhitelabelEditBasicInfo'
import WhitelabelEditBranding from './components/WhitelabelEditBranding'
import WhitelabelEditReview from './components/WhitelabelEditReview'
import {
  INITIAL_WHITELABEL_VALUES,
  STEP_COUNT,
  WHITELABELS_PATH,
  WIZARD_STEPS,
  buildCreateWhitelabelPayload,
  categoryOutcome,
  firstValidationIssue,
  hasRequiredCreateValues,
  stepFields,
  stepForField,
  thrownMessage,
  whitelabelIdFromDomain,
  whitelabelWizardSchema,
} from './whitelabelWizardModel'
import styles from './WhitelabelWizardPage.module.css'

const ACCESS_REQUIREMENT = [{ domain: 'config.whitelabels', actions: ['view', 'create'] }]

const CREATE_WHITELABEL = gql`
  mutation CreateWhitelabel($input: CreateWhitelabelInput!) {
    createWhitelabel(input: $input) { success message whitelabel { id } }
  }
`

const GENERATE_CASINO_CATEGORIES = gql`
  mutation GenerateCasinoCategories($tenantId: String!) {
    generateCasinoCategories(tenantId: $tenantId) {
      success
      message
      categoriesCreated
      gamesAssigned
      nonLatinDisabled
    }
  }
`

const WL_QUERY = gql`
  query Whitelabels {
    whitelabels {
      id
      name
      domain
      sharingRates {
        domain
        rate
      }
      logoUrl
      faviconUrl
      status
      creditLimit
      creditUsed
      creditAvailable
      creditAlertThreshold
      theme {
        primary
        success
        warning
        danger
        bgPage
        textPrimary
        textSecondary
        border
      }
    }
  }
`

function graphQlErrors(result: unknown): Array<{ message?: string }> {
  if (!result || typeof result !== 'object') return []
  const legacy = 'errors' in result && Array.isArray(result.errors) ? result.errors : null
  if (legacy) return legacy as Array<{ message?: string }>
  if ('error' in result && result.error && typeof result.error === 'object') {
    const error = result.error
    if ('errors' in error && Array.isArray(error.errors)) return error.errors as Array<{ message?: string }>
  }
  return []
}

export default function WhitelabelWizardPage() {
  return (
    <RBACGuard required={ACCESS_REQUIREMENT}>
      <WhitelabelWizardPageContent />
    </RBACGuard>
  )
}

function WhitelabelWizardPageContent() {
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const formRef = useRef<HTMLFormElement>(null)
  const submitInFlight = useRef(false)
  const [loading, setLoading] = useState(false)
  const [current, setCurrent] = useState(0)
  const [focusRequest, setFocusRequest] = useState(0)
  const [createdWhitelabelId, setCreatedWhitelabelId] = useState<string | null>(null)

  const [createWhitelabel] = useMutation(CREATE_WHITELABEL)
  const [generateCasinoCategories, { loading: generatingCategories }] = useMutation(
    GENERATE_CASINO_CATEGORIES,
    {
      onCompleted: (data) => {
        const outcome = categoryOutcome(data?.generateCasinoCategories)
        if (outcome.tone === 'ok') notify.success(outcome.message)
        else if (outcome.tone === 'info') notify.info(outcome.message)
        else notify.error(outcome.message)
      },
      onError: (error) => {
        notify.error(thrownMessage(error, 'Failed to generate casino categories.'))
      },
    },
  )

  const form = useForm({
    schema: whitelabelWizardSchema,
    initialValues: INITIAL_WHITELABEL_VALUES,
    // Submission is intentionally explicit below: the final button must preserve the legacy
    // GraphQL-error notification and success-panel branches after full-form validation.
    onSubmit: () => undefined,
  })

  useEffect(() => {
    if (focusRequest === 0) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus({ preventScroll: true })
  }, [current, focusRequest])

  const next = async () => {
    const valid = await form.validate(stepFields(current))
    if (!valid) {
      setFocusRequest((request) => request + 1)
      return
    }
    setCurrent((step) => Math.min(step + 1, STEP_COUNT - 1))
  }

  const previous = () => setCurrent((step) => Math.max(step - 1, 0))

  const handleSubmit = async () => {
    if (submitInFlight.current) return
    submitInFlight.current = true
    setLoading(true)
    try {
      const valid = await form.validate()
      if (!valid) {
        const issue = firstValidationIssue(form.values)
        notify.error(issue?.message || 'Please fill all required fields')
        if (issue) setCurrent(stepForField(issue.path))
        setFocusRequest((request) => request + 1)
        return
      }

      const values = form.values
      if (!hasRequiredCreateValues(values)) {
        notify.error('Please fill all required fields')
        return
      }

      const whitelabelId = whitelabelIdFromDomain(values.domain)
      if (!whitelabelId) {
        notify.error('Invalid domain. Please enter a valid domain name.')
        return
      }

      const createData = buildCreateWhitelabelPayload(values)
      const result = await createWhitelabel({
        variables: { input: createData },
        errorPolicy: 'all',
        refetchQueries: [{ query: WL_QUERY }],
      })
      const errors = graphQlErrors(result)
      if (errors.length > 0) {
        notify.error(errors[0]?.message || 'Failed to create whitelabel')
        return
      }

      if (result.data?.createWhitelabel?.success) {
        setCreatedWhitelabelId(createData.id)
        form.reset(INITIAL_WHITELABEL_VALUES)
        setCurrent(0)
      }
      // A `success: false` outcome is still reported by the established Apollo notification link.
    } catch (error: unknown) {
      notify.error(thrownMessage(error, 'Failed to save whitelabel. Please try again.'))
    } finally {
      submitInFlight.current = false
      setLoading(false)
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow={pageEyebrow}
        back={{ to: WHITELABELS_PATH, label: 'Back to Whitelabels' }}
        title="Create Whitelabel"
        sub="Set up a new whitelabel partnership with comprehensive configuration"
      />

      <Form
        ref={formRef}
        className={styles.form}
        onSubmit={(event) => event.preventDefault()}
        errorAnnouncement={form.errorAnnouncement}
        errorAnnouncementRevision={form.errorAnnouncementRevision}
      >
        {!createdWhitelabelId ? (
          <>
            <Steps label="Whitelabel setup steps" steps={WIZARD_STEPS} current={current} />

            {current === 0 ? <WhitelabelEditBasicInfo form={form} /> : null}
            {current === 1 ? <WhitelabelEditAccount form={form} /> : null}
            {current === 2 ? <WhitelabelEditBranding form={form} /> : null}
            {current === 3 ? <WhitelabelEditReview values={form.values} /> : null}

            <Card as="div" className={styles.footerCard}>
              <FormActions className={styles.footerActions}>
                <div className={styles.progressGroup}>
                  <progress
                    className={styles.progress}
                    max={STEP_COUNT}
                    value={current + 1}
                    aria-label={`Step ${current + 1} of ${STEP_COUNT}`}
                  />
                  <span className={styles.progressCount}>{current + 1}/{STEP_COUNT}</span>
                  <span className={styles.footerHint}>
                    {current > 0 && current < STEP_COUNT - 1 ? (
                      <>Step {current + 1} of {STEP_COUNT}</>
                    ) : (
                      <><span className={styles.requiredMark}>*</span> Required fields</>
                    )}
                  </span>
                </div>
                {current > 0 ? (
                  <Button onClick={previous}>Previous</Button>
                ) : (
                  <Button onClick={() => navigate(WHITELABELS_PATH)}>Cancel</Button>
                )}
                {current < STEP_COUNT - 1 ? (
                  <Button variant="primary" onClick={() => void next()}>Next Step</Button>
                ) : (
                  <Button
                    variant="primary"
                    loading={loading}
                    icon={<IconCircleCheck size={16} stroke={strokeFor(16)} />}
                    onClick={() => void handleSubmit()}
                  >
                    Create Whitelabel
                  </Button>
                )}
              </FormActions>
            </Card>
          </>
        ) : (
          <Card className={styles.successCard}>
            <EmptyState
              inset="none"
              tone="ok"
              icon={<IconCircleCheck size={24} stroke={strokeFor(24)} />}
              title="Whitelabel created successfully"
              description="You can generate casino categories from enabled providers (Gap/GMAG) for this whitelabel, or go to the list."
              action={(
                <div className={styles.successActions}>
                  <Button
                    variant="primary"
                    loading={generatingCategories}
                    icon={<IconBolt size={16} stroke={strokeFor(16)} />}
                    onClick={() => void generateCasinoCategories({
                      variables: { tenantId: createdWhitelabelId },
                      context: { skipNotification: true },
                    })}
                  >
                    Generate categories
                  </Button>
                  <Button onClick={() => navigate(WHITELABELS_PATH)}>Go to Whitelabels</Button>
                </div>
              )}
            />
          </Card>
        )}
      </Form>
    </Page>
  )
}
