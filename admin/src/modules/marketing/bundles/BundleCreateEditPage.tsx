import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, type MutationFunction } from '@apollo/client'
import { gql } from '@apollo/client'
import {
  IconAlertCircle,
  IconBallFootball,
  IconChartLine,
  IconDeviceFloppy,
  IconDice,
} from '@tabler/icons-react'
import { useNavigate, useParams } from 'react-router-dom'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { Form, FormActions, FormField, FormSection } from '@/ui/components/Form'
import { strokeFor } from '@/ui/components/icons'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { SegmentedControl, type SegmentedOption } from '@/ui/components/SegmentedControl'
import { Textarea } from '@/ui/components/Textarea'
import { TextField } from '@/ui/components/TextField'
import { toast } from '@/ui/components/toast'
import { useForm } from '@/ui/form/useForm'
import { BundleGamesSelector } from './components/BundleGamesSelector'
import {
  buildBundleInput,
  bundleErrorToast,
  bundleFormValues,
  bundleSaveToast,
  bundleSchema,
  bundleSelectionToast,
  selectedBundleGameIds,
  type BundleDomain,
  type BundleFormValues,
  type BundleRecord,
  type CasinoGameBundleInput,
} from './bundleCreateEditModel'
import styles from './BundleCreateEditPage.module.css'

const CREATE_BUNDLE_MUTATION = gql`
  mutation CreateCasinoGameBundle($input: CasinoGameBundleInput!) {
    createCasinoGameBundle(input: $input) {
      success
      message
      bundle {
        id
        name
        description
        domain
        gameIds
        gameWeights
        gameCount
      }
    }
  }
`

const GET_BUNDLE_QUERY = gql`
  query CasinoGameBundle($id: ID!) {
    casinoGameBundle(id: $id) {
      id
      name
      description
      domain
      gameIds
      gameWeights
      gameCount
    }
  }
`

const UPDATE_BUNDLE_MUTATION = gql`
  mutation UpdateCasinoGameBundle($id: ID!, $input: CasinoGameBundleUpdateInput!) {
    updateCasinoGameBundle(id: $id, input: $input) {
      success
      message
      bundle {
        id
        name
        description
        domain
        gameIds
        gameWeights
        gameCount
      }
    }
  }
`

interface BundleQueryData {
  casinoGameBundle: BundleRecord | null
}

interface BundlePayload {
  success: boolean
  message?: string | null
  bundle?: BundleRecord | null
}

interface CreateBundleData {
  createCasinoGameBundle: BundlePayload
}

interface CreateBundleVariables {
  input: CasinoGameBundleInput
}

interface UpdateBundleData {
  updateCasinoGameBundle: BundlePayload
}

interface UpdateBundleVariables {
  id: string
  input: CasinoGameBundleInput
}

const ACCESS_REQUIREMENT = [{ domain: 'bonuses.bundles', actions: ['view', 'create', 'update'] }]

const DOMAIN_OPTIONS: readonly SegmentedOption<BundleDomain>[] = [
  {
    value: 'casino',
    label: 'Casino',
    icon: <IconDice size={14} stroke={strokeFor(14)} />,
  },
  {
    value: 'sports',
    label: 'Sports',
    icon: <IconBallFootball size={14} stroke={strokeFor(14)} />,
  },
  {
    value: 'matka',
    label: 'Matka',
    icon: <IconChartLine size={14} stroke={strokeFor(14)} />,
  },
]

export default function BundleCreateEditPage() {
  return (
    <RBACGuard required={ACCESS_REQUIREMENT}>
      <BundleCreateEditPageContent />
    </RBACGuard>
  )
}

function BundleCreateEditPageContent() {
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const { id } = useParams<{ id: string }>()
  const isEditMode = Boolean(id)

  const { data, loading: queryLoading, error: queryError, refetch } = useQuery<BundleQueryData>(GET_BUNDLE_QUERY, {
    variables: { id },
    errorPolicy: 'all',
    skip: !isEditMode,
  })
  const [createBundle, { loading: creating }] = useMutation<CreateBundleData, CreateBundleVariables>(
    CREATE_BUNDLE_MUTATION,
  )
  const [updateBundle, { loading: updating }] = useMutation<UpdateBundleData, UpdateBundleVariables>(
    UPDATE_BUNDLE_MUTATION,
    { refetchQueries: [{ query: GET_BUNDLE_QUERY, variables: { id } }] },
  )

  let body: ReactNode
  if (isEditMode && queryLoading) {
    body = (
      <Card body="flush">
        <LoadingState label="Loading bundle" />
      </Card>
    )
  } else if (isEditMode && (!id || !data?.casinoGameBundle)) {
    body = (
      <Card body="flush">
        <EmptyState
          title={queryError ? 'Unable to load bundle' : 'Bundle not found'}
          description={queryError?.message}
          icon={<IconAlertCircle size={20} stroke={strokeFor(20)} />}
          action={queryError ? (
            <Button onClick={() => void refetch()}>Retry</Button>
          ) : (
            <Button onClick={() => navigate('/bonuses/bundles')}>Back to Bundles</Button>
          )}
        />
      </Card>
    )
  } else {
    body = (
      <BundleEditorForm
        key={id ?? 'new'}
        id={id}
        record={data?.casinoGameBundle}
        createBundle={createBundle}
        updateBundle={updateBundle}
        saving={creating || updating}
      />
    )
  }

  return (
    <Page>
      <PageHeader
        eyebrow={pageEyebrow}
        title={isEditMode ? 'Edit Bundle' : 'Create Bundle'}
        sub={isEditMode ? 'Update bundle settings and game selection' : 'Create a reusable game bundle'}
        back={{ to: '/bonuses/bundles', label: 'Back to Bundles' }}
      />
      {body}
    </Page>
  )
}

interface BundleEditorFormProps {
  id?: string
  record?: BundleRecord | null
  createBundle: MutationFunction<CreateBundleData, CreateBundleVariables>
  updateBundle: MutationFunction<UpdateBundleData, UpdateBundleVariables>
  saving: boolean
}

function BundleEditorForm({
  id,
  record,
  createBundle,
  updateBundle,
  saving,
}: BundleEditorFormProps) {
  const navigate = useNavigate()
  const isEditMode = Boolean(id)
  const [selectedGameIds, setSelectedGameIds] = useState(() => selectedBundleGameIds(record))
  const [selectionError, setSelectionError] = useState<string | undefined>()
  const descriptionTouched = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)

  const save = async (values: BundleFormValues) => {
    if (selectedGameIds.length === 0) {
      const feedback = bundleSelectionToast()
      setSelectionError(feedback.message)
      toast(feedback)
      return
    }

    const input = buildBundleInput(
      values,
      selectedGameIds,
      record?.description,
      descriptionTouched.current,
    )
    try {
      const result = isEditMode && id
        ? (await updateBundle({ variables: { id, input } })).data?.updateCasinoGameBundle
        : (await createBundle({ variables: { input } })).data?.createCasinoGameBundle
      const feedback = bundleSaveToast(result, isEditMode ? 'edit' : 'create')
      toast(feedback)
      if (result?.success) navigate('/bonuses/bundles')
    } catch (error: unknown) {
      toast(bundleErrorToast(error))
    }
  }

  const form = useForm({
    schema: bundleSchema,
    initialValues: bundleFormValues(record),
    onSubmit: save,
  })

  useEffect(() => {
    if (form.errorAnnouncementRevision === 0) return
    const focused = document.activeElement
    if (focused instanceof HTMLElement && formRef.current?.contains(focused)) {
      focused.scrollIntoView?.({ block: 'nearest' })
    }
  }, [form.errorAnnouncementRevision])

  const name = form.field('name')
  const description = form.field('description')
  const domain = form.field('domain')

  return (
    <Card body="flush" className={styles.card}>
      <Form
        ref={formRef}
        className={styles.form}
        onSubmit={form.handleSubmit}
        errorAnnouncement={form.errorAnnouncement}
        errorAnnouncementRevision={form.errorAnnouncementRevision}
      >
        {form.errorAnnouncementRevision > 0 && form.errorCount > 0 ? (
          <Notice tone="error" title={`Bundle ${isEditMode ? 'not updated' : 'not created'}`}>
            {`Fix ${form.errorCount} highlighted ${form.errorCount === 1 ? 'field' : 'fields'} and submit again.`}
          </Notice>
        ) : null}

        <FormSection title="Basic Information" cols={{ base: 1 }}>
          <TextField
            {...name}
            label="Bundle Name"
            placeholder="Enter bundle name"
            maxLength={256}
            required
          />
          <Textarea
            {...description}
            label="Description"
            placeholder="Enter bundle description (optional)"
            rows={3}
            maxLength={1000}
            showCount
            onChange={(value) => {
              descriptionTouched.current = true
              description.onChange(value)
            }}
          />
        </FormSection>

        <div className={styles.rule} aria-hidden="true" />

        <FormSection
          title="Domain & Game Selection"
          description="Choose one domain, then select every game or market that belongs in this bundle."
          cols={{ base: 1 }}
        >
          <FormField label="Domain" required>
            <SegmentedControl
              value={domain.value}
              options={DOMAIN_OPTIONS}
              onChange={(value) => {
                form.setValue('domain', value)
                setSelectedGameIds([])
                setSelectionError(undefined)
              }}
              label="Bundle domain"
              stretch="phone"
            />
          </FormField>
          <FormField
            label="Select Games"
            required
            help={`${selectedGameIds.length.toLocaleString()} selected`}
            error={selectionError}
          >
            <BundleGamesSelector
              domain={domain.value}
              selectedGameIds={selectedGameIds}
              onSelectionChange={(gameIds) => {
                setSelectedGameIds(gameIds)
                if (gameIds.length > 0) setSelectionError(undefined)
              }}
            />
          </FormField>
        </FormSection>

        <FormActions className={styles.footer}>
          <p className={styles.footerHint}>
            <span className={styles.requiredMark} aria-hidden="true">*</span> Required fields
          </p>
          <Button onClick={() => navigate('/bonuses/bundles')}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            icon={<IconDeviceFloppy size={16} stroke={strokeFor(16)} />}
            loading={saving || form.submitting}
          >
            {isEditMode ? 'Update' : 'Create'} Bundle
          </Button>
        </FormActions>
      </Form>
    </Card>
  )
}

