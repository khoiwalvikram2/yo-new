import { CheckCircle2, Clock, Coins, Copy, Download, Gift, Home, X, RefreshCw, Receipt, Calendar, CreditCard, Hash, Timer } from 'lucide-react'
import { formatAmount, getDefaultLocale } from '@/lib/currency'
import { useState, useRef, useEffect, useCallback } from 'react'
import ConfettiBurst from '@/components/animations/ConfettiBurst'
import html2canvas from 'html2canvas'
import { getAdminDepositRequests } from '@/lib/api/user'
import { CRYPTO_COIN, cryptoNetworkLabel, formatUsdt } from '@/lib/cryptoDeposit'
import ModalSurface from '../modals/ModalSurface'

// The downloadable receipt is built as an HTML string: a pasted reference must stay text.
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

interface TransactionReceiptProps {
  transaction: {
    id: string
    amount: number
    status: 'success' | 'pending' | 'failed'
    method: string
    /** The UTR / reference; for a crypto deposit, the transaction hash */
    reference?: string
    timestamp: string
    expectedSettlement?: string
    /** Crypto deposits only, as the server quoted them: the USDT to receive, its network and the bonus paid on approval */
    cryptoAmount?: number | null
    cryptoNetwork?: string | null
    cryptoBonusAmount?: number | null
  }
  onClose: () => void
  onGoHome?: () => void
  onStatusChange?: (newStatus: 'success' | 'pending' | 'failed') => void
}

export function TransactionReceipt({ transaction, onClose, onGoHome, onStatusChange }: TransactionReceiptProps) {
  const [copied, setCopied] = useState(false)
  const [currentStatus, setCurrentStatus] = useState(transaction.status)
  const [showConfetti, setShowConfetti] = useState(transaction.status === 'success')
  const [isDownloading, setIsDownloading] = useState(false)
  const [isPolling, setIsPolling] = useState(false)
  const receiptRef = useRef<HTMLDivElement>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const cryptoAmount = transaction.cryptoAmount != null && Number.isFinite(Number(transaction.cryptoAmount)) ? Number(transaction.cryptoAmount) : null
  const isCrypto = cryptoAmount !== null
  const cryptoNetwork = isCrypto ? cryptoNetworkLabel(transaction.cryptoNetwork) : ''
  const cryptoBonus = isCrypto && Number(transaction.cryptoBonusAmount) > 0 ? Number(transaction.cryptoBonusAmount) : null
  const referenceLabel = isCrypto ? 'Transaction Hash' : 'Reference'

  // Poll for status updates when pending
  const checkStatus = useCallback(async () => {
    if (currentStatus !== 'pending') return
    
    setIsPolling(true)
    try {
      const today = new Date()
      const start = new Date()
      start.setDate(today.getDate() - 1)
      
      const res = await getAdminDepositRequests({
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
          // Fallback: find the most recent deposit with matching amount
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
          let newStatus: 'success' | 'pending' | 'failed' = 'pending'
          
          if (['approved', 'success', 'successful', 'settled', 'completed'].includes(rawStatus)) {
            newStatus = 'success'
          } else if (['failed', 'rejected', 'declined', 'cancelled', 'canceled'].includes(rawStatus)) {
            newStatus = 'failed'
          }
          
          if (newStatus !== 'pending' && currentStatus === 'pending') {
            setCurrentStatus(newStatus)
            if (newStatus === 'success') {
              setShowConfetti(true)
            }
            onStatusChange?.(newStatus)
            
            // Auto-close modal shortly after admin approval/rejection
            setTimeout(() => {
              onClose()
            }, 1500)
          }
        }
      }
    } catch (err) {
      console.error('Failed to check deposit status:', err)
    } finally {
      setIsPolling(false)
    }
  }, [currentStatus, transaction.id, onStatusChange, onClose])

  useEffect(() => {
    if (currentStatus === 'pending') {
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

  const downloadReceipt = async () => {
    if (isDownloading) return
    
    setIsDownloading(true)
    try {
      // Create a styled receipt element for download
      const receiptHtml = createDownloadableReceipt()
      
      // Create a temporary container
      const container = document.createElement('div')
      container.innerHTML = receiptHtml
      container.style.position = 'absolute'
      container.style.left = '-9999px'
      container.style.top = '0'
      document.body.appendChild(container)
      
      const receiptElement = container.firstElementChild as HTMLElement
      
      const canvas = await html2canvas(receiptElement, {
        backgroundColor: '#0f172a',
        scale: 2,
        useCORS: true,
        logging: false,
        width: 400,
        height: receiptElement.offsetHeight,
      })
      
      // Clean up
      document.body.removeChild(container)
      
      const link = document.createElement('a')
      link.download = `deposit-receipt-${transaction.id || 'NA'}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch (error) {
      console.error('Failed to download receipt:', error)
    } finally {
      setIsDownloading(false)
    }
  }

  // Create a styled HTML receipt for download (uses whitelabel primary for pending)
  const createDownloadableReceipt = () => {
    const primary = typeof document !== 'undefined'
      ? (getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim() || '#3b82f6')
      : '#3b82f6'
    const statusColors = {
      success: { bg: '#10b981', text: '#10b981', light: '#d1fae5' },
      pending: { bg: primary, text: primary, light: `${primary}20` },
      failed: { bg: '#ef4444', text: '#ef4444', light: '#fee2e2' },
    }
    const colors = statusColors[currentStatus]
    const statusText = currentStatus === 'success' ? 'Completed' : currentStatus === 'pending' ? 'Processing' : 'Failed'
    
    const formattedDate = new Date(transaction.timestamp).toLocaleString(getDefaultLocale(), {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })

    return `
      <div style="width: 400px; background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%); border-radius: 5px; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, ${colors.bg} 0%, ${colors.bg}dd 100%); padding: 24px; text-align: center;">
          <div style="width: 56px; height: 56px; background: rgba(255,255,255,0.2); border-radius: 5px; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              ${currentStatus === 'success' 
                ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>'
                : currentStatus === 'pending'
                ? '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>'
                : '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>'
              }
            </svg>
          </div>
          <h2 style="color: white; font-size: 18px; font-weight: 700; margin: 0 0 4px 0;">
            ${currentStatus === 'success' ? 'Payment Successful' : currentStatus === 'pending' ? 'Processing Payment' : 'Payment Failed'}
          </h2>
          <p style="color: rgba(255,255,255,0.8); font-size: 12px; margin: 0;">
            ${currentStatus === 'success' ? 'Your deposit has been credited' : currentStatus === 'pending' ? 'Your deposit is being verified' : 'Unable to process deposit'}
          </p>
        </div>
        
        <!-- Amount -->
        <div style="padding: 24px; text-align: center; border-bottom: 1px solid #334155;">
          <p style="color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 4px 0;">Deposit Amount</p>
          <p style="color: ${colors.text}; font-size: 32px; font-weight: 700; margin: 0;">${formatAmount(transaction.amount)}</p>
        </div>
        
        <!-- Details -->
        <div style="padding: 20px;">
          <!-- Transaction ID -->
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #334155;">
            <span style="color: #94a3b8; font-size: 12px;">Transaction ID</span>
            <span style="color: white; font-size: 12px; font-family: monospace;">${escapeHtml(transaction.id || 'N/A')}</span>
          </div>

          <!-- Payment Method -->
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #334155;">
            <span style="color: #94a3b8; font-size: 12px;">Payment Method</span>
            <span style="color: white; font-size: 12px; font-weight: 500;">${escapeHtml(transaction.method)}</span>
          </div>

          ${cryptoAmount !== null ? `
          <!-- Crypto: the USDT the server quoted, its network and the bonus -->
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #334155;">
            <span style="color: #94a3b8; font-size: 12px;">${CRYPTO_COIN} Amount</span>
            <span style="color: white; font-size: 12px; font-weight: 500;">${escapeHtml(formatUsdt(cryptoAmount))}</span>
          </div>
          ${cryptoNetwork ? `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #334155;">
            <span style="color: #94a3b8; font-size: 12px;">Network</span>
            <span style="color: white; font-size: 12px; font-weight: 500;">${escapeHtml(cryptoNetwork)}</span>
          </div>
          ` : ''}
          ${cryptoBonus !== null ? `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #334155;">
            <span style="color: #94a3b8; font-size: 12px;">Crypto Bonus</span>
            <span style="color: #10b981; font-size: 12px; font-weight: 500;">+${escapeHtml(formatAmount(cryptoBonus))} on approval</span>
          </div>
          ` : ''}
          ` : ''}

          ${transaction.reference ? `
          <!-- Reference -->
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #334155;">
            <span style="color: #94a3b8; font-size: 12px; white-space: nowrap;">${referenceLabel}</span>
            <span style="color: white; font-size: 12px; font-family: monospace; word-break: break-all; text-align: right;">${escapeHtml(transaction.reference)}</span>
          </div>
          ` : ''}
          
          <!-- Date & Time -->
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #334155;">
            <span style="color: #94a3b8; font-size: 12px;">Date & Time</span>
            <span style="color: white; font-size: 12px;">${formattedDate}</span>
          </div>
          
          <!-- Status -->
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0;">
            <span style="color: #94a3b8; font-size: 12px;">Status</span>
            <span style="background: ${colors.bg}33; color: ${colors.text}; font-size: 11px; font-weight: 600; padding: 4px 12px; border-radius: 5px;">${statusText}</span>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="padding: 16px 20px 20px; text-align: center;">
          <div style="background: ${colors.bg}15; border: 1px solid ${colors.bg}30; border-radius: 5px; padding: 12px;">
            <p style="color: ${colors.text}; font-size: 11px; margin: 0; line-height: 1.5;">
              ${currentStatus === 'success' 
                ? 'Thank you for your deposit. Your funds are now available.'
                : currentStatus === 'pending'
                ? 'Please wait while we verify your payment. This usually takes 1-5 minutes.'
                : 'If money was deducted, it will be refunded within 5-7 business days.'}
            </p>
          </div>
        </div>
      </div>
    `
  }

  const statusConfig = {
    success: {
      icon: CheckCircle2,
      tone: 'is-success',
      title: 'Payment Successful',
      subtitle: 'Your deposit has been credited to your account',
      badgeText: 'Completed',
    },
    pending: {
      icon: Clock,
      tone: 'is-pending',
      title: 'Processing Payment',
      subtitle: 'Your deposit is being verified',
      badgeText: 'Processing',
    },
    failed: {
      icon: X,
      tone: 'is-failed',
      title: 'Payment Failed',
      subtitle: 'Unable to process your deposit',
      badgeText: 'Failed',
    },
  }

  const config = statusConfig[currentStatus]
  const Icon = config.icon

  return (
    <ModalSurface open onClose={onClose} title="Deposit Receipt" size="md" className="nova-transaction-receipt-modal dep-modal">
      {showConfetti && <ConfettiBurst />}

      {/* Main Modal Container - Scrollable */}
      <div className="nova-modal-body nova-receipt-body">
        <div className="nova-receipt-scroll">
          <div
            ref={receiptRef}
            className="nova-receipt-content"
          >
            <div className={`dep-receipt-bar ${config.tone}`} />
            <div className="dep-receipt-hero">
              <div className={`dep-status-tile ${config.tone}`}>
                <Icon />
              </div>
              <h2 className="dep-receipt-title">
                {config.title}
              </h2>
              <p className="dep-receipt-subtitle">
                {config.subtitle}
              </p>
            </div>

            <div className="nova-modal-summary dep-receipt-amount">
              <p className="dep-detail-kicker">
                Deposit Amount
              </p>
              <p className="dep-detail-amount">
                {formatAmount(transaction.amount)}
              </p>
            </div>

            <div className="nova-modal-details nova-receipt-details dep-receipt-rows">
              <div className="dep-receipt-row">
                <div className="dep-receipt-icon">
                  <Hash />
                </div>
                <div className="dep-receipt-text">
                  <p className="dep-receipt-label">Transaction ID</p>
                  <p className="dep-receipt-value is-mono">
                    {transaction.id || 'N/A'}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={copied ? 'Transaction ID copied' : 'Copy transaction ID'}
                  onClick={() => copyToClipboard(transaction.id)}
                  className={`dep-copy-icon${copied ? ' is-copied' : ''}`}
                >
                  {copied ? (
                    <CheckCircle2 />
                  ) : (
                    <Copy />
                  )}
                </button>
              </div>

              <div className="dep-receipt-row">
                <div className="dep-receipt-icon">
                  <CreditCard />
                </div>
                <div className="dep-receipt-text">
                  <p className="dep-receipt-label">Payment Method</p>
                  <p className="dep-receipt-value">
                    {transaction.method}
                  </p>
                </div>
              </div>

              {/* Crypto: the USDT the server quoted (not the page's preview), its network and the bonus */}
              {cryptoAmount !== null && (
                <div className="dep-receipt-row">
                  <div className="dep-receipt-icon">
                    <Coins />
                  </div>
                  <div className="dep-receipt-text">
                    <p className="dep-receipt-label">{CRYPTO_COIN} Amount</p>
                    <p className="dep-receipt-value">
                      {formatUsdt(cryptoAmount)}{cryptoNetwork ? ` · ${cryptoNetwork}` : ''}
                    </p>
                  </div>
                </div>
              )}

              {cryptoBonus !== null && (
                <div className="dep-receipt-row">
                  <div className="dep-receipt-icon">
                    <Gift />
                  </div>
                  <div className="dep-receipt-text">
                    <p className="dep-receipt-label">Crypto Bonus</p>
                    <p className="dep-receipt-value is-bonus">
                      +{formatAmount(cryptoBonus)} on approval
                    </p>
                  </div>
                </div>
              )}

              {transaction.reference && (
                <div className="dep-receipt-row">
                  <div className="dep-receipt-icon">
                    <Receipt />
                  </div>
                  <div className="dep-receipt-text">
                    <p className="dep-receipt-label">{referenceLabel}</p>
                    <p className={`dep-receipt-value is-mono${isCrypto ? ' is-wrap' : ''}`}>
                      {transaction.reference}
                    </p>
                  </div>
                </div>
              )}

              <div className="dep-receipt-row">
                <div className="dep-receipt-icon">
                  <Calendar />
                </div>
                <div className="dep-receipt-text">
                  <p className="dep-receipt-label">Date & Time</p>
                  <p className="dep-receipt-value">
                    {new Date(transaction.timestamp).toLocaleString(getDefaultLocale(), {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </p>
                </div>
              </div>

              {/* Expected Settlement */}
              {currentStatus === 'pending' && transaction.expectedSettlement && (
                <div className="dep-receipt-row">
                  <div className="dep-receipt-icon is-pending">
                    <Timer />
                  </div>
                  <div className="dep-receipt-text">
                    <p className="dep-receipt-label">Expected Time</p>
                    <p className="dep-receipt-value is-pending">
                      {transaction.expectedSettlement}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="dep-receipt-status">
              <span>Status</span>
              <div>
                {currentStatus === 'pending' && isPolling && (
                  <RefreshCw className="animate-spin" />
                )}
                <span className={`nova-acct-chip ${config.tone}`}>
                  {config.badgeText}
                </span>
              </div>
            </div>

            <p className={`dep-receipt-note ${config.tone}`}>
              {currentStatus === 'success'
                ? 'Your funds have been added to your wallet. Start playing now!'
                : currentStatus === 'pending'
                ? 'Please wait while we verify your payment. This usually takes 1-5 minutes.'
                : 'If money was deducted, it will be refunded within 5-7 business days.'}
            </p>
          </div>
        </div>

      </div>
        <div className="nova-modal-footer">
          <div className="dep-receipt-actions">
            <button
              type="button"
              onClick={onClose}
              className="nova-button nova-button-secondary"
            >
              Close
            </button>
            {onGoHome && (
              <button
                type="button"
                onClick={onGoHome}
                className="nova-button"
              >
                <Home />
                <span>Go Home</span>
              </button>
            )}
            <button
              type="button"
              aria-label={isDownloading ? 'Generating receipt' : 'Download receipt'}
              onClick={downloadReceipt}
              disabled={isDownloading}
              className="nova-button nova-button-secondary dep-receipt-download"
            >
              {isDownloading ? (
                <div className="dep-modal-spinner animate-spin" />
              ) : (
                <Download />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => copyToClipboard(transaction.id)}
            className={`nova-button nova-button-secondary dep-receipt-copy${copied ? ' is-copied' : ''}`}
          >
            {copied ? (
              <>
                <CheckCircle2 />
                <span>Transaction ID Copied!</span>
              </>
            ) : (
              <>
                <Copy />
                <span>Copy Transaction ID</span>
              </>
            )}
          </button>
        </div>
    </ModalSurface>
  )
}
