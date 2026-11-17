import { useId, useState } from 'react'
import { useMutation } from '@apollo/client'
import clsx from 'clsx'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { TextField } from '@/ui/components/TextField'
import { toast } from '@/ui/components/toast'
import { useCurrency } from '@/shared/core/CurrencyContext'
import {
  DEPOSIT_CHIPS_MUTATION,
  WITHDRAW_CHIPS_MUTATION,
  type ChipAccount,
  type ChipTransferResult,
  type ChipTransferVariables,
  type DepositChipsData,
  type WithdrawChipsData,
} from '@/lib/graphql/chips'
import {
  accountTypeLabel,
  chipErrorMessage,
  chipTone,
  depositPausedReason,
  refPnlNote,
  roundChips,
  settlePlan,
  signedChips,
  transferProblem,
  type ChipDirection,
} from './chipModel'
import { useChipAccount, useChipFormat, useChipPool, useRefreshChips } from './chipHooks'
import { useChipActor } from './useChipActor'
import styles from './Chips.module.css'

export interface ChipTransferModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The downline account the chips go to or come from. Its parent is the other side. */
  account: ChipAccount
  /** The move the dialog opens on; it can be switched inside. */
  direction: ChipDirection
  /** After the move went through (the chips reads on screen are refetched as well). */
  onDone?: (result: ChipTransferResult, direction: ChipDirection) => void
}

const DIRECTIONS = [
  { value: 'deposit', label: 'Deposit' },
  { value: 'withdraw', label: 'Withdraw' },
] as const

/**
 * Deposit chips to, or withdraw chips from, a direct downline account (spec §4.1-4.2). It shows both sides'
 * free chips, offers "Settle to credit reference" (moves |Ref P/L| the right way, spec decision 8) and checks
 * the amount the way the server will: a deposit takes no more than the parent's free chips, a withdrawal no
 * more than the account's. The server's refusals are shown as it words them.
 */
export function ChipTransferModal(props: ChipTransferModalProps) {
  // Mounted only while open, so every opening starts with an empty form and fresh figures.
  return props.open ? <ChipTransferDialog {...props} /> : null
}

function ChipTransferDialog({ onOpenChange, account: given, direction: initialDirection, onDone }: ChipTransferModalProps) {
  const formId = useId()
  const actor = useChipActor()
  const refresh = useRefreshChips()
  const { getCurrencySymbol } = useCurrency()
  // The row that opened the dialog may be stale: read the account again and fall back to the row meanwhile.
  const { account: fresh } = useChipAccount(given.accountType, given.id)
  const account = fresh ?? given
  // The other side is the direct parent: an agent, or the whitelabel pool for a root account.
  const fromPool = !account.parentAgentId
  const parentRead = useChipAccount('AGENT', account.parentAgentId, { skip: fromPool })
  const poolRead = useChipPool({ skip: !fromPool })
  const format = useChipFormat(account.currency)

  const [direction, setDirection] = useState<ChipDirection>(initialDirection)
  const [amount, setAmount] = useState<number | null>(null)
  const [remark, setRemark] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [depositChips, depositState] = useMutation<DepositChipsData, ChipTransferVariables>(DEPOSIT_CHIPS_MUTATION)
  const [withdrawChips, withdrawState] = useMutation<WithdrawChipsData, ChipTransferVariables>(WITHDRAW_CHIPS_MUTATION)
  const submitting = depositState.loading || withdrawState.loading

  const parentName = fromPool ? 'Whitelabel pool' : parentRead.account?.username ?? 'Upline'
  const parentFree = fromPool ? poolRead.pool?.available ?? null : parentRead.account?.available ?? null
  const parentLoading = fromPool ? poolRead.loading : parentRead.loading
  const childFree = account.available
  const problem = transferProblem({ direction, amount, parentFree, parentName, childFree, childName: account.username }, format)
  const pausedReason = direction === 'deposit' ? actor.depositBlockedReason ?? depositPausedReason(account) : null
  const canSubmit = amount !== null && !problem && !pausedReason && !submitting
  const moving = amount !== null && !problem ? roundChips(amount) : null
  const plan = settlePlan(account.refPnl)
  const refTone = chipTone(account.refPnl)
  const verb = direction === 'deposit' ? 'Deposit chips' : 'Withdraw chips'

  const changeDirection = (next: ChipDirection) => {
    setDirection(next)
    setServerError(null)
  }

  const settle = () => {
    if (!plan) return
    setDirection(plan.direction)
    setAmount(plan.amount)
    setServerError(null)
  }

  const submit = async () => {
    if (!canSubmit || moving === null) return
    setServerError(null)
    const input = { accountType: account.accountType, accountId: account.id, amount: moving, remark: remark.trim() || null }
    try {
      const result = direction === 'deposit'
        ? (await depositChips({ variables: { input } })).data?.agents?.depositChips
        : (await withdrawChips({ variables: { input } })).data?.agents?.withdrawChips
      if (!result) throw new Error('The server did not confirm the move. Check the statement before trying again.')
      toast({
        tone: 'ok',
        message: direction === 'deposit'
          ? `Deposited ${format(moving)} to ${account.username}`
          : `Withdrew ${format(moving)} from ${account.username}`,
      })
      onOpenChange(false)
      onDone?.(result, direction)
      void refresh()
    } catch (error) {
      setServerError(chipErrorMessage(error))
    }
  }

  // What each side's free chips become, shown once the amount is one the move can take.
  const parentAfter = moving !== null && parentFree !== null ? parentFree + (direction === 'deposit' ? -moving : moving) : null
  const childAfter = moving !== null ? childFree + (direction === 'deposit' ? moving : -moving) : null

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={verb}
      description={`${accountTypeLabel(account)} ${account.username}`}
      size="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} loading={submitting} disabled={!canSubmit && !submitting}>
            {verb}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <SegmentedControl label="Move" value={direction} options={DIRECTIONS} onChange={changeDirection} />

        <dl className={styles.sides}>
          <div className={styles.side}>
            <dt>
              {parentName}
              <span className={styles.sub}>Upline · free chips</span>
            </dt>
            <dd data-side="parent">
              <span className={styles.num}>{parentFree !== null ? format(parentFree) : parentLoading ? 'Loading…' : '—'}</span>
              {parentAfter !== null ? <span className={clsx(styles.after, styles.num)}>{`After: ${format(parentAfter)}`}</span> : null}
            </dd>
          </div>
          <div className={styles.side}>
            <dt>
              {account.username}
              <span className={styles.sub}>{accountTypeLabel(account)} · free chips</span>
            </dt>
            <dd data-side="child">
              <span className={styles.num}>{format(childFree)}</span>
              {childAfter !== null ? <span className={clsx(styles.after, styles.num)}>{`After: ${format(childAfter)}`}</span> : null}
            </dd>
          </div>
        </dl>

        <div className={styles.settle}>
          <span className={styles.settleText}>
            <span>
              Ref P/L <b className={clsx(refTone && styles[refTone])}>{signedChips(account.refPnl, format)}</b>
            </span>
            <span className={styles.sub}>
              {plan
                ? `${refPnlNote(account.refPnl)} · settling ${plan.direction === 'withdraw' ? 'withdraws' : 'deposits'} ${format(plan.amount)}`
                : 'The balance meets the credit reference'}
            </span>
          </span>
          <Button variant="link" size="sm" onClick={settle} disabled={!plan}>
            Settle to credit reference
          </Button>
        </div>

        <NumberField
          label="Amount"
          value={amount}
          onChange={(next) => {
            setAmount(next)
            setServerError(null)
          }}
          precision={2}
          prefix={getCurrencySymbol(account.currency)}
          error={problem ?? undefined}
          required
        />
        <TextField label="Remark" value={remark} onChange={setRemark} help="Optional. Shown on both statements." />

        {pausedReason ? <Notice tone="warn">{`${pausedReason}. Withdrawals still work.`}</Notice> : null}
        {serverError ? (
          <Notice tone="error" live="assertive" title="The move did not go through">
            {serverError}
          </Notice>
        ) : null}
      </form>
    </Dialog>
  )
}
