import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, gql } from '@apollo/client'
import { useNavigate } from 'react-router-dom'
import { IconAlertTriangle, IconDeviceFloppy, IconInfoCircle, IconX } from '@tabler/icons-react'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { CheckboxGroup } from '@/ui/components/CheckboxGroup'
import { Divider } from '@/ui/components/Divider'
import { Form, FormActions, FormSection } from '@/ui/components/Form'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { TextField } from '@/ui/components/TextField'
import { toast } from '@/ui/components/toast'
import { useForm } from '@/ui/form/useForm'
import {
  VISIBLE_REWARD_TYPES,
  buildProgramInput,
  nextEnabledModes,
  programErrorToast,
  programFormValues,
  programSaveToast,
  programSchema,
  type ProgramFormValues,
  type ReferralProgramInput,
  type ReferralProgramRecord,
} from './programEditorModel'
import styles from './ProgramEditorPage.module.css'

const REFERRAL_PROGRAM_QUERY = gql`
  query ReferralProgram {
    referralProgramByTenant {
      id
      name
      enabledModes
      maxDepth
      flags
      minReferralBalanceForCashTransfer
    }
  }
`

const UPSERT_REFERRAL_PROGRAM_MUTATION = gql`
  mutation UpsertReferralProgram($input: ReferralProgramInput!) {
    upsertReferralProgram(input: $input) {
      success
      message
      program {
        id
        name
        enabledModes
        maxDepth
        minReferralBalanceForCashTransfer
      }
    }
  }
`

const REFERRALS_PATH = '/referrals'

export default function ProgramEditorPage() {
  return (
    <RBACGuard required={[{ domain: 'referrals.program', actions: ['view'] }]}>
      <ProgramEditorPageContent />
    </RBACGuard>
  )
}

function ProgramEditorPageContent() {
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const [hasChanges, setHasChanges] = useState(false)

  const { data, loading, refetch } = useQuery(REFERRAL_PROGRAM_QUERY, {
    errorPolicy: 'all',
  })

  const [upsertProgram, { loading: saving }] = useMutation(
    UPSERT_REFERRAL_PROGRAM_MUTATION,
    {
      // Reported below; the global mutation toast said each outcome a second time (MAR-06).
      context: { skipNotification: true },
      onCompleted: (result) => {
        if (result.upsertReferralProgram.success) {
          toast(programSaveToast(result.upsertReferralProgram))
          setHasChanges(false)
          refetch()
        } else {
          toast(programSaveToast(result.upsertReferralProgram))
        }
      },
      onError: (error) => {
        toast(programErrorToast(error))
      },
    }
  )

  const program: ReferralProgramRecord | null | undefined = data?.referralProgramByTenant

  const handleSubmit = async (input: ReferralProgramInput) => {
    try {
      await upsertProgram({
        variables: {
          input,
        },
      })
    } catch {
      // onError reports a failed save, as before.
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow={pageEyebrow}
        title="Referral Program Settings"
        sub="Configure your referral program settings and enabled reward types"
        back={{ to: REFERRALS_PATH, label: 'Back to Referrals' }}
      />

      <div className={styles.content}>
        {hasChanges ? (
          <Notice
            tone="warn"
            live="polite"
            icon={<IconAlertTriangle size={18} stroke={strokeFor(18)} />}
            action={(
              <IconButton
                size="sm"
                label="Close"
                icon={<IconX size={15} stroke={strokeFor(15)} />}
                onClick={() => setHasChanges(false)}
              />
            )}
          >
            You have unsaved changes
          </Notice>
        ) : null}

        <Card title="Attribution Method">
          <Notice
            tone="info"
            icon={<IconInfoCircle size={18} stroke={strokeFor(18)} />}
            title="Code-Only Attribution"
          >
            Referral attribution is code-only and permanent. When a player signs up with a referral code, that referrer is permanently assigned. No cookies or time windows are used.
          </Notice>
        </Card>

        {/* The form mounts once the stored program is known, so its first render already holds it. */}
        {loading && !data ? (
          <LoadingState label="Loading referral program" minHeight={192} />
        ) : (
          <ProgramForm
            program={program}
            saving={saving}
            onSave={handleSubmit}
            onChangesChange={setHasChanges}
            onCancel={() => navigate(REFERRALS_PATH)}
          />
        )}
      </div>
    </Page>
  )
}

interface ProgramFormProps {
  program: ReferralProgramRecord | null | undefined
  saving: boolean
  onSave: (input: ReferralProgramInput) => Promise<void>
  /** The page's unsaved-changes flag: set by an edit, cleared when the stored program fills the form. */
  onChangesChange: (hasChanges: boolean) => void
  onCancel: () => void
}

function ProgramForm({ program, saving, onSave, onChangesChange, onCancel }: ProgramFormProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const form = useForm<ProgramFormValues>({
    schema: programSchema,
    // useForm reads its initial values on the first render only.
    initialValues: programFormValues(program),
    onSubmit: (values) => onSave(buildProgramInput(values)),
  })
  const { errorAnnouncementRevision, getValue, reset, setValue } = form

  // As the legacy effect: whenever the stored program arrives or changes (the mutation's answer and the
  // refetch after a save), it replaces the form and clears the unsaved-changes notice.
  useEffect(() => {
    if (!program) return
    reset(programFormValues(program))
    onChangesChange(false)
  }, [onChangesChange, program, reset])

  // useForm focuses the first invalid control without scrolling; the submit sits in the sticky footer,
  // so bring that control into view as well (as on Create Bonus).
  useEffect(() => {
    if (errorAnnouncementRevision === 0) return
    const focused = document.activeElement
    if (focused instanceof HTMLElement && formRef.current?.contains(focused)) {
      focused.scrollIntoView?.({ block: 'nearest' })
    }
  }, [errorAnnouncementRevision])

  const name = form.field('name')
  const maxDepth = form.field('maxDepth')
  const minimum = form.field('minReferralBalanceForCashTransfer')
  const modes = form.field('enabledModes')

  return (
    <Card body="flush" className={styles.card}>
      <Form
        ref={formRef}
        className={styles.form}
        onSubmit={form.handleSubmit}
        errorAnnouncement={form.errorAnnouncement}
        errorAnnouncementRevision={errorAnnouncementRevision}
      >
        <FormSection title="Basic Settings">
          <TextField
            {...name}
            onChange={(value) => {
              name.onChange(value)
              onChangesChange(true)
            }}
            label="Program Name"
            placeholder="Default Referral Program"
            help="A descriptive name for your referral program"
            required
          />
          <NumberField
            {...maxDepth}
            onChange={(value) => {
              maxDepth.onChange(value)
              onChangesChange(true)
            }}
            label="Max Tier Depth"
            placeholder="4"
            help="Maximum number of referral tiers (1-4). Only Loss Share supports multi-tier."
            min={1}
            max={4}
            step={1}
            required
          />
          <NumberField
            {...minimum}
            onChange={(value) => {
              minimum.onChange(value)
              onChangesChange(true)
            }}
            label="Min Balance to Transfer to Cash"
            placeholder="0"
            help="Minimum referral balance required before a user can transfer to their cash wallet"
            min={0}
            grouping="en-IN"
          />
        </FormSection>

        <Divider />

        <FormSection title="Enabled Reward Types" cols={{ base: 1 }}>
          <CheckboxGroup
            id={modes.id}
            name={modes.name}
            label="Reward types"
            hideLabel
            options={VISIBLE_REWARD_TYPES}
            value={modes.value}
            onChange={(checked) => {
              setValue('enabledModes', nextEnabledModes(getValue('enabledModes'), checked))
              onChangesChange(true)
            }}
            onBlur={modes.onBlur}
            error={modes.error}
          />
          <Notice tone="info" icon={<IconInfoCircle size={18} stroke={strokeFor(18)} />} title="Note">
            After enabling reward types here, you&apos;ll need to create and configure individual rules for each type in the Rules section.
          </Notice>
        </FormSection>

        <FormActions className={styles.footer}>
          <p className={styles.footerHint}>
            <span className={styles.requiredMark} aria-hidden="true">*</span> Required fields
          </p>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            icon={<IconDeviceFloppy size={16} stroke={strokeFor(16)} />}
            loading={saving || form.submitting}
          >
            Save Changes
          </Button>
        </FormActions>
      </Form>
    </Card>
  )
}
