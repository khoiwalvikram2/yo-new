import { useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { gql, useMutation, useQuery } from '@apollo/client'
import { IconPlus } from '@tabler/icons-react'
import { Link, useSearchParams } from 'react-router-dom'
import { WhitelabelsStatsCards } from './components/WhitelabelsStatsCards'
import { WhitelabelsTable } from './components/WhitelabelsTable'
import { WhitelabelDetailsDrawer } from './components/WhitelabelDetailsDrawer'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useAuthStore } from '@/shared/core/authStore'
import { useSearch } from '@/shared/hooks/useSearch'
import { useSearchParamUpdates } from '@/shared/hooks/useSearchParamUpdates'
import { notify } from '@/shared/services/notification'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { Dialog } from '@/ui/components/Dialog'
import { Form } from '@/ui/components/Form'
import { strokeFor } from '@/ui/components/icons'
import { NumberField } from '@/ui/components/NumberField'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { PasswordField } from '@/ui/components/PasswordField'
import { TextField } from '@/ui/components/TextField'
import { useForm } from '@/ui/form/useForm'
import {
  CREATE_WHITELABEL_PATH,
  CREDIT_FIELD_ORDER,
  EMPTY_RESET_PASSWORD,
  RESET_PASSWORD_FIELD_ORDER,
  adjustCreditVariables,
  clampPage,
  creditFormSchema,
  creditInitialValues,
  filterWhitelabels,
  firstValidationError,
  isSuperAdminRole,
  pageSlice,
  resetPasswordSchema,
  resetPasswordVariables,
  type CreditFormValues,
  type ResetPasswordValues,
  type Whitelabel,
} from './whitelabelsListModel'
import styles from './WhitelabelsListPage.module.css'

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

const ADJUST_CREDIT_MUTATION = gql`
  mutation AdjustWhitelabelCredit($input: AdjustWhitelabelCreditInput!) {
    adjustWhitelabelCredit(input: $input) {
      success
      message
      whitelabel {
        id
        creditLimit
        creditUsed
        creditAvailable
      }
    }
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

const RESET_WL_ADMIN_PASSWORD = gql`
  mutation ResetWhitelabelAdminPassword($whitelabelId: ID!, $adminEmail: String, $newPassword: String!, $adminPassword: String!) {
    resetWhitelabelAdminPassword(whitelabelId: $whitelabelId, adminEmail: $adminEmail, newPassword: $newPassword, adminPassword: $adminPassword) {
      success
      message
    }
  }
`

interface WhitelabelsData {
  whitelabels: Whitelabel[]
}

interface GenerateResult {
  generateCasinoCategories?: {
    success: boolean
    message?: string | null
    categoriesCreated?: number | null
    gamesAssigned?: number | null
  } | null
}

interface AdjustResult {
  adjustWhitelabelCredit?: { success: boolean; message?: string | null } | null
}

interface ResetResult {
  resetWhitelabelAdminPassword?: { success: boolean; message?: string | null } | null
}

const PAGE_TITLE = 'Whitelabels'
const PAGE_SUB = 'Manage partners and domains'
const CREDIT_FORM_ID = 'adjust-whitelabel-credit-form'
const RESET_FORM_ID = 'reset-whitelabel-password-form'

export default function WhitelabelsListPage() {
  return (
    <RBACGuard required={[{ domain: 'config.whitelabels', actions: ['view'] }]}>
      <WhitelabelsListPageContent />
    </RBACGuard>
  )
}

function WhitelabelsListPageContent() {
  const pageEyebrow = usePageEyebrow()
  const { formatAmount, getCurrencySymbol } = useCurrency()
  const roles = useAuthStore((state) => state.roles)
  const isSuperAdmin = isSuperAdminRole(roles)
  // A link may carry the search (?search=, the global search's "See all Whitelabels").
  const [searchParams] = useSearchParams()
  const { query: searchQuery, setQuery: setSearchQuery, debouncedQuery } = useSearch({ minLength: 2, initialQuery: searchParams.get('search') ?? '' })

  const [currentPage, setCurrentPage] = useState(1)
  useSearchParamUpdates((term) => {
    setSearchQuery(term)
    setCurrentPage(1)
  })
  const [pageSize, setPageSize] = useState(10)
  const [selectedWhitelabel, setSelectedWhitelabel] = useState<Whitelabel | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [creditModalOpen, setCreditModalOpen] = useState(false)
  const [resetPasswordModalOpen, setResetPasswordModalOpen] = useState(false)
  const [generatingTenantId, setGeneratingTenantId] = useState<string | null>(null)
  const overlayTriggerRef = useRef<HTMLElement | null>(null)
  const creditFirstFieldRef = useRef<HTMLInputElement>(null)
  const resetFirstFieldRef = useRef<HTMLInputElement>(null)

  const { data, loading, refetch } = useQuery<WhitelabelsData>(WL_QUERY, { errorPolicy: 'all' })

  const [generateCasinoCategories] = useMutation<GenerateResult>(GENERATE_CASINO_CATEGORIES, {
    onCompleted: (result) => {
      setGeneratingTenantId(null)
      const response = result?.generateCasinoCategories
      if (response?.success) {
        const noCategories = (response.categoriesCreated ?? 0) === 0 && (response.gamesAssigned ?? 0) === 0
        if (noCategories) notify.info(response.message || '', 'No categories created')
        else notify.success(response.message || '', 'Casino categories generated')
        void refetch()
      } else {
        notify.error(response?.message || 'Unknown error', 'Generate categories failed')
      }
    },
    onError: (error) => {
      setGeneratingTenantId(null)
      notify.error(error.message, 'Generate categories failed')
    },
  })

  const [adjustCredit, { loading: adjustingCredit }] = useMutation<AdjustResult>(ADJUST_CREDIT_MUTATION, {
    onCompleted: (result) => {
      const response = result?.adjustWhitelabelCredit
      if (response?.success) {
        notify.success(response.message || '', 'Credit Adjusted')
        setCreditModalOpen(false)
        creditForm.reset()
        setSelectedWhitelabel(null)
        void refetch()
      } else {
        notify.error(response?.message || 'Unknown error occurred', 'Failed to Adjust Credit')
      }
    },
    onError: (error) => {
      notify.error(error.message || 'An error occurred while adjusting credit', 'Failed to Adjust Credit')
    },
  })

  const [resetWhitelabelAdminPassword, { loading: resettingPassword }] = useMutation<ResetResult>(
    RESET_WL_ADMIN_PASSWORD,
    {
      onCompleted: (result) => {
        const response = result?.resetWhitelabelAdminPassword
        if (response?.success) {
          notify.success(response.message || '', 'Admin Password Reset')
          setResetPasswordModalOpen(false)
          resetPasswordForm.reset()
          setSelectedWhitelabel(null)
        } else {
          notify.error(response?.message || 'Unknown error occurred', 'Failed to Reset Admin Password')
        }
      },
      onError: (error) => {
        notify.error(
          error.message || 'An error occurred while resetting the admin password',
          'Failed to Reset Admin Password',
        )
      },
    },
  )

  const creditForm = useForm<CreditFormValues>({
    schema: creditFormSchema,
    initialValues: { creditLimit: 0, reason: '' },
    onSubmit: () => undefined,
  })
  const resetPasswordForm = useForm<ResetPasswordValues>({
    schema: resetPasswordSchema,
    initialValues: EMPTY_RESET_PASSWORD,
    onSubmit: () => undefined,
  })

  const allRows = useMemo(() => data?.whitelabels ?? [], [data?.whitelabels])
  const filteredRows = useMemo(
    () => filterWhitelabels(allRows, debouncedQuery),
    [allRows, debouncedQuery],
  )
  const shownPage = clampPage(currentPage, filteredRows.length, pageSize)
  const rows = pageSlice(filteredRows, shownPage, pageSize)

  const rememberTrigger = (event: MouseEvent<HTMLElement>) => {
    overlayTriggerRef.current = event.currentTarget
  }

  const closeSelectedOverlay = () => {
    setDrawerOpen(false)
    setCreditModalOpen(false)
    setResetPasswordModalOpen(false)
    setSelectedWhitelabel(null)
  }

  const openDetails = (whitelabel: Whitelabel, event: MouseEvent<HTMLElement>) => {
    rememberTrigger(event)
    setSelectedWhitelabel(whitelabel)
    setDrawerOpen(true)
  }

  const openCredit = (whitelabel: Whitelabel) => {
    setSelectedWhitelabel(whitelabel)
    creditForm.reset(creditInitialValues(whitelabel))
    setCreditModalOpen(true)
  }

  const openPasswordReset = (whitelabel: Whitelabel) => {
    setSelectedWhitelabel(whitelabel)
    resetPasswordForm.reset(EMPTY_RESET_PASSWORD)
    setResetPasswordModalOpen(true)
  }

  const submitCredit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validationMessage = firstValidationError(creditFormSchema, creditForm.values, CREDIT_FIELD_ORDER)
    const valid = await creditForm.validate()
    if (!valid) {
      notify.error(validationMessage || 'Please check the form fields', 'Validation Error')
      return
    }
    if (!selectedWhitelabel) {
      notify.error('Please select a whitelabel', 'Error')
      return
    }
    try {
      await adjustCredit({ variables: adjustCreditVariables(selectedWhitelabel.id, creditForm.values) })
    } catch {
      // Apollo's mutation-level onError preserves the legacy notification and owns the error copy.
    }
  }

  const submitPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validationMessage = firstValidationError(
      resetPasswordSchema,
      resetPasswordForm.values,
      RESET_PASSWORD_FIELD_ORDER,
    )
    const valid = await resetPasswordForm.validate()
    if (!valid) {
      notify.error(validationMessage || 'Please check the form fields', 'Validation Error')
      return
    }
    if (!selectedWhitelabel) {
      notify.error('Please select a whitelabel', 'Error')
      return
    }
    try {
      await resetWhitelabelAdminPassword({
        variables: resetPasswordVariables(selectedWhitelabel.id, resetPasswordForm.values),
      })
    } catch {
      // Apollo's mutation-level onError preserves the legacy notification and owns the error copy.
    }
  }

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title={PAGE_TITLE}
        sub={PAGE_SUB}
        actions={(
          <Link to={CREATE_WHITELABEL_PATH} className={buttonClassName({ variant: 'primary' })}>
            <IconPlus size={16} stroke={strokeFor(16)} aria-hidden="true" />
            <span>Add Whitelabel</span>
          </Link>
        )}
      />

      <div className={styles.content}>
        <WhitelabelsStatsCards />
        <WhitelabelsTable
          rows={rows}
          exportRows={filteredRows}
          total={filteredRows.length}
          fetching={loading}
          search={searchQuery}
          onSearchChange={(value) => {
            setSearchQuery(value)
            setCurrentPage(1)
          }}
          onViewDetails={openDetails}
          onTrigger={rememberTrigger}
          onAdjustCredit={openCredit}
          onGenerateCategories={(whitelabel) => {
            setGeneratingTenantId(whitelabel.id)
            void generateCasinoCategories({
              variables: { tenantId: whitelabel.id },
              context: { skipNotification: true },
            })
          }}
          onResetAdminPassword={isSuperAdmin ? openPasswordReset : undefined}
          generatingTenantId={generatingTenantId}
          page={shownPage}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {selectedWhitelabel && drawerOpen ? (
        <WhitelabelDetailsDrawer
          whitelabel={selectedWhitelabel}
          open
          onClose={closeSelectedOverlay}
          restoreFocusTo={overlayTriggerRef}
        />
      ) : null}

      {selectedWhitelabel && creditModalOpen ? (
        <Dialog
          title="Adjust Whitelabel Credit"
          open
          onOpenChange={(open) => { if (!open) closeSelectedOverlay() }}
          size="md"
          initialFocus={creditFirstFieldRef}
          themeFrom={overlayTriggerRef}
          restoreFocusTo={overlayTriggerRef}
          footer={(
            <div className={styles.dialogActions}>
              <Button onClick={closeSelectedOverlay}>Cancel</Button>
              <Button type="submit" form={CREDIT_FORM_ID} variant="primary" loading={adjustingCredit}>
                Adjust Credit
              </Button>
            </div>
          )}
        >
          <Form
            id={CREDIT_FORM_ID}
            onSubmit={submitCredit}
            errorAnnouncement={creditForm.errorAnnouncement}
            errorAnnouncementRevision={creditForm.errorAnnouncementRevision}
          >
            <TextField label="Whitelabel" value={selectedWhitelabel.name} onChange={() => undefined} disabled />
            <NumberField
              {...creditForm.field('creditLimit')}
              ref={creditFirstFieldRef}
              label={`Credit Limit (${getCurrencySymbol()})`}
              min={0}
              step={1000}
              grouping="en-IN"
              prefix={getCurrencySymbol()}
              required
            />
            <TextField
              {...creditForm.field('reason')}
              label="Reason (Optional)"
              placeholder="Enter reason for credit adjustment"
            />
            <dl className={styles.creditSummary}>
              <div><dt>Current Limit</dt><dd>{formatAmount(Number(selectedWhitelabel.creditLimit || 0))}</dd></div>
              <div><dt>Available</dt><dd>{formatAmount(Number(selectedWhitelabel.creditAvailable || 0))}</dd></div>
              <div><dt>Used</dt><dd>{formatAmount(Number(selectedWhitelabel.creditUsed || 0))}</dd></div>
            </dl>
          </Form>
        </Dialog>
      ) : null}

      {selectedWhitelabel && resetPasswordModalOpen ? (
        <Dialog
          title="Reset Whitelabel Admin Password"
          open
          onOpenChange={(open) => { if (!open) closeSelectedOverlay() }}
          size="md"
          initialFocus={resetFirstFieldRef}
          themeFrom={overlayTriggerRef}
          restoreFocusTo={overlayTriggerRef}
          footer={(
            <div className={styles.dialogActions}>
              <Button onClick={closeSelectedOverlay}>Cancel</Button>
              <Button type="submit" form={RESET_FORM_ID} variant="dangerSolid" loading={resettingPassword}>
                Reset Password
              </Button>
            </div>
          )}
        >
          <div className={styles.dialogIntro}>
            <span><b>Whitelabel:</b> {selectedWhitelabel.name}</span>
            <span><b>ID:</b> <code>{selectedWhitelabel.id}</code></span>
          </div>
          <Form
            id={RESET_FORM_ID}
            onSubmit={submitPasswordReset}
            errorAnnouncement={resetPasswordForm.errorAnnouncement}
            errorAnnouncementRevision={resetPasswordForm.errorAnnouncementRevision}
          >
            <TextField
              {...resetPasswordForm.field('adminEmail')}
              ref={resetFirstFieldRef}
              label="Admin Email (optional)"
              type="email"
              placeholder="admin@partner.com"
              autoComplete="off"
              help="Leave blank if this whitelabel has a single admin. Required only to disambiguate when multiple admins exist."
            />
            <PasswordField
              {...resetPasswordForm.field('newPassword')}
              label="New Password"
              placeholder="New admin password"
              autoComplete="new-password"
              required
            />
            <PasswordField
              {...resetPasswordForm.field('confirmPassword')}
              label="Confirm Password"
              placeholder="Re-enter new password"
              autoComplete="new-password"
              required
            />
            <PasswordField
              {...resetPasswordForm.field('adminPassword')}
              label="Your Password"
              placeholder="Your login password"
              autoComplete="current-password"
              help="Enter your own login password to confirm this action."
              required
            />
          </Form>
        </Dialog>
      ) : null}
    </Page>
  )
}
