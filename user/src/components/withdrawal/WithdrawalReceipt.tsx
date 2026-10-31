import { CheckCircle2, Clock, Copy, X, Loader2, Home } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { formatAmount, getDefaultLocale } from '@/lib/currency'
import { useState, useCallback, useEffect, useRef } from 'react'
import ConfettiBurst from '@/components/animations/ConfettiBurst'
import { getWithdrawalRequests } from '@/lib/api/user'
import ModalSurface from '../modals/ModalSurface'

interface WithdrawalReceiptProps {
  transaction: {
    id: string
    amount: number
    status: 'success' | 'pending' | 'processing' | 'failed'
    method: string
    account?: string
    timestamp: string
    expectedSettlement?: string
  }
  onClose: () => void
  onStatusChange?: (newStatus: 'success' | 'pending' | 'processing' | 'failed') => void
}

export function WithdrawalReceipt({ transaction, onClose, onStatusChange }: WithdrawalReceiptProps) {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const [currentStatus, setCurrentStatus] = useState(transaction.status)
  const [showConfetti, setShowConfetti] = useState(transaction.status === 'success')
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Poll for status updates when pending or processing
  const checkStatus = useCallback(async () => {
    if (currentStatus !== 'pending' && currentStatus !== 'processing') return

    try {
      const today = new Date()
      const start = new Date()
      start.setDate(today.getDate() - 1)

      const res = await getWithdrawalRequests({
        start_date: start.toISOString(),
        end_date: today.toISOString(),
      })

      if (res?.meta?.code === 200 && Array.isArray(res.data)) {
        // Try to find by ID first; if ID is N/A or missing, match by amount + most recent
        let found: any = null
        const txnId = String(transaction.id || '')
        if (txnId && txnId !== 'N/A') {
          found = res.data.find((d: any) => String(d.id) === txnId)
        }
        if (!found) {
          // Fallback: find the most recent withdrawal with matching amount
          const createdAt = new Date(transaction.timestamp).getTime()
          const candidates = res.data
            .filter((d: any) => Math.abs(Number(d.amount) - transaction.amount) < 0.01)
            .filter((d: any) => {
              const dt = new Date(d.createdAt).getTime()
              // Within 5 minutes of the receipt creation time
              return Math.abs(dt - createdAt) < 5 * 60 * 1000
            })
            .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          found = candidates[0] || null
        }
        if (found) {
          const rawStatus = String(found.status || '').toLowerCase()
          const successSet = new Set(['approved', 'success', 'successful', 'settled', 'completed', '1', 'approved_by_admin'])
          const failedSet = new Set(['failed', 'rejected', 'declined', 'cancelled', 'canceled', 'error', '2', '3'])
          const processingSet = new Set(['processing', 'in_progress'])

          let newStatus: 'success' | 'pending' | 'processing' | 'failed' = 'pending'
          if (successSet.has(rawStatus)) newStatus = 'success'
          else if (failedSet.has(rawStatus)) newStatus = 'failed'
          else if (processingSet.has(rawStatus)) newStatus = 'processing'

          if ((newStatus === 'success' || newStatus === 'failed') && (currentStatus === 'pending' || currentStatus === 'processing')) {
            setCurrentStatus(newStatus)
            if (newStatus === 'success') setShowConfetti(true)
            onStatusChange?.(newStatus)

            // Auto-close modal shortly after admin approval/rejection
            setTimeout(() => {
              onClose()
            }, 1500)
          }
        }
      }
    } catch (err) {
      console.error('Failed to check withdrawal status:', err)
    }
  }, [currentStatus, transaction.id, onStatusChange, onClose])

  useEffect(() => {
    if (currentStatus === 'pending' || currentStatus === 'processing') {
      const initialTimeout = setTimeout(checkStatus, 2000)
      pollIntervalRef.current = setInterval(checkStatus, 5000)

      return () => {
        clearTimeout(initialTimeout)
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
        }
      }
    }
  }, [currentStatus, checkStatus])

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const statusConfig = {
    success: {
      icon: CheckCircle2,
      color: 'emerald',
      title: 'Withdrawal Successful!',
      message: 'Your withdrawal has been processed successfully.',
    },
    pending: {
      icon: Clock,
      color: 'primary',
      title: 'Withdrawal Pending',
      message: 'Your withdrawal request is being reviewed. Please wait.',
    },
    processing: {
      icon: Loader2,
      color: 'blue',
      title: 'Processing Withdrawal',
      message: 'Your withdrawal is being processed. This usually takes 1-2 hours.',
    },
    failed: {
      icon: X,
      color: 'red',
      title: 'Withdrawal Failed',
      message: 'Your withdrawal could not be processed. Please try again.',
    },
  }

  const config = statusConfig[currentStatus]
  const Icon = config.icon

  return (
    <ModalSurface open onClose={onClose} title="Withdrawal Receipt" size="md" className="nova-withdrawal-receipt-modal wd-modal">
      {showConfetti && <ConfettiBurst />}

      <div className="nova-modal-body nova-receipt-body wd-receipt">
        <div className="wd-receipt-hero">
          <div className={`wd-receipt-icon is-${currentStatus}`}>
            <Icon className="h-10 w-10" />
          </div>
          <h2 className="wd-receipt-title">
            {config.title}
          </h2>
          <p className="wd-receipt-msg">
            {config.message}
          </p>
        </div>

        <div className="nova-modal-summary">
          <p>Amount Withdrawn</p>
          <p>
            {formatAmount(transaction.amount)}
          </p>
        </div>

        <div className="nova-modal-details">
          <div className="nova-modal-detail-grid">
            <div className="flex items-center justify-between">
              <span>Transaction ID</span>
              <div className="flex items-center gap-2">
                <span className="font-mono">
                  {transaction.id}
                </span>
                <button
                  type="button"
                  aria-label={copied ? 'Transaction ID copied' : 'Copy transaction ID'}
                  onClick={() => copyToClipboard(transaction.id)}
                  className={`wd-copy${copied ? ' is-copied' : ''}`}
                >
                  {copied ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span>Payment Method</span>
              <span>
                {transaction.method}
              </span>
            </div>

            {transaction.account && (
              <div className="flex items-center justify-between">
                <span>Account</span>
                <span className="font-mono">
                  {transaction.account}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span>Date & Time</span>
              <span>
                {new Date(transaction.timestamp).toLocaleString(getDefaultLocale(), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
            </div>

            {(currentStatus === 'pending' || currentStatus === 'processing') && transaction.expectedSettlement && (
              <div className="flex items-center justify-between">
                <span>Expected By</span>
                <span>
                  {transaction.expectedSettlement}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="nova-modal-actions">
          <button
            type="button"
            onClick={onClose}
            className="nova-button nova-button-secondary"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => { onClose(); navigate('/') }}
            className="nova-button"
          >
            <Home className="h-4 w-4" />
            Go Home
          </button>
        </div>

        {currentStatus === 'pending' && (
          <div className="wd-notice is-warn">
            <Clock className="h-4 w-4" />
            <p>
              Your withdrawal request is being reviewed. It typically takes 1-2 hours. You'll receive a notification once it's processed.
            </p>
          </div>
        )}

        {currentStatus === 'processing' && (
          <div className="wd-notice is-info">
            <Loader2 className="h-4 w-4" />
            <p>
              Your withdrawal is being processed. Funds will be credited to your account within 1-2 hours.
            </p>
          </div>
        )}

        {currentStatus === 'failed' && (
          <div className="wd-notice is-error">
            <X className="h-4 w-4" />
            <p>
              If you believe this is an error, please contact support with this transaction ID for assistance.
            </p>
          </div>
        )}
      </div>
    </ModalSurface>
  )
}

