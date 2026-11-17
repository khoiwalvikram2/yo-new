import clsx from 'clsx'
import type { ApolloError } from '@apollo/client'
import { ChipActions, ChipDownlineTable, ChipFigures, ChipStatementTable, chipErrorMessage, type ChipAccount } from '@/modules/chips'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Notice } from '@/ui/components/Notice'
import styles from './AgentProfileComponents.module.css'

interface ChipsTabProps {
  agentId: string
  /** The agent's chips account, read once by the page (null until it answers, or when it cannot be read). */
  account: ChipAccount | null
  loading: boolean
  error?: ApolloError
  onRetry: () => void
  /** After a deposit, withdrawal or credit reference change made from this tab. */
  onChanged?: () => void
}

/**
 * A CREDIT agent's Chips tab (spec 2026-11-02 §8): its five figures with D / W / CR for its direct parent,
 * its direct downline on chips (each row with its own D / W / CR for whoever is that row's parent) and its
 * chip statement.
 */
export function ChipsTab({ agentId, account, loading, error, onRetry, onChanged }: ChipsTabProps) {
  const failed = Boolean(error) && !account && !loading
  return <div className={clsx(styles.stack, styles.tabPanel)}>
    <Card title="Chips" sub="Credit reference, balance, exposure and what is owed" tools={account ? <ChipActions account={account} variant="full" onDone={onChanged} /> : null}>
      {failed
        ? <Notice tone="error" title="Chip figures unavailable" action={<Button size="sm" onClick={onRetry}>Retry</Button>}>{chipErrorMessage(error)}</Notice>
        : <ChipFigures account={account} loading={loading} label="Agent chip figures" />}
    </Card>
    <Card title="Downline" sub="Direct sub-agents and players on chips; an agent's name opens its own downline">
      <ChipDownlineTable parentAgentId={agentId} label="Agent chip downline" onChanged={onChanged} />
    </Card>
    <Card title="Statement" sub="Every chip movement, newest first" body="table">
      <ChipStatementTable accountType="AGENT" accountId={agentId} currency={account?.currency} label="Agent chip statement" />
    </Card>
  </div>
}
