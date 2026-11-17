import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useBetSlip } from '../sports/BetSlipProvider'
import { useAuth } from '@/lib/auth'
import DesktopBetSlipSidebar from './DesktopBetSlipSidebar'
import { useRailLayout } from './useRailLayout'
import type { EventDetails } from './types'

/**
 * The event page's bet slip on screens with the rail (801px and up): a rail drawer (nova-rail-panel gives it
 * the place, size, header and slide of "Your account") that opens when a price is picked and closes with the
 * slip — Cancel, Esc, the close button, a placed bet, or a click outside the drawer and the price grid.
 * Phones keep the bottom sheet (MobileBetSlipRenderer).
 */
export default function BetSlipDrawer({ event }: { event: EventDetails }) {
  const { quickBet, closeQuickBet } = useBetSlip()
  const { isAuthenticated } = useAuth()
  const rail = useRailLayout()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const open = Boolean(quickBet) && rail && isAuthenticated

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.show?.()
    if (!open && dialog.open) dialog.close?.()
  }, [open])

  // Non-modal: a click outside closes the slip, except on the prices (picking another price switches the slip).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target || dialogRef.current?.contains(target) || target.closest('.nova-ev-markets, .nova-toast, [data-sonner-toaster]')) return
      closeQuickBet()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, closeQuickBet])

  if (!rail || !isAuthenticated) return null
  const title = [event.homeTeam?.name, event.awayTeam?.name].filter(Boolean).join(' v ')
  return createPortal(
    <dialog ref={dialogRef} className="nova-panel nova-rail-panel nova-betslip-panel" data-ui-radius="square" aria-label="Bet slip"
      onCancel={dialogEvent => { dialogEvent.preventDefault(); closeQuickBet() }}>
      <div className="nova-panel-content">
        <header>
          <div>
            {title && <span className="nova-eyebrow">{title}</span>}
            <h2>Bet slip</h2>
          </div>
          <button type="button" className="nova-icon-button" aria-label="Close bet slip" onClick={closeQuickBet}><X size={20} /></button>
        </header>
        <DesktopBetSlipSidebar event={event} />
      </div>
    </dialog>,
    document.querySelector('.nova-shell-matchbook') ?? document.body,
  )
}
