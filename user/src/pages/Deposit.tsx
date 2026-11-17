import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { AlertCircle, AlertTriangle, Banknote, ArrowLeft, ArrowRight, ImagePlus, Check, X } from 'lucide-react'
// import { useTranslation } from 'react-i18next' // i18n hook for future use
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import ModalSurface from '@/components/modals/ModalSurface'
 
import { formatAmount } from '@/lib/currency'
import { DepositPageHeader } from '@/components/deposit'
import { usePageSEO } from '@/hooks/usePageSEO'
import {
  createWelivepayDeposit,
  getAdminAccounts,
  createAdminDeposit,
  getAdminDepositRequests,
  type WelivepayCheckout as OnlineCheckout,
} from '@/lib/api/user'
import { compressDepositProof, PROOF_UNREADABLE } from '@/lib/depositProof'
import { requestWithToast } from '@/lib/request'
import { SegmentedTabs } from '@/components/bonus/SegmentedTabs'
import {
  AmountSelector,
  PaymentMethodSelector,
  DepositHistory,
  TransactionReceipt,
  CopyableField,
  CryptoCoinBadge,
  CryptoBonusBadge,
  CryptoBonusSummary,
  WelivepayCheckout,
  type PaymentMethod,
} from '@/components/deposit'
import { CRYPTO_COIN, cryptoBonusPercent, cryptoDepositInfo, cryptoNetworkWarning, formatUsdt, usdtFor } from '@/lib/cryptoDeposit'
import { clearSavedCheckout, readSavedCheckout, saveCheckout, welivepayCheckoutKey } from '@/lib/welivepayCheckout'
import { getWhitelabelId } from '@/lib/whitelabel'
import { usePaymentConfig, useParsedSettings } from '@/hooks/useAppSettings'
import FeeBreakdown from '@/components/payment/FeeBreakdown'
import '../styles/account/deposit.css'

type DepositStep = 'amount' | 'method' | 'confirm'
type DepositTab = 'deposit' | 'history'

const optionalNumber = (value: unknown) => (value != null && value !== '' ? Number(value) : undefined)

/**
 * A USDT wallet from adminAccounts(includeCrypto: true) as a deposit method. The server offers a wallet
 * only while the whitelabel has a rate to quote it at; one without a rate or an address is left out
 * (empty list), since the player could not know what to send or where.
 */
function cryptoMethods(acc: any): PaymentMethod[] {
  const walletAddress = acc?.walletAddress || acc?.accountNumber || undefined
  const cryptoRate = optionalNumber(acc?.cryptoRate)
  if (!walletAddress || cryptoRate === undefined || !Number.isFinite(cryptoRate) || cryptoRate <= 0) return []
  return [{
    id: acc?.id || acc?._id,
    type: 'crypto',
    name: CRYPTO_COIN,
    displayName: acc?.displayName || (acc?.network ? `${CRYPTO_COIN} (${acc.network})` : CRYPTO_COIN),
    accountNumber: walletAddress,
    walletAddress,
    network: acc?.network || undefined,
    qrUrl: acc?.qrUrl || undefined,
    cryptoRate,
    cryptoBonusPercent: cryptoBonusPercent(acc?.cryptoBonusPercent) ?? undefined,
    minAmount: optionalNumber(acc?.minAmount),
    maxAmount: optionalNumber(acc?.maxAmount),
    processingTime: 'After network confirmation',
    isActive: true,
  }]
}

export default function DepositPage() {
  usePageSEO({ 
    title: 'Deposit', 
    description: 'Add funds to your account securely' 
  })
  
  // Translation hook (currently unused)
  // const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, refreshUser } = useAuth()

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

  // The open WeLivePay checkout. Saved per site and player, so the card comes back after a reload or a
  // return from the payment tab; the key changes (and the card is read again) once the player is known.
  const checkoutKey = welivepayCheckoutKey(getWhitelabelId(), (user as any)?.id)
  const [onlineCheckout, setOnlineCheckout] = useState<OnlineCheckout | null>(() => readSavedCheckout(checkoutKey))
  // The checkout just started on this page: its card takes the focus (and scrolls into view)
  const [startedCheckoutId, setStartedCheckoutId] = useState<string | null>(null)
  useEffect(() => {
    setOnlineCheckout(readSavedCheckout(checkoutKey))
  }, [checkoutKey])

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
  // The screenshot as the compressed image data URI sent with the request (there is no separate upload)
  const [proofImage, setProofImage] = useState<string>('')
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
        const methods: PaymentMethod[] = res.data.flatMap((acc: any): PaymentMethod[] => acc?.type === 'crypto' ? cryptoMethods(acc) : [{
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
        }])
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

  // A chosen screenshot is scaled down to a JPEG data URI here and sent with the deposit request itself
  const handleProofChosen = async (file: File) => {
    setProofUploadError(null)
    setProofUploading(true)
    setProofImage('')
    setProofFileName(file.name)
    try {
      setProofImage(await compressDepositProof(file))
    } catch (err: any) {
      setProofUploadError(err?.message || PROOF_UNREADABLE)
      setProofFileName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } finally {
      setProofUploading(false)
    }
  }

  const clearProof = () => {
    setProofImage('')
    setProofFileName('')
    setProofUploadError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Handle gateway deposit: the payment gateway (WeLivePay, the only one) gets a checkout card on this
  // page. Its link opens in a new tab; the page itself never navigates away.
  const handleGatewayDeposit = async () => {
    if (processing || onlineCheckout) return
    if (!isSelectionValid) { setError(limitsChangedMessage); return }
    setProcessing(true)
    setError(null)
    try {
      const res = await createWelivepayDeposit(parsedAmount)
      if (res?.meta?.code !== 200 || !res.data) throw new Error(res?.meta?.message || 'Unable to start the online payment')
      const checkout: OnlineCheckout = { ...res.data, amount: parsedAmount }
      // Saved first: after a reload or back from the payment tab, the card picks the order up again
      saveCheckout(checkoutKey, checkout)
      setOnlineCheckout(checkout)
      setStartedCheckoutId(checkout.orderId)
      // The pending order now counts against the daily and monthly limits.
      void loadPaymentMethods()
    } catch (e: any) {
      setError(e?.message || 'Unable to start the online payment')
    } finally {
      setProcessing(false)
    }
  }

  // The gateway confirmed the checkout's payment: show the new balance and the deposit in the history
  const handleCheckoutPaid = () => {
    void refreshUser()
    void loadHistory()
  }

  const handleCheckoutClose = () => {
    clearSavedCheckout(checkoutKey)
    setOnlineCheckout(null)
  }

  // Handle admin deposit
  const handleAdminDeposit = async () => {
    if (!selectedMethod || processing) return
    if (!isSelectionValid) { setError(limitsChangedMessage); return }
    // A crypto transfer is checked by its hash: the server refuses one without it (the button is disabled too)
    if (selectedMethod.type === 'crypto' && !txnRef.trim()) return
    setProcessing(true)
    setError(null)
      try {
      const res = await requestWithToast(
        () =>
          createAdminDeposit({
            accountId: selectedMethod.id,
            amount: parsedAmount,
            txnRef: txnRef || undefined,
            proofKey: proofImage || undefined,
            type: selectedMethod.type,
          }).then((response) => {
            // A refusal the server answers in `meta` (not as an error) must not toast as a success
            if (response?.meta?.code !== 200) throw new Error(response?.meta?.message || 'Failed to submit deposit')
            return response
          }),
        {
          loading: 'Submitting deposit request...',
          success: 'Deposit request submitted successfully',
          error: 'Failed to submit deposit',
        }
      )
      if ((res as any)?.meta?.code === 200) {
        // `data` is the list of requests created: one row
        const data: any = (res as any)?.data
        const created = Array.isArray(data) ? data[0] : data
        // A crypto receipt states the USDT and bonus the server quoted, not this page's preview
        const crypto = cryptoDepositInfo(created)
        // Show success receipt
        setReceipt({
          id: created?.id || 'N/A',
          amount: parsedAmount,
          status: 'pending' as const,
          method: selectedMethod.displayName || selectedMethod.name,
          reference: crypto ? (created?.utr || txnRef.trim() || undefined) : (txnRef || undefined),
          timestamp: new Date().toISOString(),
          expectedSettlement: selectedMethod.processingTime || '1-5 minutes',
          ...(crypto ? { cryptoAmount: crypto.usdt, cryptoNetwork: crypto.network, cryptoBonusAmount: crypto.bonus } : {}),
        })
        // Reset form
        setTxnRef('')
        clearProof()
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

  const handleSelectMethod = (method: PaymentMethod) => {
    // A bank/UPI reference is not a transaction hash (and the other way round): moving between
    // crypto and the other methods starts the reference and the screenshot afresh.
    if (selectedMethod && (selectedMethod.type === 'crypto') !== (method.type === 'crypto')) {
      setTxnRef('')
      clearProof()
    }
    setSelectedMethod(method)
  }

  const handleMethodNext = () => {
    if (!selectedMethod) return
    setError(null)
    // A payment gateway needs no confirm step: Proceed starts its checkout card on this page
    if (selectedMethod.type === 'gateway') {
      void handleGatewayDeposit()
      return
    }
    setCurrentStep('confirm')
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

  // Methods paid outside the app and confirmed by an admin from the reference / screenshot
  const isManualMethod = selectedMethod?.type === 'bank' || selectedMethod?.type === 'upi' || selectedMethod?.type === 'crypto'
  const isCrypto = selectedMethod?.type === 'crypto'
  // Preview of the USDT to send; the server quotes the request itself when it is submitted
  const usdtToSend = isCrypto ? usdtFor(parsedAmount, selectedMethod?.cryptoRate) : null
  // A crypto transfer can only be checked on-chain by its hash, so a screenshot alone is not enough
  const missingProof = isCrypto ? !txnRef.trim() : !txnRef.trim() && !proofImage
  // One gateway checkout at a time: a new one waits until the open card is closed
  const gatewayBlockedReason = selectedMethod?.type === 'gateway' && onlineCheckout
    ? 'Complete or close your open online payment to start a new one.'
    : null

  // Rendered after every hook has run: an early return above the hooks would
  // change hook order between renders (hideDW arrives asynchronously with
  // settings) and crash the page with "rendered fewer hooks than expected".
  if (isCreditPlayer || hideDW) {
    return null // redirect is handled by the effect above
  }

  return (
    <div className="dep-page">
      <DepositPageHeader onHelpClick={() => setInfoModalOpen(true)} />

      {/* Above the tabs, so the payment status stays in view on both */}
      {onlineCheckout && (
        <WelivepayCheckout
          checkout={onlineCheckout}
          onPaid={handleCheckoutPaid}
          onDismiss={handleCheckoutClose}
          focusOnMount={startedCheckoutId === onlineCheckout.orderId}
        />
      )}

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
                    onSelect={handleSelectMethod}
                    onProceed={handleMethodNext}
                    amount={parsedAmount}
                    disabled={processing}
                    busy={processing && selectedMethod?.type === 'gateway'}
                    proceedBlockedReason={gatewayBlockedReason}
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
                      {isCrypto && usdtToSend !== null && (
                        <div className="dep-summary-row">
                          <span className="dep-summary-label">You send</span>
                          <span className="dep-summary-value">{formatUsdt(usdtToSend)}</span>
                        </div>
                      )}
                    </div>

                    {parsedAmount > 0 && <FeeBreakdown amount={parsedAmount} type="deposit" />}
                    {selectedMethod.processingTime && (
                      <div className="dep-meta-row">
                        <span>Processing</span>
                        <span>{selectedMethod.processingTime}</span>
                      </div>
                    )}
                  </div>

                  {isManualMethod && (
                    <div className="dep-pay">
                      <p className="dep-pay-head">Payment details</p>
                      <div className="dep-pay-body">
                      {isCrypto ? (
                        <div className="dep-crypto-pay">
                          <div className="dep-crypto-meta">
                            <CryptoCoinBadge network={selectedMethod.network} />
                            <CryptoBonusBadge percent={selectedMethod.cryptoBonusPercent} />
                            {selectedMethod.cryptoRate != null && (
                              <span className="dep-crypto-rate">1 {CRYPTO_COIN} = {formatAmount(selectedMethod.cryptoRate)}</span>
                            )}
                          </div>
                          <div className="dep-copy-list">
                            {selectedMethod.walletAddress && <CopyableField label="Wallet Address" value={selectedMethod.walletAddress} wrap />}
                            {usdtToSend !== null && <CopyableField label="Amount to Send" value={formatUsdt(usdtToSend)} copyValue={usdtToSend.toFixed(2)} />}
                          </div>
                          {usdtToSend !== null && <CryptoBonusSummary amount={parsedAmount} percent={selectedMethod.cryptoBonusPercent} />}
                          <p className="dep-warn" role="note">
                            <AlertTriangle aria-hidden="true" />
                            <span>{cryptoNetworkWarning(selectedMethod.network)}. Funds sent on another network cannot be recovered.</span>
                          </p>
                        </div>
                      ) : (
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
                      )}

                      {selectedMethod.qrUrl && (
                        <div className="dep-pay-qr">
                          {/* A wallet QR stays dark-on-white in both themes so a phone can scan it */}
                          <img src={selectedMethod.qrUrl} alt={isCrypto ? 'Wallet QR Code' : 'Payment QR'} className={isCrypto ? 'is-scan' : undefined} />
                        </div>
                      )}
                      <div>
                        <label className="dep-label" htmlFor="dep-txn-ref">{isCrypto ? 'Transaction hash (TxID)' : 'UTR / Reference'}</label>
                        <input
                          id="dep-txn-ref"
                          type="text"
                          value={txnRef}
                          onChange={(e) => setTxnRef(e.target.value)}
                          placeholder={isCrypto ? 'Paste the transaction hash' : 'Transaction reference'}
                          className="dep-input"
                          // A hash must reach the server exactly as the wallet app shows it
                          required={isCrypto}
                          autoComplete={isCrypto ? 'off' : undefined}
                          autoCapitalize={isCrypto ? 'off' : undefined}
                          autoCorrect={isCrypto ? 'off' : undefined}
                          spellCheck={isCrypto ? false : undefined}
                        />
                      </div>
                      <div>
                        <label className="dep-label">{isCrypto ? 'Screenshot (optional)' : 'Screenshot (or UTR)'}</label>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (!file) { clearProof(); return }
                            void handleProofChosen(file)
                          }}
                          className="sr-only"
                          disabled={proofUploading}
                        />
                        {!proofImage && !proofUploading ? (
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
                            <span>Preparing…</span>
                          </div>
                        ) : (
                          <div className="dep-file">
                            <Check />
                            <span className="dep-file-name">{proofFileName || 'Screenshot added'}</span>
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
                  {isManualMethod && missingProof && (
                    <p className="dep-hint">{isCrypto ? 'Enter the transaction hash after sending' : 'Provide UTR or screenshot'}</p>
                  )}
                  <button
                    type="button"
                    onClick={handleConfirmSubmit}
                    disabled={processing || proofUploading || !isSelectionValid || (isManualMethod && missingProof)}
                    className="dep-btn dep-btn-primary"
                  >
                    {processing || proofUploading ? (
                      <><div className="dep-spinner animate-spin" /> {processing ? 'Processing…' : 'Preparing…'}</>
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
