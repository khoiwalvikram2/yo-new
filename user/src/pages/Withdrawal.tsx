import { useEffect, useState, useMemo, useCallback } from 'react'
import { Wallet, ShieldCheck, ArrowLeft, ArrowRight, CreditCard, Check, Info, AlertCircle } from 'lucide-react'
// import { useTranslation } from 'react-i18next' // i18n hook for future use
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import ModalSurface from '@/components/modals/ModalSurface'

import { WithdrawalPageHeader } from '@/components/withdrawal'
import { usePageSEO } from '@/hooks/usePageSEO'
import { SegmentedTabs } from '@/components/bonus/SegmentedTabs'
import AccountsTab from '@/components/withdrawal/AccountsTab'
import UpiModal from '@/components/withdrawal/UpiModal'
import BankModal from '@/components/withdrawal/BankModal'
import {
  createWithdrawalRequest,
  getAccountDetails,
  createAccountDetails,
  getWithdrawalRequests,
  setPrimaryAccount,
} from '@/lib/api/user'
import { requestWithToast } from '@/lib/request'
import { notify } from '@/lib/notify'
import { formatAmount } from '@/lib/currency'
import {
  WithdrawalAmountSelector,
  AccountSelector,
  WithdrawalHistory,
  WithdrawalReceipt,
  type WithdrawalAccount,
} from '@/components/withdrawal'
import { usePaymentConfig, useParsedSettings } from '@/hooks/useAppSettings'
import FeeBreakdown from '@/components/payment/FeeBreakdown'
import '@/styles/account/withdrawal.css'

type WithdrawalStep = 'amount' | 'account' | 'confirm'
type WithdrawalTab = 'accounts' | 'withdrawal' | 'history'

type UpiAccount = {
  id: string
  upiId: string
  holderName: string
  isPrimary?: boolean
  label?: string
  approvalStatus?: string
  rejectionReason?: string
}

type BankAccount = {
  id: string
  holderName: string
  accountNumber: string
  ifsc: string
  bankName?: string
  isPrimary?: boolean
  label?: string
  approvalStatus?: string
  rejectionReason?: string
}

export default function WithdrawalPage() {
  usePageSEO({ 
    title: 'Withdrawal', 
    description: 'Withdraw your winnings securely' 
  })
  
  // Translation hook (currently unused)
  // const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, refreshUser } = useAuth()

  // Tab management
  const [activeTab, setActiveTab] = useState<WithdrawalTab>('withdrawal')

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WithdrawalStep>('amount')
  const [amount, setAmount] = useState<string>('')
  const [selectedAccount, setSelectedAccount] = useState<WithdrawalAccount | null>(null)

  // Accounts state
  const [upiAccounts, setUpiAccounts] = useState<UpiAccount[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsError, setAccountsError] = useState<string | null>(null)

  // Transaction state
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<any>(null)

  // History state
  const [history, setHistory] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  // Modal states
  const [showAddUpi, setShowAddUpi] = useState(false)
  const [showAddBank, setShowAddBank] = useState(false)

  // Get payment configuration from app settings
  const paymentConfig = usePaymentConfig()
  const minAmount = paymentConfig.withdrawalMin ?? 200
  const maxAmount = paymentConfig.withdrawalMax ?? 10000000
  const upiPayoutsDisabled = paymentConfig.upiPayoutsDisabled ?? false
  const bankPayoutsDisabled = paymentConfig.bankPayoutsDisabled ?? false
  const hideAddUpi = paymentConfig.hideAddUpi ?? false
  const hideAddBank = paymentConfig.hideAddBank ?? false
  const maxDailyWithdrawalLimit =
    paymentConfig.maxDailyWithdrawalRequests != null && Number(paymentConfig.maxDailyWithdrawalRequests) > 0
      ? Math.floor(Number(paymentConfig.maxDailyWithdrawalRequests))
      : 0

  // Check if user belongs to CREDIT agent
  const parsedSettings = useParsedSettings()
  const whitelabelTz = parsedSettings.timeZone?.trim() || 'UTC'
  const hideDW = parsedSettings.hideDW ?? false
  
  // Redirect CREDIT agent players - they cannot withdraw
  useEffect(() => {
    if (hideDW) {
      navigate('/', { replace: true })
    }
  }, [hideDW, navigate])
  
  // Check KYC requirement
  const isKycRequired = paymentConfig.kycRequiredToWithdraw ?? false
  const isKycVerified = (user as any)?.kycStatus === 'VERIFIED' || (user as any)?.kycVerified === true
  
  // Check if user is a credit player
  const playerType = (user as any)?.playerType || 'REGULAR'
  const isCreditPlayer = playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT'

  // Redirect credit players - they cannot withdraw
  useEffect(() => {
    if (isCreditPlayer) {
      navigate('/', { replace: true })
    }
  }, [isCreditPlayer, navigate])

  // Calculate available balance considering exposure
  const availableBalance = useMemo(() => {
    const balance = user?.balance || 0
    const exposure = Math.abs(Number((user as any)?.exposure || 0))
    const netBalance = balance - exposure
    return Math.max(0, netBalance)
  }, [user])

  const parsedAmount = useMemo(() => Number(amount || 0), [amount])
  const isAmountValid = parsedAmount >= minAmount && parsedAmount <= Math.min(maxAmount, availableBalance)
  const canWithdraw = isAmountValid && (!isKycRequired || isKycVerified)

  // Convert approved accounts only to WithdrawalAccount format (only approved can be used for withdrawal)
  const withdrawalAccounts: WithdrawalAccount[] = useMemo(() => {
    return [
      ...upiAccounts
        .filter((u) => (u.approvalStatus || 'PENDING') === 'APPROVED' && !upiPayoutsDisabled)
        .map((u) => ({
          id: u.id,
          type: 'upi' as const,
          holderName: u.holderName,
          upiId: u.upiId,
          isPrimary: u.isPrimary,
          label: u.label,
        })),
      ...bankAccounts
        .filter((b) => (b.approvalStatus || 'PENDING') === 'APPROVED' && !bankPayoutsDisabled)
        .map((b) => ({
          id: b.id,
          type: 'bank' as const,
          holderName: b.holderName,
          accountNumber: b.accountNumber,
          ifsc: b.ifsc,
          bankName: b.bankName,
          isPrimary: b.isPrimary,
          label: b.label,
        })),
    ]
  }, [upiAccounts, bankAccounts, upiPayoutsDisabled, bankPayoutsDisabled])

  useEffect(() => {
    setSelectedAccount((prev) => {
      if (!prev) return prev
      const stillValid = withdrawalAccounts.some((a) => a.id === prev.id)
      if (stillValid) return prev
      return withdrawalAccounts[0] ?? null
    })
  }, [withdrawalAccounts])

  // Load accounts
  const refreshAccounts = useCallback(async () => {
    setAccountsLoading(true)
    setAccountsError(null)
    try {
      const res = await getAccountDetails()
      if (res?.meta?.code === 200 && Array.isArray(res.data)) {
        const upi: UpiAccount[] = []
        const bank: BankAccount[] = []
        for (const a of res.data) {
          if ((a?.type || '').toLowerCase() === 'upi') {
            upi.push({
              id: a?.id || a?._id,
              upiId: a?.accountNumber || '',
              holderName: a?.accountHolderName || '',
              isPrimary: Boolean(a?.isPrimary),
              approvalStatus: a?.approvalStatus ?? 'PENDING',
              rejectionReason: a?.rejectionReason,
            })
          } else {
            bank.push({
              id: a?.id || a?._id,
              holderName: a?.accountHolderName || '',
              accountNumber: a?.accountNumber || '',
              ifsc: a?.ifscCode || '',
              bankName: a?.bankName || '',
              isPrimary: Boolean(a?.isPrimary),
              approvalStatus: a?.approvalStatus ?? 'PENDING',
              rejectionReason: a?.rejectionReason,
            })
          }
        }
        setUpiAccounts(upi)
        setBankAccounts(bank)
        
        // Set initial selected account only if none is selected (only from approved accounts)
        setSelectedAccount((prev) => {
          if (prev) return prev
          const approvedUpi = upi.filter(
            (a) => (a.approvalStatus || 'PENDING') === 'APPROVED' && !upiPayoutsDisabled
          )
          const approvedBank = bank.filter(
            (b) => (b.approvalStatus || 'PENDING') === 'APPROVED' && !bankPayoutsDisabled
          )
          const primary = approvedUpi.find((a) => a.isPrimary)?.id || approvedBank.find((b) => b.isPrimary)?.id
          const fallback = primary || approvedUpi[0]?.id || approvedBank[0]?.id
          if (fallback) {
            const account = approvedUpi.find((a) => a.id === fallback)
              ? {
                  id: fallback,
                  type: 'upi' as const,
                  holderName: approvedUpi.find((a) => a.id === fallback)!.holderName,
                  upiId: approvedUpi.find((a) => a.id === fallback)!.upiId,
                  isPrimary: approvedUpi.find((a) => a.id === fallback)!.isPrimary,
                }
              : approvedBank.find((b) => b.id === fallback)
              ? {
                  id: fallback,
                  type: 'bank' as const,
                  holderName: approvedBank.find((b) => b.id === fallback)!.holderName,
                  accountNumber: approvedBank.find((b) => b.id === fallback)!.accountNumber,
                  ifsc: approvedBank.find((b) => b.id === fallback)!.ifsc,
                  bankName: approvedBank.find((b) => b.id === fallback)!.bankName,
                  isPrimary: approvedBank.find((b) => b.id === fallback)!.isPrimary,
                }
              : null
            return account
          }
          return null
        })
      }
    } catch (e: any) {
      setAccountsError(e?.message || 'Failed to load accounts')
    } finally {
      setAccountsLoading(false)
    }
  }, [upiPayoutsDisabled, bankPayoutsDisabled])

  // Load history
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const today = new Date()
      const start = new Date()
      start.setDate(today.getDate() - 30)
      const res = await getWithdrawalRequests({
        start_date: start.toISOString(),
        end_date: today.toISOString(),
      })
      if (res?.meta?.code === 200 && Array.isArray(res.data)) {
        setHistory(res.data)
      } else {
        setHistoryError('Failed to load withdrawal history')
      }
    } catch (e: any) {
      setHistoryError(e?.message || 'Failed to load withdrawal history')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  // Initialize - only run once on mount
  useEffect(() => {
    refreshAccounts()
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const withdrawalsUsedToday = useMemo(() => {
    if (maxDailyWithdrawalLimit <= 0) return 0
    const counted = new Set(['PENDING', 'PROCESSING', 'COMPLETED'])
    const now = new Date()
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: whitelabelTz })
    return history.filter((h: any) => {
      const s = String(h?.status ?? '').toUpperCase()
      if (!counted.has(s)) return false
      const d = h?.createdAt ? new Date(h.createdAt) : null
      if (!d || Number.isNaN(d.getTime())) return false
      return d.toLocaleDateString('en-CA', { timeZone: whitelabelTz }) === todayStr
    }).length
  }, [history, maxDailyWithdrawalLimit, whitelabelTz])

  const dailyWithdrawalLimitReached = maxDailyWithdrawalLimit > 0 && withdrawalsUsedToday >= maxDailyWithdrawalLimit

  // Handle withdrawal
  const handleWithdrawal = async () => {
    if (!canWithdraw || !selectedAccount || processing) return
    if (dailyWithdrawalLimitReached) {
      setError(
        `Daily withdrawal limit reached. You can raise up to ${maxDailyWithdrawalLimit} requests per day. Try again tomorrow or contact support.`
      )
      return
    }

    // Double-check KYC requirement
    if (isKycRequired && !isKycVerified) {
      setError('KYC verification is required to withdraw funds. Please complete your verification first.')
      return
    }
    
    setProcessing(true)
    setError(null)
    try {
      const loadingId = notify.loading('Submitting withdrawal request...')
      const res = await createWithdrawalRequest({ accountId: selectedAccount.id, amount: parsedAmount })
      notify.dismiss(loadingId)

      if ((res as any)?.meta?.code === 200) {
        notify.success((res as any)?.meta?.message || 'Withdrawal request submitted successfully')
        // Show success receipt
        setReceipt({
          id: (res as any)?.data?.id || 'N/A',
          amount: parsedAmount,
          status: 'pending' as const,
          method: selectedAccount.type === 'upi' ? 'UPI' : 'Bank Transfer',
          account: selectedAccount.type === 'upi' ? selectedAccount.upiId : `••••${selectedAccount.accountNumber?.slice(-4)}`,
          timestamp: new Date().toISOString(),
          expectedSettlement: '1-2 hours',
        })
        // Reset form
        setAmount('')
        setSelectedAccount(null)
        setCurrentStep('amount')
        // Refresh balance and history
        await refreshUser()
        await loadHistory()
      } else {
        const errMsg = (res as any)?.meta?.message || 'Failed to submit withdrawal'
        notify.error(errMsg)
        setError(errMsg)
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to submit withdrawal')
    } finally {
      setProcessing(false)
    }
  }

  // Step navigation
  const handleAmountNext = () => {
    if (canWithdraw && !dailyWithdrawalLimitReached) {
      setCurrentStep('account')
    }
  }

  const handleAccountBack = () => {
    setCurrentStep('amount')
  }

  const handleAccountNext = () => {
    if (selectedAccount) {
      setCurrentStep('confirm')
    }
  }

  const handleConfirmBack = () => {
    setCurrentStep('account')
  }

  const handleConfirmSubmit = () => {
    handleWithdrawal()
  }

  // Close receipt
  const handleCloseReceipt = () => {
    setReceipt(null)
    setActiveTab('history')
  }

  // Set primary account
  const setPrimary = async (_kind: 'upi' | 'bank', id: string) => {
    try {
      await requestWithToast(
        () => setPrimaryAccount({ accountId: id }),
        { loading: 'Updating primary...', success: 'Primary updated', error: 'Failed to update primary' }
      )
      await refreshAccounts()
      const account = withdrawalAccounts.find((a) => a.id === id)
      if (account) setSelectedAccount(account)
    } catch (_) {
      // toast already handled
    }
  }

  const [infoModalOpen, setInfoModalOpen] = useState(false)

  // Both guards run after every hook: returning early above the hooks would
  // change hook order between renders (hideDW and playerType arrive
  // asynchronously) and crash the page. Redirects are handled by the effects.
  if (hideDW || isCreditPlayer) {
    return null
  }

  return (
    <div className="wd-page">
      {/* Page Header - matchbook bar */}
      <WithdrawalPageHeader onHelpClick={() => setInfoModalOpen(true)} />

      {/* Tabs */}
      <div className="w-full">
        <SegmentedTabs
          theme="slate"
          fullWidth
          tabs={[
            { key: 'accounts', label: 'Accounts', icon: <CreditCard className="h-4 w-4" /> },
            { key: 'withdrawal', label: 'Withdraw', icon: <Wallet className="h-4 w-4" /> },
            { key: 'history', label: 'History', icon: <Wallet className="h-4 w-4" /> },
          ]}
          value={activeTab}
          onChange={(k: string) => {
            setActiveTab(k as WithdrawalTab)
            if (k === 'withdrawal') {
              setCurrentStep('amount')
              setError(null)
            }
          }}
        />
      </div>

      {/* Accounts Tab */}
      {activeTab === 'accounts' && (
        <AccountsTab
          upiAccounts={upiAccounts}
          bankAccounts={bankAccounts}
          setPrimary={setPrimary}
          onAddUpi={() => setShowAddUpi(true)}
          onAddBank={() => setShowAddBank(true)}
          hideAddUpi={hideAddUpi}
          hideAddBank={hideAddBank}
          upiDisabled={upiPayoutsDisabled}
          bankDisabled={bankPayoutsDisabled}
        />
      )}

      {/* Withdrawal Tab */}
      {activeTab === 'withdrawal' && (
        <div className="wd-pane">
          {maxDailyWithdrawalLimit > 0 && (
            <div className={`wd-notice ${dailyWithdrawalLimitReached ? 'is-warn' : 'is-info'}`}>
              <Info className="h-4 w-4" />
              <div className="wd-notice-copy">
                <p className="wd-notice-title">
                  Withdrawal requests today: {withdrawalsUsedToday} of {maxDailyWithdrawalLimit}
                </p>
                {dailyWithdrawalLimitReached ? (
                  <p className="wd-notice-text">
                    You have reached today&apos;s limit. New requests will be available on the next calendar day (platform
                    timezone).
                  </p>
                ) : (
                  <p className="wd-notice-text">
                    Each submitted request counts toward this daily limit (pending, processing, or completed).
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="wd-flow">
          {/* Progress Indicator: charcoal step bar */}
          <div className="wd-steps">
            {(['amount', 'account', 'confirm'] as const).map((step, index) => {
              const isActive = currentStep === step

              // Check if this step is completed (user has moved past it)
              const isCompleted = (() => {
                if (step === 'amount') {
                  // Amount is completed if we're on account or confirm step
                  return currentStep === 'account' || currentStep === 'confirm'
                }
                if (step === 'account') {
                  // Account is completed if we're on confirm step
                  return currentStep === 'confirm'
                }
                if (step === 'confirm') {
                  return false // Confirm is never completed until submission
                }
                return false
              })()

              // Check if progress bar should be filled
              const prevStepCompleted = (() => {
                if (index === 0) {
                  // Bar between amount and account - fill if amount is valid OR user is on account/confirm step
                  return (parsedAmount > 0 && isAmountValid) || currentStep === 'account' || currentStep === 'confirm'
                }
                if (index === 1) {
                  // Bar between account and confirm - fill if account is selected OR user is on confirm step
                  return selectedAccount !== null || currentStep === 'confirm'
                }
                return false
              })()

              const stepLabels = {
                amount: 'Amount',
                account: 'Account',
                confirm: 'Confirm',
              }
              const stepDescriptions = {
                amount: 'Enter withdrawal amount',
                account: 'Choose withdrawal account',
                confirm: 'Review and confirm',
              }

              return (
                <div key={step} className="wd-step-item">
                  <div className={`wd-step${isActive ? ' is-active' : isCompleted ? ' is-done' : ''}`}>
                    <div title={stepDescriptions[step]} className="wd-step-num">
                      {isCompleted && !isActive ? <Check /> : index + 1}
                    </div>
                    <span className="wd-step-label">
                      {stepLabels[step]}
                    </span>
                  </div>
                  {index < 2 && (
                    <div className={`wd-step-line${prevStepCompleted ? ' is-filled' : ''}`} />
                  )}
                </div>
              )
            })}
          </div>

          {/* Step Content */}
          <div className="wd-flow-body">
              {/* Step 1: Amount */}
              {currentStep === 'amount' && (
                <div className="wd-pane">
                  {/* KYC Warning */}
                  {isKycRequired && !isKycVerified && (
                    <div className="wd-notice is-warn">
                      <ShieldCheck className="h-5 w-5" />
                      <div className="wd-notice-copy">
                        <p className="wd-notice-title">
                          KYC Verification Required
                        </p>
                        <p className="wd-notice-text">
                          You must complete KYC verification before you can withdraw funds. Please verify your identity first.
                        </p>
                      </div>
                    </div>
                  )}

                  <WithdrawalAmountSelector
                    amount={amount}
                    onChange={setAmount}
                    minAmount={minAmount}
                    maxAmount={maxAmount}
                    availableBalance={availableBalance}
                    disabled={
                      processing || (isKycRequired && !isKycVerified) || dailyWithdrawalLimitReached
                    }
                  />

                  <button
                    onClick={handleAmountNext}
                    disabled={!canWithdraw || processing || dailyWithdrawalLimitReached}
                    title={
                      dailyWithdrawalLimitReached
                        ? 'Daily withdrawal request limit reached for today'
                        : !isAmountValid
                        ? 'Please enter a valid amount'
                        : isKycRequired && !isKycVerified
                        ? 'KYC verification required'
                        : 'Continue to select account'
                    }
                    className="wd-btn wd-btn-primary"
                  >
                    Continue to Account Selection
                    <ArrowRight className="h-5 w-5" />
                  </button>
                </div>
              )}

              {/* Step 2: Account */}
              {currentStep === 'account' && (
                <div className="wd-pane">
                  <button
                    onClick={handleAccountBack}
                    title="Go back to amount selection"
                    className="wd-back"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Change Amount
                  </button>
                  <div className="wd-sum">
                    <div className="wd-sum-main">
                      <p className="wd-sum-label">Withdrawal Amount</p>
                      <p className="wd-sum-amount">
                        {formatAmount(parsedAmount)}
                      </p>
                    </div>
                    <div className="wd-sum-icon">
                      <Wallet className="h-5 w-5" />
                    </div>
                  </div>
                  <AccountSelector
                    accounts={withdrawalAccounts}
                    selectedAccountId={selectedAccount?.id}
                    onSelect={setSelectedAccount}
                    loading={accountsLoading}
                    error={accountsError}
                    disabled={processing}
                  />
                  {withdrawalAccounts.length === 0 && (upiAccounts.length + bankAccounts.length) > 0 && (
                    <div className="wd-notice is-warn">
                      <AlertCircle className="h-4 w-4" />
                      <p>
                        {upiPayoutsDisabled || bankPayoutsDisabled
                          ? 'Withdrawals using one or more payout methods are temporarily disabled by the platform. Check the Accounts tab for details or contact support.'
                          : 'No approved accounts yet. Please wait for admin to approve your accounts, or add an account in the Accounts tab.'}
                      </p>
                    </div>
                  )}
                  {withdrawalAccounts.length === 0 && (upiAccounts.length + bankAccounts.length) === 0 && (
                    <div className="wd-notice is-info">
                      <Info className="h-4 w-4" />
                      <p>
                        No withdrawal accounts found. Please add an account in the Accounts tab first.
                      </p>
                    </div>
                  )}
                  {selectedAccount && (
                    <button
                      onClick={handleAccountNext}
                      disabled={!selectedAccount || processing || dailyWithdrawalLimitReached}
                      title={
                        dailyWithdrawalLimitReached
                          ? 'Daily withdrawal request limit reached for today'
                          : !selectedAccount
                          ? 'Please select an account'
                          : 'Continue to confirmation'
                      }
                      className="wd-btn wd-btn-primary"
                    >
                      Continue to Confirmation
                      <ArrowRight className="h-5 w-5" />
                    </button>
                  )}
                </div>
              )}

              {/* Step 3: Confirm */}
              {currentStep === 'confirm' && selectedAccount && (
                <div className="wd-pane">
                  <button
                    onClick={handleConfirmBack}
                    title="Go back to account selection"
                    className="wd-back"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Change Account
                  </button>

                  {/* Summary */}
                  <h3 className="wd-title">
                    Confirm Your Withdrawal
                  </h3>
                  <div className="wd-rows">
                    <div className="wd-row is-total">
                      <span className="wd-row-label">Amount</span>
                      <span className="wd-row-value">
                        {formatAmount(parsedAmount)}
                      </span>
                    </div>
                    <div className="wd-row">
                      <span className="wd-row-label">Account</span>
                      <span className="wd-row-value">
                        {selectedAccount.type === 'upi' ? selectedAccount.upiId : selectedAccount.bankName || 'Bank Account'}
                      </span>
                    </div>
                    <div className="wd-row">
                      <span className="wd-row-label">Processing Time</span>
                      <span className="wd-row-value">
                        1-2 hours
                      </span>
                    </div>
                  </div>

                  {/* Fee Breakdown */}
                  {parsedAmount > 0 && (
                    <FeeBreakdown amount={parsedAmount} type="withdrawal" />
                  )}

                  {/* Account Details */}
                  <div className="wd-rows">
                    <p className="wd-rows-head">Account Details</p>
                    <div className="wd-row">
                      <span className="wd-row-label">Holder Name</span>
                      <span className="wd-row-value is-name">
                        {selectedAccount.holderName}
                      </span>
                    </div>
                    {selectedAccount.type === 'upi' ? (
                      <div className="wd-row">
                        <span className="wd-row-label">UPI ID</span>
                        <span className="wd-row-value is-mono">
                          {selectedAccount.upiId}
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="wd-row">
                          <span className="wd-row-label">Account Number</span>
                          <span className="wd-row-value is-mono">
                            •••• {selectedAccount.accountNumber?.slice(-4)}
                          </span>
                        </div>
                        {selectedAccount.ifsc && (
                          <div className="wd-row">
                            <span className="wd-row-label">IFSC</span>
                            <span className="wd-row-value is-mono">
                              {selectedAccount.ifsc}
                            </span>
                          </div>
                        )}
                        {selectedAccount.bankName && (
                          <div className="wd-row">
                            <span className="wd-row-label">Bank</span>
                            <span className="wd-row-value">
                              {selectedAccount.bankName}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="wd-notice is-error">
                      <AlertCircle className="h-4 w-4" />
                      <p>{error}</p>
                    </div>
                  )}

                  {/* KYC Warning in Confirm Step */}
                  {isKycRequired && !isKycVerified && (
                    <div className="wd-notice is-warn">
                      <ShieldCheck className="h-5 w-5" />
                      <div className="wd-notice-copy">
                        <p className="wd-notice-title">
                          KYC Verification Required
                        </p>
                        <p className="wd-notice-text">
                          You cannot proceed with withdrawal until you complete KYC verification.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Submit Button */}
                  <button
                    onClick={handleConfirmSubmit}
                    disabled={processing || !canWithdraw || dailyWithdrawalLimitReached}
                    title={
                      dailyWithdrawalLimitReached
                        ? 'Daily withdrawal request limit reached for today'
                        : processing
                        ? 'Processing your withdrawal...'
                        : !canWithdraw
                        ? isKycRequired && !isKycVerified
                          ? 'KYC verification required'
                          : 'Please enter a valid amount'
                        : 'Submit your withdrawal request'
                    }
                    className="wd-btn wd-btn-primary"
                  >
                    {processing ? (
                      <>
                        <span className="wd-spin" aria-hidden="true" />
                        Processing...
                      </>
                    ) : (
                      'Confirm Withdrawal'
                    )}
                  </button>
                </div>
              )}
          </div>
          </div>

        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <WithdrawalHistory
          withdrawals={history}
          loading={historyLoading}
          error={historyError}
          onRefresh={loadHistory}
        />
      )}

      {/* Withdrawal Receipt Modal */}
      {receipt && (
        <WithdrawalReceipt
          transaction={receipt}
          onClose={handleCloseReceipt}
          onStatusChange={(newStatus) => {
            setReceipt((prev: any) => prev ? { ...prev, status: newStatus } : null)
            loadHistory()
          }}
        />
      )}

      {/* Add UPI Modal */}
      <UpiModal
        isOpen={showAddUpi}
        onClose={() => setShowAddUpi(false)}
        onSubmit={async (data) => {
          try {
            if (hideAddUpi) {
              notify.error('Adding UPI is not available right now.')
              return
            }
            await requestWithToast(
              () =>
                createAccountDetails({
                  accountHolderName: data.holderName,
                  accountNumber: data.upiId,
                  ifscCode: 'NA',
                  accountType: 'upi',
                  type: 'upi',
                } as any),
              { loading: 'Adding UPI...', success: 'UPI added', error: 'Failed to add UPI' }
            )
            setShowAddUpi(false)
            await refreshAccounts()
          } catch (_) {
            // Ignore API errors; UI will show a toast from requestWithToast
          }
        }}
      />

      {/* Add Bank Modal */}
      <BankModal
        isOpen={showAddBank}
        onClose={() => setShowAddBank(false)}
        onSubmit={async (data) => {
          try {
            if (hideAddBank) {
              notify.error('Adding bank accounts is not available right now.')
              return
            }
            await requestWithToast(
              () =>
                createAccountDetails({
                  accountHolderName: data.holderName,
                  accountNumber: data.accountNumber,
                  ifscCode: data.ifsc,
                  bankName: data.bankName,
                  accountType: 'bank',
                  type: 'bank',
                } as any),
              { loading: 'Adding account...', success: 'Account added', error: 'Failed to add account' }
            )
            setShowAddBank(false)
            await refreshAccounts()
          } catch (_) {
            // Ignore API errors; UI will show a toast from requestWithToast
          }
        }}
      />

      {/* Important Information Modal (header help ? button) */}
      {infoModalOpen && (
        <ModalSurface open={infoModalOpen} onClose={() => setInfoModalOpen(false)} title="Important Information" titleId="withdrawal-info-modal-title" size="md" className="nova-withdrawal-information-modal wd-modal">
            <ul className="nova-modal-body wd-info-list">
              <li>
                <span className="wd-info-mark" aria-hidden="true" />
                <span>Withdrawals are typically processed within 1-2 hours during business hours</span>
              </li>
              <li>
                <span className="wd-info-mark" aria-hidden="true" />
                <span>For withdrawals over {formatAmount(50000)}, additional verification may be required</span>
              </li>
              <li>
                <span className="wd-info-mark" aria-hidden="true" />
                <span>Ensure account holder name matches your registered name to avoid delays</span>
              </li>
              <li>
                <span className="wd-info-mark" aria-hidden="true" />
                <span>All transactions are encrypted with 256-bit SSL and monitored 24/7</span>
              </li>
            </ul>
        </ModalSurface>
      )}
    </div>
  )
}
