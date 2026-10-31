import { AlertTriangle, ArrowRightLeft, Gift, RefreshCw } from 'lucide-react'
import ModalSurface from '../modals/ModalSurface'
import { formatAmount } from '@/lib/currency'
import type { CurrencyCode } from '@/types'
// Matchbook modal styles (.bon-modal); the modal renders in a portal, outside the page's .nova-acct scope.
import '@/styles/account/bonus.css'

type BonusInfo = {
  id: string
  name: string
  amount: number
  currency?: string
  wagered?: number
  rollingX?: number
}

type SwitchBonusModalProps = {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  currentBonus: BonusInfo | null
  newBonus: BonusInfo | null
  isLoading?: boolean
}

export function SwitchBonusModal({
  isOpen,
  onClose,
  onConfirm,
  currentBonus,
  newBonus,
  isLoading = false,
}: SwitchBonusModalProps) {
  if (!isOpen) return null

  return (
    <ModalSurface open={isOpen} onClose={onClose} title="Switch Bonus" size="md" dismissible={!isLoading} className="nova-switch-bonus-modal bon-modal">

        {/* Content */}
        <div className="nova-modal-body bon-switch">
          {/* Warning */}
          <div className="nova-modal-notice bon-switch-warn">
            <AlertTriangle aria-hidden="true" />
            <div>
              <p className="bon-switch-warn-title">Warning</p>
              <p>
                Switching bonuses will cancel your current active bonus and remove its balance from your bonus wallet.
              </p>
            </div>
          </div>

          {/* Current Bonus */}
          {currentBonus && (
            <div className="nova-modal-summary bon-switch-card is-current">
              <div className="bon-switch-kicker">
                <Gift aria-hidden="true" />
                <span>Current Active Bonus (will be cancelled)</span>
              </div>
              <p className="bon-switch-name">{currentBonus.name}</p>
              <p className="bon-switch-amount">
                {formatAmount(currentBonus.amount, currentBonus.currency as CurrencyCode)}
                <span>will be removed</span>
              </p>
              {currentBonus.rollingX != null && currentBonus.rollingX > 0 && (
                <div className="bon-switch-meta">
                  <span>Wagering Progress:</span>
                  <span>
                    {(currentBonus.wagered || 0).toLocaleString()} / {currentBonus.rollingX.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Arrow */}
          <div className="bon-switch-arrow" aria-hidden="true">
            <ArrowRightLeft />
          </div>

          {/* New Bonus */}
          {newBonus && (
            <div className="nova-modal-summary bon-switch-card is-new">
              <div className="bon-switch-kicker">
                <Gift aria-hidden="true" />
                <span>New Bonus (will be activated)</span>
              </div>
              <p className="bon-switch-name">{newBonus.name}</p>
              <p className="bon-switch-amount">
                {formatAmount(newBonus.amount, newBonus.currency as CurrencyCode)}
                <span>will be available</span>
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="nova-modal-footer nova-modal-actions bon-switch-footer">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="nova-button nova-button-secondary flex-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="nova-button flex-1"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Switching...
              </span>
            ) : (
              'Switch Bonus'
            )}
          </button>
        </div>
    </ModalSurface>
  )
}
