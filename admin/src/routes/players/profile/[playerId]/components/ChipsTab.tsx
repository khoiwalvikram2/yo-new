import type { ApolloError } from '@apollo/client'
import { ChipActions, ChipFigures, ChipStatementTable, chipErrorMessage, type ChipAccount } from '@/modules/chips'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Notice } from '@/ui/components/Notice'
import styles from '../PlayerProfile.module.css'

interface ChipsTabProps {
  playerId: string
  /** The player's chips account, read once by the page (null until it answers, or when it cannot be read). */
  account: ChipAccount | null
  loading: boolean
  error?: ApolloError
  onRetry: () => void
  /** After a deposit, withdrawal or credit reference change made from this tab. */
  onChanged?: () => void
}

/**
 * A credit player's Chips tab (spec 2026-11-02 §8), in place of the old Credit Management and Credit
 * Statement tabs: its five figures, Deposit / Withdraw chips and the credit reference for its direct parent
 * (its agent, or an admin for a whitelabel credit player), and its chip statement.
 */
export function ChipsTab({ playerId, account, loading, error, onRetry, onChanged }: ChipsTabProps) {
  const failed = Boolean(error) && !account && !loading
  return <div className={styles.stack}>
    <Card title="Chips" sub="Credit reference, balance, exposure and what is owed" tools={account ? <ChipActions account={account} variant="full" onDone={onChanged} /> : null}>
      {failed
        ? <Notice tone="error" title="Chip figures unavailable" action={<Button size="sm" onClick={onRetry}>Retry</Button>}>{chipErrorMessage(error)}</Notice>
        : <ChipFigures account={account} loading={loading} label="Player chip figures" />}
    </Card>
    <Card title="Chip statement" sub="Deposits, withdrawals and credit reference changes, newest first" body="table">
      <ChipStatementTable accountType="PLAYER" accountId={playerId} currency={account?.currency} label="Player chip statement" />
    </Card>
  </div>
}
