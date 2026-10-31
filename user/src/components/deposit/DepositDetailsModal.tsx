import { Download, Copy, CheckCircle2 } from 'lucide-react'
import ModalSurface from '../modals/ModalSurface'
import { formatAmount } from '@/lib/currency'
import { useState, useRef } from 'react'
import html2canvas from 'html2canvas'
import { useAuth } from '@/lib/auth'
import { useLogo } from '@/hooks/useAppSettings'

interface DepositDetailsModalProps {
  deposit: any
  isOpen: boolean
  onClose: () => void
}

export function DepositDetailsModal({ deposit, isOpen, onClose }: DepositDetailsModalProps) {
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const slipRef = useRef<HTMLDivElement>(null)
  const { user } = useAuth()
  const { siteTitle } = useLogo()

  if (!isOpen || !deposit) return null

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Get deposit date
  const depositDate = (() => {
    const candidates = [
      deposit?.createdAt,
      deposit?.created_at,
      deposit?.createdDate,
      deposit?.date,
      deposit?.timestamp,
      deposit?.updatedAt,
    ]
    for (const v of candidates) {
      if (!v) continue
      const d = new Date(v)
      if (!Number.isNaN(d.getTime())) return d
    }
    return new Date()
  })()

  // Get status
  const status = (() => {
    const raw = String(
      deposit?.status ?? deposit?.txnStatus ?? deposit?.paymentStatus ?? deposit?.state ?? ''
    )
      .trim()
      .toLowerCase()
    const successSet = new Set(['approved', 'success', 'successful', 'settled', 'completed', 'done'])
    const pendingSet = new Set(['pending', 'inprogress', 'processing', 'initiated', 'created'])
    const failedSet = new Set(['failed', 'rejected', 'declined', 'cancelled', 'canceled', 'error'])
    
    if (successSet.has(raw) || raw === '1' || raw === 'approved_by_admin') return 'Success'
    if (pendingSet.has(raw) || raw === '' || raw === '0') return 'Pending'
    if (failedSet.has(raw) || raw === '2' || raw === '3') return 'Failed'
    return 'Pending'
  })()

  // Format date helper
  const formatDate = (date: Date) => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const day = date.getDate()
    const month = months[date.getMonth()]
    const year = date.getFullYear()
    const hours = date.getHours()
    const minutes = date.getMinutes()
    const ampm = hours >= 12 ? 'PM' : 'AM'
    const displayHours = hours % 12 || 12
    const displayMinutes = minutes.toString().padStart(2, '0')
    return `${day} ${month} ${year}, ${displayHours}:${displayMinutes} ${ampm}`
  }

  // Get theme colors from CSS variables
  const getThemeColors = () => {
    const root = document.documentElement
    const computedStyle = getComputedStyle(root)
    
    return {
      brandPrimary: computedStyle.getPropertyValue('--brand-primary').trim() || '#3b82f6',
      brandPrimaryDark: computedStyle.getPropertyValue('--brand-primary-dark').trim() || '#2563eb',
      surface: computedStyle.getPropertyValue('--surface').trim() || '#ffffff',
      text: computedStyle.getPropertyValue('--text').trim() || '#111827',
      subtle: computedStyle.getPropertyValue('--subtle').trim() || '#6b7280',
      border: computedStyle.getPropertyValue('--border').trim() || '#e5e7eb',
    }
  }

  // Download deposit slip as image
  const downloadSlip = async () => {
    if (!slipRef.current) {
      console.error('Slip ref not available')
      alert('Unable to generate slip. Please refresh the page and try again.')
      return
    }
    
    setDownloading(true)

    try {
      const element = slipRef.current

      // Store original styles
      const originalStyles = {
        position: element.style.position,
        left: element.style.left,
        top: element.style.top,
        opacity: element.style.opacity,
        visibility: element.style.visibility,
        zIndex: element.style.zIndex,
        transform: element.style.transform,
      }
      
      // Make element visible but keep it off-screen (not visible to user)
      element.style.position = 'fixed'
      element.style.left = '-9999px' // Keep off-screen
      element.style.top = '0px'
      element.style.opacity = '1'
      element.style.visibility = 'visible'
      element.style.zIndex = '-1' // Behind everything
      element.style.transform = 'translateZ(0)' // Force GPU acceleration
      
      // Force reflow
      void element.offsetHeight
      
      // Additional wait for rendering
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Capture with html2canvas (it can capture off-screen elements)
      const canvas = await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
        useCORS: true, // Enable CORS
        allowTaint: false, // Don't allow tainted canvas so toBlob() works
        foreignObjectRendering: false,
        windowWidth: 800,
        windowHeight: element.scrollHeight,
        x: 0,
        y: 0,
        scrollX: 0,
        scrollY: 0,
        imageTimeout: 0,
        proxy: undefined,
        onclone: (clonedDoc) => {
          // Remove images with CORS issues to prevent tainting
          const clonedImages = clonedDoc.querySelectorAll('img')
          clonedImages.forEach((img) => {
            if (img.src) {
              const isExternal = img.src.startsWith('http') && !img.src.startsWith(window.location.origin)
              if (isExternal) {
                // Replace with placeholder or remove
                img.style.display = 'none'
              }
            }
          })
        },
      })

      // Restore original styles immediately
      Object.assign(element.style, originalStyles)
      
      // Check if canvas is valid
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        throw new Error('Canvas is empty or invalid')
      }
      
      // Convert to blob and download
      let blobCallbackCalled = false
      const blobTimeout = setTimeout(() => {
        if (!blobCallbackCalled) {
          console.error('canvas.toBlob() callback timeout')
          setDownloading(false)
          alert('Slip generation timed out. Please try again.')
        }
      }, 10000) // 10 second timeout
      
      canvas.toBlob(
        (blob) => {
          blobCallbackCalled = true
          clearTimeout(blobTimeout)
          
          try {
            if (!blob) {
              console.error('Blob generation failed - blob is null')
              throw new Error('Failed to generate image blob')
            }
            
            const url = URL.createObjectURL(blob)
            const dateForFilename = `${depositDate.getFullYear()}${String(depositDate.getMonth() + 1).padStart(2, '0')}${String(depositDate.getDate()).padStart(2, '0')}`
            const filename = `deposit-slip-${deposit?.id || deposit?._id || 'receipt'}-${dateForFilename}.png`

            const link = document.createElement('a')
            link.href = url
            link.download = filename
            link.style.display = 'none'
            document.body.appendChild(link)
            link.click()

            // Cleanup
            setTimeout(() => {
              document.body.removeChild(link)
              URL.revokeObjectURL(url)
            }, 100)
            
            setDownloading(false)
          } catch (blobError) {
            console.error('Error in blob callback:', blobError)
            setDownloading(false)
            alert('Failed to generate slip. Please try again or contact support if the problem persists.')
          }
        },
        'image/png',
        1.0
      )
      
    } catch (error) {
      console.error('Error generating slip:', error)
      alert('Failed to generate slip. Please try again or contact support if the problem persists.')
      setDownloading(false)
    }
  }

  const dateStr = formatDate(depositDate)
  const generatedDateStr = formatDate(new Date())
  const paymentMethod = String(deposit?.method ?? '').trim()
    || String(deposit?.paymentMethod ?? '').trim()
    || (deposit?.type === 'upi' ? 'UPI' : deposit?.type === 'bank' ? 'Bank Transfer' : deposit?.type === 'wallet' ? 'Wallet' : 'N/A')

  // Get theme colors for slip
  const themeColors = getThemeColors()
  const isDark = themeColors.surface === '#1a1a1a' || themeColors.surface.startsWith('rgb(26')

  return (
    <>
      {/* Hidden slip template for image generation */}
      <div 
        ref={slipRef}
        style={{ 
          fontFamily: 'system-ui, -apple-system, sans-serif',
          position: 'fixed',
          left: '-9999px',
          top: '0px',
          opacity: '0',
          visibility: 'hidden',
          pointerEvents: 'none',
          zIndex: '-1',
          width: '800px',
          background: isDark 
            ? 'linear-gradient(135deg, #1e293b 0%, #0f172a 50%, #1e1b4b 100%)'
            : 'linear-gradient(135deg, #f8fafc 0%, #ffffff 50%, #eff6ff 100%)',
          padding: '48px',
        }}
      >
        {/* Header with Logo, User Info, and Title */}
        <div style={{ marginBottom: '32px', paddingBottom: '24px', borderBottom: `4px solid ${themeColors.brandPrimary}` }}>
          {/* Site Title */}
          {siteTitle && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px' }}>
              <h2 style={{ 
                fontSize: '32px', 
                fontWeight: 'bold',
                color: themeColors.brandPrimary,
                margin: 0,
                textAlign: 'center',
                letterSpacing: '1px',
                textTransform: 'uppercase'
              }}>
                {siteTitle}
              </h2>
            </div>
          )}
          
          {/* User Information */}
          {(user?.username || user?.phone) && (
            <div style={{ 
              marginBottom: '24px', 
              padding: '16px', 
              background: isDark ? '#1e293b' : '#f8fafc', 
              borderRadius: '5px',
              border: `1px solid ${isDark ? '#334155' : '#e5e7eb'}`
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {user?.username && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', color: themeColors.subtle, fontWeight: '500' }}>Name:</span>
                    <span style={{ fontSize: '16px', color: isDark ? '#f3f4f6' : '#111827', fontWeight: '600' }}>
                      {user.username}
                    </span>
                  </div>
                )}
                {user?.phone && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', color: themeColors.subtle, fontWeight: '500' }}>Phone:</span>
                    <span style={{ fontSize: '16px', color: isDark ? '#f3f4f6' : '#111827', fontWeight: '600', fontFamily: 'monospace' }}>
                      {user.phone}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Receipt Title */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{ fontSize: '36px', fontWeight: 'bold', color: themeColors.brandPrimary, marginBottom: '8px' }}>
                DEPOSIT RECEIPT
              </h1>
              <p style={{ fontSize: '14px', color: themeColors.subtle }}>Transaction Confirmation</p>
            </div>
            <div style={{ 
              width: '80px', 
              height: '80px', 
              borderRadius: '5px', 
              background: `linear-gradient(135deg, ${themeColors.brandPrimary} 0%, ${themeColors.brandPrimaryDark} 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 10px 25px ${themeColors.brandPrimary}40`
            }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
            </div>
          </div>
        </div>

        {/* Amount Section */}
        <div style={{ 
          marginBottom: '32px', 
          padding: '32px', 
          borderRadius: '5px', 
          background: `linear-gradient(135deg, ${themeColors.brandPrimary} 0%, ${themeColors.brandPrimaryDark} 50%, #6366f1 100%)`,
          color: 'white',
          boxShadow: `0 20px 40px ${themeColors.brandPrimary}40`
        }}>
          <p style={{ fontSize: '14px', fontWeight: '500', opacity: '0.9', marginBottom: '8px' }}>Deposit Amount</p>
          <p style={{ fontSize: '48px', fontWeight: 'bold', marginBottom: '16px' }}>{formatAmount(Number(deposit?.amount || 0))}</p>
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.2)' }}>
            <span style={{ 
              display: 'inline-flex', 
              alignItems: 'center', 
              padding: '8px 16px', 
              borderRadius: '5px', 
              fontSize: '14px', 
              fontWeight: '600',
              background: status === 'Success' ? '#22c55e' : status === 'Failed' ? '#ef4444' : themeColors.brandPrimary,
              color: 'white'
            }}>
              {status}
            </span>
          </div>
        </div>

        {/* Transaction Details */}
        <div style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: isDark ? '#f3f4f6' : '#1f2937', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '4px', height: '24px', background: themeColors.brandPrimary, borderRadius: '5px' }}></div>
            Transaction Information
          </h2>
          <div style={{ background: isDark ? '#1e293b' : 'white', borderRadius: '5px', padding: '24px', boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)', border: `1px solid ${isDark ? '#334155' : '#e5e7eb'}` }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', paddingBottom: '12px', borderBottom: `1px solid ${isDark ? '#334155' : '#f3f4f6'}` }}>
                <span style={{ color: themeColors.subtle, fontWeight: '500' }}>Transaction ID</span>
                <span style={{ color: isDark ? '#f3f4f6' : '#111827', fontFamily: 'monospace', fontWeight: '600', fontSize: '18px' }}>
                  {deposit?.id || deposit?._id || 'N/A'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', paddingBottom: '12px', borderBottom: `1px solid ${isDark ? '#334155' : '#f3f4f6'}` }}>
                <span style={{ color: themeColors.subtle, fontWeight: '500' }}>Date & Time</span>
                <span style={{ color: isDark ? '#f3f4f6' : '#111827', fontWeight: '600' }}>{dateStr}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', paddingBottom: '12px' }}>
                <span style={{ color: themeColors.subtle, fontWeight: '500' }}>Payment Method</span>
                <span style={{ color: isDark ? '#f3f4f6' : '#111827', fontWeight: '600' }}>
                  {paymentMethod}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Payment Details */}
        {(deposit?.transactionId || deposit?.referenceId || deposit?.paymentId || deposit?.upiTransactionId) && (
          <div style={{ marginBottom: '24px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: isDark ? '#f3f4f6' : '#1f2937', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '4px', height: '24px', background: '#6366f1', borderRadius: '5px' }}></div>
              Payment Details
            </h2>
            <div style={{ background: isDark ? '#1e293b' : 'white', borderRadius: '5px', padding: '24px', boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)', border: `1px solid ${isDark ? '#334155' : '#e5e7eb'}` }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {deposit?.transactionId && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', paddingBottom: '12px', borderBottom: `1px solid ${isDark ? '#334155' : '#f3f4f6'}` }}>
                    <span style={{ color: themeColors.subtle, fontWeight: '500' }}>Transaction ID</span>
                    <span style={{ color: isDark ? '#f3f4f6' : '#111827', fontFamily: 'monospace', fontWeight: '600' }}>{deposit.transactionId}</span>
                  </div>
                )}
                {deposit?.referenceId && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', paddingBottom: '12px', borderBottom: `1px solid ${isDark ? '#334155' : '#f3f4f6'}` }}>
                    <span style={{ color: themeColors.subtle, fontWeight: '500' }}>Reference ID</span>
                    <span style={{ color: isDark ? '#f3f4f6' : '#111827', fontFamily: 'monospace', fontWeight: '600' }}>{deposit.referenceId}</span>
                  </div>
                )}
                {deposit?.paymentId && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', paddingBottom: '12px', borderBottom: `1px solid ${isDark ? '#334155' : '#f3f4f6'}` }}>
                    <span style={{ color: themeColors.subtle, fontWeight: '500' }}>Payment ID</span>
                    <span style={{ color: isDark ? '#f3f4f6' : '#111827', fontFamily: 'monospace', fontWeight: '600' }}>{deposit.paymentId}</span>
                  </div>
                )}
                {deposit?.upiTransactionId && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', paddingBottom: '12px' }}>
                    <span style={{ color: themeColors.subtle, fontWeight: '500' }}>UPI Transaction ID</span>
                    <span style={{ color: isDark ? '#f3f4f6' : '#111827', fontFamily: 'monospace', fontWeight: '600' }}>{deposit.upiTransactionId}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: `2px solid ${isDark ? '#334155' : '#e5e7eb'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '14px', color: themeColors.subtle }}>
            <div>
              <p style={{ fontWeight: '600', color: isDark ? '#d1d5db' : '#374151', marginBottom: '4px' }}>This is a computer-generated receipt</p>
              <p>Generated on: {generatedDateStr}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontWeight: '600', color: isDark ? '#d1d5db' : '#374151' }}>Thank you for using our service</p>
            </div>
          </div>
        </div>
      </div>

      {/* Modal */}
      <ModalSurface open={isOpen} onClose={onClose} title="Deposit Details" description={`Transaction ID: ${deposit?.id || deposit?._id || 'N/A'}`} size="lg" className="nova-payment-details-modal nova-deposit-details-modal dep-modal">

          {/* Content */}
          <div className="nova-modal-body dep-detail-body">
            {/* Amount Card */}
            <div className="nova-modal-summary">
              <p className="dep-detail-kicker">Deposit Amount</p>
              <p className="dep-detail-amount">
                {formatAmount(Number(deposit?.amount || 0))}
              </p>
            </div>

            {/* Transaction Details */}
            <div className="dep-detail-section">
              <h3>Transaction Information</h3>

              <div className="dep-detail-grid">
                {/* Transaction ID */}
                <div className="dep-detail-row">
                  <span className="dep-detail-label">Transaction ID</span>
                  <div className="dep-detail-value">
                    <span className="is-mono">
                      {deposit?.id || deposit?._id || 'N/A'}
                    </span>
                    <button
                      type="button"
                      aria-label={copied ? 'Transaction ID copied' : 'Copy transaction ID'}
                      onClick={() => copyToClipboard(String(deposit?.id || deposit?._id || ''))}
                      className={`dep-copy-icon${copied ? ' is-copied' : ''}`}
                    >
                      {copied ? (
                        <CheckCircle2 />
                      ) : (
                        <Copy />
                      )}
                    </button>
                  </div>
                </div>

                {/* Date & Time */}
                <div className="dep-detail-row">
                  <span className="dep-detail-label">Date & Time</span>
                  <span className="dep-detail-value">
                    {formatDate(depositDate)}
                  </span>
                </div>

                {/* Status */}
                <div className="dep-detail-row">
                  <span className="dep-detail-label">Status</span>
                  <span className={`nova-acct-chip ${
                    status === 'Success'
                      ? 'is-success'
                      : status === 'Failed'
                      ? 'is-failed'
                      : 'is-pending'
                  }`}>
                    {status}
                  </span>
                </div>

                {/* Payment Method */}
                <div className="dep-detail-row">
                  <span className="dep-detail-label">Payment Method</span>
                  <span className="dep-detail-value">
                    {paymentMethod}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment Details */}
            {(deposit?.transactionId || deposit?.referenceId || deposit?.paymentId || deposit?.upiTransactionId) && (
              <div className="dep-detail-section">
                <h3>Payment Details</h3>

                <div className="dep-detail-grid">
                  {deposit?.transactionId && (
                    <div className="dep-detail-row">
                      <span className="dep-detail-label">Transaction ID</span>
                      <span className="dep-detail-value is-mono">
                        {deposit.transactionId}
                      </span>
                    </div>
                  )}

                  {deposit?.referenceId && (
                    <div className="dep-detail-row">
                      <span className="dep-detail-label">Reference ID</span>
                      <span className="dep-detail-value is-mono">
                        {deposit.referenceId}
                      </span>
                    </div>
                  )}

                  {deposit?.paymentId && (
                    <div className="dep-detail-row">
                      <span className="dep-detail-label">Payment ID</span>
                      <span className="dep-detail-value is-mono">
                        {deposit.paymentId}
                      </span>
                    </div>
                  )}

                  {deposit?.upiTransactionId && (
                    <div className="dep-detail-row">
                      <span className="dep-detail-label">UPI Transaction ID</span>
                      <span className="dep-detail-value is-mono">
                        {deposit.upiTransactionId}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="nova-modal-footer nova-modal-actions">
          <button
            type="button"
            onClick={downloadSlip}
            disabled={downloading}
            className="nova-button dep-detail-primary"
          >
            {downloading ? (
              <>
                <div className="dep-modal-spinner animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download />
                Download Slip
              </>
            )}
          </button>
            <button
              type="button"
              onClick={onClose}
              className="nova-button nova-button-secondary"
            >
              Close
            </button>
          </div>
      </ModalSurface>
    </>
  )
}
