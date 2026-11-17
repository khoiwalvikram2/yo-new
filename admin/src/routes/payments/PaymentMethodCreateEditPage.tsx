import { VipTierAccessPicker } from '@/modules/vip/components/VipTierAccessPicker'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  IconBuildingBank,
  IconCircleCheck,
  IconCurrencyTether,
  IconQrcode,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { WHITELABEL_PAYMENT_METHODS, UPSERT_WHITELABEL_PAYMENT_METHODS } from '@/lib/graphql/deposits'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { compressImageToDataUrl } from '@/shared/utils/imageCompression'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { FileField } from '@/ui/components/FileField'
import { Form, FormActions, FormField, FormSection } from '@/ui/components/Form'
import { strokeFor } from '@/ui/components/icons'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Select } from '@/ui/components/Select'
import { Steps } from '@/ui/components/Steps'
import { StoredImage } from '@/ui/components/StoredImage'
import { Switch } from '@/ui/components/Switch'
import { Textarea } from '@/ui/components/Textarea'
import { TextField } from '@/ui/components/TextField'
import { toast } from '@/ui/components/toast'
import { useForm } from '@/ui/form/useForm'
import { CRYPTO_COIN, CRYPTO_NETWORKS, cryptoWalletTitle } from './cryptoWalletModel'
import {
  CRYPTO_NO_RATE_REVIEW_NOTICE,
  METHODS_LIST_PATH,
  STEP_COUNT,
  buildCryptoMethodsInput,
  buildPaymentMethodsInput,
  createInitialValues,
  cryptoLimitsNote,
  cryptoRateReviewRow,
  detailReviewRows,
  findStoredCrypto,
  findStoredUpi,
  isImageFile,
  limitReviewRows,
  limitsIntro,
  methodKindOf,
  pageSub,
  pageTitle,
  paymentMethodSchema,
  qrStatusText,
  resolveActiveType,
  resolveEditType,
  saveFailureMessage,
  stepFields,
  stepsFor,
  storedFormValues,
  submitLabel,
  type PaymentMethodFormValues,
  type PaymentMethodKind,
  type ReviewRow,
  type StoredPaymentMethods,
} from './paymentMethodFormModel'
import styles from './PaymentMethodCreateEditPage.module.css'

const FORM_ACCESS_REQUIREMENT = [{ domain: 'payments.methods', actions: ['create', 'update'] }]

/** The stored QR row's note when its image cannot be shown (a legacy file, or one that will not load). */
const QR_UNAVAILABLE = 'Cannot be shown. Choose the QR code again to replace it.'

function reviewItems(rows: ReviewRow[]) {
  return rows.map((row) => ({ key: row.label, term: row.label, value: row.value }))
}

export default function PaymentMethodCreateEditPage() {
  return (
    <RBACGuard required={FORM_ACCESS_REQUIREMENT}>
      <PaymentMethodFormContent />
    </RBACGuard>
  )
}

function PaymentMethodFormContent() {
  const navigate = useNavigate()
  const params = useParams<{ type?: string; id?: string }>()
  const [searchParams] = useSearchParams()
  const pageEyebrow = usePageEyebrow()
  const { formatAmount, getCurrencySymbol } = useCurrency()
  const reviewHeadingId = useId()
  const formRef = useRef<HTMLFormElement>(null)

  // Get type from URL params or search params
  const urlType = params.type || searchParams.get('type') || null
  const maxAmountFromUrl = searchParams.get('maxAmount')
  const isEdit = Boolean(params.id)

  // A create link's type is applied before the first paint, so the type choice does not flash.
  const [selectedType, setSelectedType] = useState<string | null>(() => (!isEdit ? urlType : null))
  const [currentStep, setCurrentStep] = useState(0)
  const [qrPreview, setQrPreview] = useState<string | null>(null)
  const [qrImgError, setQrImgError] = useState(false)
  const [qrProcessing, setQrProcessing] = useState(false)
  const [focusRequest, setFocusRequest] = useState(0)

  // Always fetch current methods so create mode can append instead of overwriting
  const { data, loading, error, refetch } = useQuery(WHITELABEL_PAYMENT_METHODS, {
    errorPolicy: 'all',
  })
  const methods: StoredPaymentMethods | undefined = data?.whitelabelPaymentMethods

  // In edit mode the type is the list the id belongs to
  const editType = useMemo(() => (isEdit ? resolveEditType(methods, params.id) : null), [isEdit, methods, params.id])
  const activeType = resolveActiveType(isEdit, editType, selectedType, urlType)
  const kind = methodKindOf(activeType)
  const isBank = kind === 'bank'
  const isCrypto = kind === 'crypto'
  const steps = stepsFor(kind)
  const isReviewStep = currentStep === STEP_COUNT - 1

  // Set selected type from URL if provided
  useEffect(() => {
    if (urlType && !isEdit) {
      setSelectedType(urlType)
    }
  }, [urlType, isEdit])

  const [upsertMethods] = useMutation(UPSERT_WHITELABEL_PAYMENT_METHODS, {
    refetchQueries: [{ query: WHITELABEL_PAYMENT_METHODS }],
    awaitRefetchQueries: true,
    onCompleted: (result) => {
      // Apollo's notification link reports the server message; only a success returns to the list.
      if (result?.upsertWhitelabelPaymentMethods?.success) {
        navigate(METHODS_LIST_PATH)
      }
    },
  })

  const schema = useMemo(() => paymentMethodSchema(kind), [kind])
  const [initialValues] = useState(() => createInitialValues(isEdit ? null : maxAmountFromUrl))

  const saveMethod = useCallback(async (values: PaymentMethodFormValues) => {
    if (loading || error || !data || (isEdit && !editType)) return
    // Enter submits the form on every step; before the review it moves on, as the legacy form did.
    if (currentStep < STEP_COUNT - 1) {
      setCurrentStep(currentStep + 1)
      return
    }
    try {
      await upsertMethods({
        variables: {
          // A wallet save sends the wallet list alone; the server keeps everything an upsert omits.
          input: kind === 'crypto'
            ? buildCryptoMethodsInput(methods, values, { isEdit, editId: params.id })
            : buildPaymentMethodsInput(methods, values, { isBank: kind === 'bank', isEdit, editId: params.id }),
        },
      })
    } catch (error: unknown) {
      // The server's own reason, e.g. "Invalid input: A TRC20 address must start with T…", is shown as is.
      toast({ message: saveFailureMessage(error, isEdit), tone: 'error' })
    }
  }, [currentStep, kind, isEdit, methods, params.id, upsertMethods, loading, error, data, editType])

  const form = useForm({ schema, initialValues, onSubmit: saveMethod })
  const { reset, setValue, validate, values } = form

  // An edited method's stored values load once it is known; a later refetch does not overwrite edits.
  const loadedRecordId = useRef<string | null>(null)
  useEffect(() => {
    if (!isEdit || !methods || !params.id || loadedRecordId.current === params.id) return
    const storedValues = storedFormValues(methods, params.id, kind)
    if (!storedValues) return
    loadedRecordId.current = params.id
    reset(storedValues)
  }, [kind, isEdit, methods, params.id, reset])

  // A failed Next moves focus to the first field it flagged.
  useEffect(() => {
    if (focusRequest === 0) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [focusRequest])

  /**
   * The UPI account or wallet being edited: the two types that carry a QR code.
   * qrUrl/qrKey are read straight from the stored record: the QR's base64 data
   * URI. qrUrl is null for a legacy value the server can no longer serve.
   */
  const currentQrMethod = useMemo(() => {
    if (!isEdit || kind === 'bank') return null
    return kind === 'crypto' ? findStoredCrypto(methods, params.id) : findStoredUpi(methods, params.id)
  }, [kind, isEdit, methods, params.id])

  // The QR image to preview: a freshly picked file (qrPreview) wins over the saved one.
  const qrSrc = qrPreview || currentQrMethod?.qrUrl || ''
  // Reset the load-error flag whenever the source changes, so a stale failure (e.g. a
  // legacy QR that could not load) never hides a newly-selected, valid preview.
  useEffect(() => {
    setQrImgError(false)
  }, [qrSrc])

  const handleQrSelect = async (file: File) => {
    if (!isImageFile(file)) {
      toast({ message: 'You can only upload image files!', tone: 'error' })
      return
    }
    try {
      setQrProcessing(true)
      // PNG preset: a QR code must stay lossless or scanners can fail.
      const dataUri = await compressImageToDataUrl(file, 'qr')
      setQrImgError(false) // fresh selection: clear any prior load-failure state
      setQrPreview(dataUri)
      setValue('qrKey', dataUri)
    } catch (error: unknown) {
      toast({ message: error instanceof Error ? error.message : 'Failed to process QR code', tone: 'error' })
      setQrPreview(null)
    } finally {
      setQrProcessing(false)
    }
  }

  // Removing a picked image returns to the stored QR code (or none), which is what the preview shows.
  const handleQrRemove = () => {
    setQrImgError(false)
    setQrPreview(null)
    setValue('qrKey', currentQrMethod?.qrKey ?? null)
  }

  const goNext = async () => {
    const valid = await validate(stepFields(currentStep, kind))
    if (!valid) {
      setFocusRequest((request) => request + 1)
      return
    }
    setCurrentStep((step) => Math.min(step + 1, STEP_COUNT - 1))
  }

  const goPrevious = () => setCurrentStep((step) => Math.max(step - 1, 0))

  const chooseType = (type: PaymentMethodKind) => {
    setSelectedType(type)
    setCurrentStep(0)
  }

  // A pasted address is re-checked as soon as the network changes: an address valid on one network is
  // usually not one on another, and funds sent across networks are lost.
  const changeNetwork = (next: string) => {
    setValue('network', next)
    if (values.walletAddress.trim()) void validate(['walletAddress'])
  }

  const symbol = getCurrencySymbol()
  const waitingForRecord = loading && !data
  const missingRecord = isEdit && !loading && !error && !editType
  const showWizard = !loading && !error && !missingRecord && ((!isEdit && Boolean(selectedType)) || isEdit)
  const qrAttached = Boolean(qrPreview || currentQrMethod?.qrUrl)
  const qrAlt = isCrypto ? 'Wallet QR Code' : 'UPI QR Code'
  const defaultWalletName = cryptoWalletTitle({ network: values.network })
  const detailRows = detailReviewRows(values, kind, qrAttached)

  const accountName = form.field('accountName')
  const accountNumber = form.field('accountNumber')
  const ifsc = form.field('ifsc')
  const bankName = form.field('bankName')
  const branch = form.field('branch')
  const notes = form.field('notes')
  const upiId = form.field('upiId')
  const network = form.field('network')
  const walletAddress = form.field('walletAddress')
  const displayName = form.field('displayName')
  const minAmount = form.field('minAmount')
  const maxAmount = form.field('maxAmount')
  const weight = form.field('weight')

  // UPI accounts and wallets share the QR picker. The row is the QR preview: the status as its name,
  // "Saved" under it for the stored image, and Remove only for a freshly picked one (it returns to the
  // stored QR).
  const qrField = (
    <FileField
      className={styles.fullRow}
      label="QR Code Image"
      help="Ready to save"
      accept="image/*"
      fit="contain"
      prompt={qrPreview || currentQrMethod?.qrUrl || currentQrMethod?.qrKey ? 'Change QR Code' : 'Select QR Code'}
      busy={qrProcessing}
      busyLabel="Processing QR code…"
      files={qrSrc || (isEdit && currentQrMethod?.qrKey) ? [{
        id: 'qr',
        name: qrStatusText(Boolean(qrPreview), Boolean(currentQrMethod?.qrUrl)),
        // A stored QR the server can no longer serve (null qrUrl) or that will not load is a placeholder naming
        // it, never a broken image (SYS-18), and the row says how to replace it.
        meta: qrPreview ? undefined : currentQrMethod?.qrUrl && !qrImgError ? 'Saved' : QR_UNAVAILABLE,
        thumbnail: (
          <StoredImage src={qrSrc || null} alt={qrAlt} placeholderClassName={styles.qrPlaceholder} onError={() => setQrImgError(true)} />
        ),
        removeLabel: 'Remove',
        onRemove: qrPreview ? handleQrRemove : undefined,
      }] : []}
      onFiles={([file]) => { if (file) void handleQrSelect(file) }}
    />
  )

  return (
    <Page>
      <PageHeader
        eyebrow={pageEyebrow}
        back={{ to: METHODS_LIST_PATH, label: 'Back to list' }}
        // Until the edited record is known its type is not, so the header uses the route's own label.
        title={waitingForRecord || error || missingRecord ? (isEdit ? 'Edit Payment Method' : 'Add Payment Method') : pageTitle(isEdit, kind)}
        sub={waitingForRecord || error || missingRecord ? undefined : pageSub(isEdit, kind)}

      />

      <div className={styles.content}>
        {waitingForRecord ? <LoadingState label={isEdit ? 'Loading payment method' : 'Loading payment methods'} minHeight={192} /> : null}
        {error ? <Notice tone="error" title="Unable to load payment methods" action={<Button onClick={() => { void refetch().catch(() => {}) }}>Retry</Button>}>Reload the saved accounts before adding or editing a payment method.</Notice> : null}
        {missingRecord ? <Notice tone="warn" title="Payment method not found">Return to the list and choose an existing account.</Notice> : null}

        {!loading && !error && !isEdit && !selectedType ? (
          <Card title="Select Payment Method Type" sub="Choose the type of payment method you want to add">
            <div className={styles.typeFrame}>
              <div className={styles.typeGrid}>
                <button type="button" className={styles.typeOption} onClick={() => chooseType('bank')}>
                  <span className={clsx(styles.typeIcon, styles.bankIcon)} aria-hidden="true">
                    <IconBuildingBank size={20} stroke={strokeFor(20)} />
                  </span>
                  <span className={styles.typeText}>
                    <span className={styles.typeTitle}>Bank Account</span>
                    <span className={styles.typeSub}>Add bank account for deposits</span>
                  </span>
                </button>
                <button type="button" className={styles.typeOption} onClick={() => chooseType('upi')}>
                  <span className={clsx(styles.typeIcon, styles.upiIcon)} aria-hidden="true">
                    <IconQrcode size={20} stroke={strokeFor(20)} />
                  </span>
                  <span className={styles.typeText}>
                    <span className={styles.typeTitle}>UPI Account</span>
                    <span className={styles.typeSub}>Add UPI account for deposits</span>
                  </span>
                </button>
                <button type="button" className={styles.typeOption} onClick={() => chooseType('crypto')}>
                  <span className={clsx(styles.typeIcon, styles.cryptoIcon)} aria-hidden="true">
                    <IconCurrencyTether size={20} stroke={strokeFor(20)} />
                  </span>
                  <span className={styles.typeText}>
                    <span className={styles.typeTitle}>Crypto Wallet</span>
                    <span className={styles.typeSub}>Add {CRYPTO_COIN} wallet for deposits</span>
                  </span>
                </button>
              </div>
            </div>
          </Card>
        ) : null}

        {!waitingForRecord && showWizard ? (
          <>
            <Steps label="Form steps" steps={steps} current={currentStep} />

            <Card as="div" body="flush" className={styles.card}>
              <Form
                ref={formRef}
                className={styles.form}
                onSubmit={form.handleSubmit}
                errorAnnouncement={form.errorAnnouncement}
                errorAnnouncementRevision={form.errorAnnouncementRevision}
              >
                {currentStep === 0 && isBank ? (
                  <FormSection title={steps[0].title}>
                    <TextField {...accountName} label="Account Name" placeholder="Account holder name" required />
                    <TextField {...accountNumber} label="Account Number" placeholder="Account number" required />
                    <TextField {...ifsc} label="IFSC Code" placeholder="e.g. SBIN0001234" required />
                    <TextField {...bankName} label="Bank Name" placeholder="Bank name" required />
                    <TextField {...branch} label="Branch" placeholder="Branch name" required />
                    <Textarea
                      {...notes}
                      className={styles.fullRow}
                      label="Notes (Optional)"
                      placeholder="Additional instructions for users"
                      rows={2}
                    />
                  </FormSection>
                ) : null}

                {currentStep === 0 && kind === 'upi' ? (
                  <FormSection title={steps[0].title}>
                    <TextField {...upiId} label="UPI ID" placeholder="e.g. merchant@paytm" required />
                    <TextField {...displayName} label="Display Name (Optional)" placeholder="Display name for UPI" />
                    {qrField}
                  </FormSection>
                ) : null}

                {currentStep === 0 && isCrypto ? (
                  <FormSection title={steps[0].title}>
                    <Select
                      {...network}
                      onChange={changeNetwork}
                      label={`${CRYPTO_COIN} Network`}
                      layout="stacked"
                      options={CRYPTO_NETWORKS}
                      help="Players are told to send on this network only"
                      required
                    />
                    <TextField
                      {...displayName}
                      label="Display Name (Optional)"
                      placeholder={defaultWalletName}
                      help={`Leave empty to show ${defaultWalletName}`}
                      maxLength={64}
                    />
                    <TextField
                      {...walletAddress}
                      className={styles.fullRow}
                      inputClassName={styles.address}
                      label="Wallet Address"
                      placeholder="Paste the wallet address"
                      help="Checked against the network: funds sent on another network are lost"
                      autoComplete="off"
                      spellCheck={false}
                      required
                    />
                    {qrField}
                  </FormSection>
                ) : null}

                {currentStep === 1 ? (
                  <FormSection
                    title={steps[1].title}
                    description={isCrypto ? `${limitsIntro(isEdit)} ${cryptoLimitsNote(symbol)}` : limitsIntro(isEdit)}
                    cols={{ base: 1, md: 3 }}
                  >
                    <NumberField
                      {...minAmount}
                      label={`Min Amount (${symbol})`}
                      prefix={symbol}
                      placeholder="No minimum"
                      help="Leave empty for no minimum"
                      min={0}
                      step={100}
                      grouping="en-IN"
                    />
                    <NumberField
                      {...maxAmount}
                      label={`Max Amount (${symbol})`}
                      prefix={symbol}
                      placeholder="Unlimited"
                      help="Leave empty for no extra account limit."
                      min={0}
                      step={1000}
                      grouping="en-IN"
                    />
                    <NumberField
                      {...weight}
                      label="Priority Weight"
                      placeholder="0"
                      help="Higher = shown first in same tier"
                      min={0}
                      step={1}
                    />
                    <FormField className={styles.fullRow} label="Status" help="Toggle availability for deposits">
                      <span className={styles.statusRow}>
                        <Switch
                          label="Active"
                          hideLabel
                          checked={values.enabled}
                          onChange={(checked) => setValue('enabled', checked)}
                        />
                        <span className={styles.statusText}>{values.enabled ? 'Active' : 'Inactive'}</span>
                      </span>
                    </FormField>
                    <VipTierAccessPicker value={values.vipTierIds} onChange={ids => setValue('vipTierIds', ids)} error={form.errors.vipTierIds} />
                    {!isEdit && maxAmountFromUrl ? (
                      <Notice tone="info" className={styles.fullRow}>
                        <strong>Adding to tier:</strong> Max amount {formatAmount(parseFloat(maxAmountFromUrl))}
                      </Notice>
                    ) : null}
                  </FormSection>
                ) : null}

                {isReviewStep ? (
                  <section className={styles.review} aria-labelledby={reviewHeadingId}>
                    <h2 id={reviewHeadingId} className={styles.reviewHeading}>{steps[2].title}</h2>
                    <p className={styles.reviewIntro}>Confirm details before saving. Go back to edit anything.</p>
                    <div className={styles.reviewGrid}>
                      <DescriptionList.Section
                        className={styles.reviewPanel}
                        title={steps[0].title}
                      >
                        <DescriptionList
                          items={reviewItems(isCrypto
                            ? [...detailRows, cryptoRateReviewRow(methods?.cryptoRate, (amount) => formatAmount(amount))]
                            : detailRows)}
                        />
                      </DescriptionList.Section>
                      <DescriptionList.Section className={styles.reviewPanel} title="Limits & Priority">
                        <DescriptionList items={reviewItems(limitReviewRows(values, (amount) => formatAmount(amount)))} />
                        <p>VIP access: {values.vipTierIds == null ? 'All eligible tiers' : `${values.vipTierIds.length} selected tier(s)`}</p>
                      </DescriptionList.Section>
                    </div>
                    {isCrypto && methods?.cryptoRate == null ? (
                      <Notice tone="warn">{CRYPTO_NO_RATE_REVIEW_NOTICE}</Notice>
                    ) : null}
                  </section>
                ) : null}

                <FormActions className={styles.footer}>
                  <p className={styles.footerHint}>
                    {!isReviewStep ? (
                      `Step ${currentStep + 1} of ${STEP_COUNT}`
                    ) : (
                      <>
                        <span className={styles.requiredMark} aria-hidden="true">*</span> Ensure required fields are
                        complete
                      </>
                    )}
                  </p>
                  {currentStep === 0 ? (
                    <Button onClick={() => navigate(METHODS_LIST_PATH)}>Cancel</Button>
                  ) : (
                    <Button onClick={goPrevious}>Previous</Button>
                  )}
                  {!isReviewStep ? (
                    <Button key="next" variant="primary" onClick={(event) => { event.preventDefault(); void goNext() }}>
                      Next
                    </Button>
                  ) : (
                    <Button
                      key="save"
                      type="submit"
                      variant="primary"
                      icon={<IconCircleCheck size={16} stroke={strokeFor(16)} />}
                      loading={form.submitting}
                    >
                      {submitLabel(isEdit, kind)}
                    </Button>
                  )}
                </FormActions>
              </Form>
            </Card>
          </>
        ) : null}
      </div>
    </Page>
  )
}

