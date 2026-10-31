import { Link } from 'react-router-dom'
import { useQuery, gql } from '@apollo/client'
import { IconGauge } from '@tabler/icons-react'
import { useAuthStore } from '@/shared/core/authStore'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import { Notice } from '@/ui/components/Notice'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { Meter } from '@/ui/components/Meter'
import { Skeleton } from '@/ui/components/Skeleton'
import { EmptyState } from '@/ui/components/EmptyState'
import { rawAmount, type CreditResult } from '../agentHomeModel'
import styles from '../AgentHome.module.css'

const CREDIT_ALLOCATION_QUERY = gql`
  query CreditAllocation($agentId: ID!) {
    agents {
      creditAllocation(agentId: $agentId) {
        agentId
        creditLimit
        creditUsed
        creditAvailable
        creditAlertThreshold
        usagePercentage
        isOverLimit
        isNearThreshold
      }
    }
  }
`

interface CreditMeterProps {
  agentId?: string
  /** There is no credit-request workflow yet: the button shows only when a caller supplies one. */
  showRequestButton?: boolean
  onRequestCredit?: () => void
}

export default function CreditMeter({ agentId, showRequestButton: requestButton, onRequestCredit }: CreditMeterProps) {
  const showRequestButton = Boolean(onRequestCredit) && requestButton !== false
  const { formatAmount, convertFromWhitelabelCurrency, getCurrencySymbol } = useCurrency()
  const agent = useAuthStore(s => s.agent)
  const targetAgentId = agentId || agent?.id
  const isCreditAgent = agent?.schemeType === 'CREDIT'
  const { data, loading, error } = useQuery<CreditResult>(CREDIT_ALLOCATION_QUERY, {
    variables: { agentId: targetAgentId },
    skip: !targetAgentId || !isCreditAgent,
    pollInterval: 60000,
  })
  if (!isCreditAgent || !targetAgentId) return null
  const credit = data?.agents?.creditAllocation
  // Until the first answer the card keeps its layout with placeholders.
  const pending = loading && !credit
  if (!pending && (error || !credit)) return <Card title="Credit Status">{error ? <Notice tone="error" title="Credit status unavailable">{error.message}</Notice> : <EmptyState title="No credit allocation available" />}</Card>
  const status = credit?.isOverLimit ? 'Over Limit' : credit?.isNearThreshold ? 'Near Threshold' : 'Healthy'
  const tone = credit?.isOverLimit ? 'error' : credit?.isNearThreshold ? 'warn' : 'ok'
  return <Card title="Credit Status" aria-busy={pending || undefined} tools={showRequestButton ? <Button size="sm" onClick={onRequestCredit} disabled={!credit?.isNearThreshold && !credit?.isOverLimit}>Request More Credit</Button> :
    <Link to="/agent/credit" className={buttonClassName({ size: 'sm' })}>Credit details</Link>}>
    <div className={styles.stack}>
      {credit?.isOverLimit && <Notice tone="error" title="Credit Limit Exceeded">You have exceeded your credit limit. Please contact your parent agent or reduce credit usage.</Notice>}
      {credit?.isNearThreshold && !credit.isOverLimit && <Notice tone="warn" title="Credit Usage Alert">You are using {credit.usagePercentage.toFixed(1)}% of your credit limit. Contact your parent agent to raise your limit.</Notice>}
      <div className={styles.three}>
        <Stat variant="bare" size="compact" label="Credit Limit" value={rawAmount(credit?.creditLimit ?? 0, getCurrencySymbol())} loading={pending} />
        <Stat variant="bare" size="compact" label="Credit Used" value={rawAmount(credit?.creditUsed ?? 0, getCurrencySymbol())} loading={pending} />
        <Stat variant="bare" size="compact" label="Available" value={rawAmount(credit?.creditAvailable ?? 0, getCurrencySymbol())} loading={pending} />
      </div>
      <div className={styles.split}>
        <div className={styles.row}><span>Credit Usage</span><strong>{credit ? <>{credit.usagePercentage.toFixed(1)}%</> : <Skeleton width={40} height={10} />}</strong></div>
        {credit ? <Meter value={credit.usagePercentage} tone={credit.isOverLimit ? 'neg' : credit.isNearThreshold ? 'warn' : 'acc'} /> : <Skeleton height={6} radius="pill" />}
        <div className={styles.row}><span className={styles.muted}>{formatAmount(0)}</span><span className={styles.muted}>{credit ? formatAmount(convertFromWhitelabelCurrency(credit.creditLimit)) : <Skeleton width={72} height={10} />}</span></div>
      </div>
      <Notice tone={credit ? tone : 'neutral'} icon={<IconGauge size={18} />} title={credit ? status : <Skeleton width={72} height={10} />}>{credit ? <>Alert triggers at {credit.creditAlertThreshold}% usage</> : <Skeleton width={160} height={10} />}</Notice>
    </div>
  </Card>
}

