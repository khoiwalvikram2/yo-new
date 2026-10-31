import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IconCircleCheck } from '@tabler/icons-react'
import { useCreateMatka, useMatka, useSetMatkaStatus, useUpdateMatka } from '../../modules/matka'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { notify } from '@/shared/services/notification'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Dialog } from '@/ui/components/Dialog'
import { Form, FormActions } from '@/ui/components/Form'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Steps } from '@/ui/components/Steps'
import { Textarea } from '@/ui/components/Textarea'
import { strokeFor } from '@/ui/components/icons'
import { useForm } from '@/ui/form/useForm'
import BasicInfoStep from './components/BasicInfoStep'
import BettingConfigurationStep from './components/BettingConfigurationStep'
import ReviewStep from './components/ReviewStep'
import {
  DEFAULT_STATUS_REASON,
  MATKA_LIST_PATH,
  MATKA_STEP_COUNT,
  MATKA_STEPS,
  SAVE_FAILURE,
  buildCreateMatkaInput,
  buildUpdateMatkaInput,
  createMatkaInitialValues,
  matkaFormSchema,
  matkaStepFields,
  matkaValuesFromRecord,
  needsStatusReason,
  pageSubtitle,
  pageTitle,
  statusChangeVariables,
  type MatkaFormValues,
  type MatkaRecord,
} from './matkaFormModel'
import styles from './CreateEditPage.module.css'

const ACCESS_REQUIREMENT = [{ domain: 'matka.management', actions: ['view', 'create', 'update'] }]

export default function MatkaCreateEditPage() {
  return (
    <RBACGuard required={ACCESS_REQUIREMENT}>
      <MatkaCreateEditPageContent />
    </RBACGuard>
  )
}

function MatkaCreateEditPageContent() {
  const { id } = useParams<{ id?: string }>()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const formRef = useRef<HTMLFormElement>(null)
  const { data } = useMatka(id || '')
  const matka = data?.matka as MatkaRecord | null | undefined
  const [createMatka, { loading: creating }] = useCreateMatka()
  const [updateMatka, { loading: updating }] = useUpdateMatka()
  const [setMatkaStatus, { loading: changingStatus }] = useSetMatkaStatus()
  const [currentStep, setCurrentStep] = useState(0)
  const [reasonModalOpen, setReasonModalOpen] = useState(false)
  const [statusChangeReason, setStatusChangeReason] = useState('')
  const [pendingSubmitValues, setPendingSubmitValues] = useState<MatkaFormValues | null>(null)
  const schema = useMemo(() => matkaFormSchema(isEdit), [isEdit])
  const [initialValues] = useState(createMatkaInitialValues)

  const persist = useCallback(async (values: MatkaFormValues, reason?: string) => {
    const close = notify.loading(isEdit ? 'Saving changes…' : 'Creating matka…', 0)
    try {
      if (isEdit && id) {
        const statusChanged = needsStatusReason(values, matka?.status)
        await updateMatka({
          variables: { input: buildUpdateMatkaInput(id, values, matka?.status) },
        })
        if (statusChanged) {
          await setMatkaStatus({
            variables: statusChangeVariables(id, values.status, reason),
          })
        }
      } else {
        await createMatka({ variables: { input: buildCreateMatkaInput(values) } })
      }
      navigate(MATKA_LIST_PATH)
    } catch {
      notify.error(SAVE_FAILURE)
    } finally {
      close()
    }
  }, [createMatka, id, isEdit, matka?.status, navigate, setMatkaStatus, updateMatka])

  const submitValues = useCallback(async (values: MatkaFormValues) => {
    if (isEdit && id && matka && needsStatusReason(values, matka.status) && !statusChangeReason) {
      setPendingSubmitValues(values)
      setReasonModalOpen(true)
      return
    }
    await persist(values, statusChangeReason)
  }, [id, isEdit, matka, persist, statusChangeReason])

  const form = useForm({ schema, initialValues, onSubmit: submitValues })
  const { reset } = form

  useEffect(() => {
    if (matka) reset(matkaValuesFromRecord(matka))
  }, [matka, reset])

  const focusFirstVisibleError = () => {
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?? formRef.current?.querySelector<HTMLElement>('[name="schedule.daysOfWeek"]')
    invalid?.focus({ preventScroll: true })
  }

  const next = async () => {
    const fields = matkaStepFields(currentStep, isEdit)
    if (fields.length) {
      const valid = await form.validate(fields)
      if (!valid) {
        focusFirstVisibleError()
        return
      }
    }
    setCurrentStep((step) => Math.min(MATKA_STEP_COUNT - 1, step + 1))
  }

  const previous = () => setCurrentStep((step) => Math.max(0, step - 1))
  const cancelReason = () => {
    setReasonModalOpen(false)
    setStatusChangeReason('')
    setPendingSubmitValues(null)
  }
  const applyReason = async () => {
    if (!pendingSubmitValues) return
    const values = pendingSubmitValues
    setReasonModalOpen(false)
    await persist(values, statusChangeReason || DEFAULT_STATUS_REASON)
    setStatusChangeReason('')
    setPendingSubmitValues(null)
  }

  const finalStep = currentStep === MATKA_STEP_COUNT - 1
  const activeStep = MATKA_STEPS[currentStep]

  return (
    <Page>
      <PageHeader
        eyebrow={pageEyebrow}
        title={pageTitle(isEdit)}
        sub={pageSubtitle(isEdit)}
        back={{ label: 'Back to Matkas', onClick: () => navigate(MATKA_LIST_PATH) }}
      />

      <Form
        ref={formRef}
        className={styles.form}
        onSubmit={form.handleSubmit}
        errorAnnouncement={form.errorAnnouncement}
        errorAnnouncementRevision={form.errorAnnouncementRevision}
      >
        <Steps label="Form steps" steps={MATKA_STEPS} current={currentStep} />

        {currentStep === 0 ? <BasicInfoStep form={form} isEdit={isEdit} /> : null}
        {currentStep === 1 ? <BettingConfigurationStep form={form} /> : null}
        {currentStep === 2 ? <ReviewStep values={form.values} /> : null}

        <Card as="div" className={styles.footerCard}>
          <FormActions className={styles.footerActions}>
            <div className={styles.progressGroup}>
              <progress
                className={styles.progress}
                max={MATKA_STEP_COUNT}
                value={currentStep + 1}
                aria-label={`Step ${currentStep + 1} of ${MATKA_STEP_COUNT}`}
              />
              <span className={styles.progressCount}>{currentStep + 1}/{MATKA_STEP_COUNT}</span>
              <span className={styles.progressLabel}>{activeStep.footer}</span>
            </div>
            {currentStep > 0 ? (
              <Button onClick={previous}>Previous</Button>
            ) : (
              <Button onClick={() => navigate(MATKA_LIST_PATH)}>Cancel</Button>
            )}
            {!finalStep ? (
              <Button key="next" variant="primary" onClick={(event) => { event.preventDefault(); void next() }}>Next Step</Button>
            ) : (
              <Button
                key="save"
                type="submit"
                variant="primary"
                icon={<IconCircleCheck size={16} stroke={strokeFor(16)} />}
                loading={creating || updating}
              >
                {isEdit ? 'Save Changes' : 'Create Matka'}
              </Button>
            )}
          </FormActions>
        </Card>
      </Form>

      <Dialog
        open={reasonModalOpen}
        onOpenChange={(open) => {
          if (!open) cancelReason()
        }}
        title="Reason for Status Change"
        description="Please provide a brief reason for changing the status. This will be recorded in the audit log."
        size="sm"
        footer={(
          <div className={styles.dialogActions}>
            <Button onClick={cancelReason}>Cancel</Button>
            <Button
              variant="primary"
              loading={changingStatus || updating}
              onClick={() => void applyReason()}
            >
              Apply
            </Button>
          </div>
        )}
      >
        <Textarea
          label="Reason"
          hideLabel
          rows={3}
          value={statusChangeReason}
          onChange={setStatusChangeReason}
          placeholder="Reason"
        />
      </Dialog>
    </Page>
  )
}
