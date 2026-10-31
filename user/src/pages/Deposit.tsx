import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { AlertCircle, Banknote, ArrowLeft, ArrowRight, ImagePlus, Check, X } from 'lucide-react'
// import { useTranslation } from 'react-i18next' // i18n hook for future use
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import ModalSurface from '@/components/modals/ModalSurface'
 
import { formatAmount } from '@/lib/currency'
import { DepositPageHeader } from '@/components/deposit'
import { usePageSEO } from '@/hooks/usePageSEO'
import {
  createDeposit,
  getAdminAccounts,
  createAdminDeposit,
  getAdminDepositRequests,
  uploadDepositProof,
} from '@/lib/api/user'
import { requestWithToast } from '@/lib/request'
import { SegmentedTabs } from '@/components/bonus/SegmentedTabs'
import {
  AmountSelector,
  PaymentMethodSelector,
  DepositHistory,
  TransactionReceipt,
  type PaymentMethod,
} from '@/components/deposit'
import { usePaymentConfig, useParsedSettings } from '@/hooks/useAppSettings'
import FeeBreakdown from '@/components/payment/FeeBreakdown'
import '../styles/account/deposit.css'

type DepositStep = 'amount' | 'method' | 'confirm'
type DepositTab = 'deposit' | 'history'

export default function DepositPage() {
  usePageSEO({ 
    title: 'Deposit', 
    description: 'Add funds to your account securely' 
  })
  
  // Translation hook (currently unused)
  // const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()

  // Check if user is a credit player or belongs to CREDIT agent
  const playerType = (user as any)?.playerType || 'REGULAR'
  const isCreditPlayer = playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT'
  const parsedSettings = useParsedSettings()
  const hideDW = parsedSettings.hideDW ?? false

  // Redirect credit players or CREDIT agent players - they cannot deposit
  useEffect(() => {
    if (isCreditPlayer || hideDW) {
      navigate('/', { replace: true })
    }
  }, [isCreditPlayer, hideDW, navigate])

  // Tab management
  const [activeTab, setActiveTab] = useState<DepositTab>('deposit')

  // Wizard state
  const [currentStep, setCurrentStep] = useState<DepositStep>('amount')
  const [amount, setAmount] = useState<string>('')
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null)

  // Payment methods state
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [methodsLoading, setMethodsLoading] = useState(false)
  const [methodsError, setMethodsError] = useState<string | null>(null)

  // Transaction state
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<any>(null)

  // Manual deposit fields (for admin accounts)
  const [txnRef, setTxnRef] = useState<string>('')
  const [proofKey, setProofKey] = useState<string>('')
  const [, setProofPreview] = useState<string>('')
  const [proofFileName, setProofFileName] = useState<string>('')
  const [proofUploading, setProofUploading] = useState(false)
  const [proofUploadError, setProofUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // History state
  const [history, setHistory] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  // Get payment configuration from app settings
  const paymentConfig = usePaymentConfig()
  const noGlobalDepositLimits = paymentConfig.depositMin == null && paymentConfig.depositMax == null

  const methodsAggregate = useMemo(() => {
    const mins = paymentMethods
      .map((m) => m.minAmount)
      .filter((n): n is number => typeof n === 'number' && !Number.isNaN(n))
    const maxs = paymentMethods
      .map((m) => m.maxAmount)
      .filter((n): n is number => typeof n === 'number' && !Number.isNaN(n))
    return {
      min: mins.length ? Math.min(...mins) : undefined,
      max: maxs.length ? Math.max(...maxs) : undefined,
    }
  }, [paymentMethods])

  const minAmount = Math.max(paymentConfig.depositMin ?? 0, methodsAggregate.min ?? 1)
  const maxAmount = Math.min(paymentConfig.depositMax ?? 50_000_000, methodsAggregate.max ?? 50_000_000)

  // Each account's limits already include the tier and the remaining daily and
  // monthly allowance. The amount step checks the widest of them; the method
  // step then offers only the accounts that fit, so an earlier choice of
  // account must not narrow the amount.
  const parsedAmount = useMemo(() => Number(amount || 0), [amount])
  const isAmountValid = parsedAmount >= minAmount && parsedAmount <= maxAmount
  const fitsAccount = (method: PaymentMethod | null, value: number) => !!method &&
    (method.minAmount == null || value >= method.minAmount) && (method.maxAmount == null || value <= method.maxAmount)
  // Limits can change while the player pays (a refresh on focus, another pending deposit).
  const isSelectionValid = isAmountValid && fitsAccount(selectedMethod, parsedAmount)
  const limitsChangedMessage = `This amount is no longer allowed for this account. Allowed: ${formatAmount(Math.max(minAmount, selectedMethod?.minAmount ?? 0))} to ${formatAmount(Math.min(maxAmount, selectedMethod?.maxAmount ?? maxAmount))}. Please change the amount or the account.`

  // Load payment methods (admin accounts)
  const loadPaymentMethods = useCallback(async () => {
    setMethodsLoading(true)
    setMethodsError(null)
    try {
      const res = await getAdminAccounts()
      if (res?.meta?.code === 200 && Array.isArray(res.data)) {
        const methods: PaymentMethod[] = res.data.map((acc: any) => ({
          id: acc?.id || acc?._id,
          type: acc?.type === 'upi' ? 'upi' : acc?.type === 'gateway' ? 'gateway' : 'bank',
          name: acc?.displayName || acc?.bankName || (acc?.type === 'upi' ? 'UPI' : 'Bank Account'),
          displayName: acc?.displayName || acc?.bankName || acc?.accountNumber,
          accountNumber: acc?.accountNumber,
          ifscCode: acc?.ifscCode,
          bankName: acc?.bankName,
          accountHolderName: acc?.accountHolderName,
          branch: acc?.branch,
          upiId: acc?.upiId || (acc?.type === 'upi' ? acc?.accountNumber : undefined),
          qrUrl: acc?.qrUrl,
          minAmount:
            acc?.minAmount != null && acc?.minAmount !== '' ? Number(acc.minAmount) : undefined,
          maxAmount:
            acc?.maxAmount != null && acc?.maxAmount !== '' ? Number(acc.maxAmount) : undefined,
          processingTime: '1-5 minutes',
          isActive: true,
        }))
        setPaymentMethods(methods)
        setSelectedMethod(current => current ? methods.find(method => method.id === current.id) || null : null)
      } else {
        setMethodsError('Failed to load payment methods')
      }
    } catch (e: any) {
      setMethodsError(e?.message || 'Failed to load payment methods')
    } finally {
      setMethodsLoading(false)
    }
  }, [])

  // Load deposit history
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const today = new Date()
      const start = new Date()
      start.setDate(today.getDate() - 30)
      const res = await getAdminDepositRequests({
        start_date: start.toISOString(),
        end_date: today.toISOString(),
      })
      if (res?.meta?.code === 200 && Array.isArray(res.data)) {
        setHistory(res.data)
      } else {
        setHistoryError('Failed to load deposit history')
      }
    } catch (e: any) {
      setHistoryError(e?.message || 'Failed to load deposit history')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  // Initialize
  useEffect(() => {
    loadPaymentMethods()
    loadHistory()
  }, [loadPaymentMethods, loadHistory])

  useEffect(() => {
    const refresh = () => { if (!processing) void loadPaymentMethods() }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [loadPaymentMethods, processing])

  // A refresh can drop the chosen account (tier changed, account disabled).
  // Return to the method step with a reason instead of an empty confirm panel.
  useEffect(() => {
    if (currentStep !== 'confirm' || selectedMethod) return
    setCurrentStep('method')
    setError(current => current || 'That account is no longer available for your VIP tier. Please choose another.')
  }, [currentStep, selectedMethod])

  // Handle proof upload
  const handleProofUpload = async (file: File) => {
    setProofUploadError(null)
    setProofUploading(true)
    setProofKey('')
    setProofFileName(file.name)
    try {
      // Show preview immediately
      const reader = new FileReader()
      reader.onload = () => setProofPreview(String(reader.result || ''))
      reader.readAsDataURL(file)

      // Upload via backend (bypasses S3 CORS issues)
      const result = await uploadDepositProof(file)
      
      if (!result.success || !result.data?.key) {
        throw new Error(result.message || 'Failed to upload proof')
      }
      
      setProofKey(result.data.key)
    } catch (err: any) {
      setProofUploadError(err?.message || 'Failed to upload proof')
      setProofPreview('')
      setProofFileName('')
    } finally {
      setProofUploading(false)
    }
  }

  const clearProof = () => {
    setProofKey('')
    setProofPreview('')
    setProofFileName('')
    setProofUploadError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Handle gateway deposit
  const handleGatewayDeposit = async () => {
    if (processing) return
    if (!isSelectionValid) { setError(limitsChangedMessage); return }
    setProcessing(true)
    setError(null)
      try {
      const res = await requestWithToast(
        () => createDeposit({ amount: parsedAmount }),
        {
          loading: 'Creating deposit...',
          success: 'Redirecting to payment gateway',
          error: 'Failed to create deposit',
        }
      )
      const redirectUrl = (res as any)?.data?.redirectUrl || (res as any)?.data?.url
      if (redirectUrl) {
        window.open(redirectUrl, '_self')
      } else {
        // Show success receipt for non-redirect payments
        setReceipt({
          id: (res as any)?.data?.id || 'N/A',
          amount: parsedAmount,
          status: 'pending' as const,
          method: 'Payment Gateway',
          timestamp: new Date().toISOString(),
          expectedSettlement: '1-5 minutes',
        })
        // The pending order now counts against the daily and monthly limits.
        void loadPaymentMethods()
        }
      } catch (e: any) {
      setError(e?.message || 'Failed to create deposit')
      } finally {
      setProcessing(false)
      }
    }

  // Handle admin deposit
  const handleAdminDeposit = async () => {
    if (!selectedMethod || processing) return
    if (!isSelectionValid) { setError(limitsChangedMessage); return }
    setProcessing(true)
    setError(null)
      try {
      const res = await requestWithToast(
        () =>
          createAdminDeposit({
            accountId: selectedMethod.id,
            amount: parsedAmount,
            txnRef: txnRef || undefined,
            proofKey: proofKey || undefined,
            type: selectedMethod.type,
          }),
        {
          loading: 'Submitting deposit request...',
          success: 'Deposit request submitted successfully',
          error: 'Failed to submit deposit',
        }
      )
      if ((res as any)?.meta?.code === 200) {
        // Show success receipt
        setReceipt({
          id: (res as any)?.data?.id || 'N/A',
          amount: parsedAmount,
          status: 'pending' as const,
          method: selectedMethod.displayName || selectedMethod.name,
          reference: txnRef || undefined,
          timestamp: new Date().toISOString(),
          expectedSettlement: '1-5 minutes',
        })
        // Reset form
        setTxnRef('')
        setProofKey('')
        setProofPreview('')
        setAmount('')
        setSelectedMethod(null)
        setCurrentStep('amount')
        // Refresh history, and the limits this pending request now counts against
        void loadPaymentMethods()
        await loadHistory()
      }
      } catch (e: any) {
      setError(e?.message || 'Failed to submit deposit')
      void loadPaymentMethods()
    } finally {
      setProcessing(false)
    }
  }

  // Step navigation
  const handleAmountNext = () => {
    if (isAmountValid) {
      if (selectedMethod && !fitsAccount(selectedMethod, parsedAmount)) setSelectedMethod(null)
      setError(null)
      setCurrentStep('method')
    }
  }

  const handleMethodBack = () => {
    setCurrentStep('amount')
  }

  const handleMethodNext = () => {
    if (selectedMethod) {
      setError(null)
      setCurrentStep('confirm')
    }
  }

  const handleConfirmBack = () => {
    setCurrentStep('method')
  }

  const handleConfirmSubmit = () => {
    if (selectedMethod?.type === 'gateway') {
      handleGatewayDeposit()
    } else {
      handleAdminDeposit()
      }
    }

  // Close receipt
  const handleCloseReceipt = () => {
    setReceipt(null)
    setActiveTab('history')
  }

  const [infoModalOpen, setInfoModalOpen] = useState(false)

  // Rendered after every hook has run: an early return above the hooks would
  // change hook order between renders (hideDW arrives asynchronously with
  // settings) and crash the page with "rendered fewer hooks than expected".
  if (isCreditPlayer || hideDW) {
    return null // redirect is handled by the effect above
  }

  return (
    <div className="dep-page">
      <DepositPageHeader onHelpClick={() => setInfoModalOpen(true)} />

      <div className="w-full">
        <SegmentedTabs
          theme="slate"
          fullWidth
          tabs={[
            { key: 'deposit', label: 'Deposit' },
            { key: 'history', label: 'History' },
          ]}
          value={activeTab}
          onChange={(k: string) => {
            setActiveTab(k as DepositTab)
            if (k === 'deposit') {
              setCurrentStep('amount')
              setError(null)
            }
          }}
        />
      </div>

      {activeTab === 'deposit' && (
        <div className="dep-flow nova-acct-panel">
          {/* Step bar */}
          <div className="nova-acct-panel-head">
            <div className="dep-steps">
              {(['amount', 'method', 'confirm'] as const).map((step, index) => {
                const isActive = currentStep === step
                const isCompleted =
                  (step === 'amount' && parsedAmount > 0 && isAmountValid) ||
                  (step === 'method' && selectedMethod !== null) ||
                  (step === 'confirm' && false)
                const stepLabels = { amount: 'Amount', method: 'Method', confirm: 'Confirm' }
                return (
                  <div key={step} className={`dep-step${isActive ? ' is-active' : isCompleted ? ' is-done' : ''}`}>
                    <span className="dep-step-num">
                      {isCompleted && !isActive ? <Check aria-hidden="true" /> : index + 1}
                    </span>
                    <span className="dep-step-label">{stepLabels[step]}</span>
                    {index < 2 && (
                      <span className="dep-step-line" aria-hidden="true" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="dep-flow-body">
              {currentStep === 'amount' && (
                <>
                  {noGlobalDepositLimits && paymentMethods.length > 0 && (
                    <div className="dep-note">
                      <p className="dep-note-title">
                        Limits are set per payment method
                      </p>
                      <p className="dep-note-text">
                        App-wide min/max are not configured. Enter between{' '}
                        <strong>{formatAmount(minAmount)}</strong> and{' '}
                        <strong>{formatAmount(maxAmount)}</strong>. Each
                        method shows its Min / Max on the next step.
                      </p>
                    </div>
                  )}
                  {methodsLoading ? <p role="status">Loading available deposit options...</p> : null}
                  {methodsError ? <div className="dep-alert"><AlertCircle /><p>{methodsError}</p></div> : null}
                  {!methodsLoading && !methodsError && !paymentMethods.length ? <div className="dep-alert"><AlertCircle /><p>No deposit options are available for your tier or remaining limits. Please contact support.</p></div> : null}
                  <AmountSelector
                    amount={amount}
                    onChange={setAmount}
                    minAmount={minAmount}
                    maxAmount={maxAmount}
                    disabled={processing}
                  />
                  <button
                    type="button"
                    onClick={handleAmountNext}
                    disabled={!isAmountValid || processing || methodsLoading || !paymentMethods.length}
                    className="dep-btn dep-btn-primary"
                  >
                    Continue <ArrowRight />
                  </button>
                </>
              )}

              {currentStep === 'method' && (
                <>
                  <button
                    type="button"
                    onClick={handleMethodBack}
                    className="dep-back"
                  >
                    <ArrowLeft /> Change amount
                  </button>
                  <div className="dep-amount-strip">
                    <span className="dep-amount-strip-label">Amount</span>
                    <span className="dep-amount-strip-value">{formatAmount(parsedAmount)}</span>
                    <Banknote />
                  </div>
                  {error && (
                    <div className="dep-alert">
                      <AlertCircle />
                      <p>{error}</p>
                    </div>
                  )}
                  <PaymentMethodSelector
                    methods={paymentMethods}
                    loading={methodsLoading}
                    error={methodsError}
                    selectedMethodId={selectedMethod?.id}
                    onSelect={setSelectedMethod}
                    onProceed={handleMethodNext}
                    amount={parsedAmount}
                    disabled={processing}
                    prominentAccountLimits={noGlobalDepositLimits}
                  />
                </>
              )}

              {currentStep === 'confirm' && selectedMethod && (
                <>
                  <button
                    type="button"
                    onClick={handleConfirmBack}
                    className="dep-back"
                  >
                    <ArrowLeft /> Change method
                  </button>

                  <div className="dep-confirm-grid">
                  <div className="dep-confirm-summary">
                    <div className="dep-summary">
                      <div className="dep-summary-row">
                        <span className="dep-summary-label">Amount</span>
                        <span className="dep-summary-value is-amount">{formatAmount(parsedAmount)}</span>
                      </div>
                      <div className="dep-summary-row">
                        <span className="dep-summary-label">Method</span>
                        <span className="dep-summary-value">{selectedMethod.displayName || selectedMethod.name}</span>
                      </div>
                    </div>

                    {parsedAmount > 0 && <FeeBreakdown amount={parsedAmount} type="deposit" />}
                    {selectedMethod.processingTime && (
                      <div className="dep-meta-row">
                        <span>Processing</span>
                        <span>{selectedMethod.processingTime}</span>
                      </div>
                    )}
                  </div>

                  {(selectedMethod.type === 'bank' || selectedMethod.type === 'upi') && (
                    <div className="dep-pay">
                      <p className="dep-pay-head">Payment details</p>
                      <div className="dep-pay-body">
                      <div className="dep-pay-lines">
                        {selectedMethod.type === 'upi' && selectedMethod.upiId && (
                          <div className="dep-pay-line"><span className="dep-pay-key">UPI: </span><span className="dep-pay-val is-mono">{selectedMethod.upiId}</span></div>
                        )}
                        {selectedMethod.type === 'bank' && (
                          <>
                            {selectedMethod.bankName && <div className="dep-pay-line"><span className="dep-pay-key">Bank: </span><span className="dep-pay-val">{selectedMethod.bankName}</span></div>}
                            {selectedMethod.accountNumber && <div className="dep-pay-line"><span className="dep-pay-key">A/C: </span><span className="dep-pay-val is-mono">{selectedMethod.accountNumber}</span></div>}
                            {selectedMethod.ifscCode && <div className="dep-pay-line"><span className="dep-pay-key">IFSC: </span><span className="dep-pay-val is-mono">{selectedMethod.ifscCode}</span></div>}
                          </>
                        )}
                      </div>

                      {selectedMethod.qrUrl && (
                        <div className="dep-pay-qr">
                          <img src={selectedMethod.qrUrl} alt="Payment QR" />
                        </div>
                      )}
                      <div>
                        <label className="dep-label">UTR / Reference</label>
                        <input
                          type="text"
                          value={txnRef}
                          onChange={(e) => setTxnRef(e.target.value)}
                          placeholder="Transaction reference"
                          className="dep-input"
                        />
                      </div>
                      <div>
                        <label className="dep-label">Screenshot (or UTR)</label>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (!file) { clearProof(); return }
                            void handleProofUpload(file)
                          }}
                          className="sr-only"
                          disabled={proofUploading}
                        />
                        {!proofKey && !proofUploading ? (
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="dep-drop"
                          >
                            <ImagePlus />
                            <span>Browse or drop</span>
                          </button>
                        ) : proofUploading ? (
                          <div className="dep-drop is-busy">
                            <div className="dep-drop-spinner animate-spin" />
                            <span>Uploading…</span>
                          </div>
                        ) : (
                          <div className="dep-file">
                            <Check />
                            <span className="dep-file-name">{proofFileName || 'Uploaded'}</span>
                            <button type="button" onClick={clearProof} className="dep-file-remove"><X /></button>
                            <button type="button" onClick={() => fileInputRef.current?.click()} className="dep-file-change">Change</button>
                          </div>
                        )}
                        {proofUploadError && <p className="dep-upload-error">{proofUploadError}</p>}
                      </div>
                      </div>
                    </div>
                  )}
                  </div>

                  {error && (
                    <div className="dep-alert">
                      <AlertCircle />
                      <p>{error}</p>
                    </div>
                  )}
                  {!isSelectionValid && !error && (
                    <div className="dep-alert">
                      <AlertCircle />
                      <p>{limitsChangedMessage}</p>
                    </div>
                  )}
                  {(selectedMethod.type === 'bank' || selectedMethod.type === 'upi') && !txnRef.trim() && !proofKey && (
                    <p className="dep-hint">Provide UTR or screenshot</p>
                  )}
                  <button
                    type="button"
                    onClick={handleConfirmSubmit}
                    disabled={processing || proofUploading || !isSelectionValid || ((selectedMethod.type === 'bank' || selectedMethod.type === 'upi') && !txnRef.trim() && !proofKey)}
                    className="dep-btn dep-btn-primary"
                  >
                    {processing || proofUploading ? (
                      <><div className="dep-spinner animate-spin" /> {processing ? 'Processing…' : 'Uploading…'}</>
                    ) : (
                      'Confirm Deposit'
                    )}
                  </button>
                </>
              )}
          </div>
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <DepositHistory
          deposits={history}
          loading={historyLoading}
          error={historyError}
          onRefresh={loadHistory}
        />
      )}

      {/* Transaction Receipt Modal */}
      {receipt && (
        <TransactionReceipt
          transaction={receipt}
          onClose={handleCloseReceipt}
          onGoHome={() => navigate('/')}
          onStatusChange={(newStatus) => {
            // Update receipt status and refresh history when status changes
            setReceipt((prev: any) => prev ? { ...prev, status: newStatus } : null)
            loadHistory()
          }}
        />
      )}

      {/* Important Information Modal (header help ? button) */}
      {infoModalOpen && (
        <ModalSurface open={infoModalOpen} onClose={() => setInfoModalOpen(false)} title="Important Information" titleId="deposit-info-modal-title" size="md" className="nova-deposit-information-modal dep-modal">
            <ul className="nova-modal-body dep-info-list">
              <li>
                <span className="dep-info-bullet" aria-hidden="true" />
                <span>Deposits are processed instantly and typically reflect within 1-5 minutes</span>
              </li>
              <li>
                <span className="dep-info-bullet" aria-hidden="true" />
                <span>For deposits over {formatAmount(50000)}, additional verification may be required</span>
              </li>
              <li>
                <span className="dep-info-bullet" aria-hidden="true" />
                <span>If payment is delayed beyond 30 minutes, contact support with transaction reference</span>
              </li>
              <li>
                <span className="dep-info-bullet" aria-hidden="true" />
                <span>All transactions are encrypted with 256-bit SSL and monitored 24/7</span>
              </li>
            </ul>
        </ModalSurface>
      )}
    </div>
  )
}
