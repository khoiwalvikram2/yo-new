import { useState, type ReactElement } from 'react'
import clsx from 'clsx'
import { Button } from '@/ui/components/Button'
import { Tooltip } from '@/ui/components/Tooltip'
import type { ChipAccount } from '@/lib/graphql/chips'
import { depositPausedReason, isDirectParent } from './chipModel'
import { ChipTransferModal } from './ChipTransferModal'
import { CreditReferenceModal } from './CreditReferenceModal'
import { useChipActor } from './useChipActor'
import styles from './Chips.module.css'

type ChipAction = 'deposit' | 'withdraw' | 'creditReference'

export interface ChipActionsProps {
  account: ChipAccount
  /** compact: the D / W / CR buttons of a list row; full: worded buttons for a page or card head. @default 'compact' */
  variant?: 'compact' | 'full'
  /** After a deposit, withdrawal or credit reference change went through. */
  onDone?: () => void
  className?: string
}

/**
 * Deposit (D), Withdraw (W) and Credit Reference (CR) for one account, with their dialogs. Only the direct
 * parent moves chips (spec decision 3), so the buttons render only for it: an agent on its own sub-agents
 * and players, an admin on the root accounts. A deposit to an account that is not ACTIVE, or by an agent
 * that is not, is refused (spec §4.1), so D is disabled with the reason; withdrawals always work.
 */
export function ChipActions({ account, variant = 'compact', onDone, className }: ChipActionsProps) {
  const actor = useChipActor()
  const [open, setOpen] = useState<ChipAction | null>(null)
  if (!actor.canManage || !isDirectParent(account, actor.agentId)) return null

  const compact = variant === 'compact'
  const name = account.username
  const pausedReason = actor.depositBlockedReason ?? depositPausedReason(account)
  const close = (next: boolean) => {
    if (!next) setOpen(null)
  }

  const action = (kind: ChipAction, short: string, words: string, accessibleName: string, blocked: string | null = null) => {
    const button: ReactElement = (
      <Button
        size={compact ? 'xs' : 'md'}
        variant={!compact && kind === 'deposit' ? 'primary' : 'secondary'}
        className={compact ? styles.compactButton : undefined}
        aria-label={accessibleName}
        aria-disabled={blocked ? true : undefined}
        onClick={() => setOpen(kind)}
      >
        {compact ? short : words}
      </Button>
    )
    // The short labels need their words on hover; a blocked button says why.
    return compact || blocked ? <Tooltip content={blocked ?? words}>{button}</Tooltip> : button
  }

  return (
    <div className={clsx(styles.actions, className)} data-variant={variant} role="group" aria-label={`Chips for ${name}`}>
      {action('deposit', 'D', 'Deposit chips', `Deposit chips to ${name}`, pausedReason)}
      {action('withdraw', 'W', 'Withdraw chips', `Withdraw chips from ${name}`)}
      {action('creditReference', 'CR', 'Credit reference', `Set credit reference for ${name}`)}
      <ChipTransferModal
        open={open === 'deposit' || open === 'withdraw'}
        onOpenChange={close}
        account={account}
        direction={open === 'withdraw' ? 'withdraw' : 'deposit'}
        onDone={() => onDone?.()}
      />
      <CreditReferenceModal open={open === 'creditReference'} onOpenChange={close} account={account} onDone={() => onDone?.()} />
    </div>
  )
}
