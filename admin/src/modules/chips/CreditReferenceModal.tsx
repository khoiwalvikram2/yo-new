import { useId, useState } from 'react'
import { useMutation } from '@apollo/client'
import clsx from 'clsx'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { TextField } from '@/ui/components/TextField'
import { toast } from '@/ui/components/toast'
import { useCurrency } from '@/shared/core/CurrencyContext'
import {
  SET_CREDIT_REFERENCE_MUTATION,
  type ChipAccount,
  type SetCreditReferenceData,
  type SetCreditReferenceVariables,
} from '@/lib/graphql/chips'
import {
  accountTypeLabel,
  chipErrorMessage,
  chipTone,
  creditReferenceProblem,
  refPnlAfterReference,
  refPnlNote,
  roundChips,
  signedChips,
} from './chipModel'
import { useChipAccount, useChipFormat, useRefreshChips } from './chipHooks'
import styles from './Chips.module.css'

export interface CreditReferenceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: ChipAccount
  /** After the reference was saved, with the account as the server returned it. */
  onDone?: (account: ChipAccount) => void
}

/**
 * Sets a direct downline account's credit reference (spec §4.3). It is a reference only: it moves no
 * chips and gates nothing; Ref P/L is measured against it, so the dialog shows what Ref P/L becomes.
 */
export function CreditReferenceModal(props: CreditReferenceModalProps) {
  // Mounted only while open, so every opening starts from the account's current reference.
  return props.open ? <CreditReferenceDialog {...props} /> : null
}

function CreditReferenceDialog({ onOpenChange, account: given, onDone }: CreditReferenceModalProps) {
  const formId = useId()
  const refresh = useRefreshChips()
  const { getCurrencySymbol } = useCurrency()
  const { account: fresh } = useChipAccount(given.accountType, given.id)
  const account = fresh ?? given
  const format = useChipFormat(account.currency)
  const [value, setValue] = useState<number | null>(() => roundChips(given.creditReference))
  const [remark, setRemark] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [setCreditReference, { loading: submitting }] = useMutation<SetCreditReferenceData, SetCreditReferenceVariables>(SET_CREDIT_REFERENCE_MUTATION)

  const problem = creditReferenceProblem(value)
  const next = value !== null && !problem ? roundChips(value) : null
  const unchanged = next !== null && next === roundChips(account.creditReference)
  const canSubmit = next !== null && !unchanged && !submitting
  const refPnlNow = account.refPnl
  const refPnlAfter = next !== null ? refPnlAfterReference(account, next) : null
  const nowTone = chipTone(refPnlNow)
  const afterTone = refPnlAfter !== null ? chipTone(refPnlAfter) : undefined

  const submit = async () => {
    if (!canSubmit || next === null) return
    setServerError(null)
    try {
      const { data } = await setCreditReference({
        variables: { input: { accountType: account.accountType, accountId: account.id, creditReference: next, remark: remark.trim() || null } },
      })
      const saved = data?.agents?.setCreditReference
      if (!saved) throw new Error('The server did not confirm the new reference. Check the statement before trying again.')
      toast({ tone: 'ok', message: `Credit reference for ${account.username} set to ${format(saved.creditReference)}` })
      onOpenChange(false)
      onDone?.(saved)
      void refresh()
    } catch (error) {
      setServerError(chipErrorMessage(error))
    }
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Credit reference"
      description={`${accountTypeLabel(account)} ${account.username}`}
      size="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} loading={submitting} disabled={!canSubmit && !submitting}>
            Save reference
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
        <p className={styles.parentLine}>
          A reference only: it moves no chips and limits nothing. Ref P/L is the balance{account.accountType === 'AGENT' ? ' plus the downline' : ''} less this reference.
        </p>

        <dl className={styles.sides}>
          <div className={styles.side}>
            <dt>Current reference</dt>
            <dd data-figure="current">
              <span className={styles.num}>{format(account.creditReference)}</span>
            </dd>
          </div>
          <div className={styles.side}>
            <dt>
              Ref P/L
              <span className={styles.sub}>{refPnlNote(refPnlNow)}</span>
            </dt>
            <dd data-figure="refPnl">
              <span className={clsx(styles.num, nowTone && styles[nowTone])}>{signedChips(refPnlNow, format)}</span>
              {refPnlAfter !== null && !unchanged ? (
                <span className={clsx(styles.after, styles.num)}>
                  {'After: '}
                  <span className={clsx(afterTone && styles[afterTone])}>{signedChips(refPnlAfter, format)}</span>
                  {` · ${refPnlNote(refPnlAfter)}`}
                </span>
              ) : null}
            </dd>
          </div>
        </dl>

        <NumberField
          label="New credit reference"
          value={value}
          onChange={(nextValue) => {
            setValue(nextValue)
            setServerError(null)
          }}
          precision={2}
          prefix={getCurrencySymbol(account.currency)}
          error={problem ?? undefined}
          help={unchanged ? 'This is the current reference.' : undefined}
          required
        />
        <TextField label="Remark" value={remark} onChange={setRemark} help="Optional. Shown on the statement." />

        {serverError ? (
          <Notice tone="error" live="assertive" title="The reference was not saved">
            {serverError}
          </Notice>
        ) : null}
      </form>
    </Dialog>
  )
}
