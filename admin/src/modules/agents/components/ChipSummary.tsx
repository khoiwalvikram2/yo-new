import { useId } from 'react'
import { Link } from 'react-router-dom'
import { ChipFigures, chipErrorMessage, useMyChipAccount } from '@/modules/chips'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { Notice } from '@/ui/components/Notice'
import styles from '../AgentHome.module.css'

/**
 * A CREDIT agent's chips on its dashboard (spec 2026-11-02 §8): its five figures and the way to its Chips
 * page. It replaces the credit-limit meter and its alerts; chips have no limit to run out of. On the Financial
 * tab it also stands in for the settlement summary: a CREDIT agent settles nothing, and what it is owed or owes
 * is its Ref P/L (green: the upline owes it; rose: it owes the upline).
 */
export default function ChipSummary() {
  const { account, loading, error } = useMyChipAccount()
  const headingId = useId()

  return (
    <section className={styles.stack} aria-labelledby={headingId}>
      <div className={styles.row}>
        <h2 id={headingId}>My chips</h2>
        <Link to="/agent/credit" className={buttonClassName({ size: 'sm' })}>Open chips</Link>
      </div>
      {error && !account ? (
        <Notice tone="error" title="Chips unavailable">{chipErrorMessage(error, 'Your chips could not be loaded.')}</Notice>
      ) : (
        <ChipFigures account={account} loading={loading} label="My chip figures" self />
      )}
    </section>
  )
}
