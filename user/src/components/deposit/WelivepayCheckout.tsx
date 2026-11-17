import { useEffect, useId, useRef, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { getWelivepayDepositStatus, type WelivepayCheckout as Checkout } from '@/lib/api/user'
import { formatAmount } from '@/lib/currency'
import { checkoutLink, checkoutQrSrc, normalizeCheckoutStatus, type CheckoutStatus } from '@/lib/welivepayCheckout'

/** How often a visible page asks for the status. The server asks the gateway at most once a minute per order. */
const POLL_MS = 12_000
const STATUS_ERROR = 'Payment confirmation is temporarily unavailable. Check again shortly.'
const LATE_PAYMENT = 'Start a new checkout if you have not paid. Any confirmed late payment will still be credited.'

const STATES: Record<CheckoutStatus, { title: string; text: string; tone: string }> = {
  pending: { title: 'Complete your payment', text: 'Your balance updates after the payment gateway confirms your payment.', tone: '' },
  success: { title: 'Payment confirmed', text: 'Your deposit has been credited to your wallet.', tone: ' is-success' },
  expired: { title: 'Payment checkout expired', text: LATE_PAYMENT, tone: ' is-failed' },
  // The gateway refused the order; the server still credits it if a payment is confirmed later
  invalid: { title: 'Payment not completed', text: LATE_PAYMENT, tone: ' is-failed' },
}

interface WelivepayCheckoutProps {
  checkout: Checkout
  /** Called once, when the gateway confirms the payment: refresh the balance and the history. */
  onPaid: () => void
  /** Close the card (the page also forgets the saved checkout). */
  onDismiss: () => void
  /** Move focus to the card when it appears for a checkout just started, which also scrolls it into view. */
  focusOnMount?: boolean
}

/**
 * An open WeLivePay checkout on the Deposit page: the amount and reference, a link to the gateway's
 * checkout (a new tab) and its QR while unpaid, and the status, checked at once, every 12 s while the
 * page is visible, when the window regains focus and on request.
 */
export function WelivepayCheckout({ checkout, onPaid, onDismiss, focusOnMount = false }: WelivepayCheckoutProps) {
  const [status, setStatus] = useState<CheckoutStatus>('pending')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const paidRef = useRef(onPaid)
  paidRef.current = onPaid
  const checkRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus()
  }, [focusOnMount])

  useEffect(() => {
    let stopped = false
    let inFlight = false
    let paid = false
    let timer: ReturnType<typeof setInterval> | undefined
    setStatus('pending')
    setError(null)
    const check = async (asked: boolean) => {
      if (stopped || inFlight || paid) return
      // Only a visible page polls; a check the player asks for always runs
      if (!asked && document.visibilityState === 'hidden') return
      inFlight = true
      setChecking(true)
      try {
        const result = await getWelivepayDepositStatus(checkout.orderId)
        if (stopped) return
        const next = normalizeCheckoutStatus(result?.status)
        setStatus(next)
        setError(null)
        if (next === 'success') {
          paid = true
          clearInterval(timer)
          paidRef.current()
        }
      } catch {
        // The card stays: the order is still open, only its status could not be read
        if (!stopped) setError(STATUS_ERROR)
      } finally {
        inFlight = false
        if (!stopped) setChecking(false)
      }
    }
    checkRef.current = () => { void check(true) }
    timer = setInterval(() => { void check(false) }, POLL_MS)
    const onFocus = () => { void check(false) }
    window.addEventListener('focus', onFocus)
    void check(true)
    return () => {
      stopped = true
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [checkout.orderId])

  const state = STATES[status]
  const link = checkoutLink(checkout)
  const qr = checkoutQrSrc(checkout.qrImage)
  // Closing never loses money: the server credits a paid order either way. A card whose status cannot
  // be read may be closed too, so it can never block a new checkout for good.
  const canClose = status !== 'pending' || error !== null

  return (
    <section className="dep-checkout nova-acct-panel" aria-labelledby={headingId}>
      <div className="nova-acct-panel-head dep-checkout-head">
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>{state.title}</h2>
        <strong className="dep-checkout-amount">{formatAmount(checkout.amount)}</strong>
      </div>
      <div className="dep-checkout-body">
        <div role="status">
          <p className={`dep-checkout-text${state.tone}`}>{state.text}</p>
          {error && <p className="dep-checkout-error">{error}</p>}
        </div>
        <p className="dep-checkout-ref">Reference: <span className="is-mono">{checkout.orderId}</span></p>
        {status === 'pending' && (link || qr) && (
          <div className="dep-checkout-pay">
            {link && (
              <a className="dep-btn dep-btn-primary dep-checkout-link" href={link} target="_blank" rel="noopener noreferrer">
                Open secure checkout <ExternalLink aria-hidden="true" />
              </a>
            )}
            {/* White in both themes: a QR code only scans dark-on-light */}
            {qr && <img className="dep-checkout-qr" src={qr} alt="Payment QR" />}
          </div>
        )}
        <div className="dep-checkout-actions">
          {status !== 'success' && (
            <button type="button" className="dep-checkout-action" onClick={() => checkRef.current()} disabled={checking}>
              <RefreshCw className={checking ? 'animate-spin' : undefined} aria-hidden="true" /> Check payment status
            </button>
          )}
          {canClose && (
            <button type="button" className="dep-checkout-action" onClick={onDismiss}>Close</button>
          )}
        </div>
      </div>
    </section>
  )
}
