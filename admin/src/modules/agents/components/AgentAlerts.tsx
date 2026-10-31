import { useState, useEffect } from 'react'
import { useQuery, gql } from '@apollo/client'
import { formatDistanceToNow } from 'date-fns'
import { IconBell } from '@tabler/icons-react'
import { useAuthStore } from '@/shared/core/authStore'
import { Card } from '@/ui/components/Card'
import { Notice } from '@/ui/components/Notice'
import { Button } from '@/ui/components/Button'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import type { CreditResult, ActivityResult } from '../agentHomeModel'
import styles from '../AgentHome.module.css'

const CREDIT_ALLOCATION_QUERY = gql`
  query CreditAllocation($agentId: ID!) {
    agents {
      creditAllocation(agentId: $agentId) {
        usagePercentage
        isOverLimit
        isNearThreshold
        creditAvailable
        creditLimit
      }
    }
  }
`

const AGENT_ACTIVITY_QUERY = gql`
  query AgentActivity($agentId: ID!, $limit: Int!) {
    agents {
      agentActivity(agentId: $agentId, limit: $limit) {
        id
        type
        timestamp
        playerName
        details
      }
    }
  }
`

interface AgentAlertsProps {
  agentId: string
  autoRefresh?: boolean
}

interface AlertItem {
  id: string
  type: 'critical' | 'warning' | 'info'
  title: string
  message: string
  timestamp?: string
  dismissible?: boolean
}

export default function AgentAlerts({ agentId, autoRefresh = true }: AgentAlertsProps) {
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set())
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const agent = useAuthStore(s => s.agent)
  
  // Only query credit data for CREDIT scheme agents
  const isCreditAgent = agent?.schemeType === 'CREDIT'

  const { data: creditData, loading: creditLoading, error: creditError } = useQuery<CreditResult>(CREDIT_ALLOCATION_QUERY, {
    variables: { agentId },
    skip: !agentId || !isCreditAgent, // Skip if not CREDIT agent
    pollInterval: autoRefresh ? 30000 : 0,
  })

  const { data: activityData, loading: activityLoading, error: activityError } = useQuery<ActivityResult>(AGENT_ACTIVITY_QUERY, {
    variables: { agentId, limit: 5 },
    skip: !agentId,
    pollInterval: autoRefresh ? 30000 : 0,
  })

  useEffect(() => {
    const newAlerts: AlertItem[] = []

    // Credit alerts
    const credit = creditData?.agents?.creditAllocation
    if (credit) {
      if (credit.isOverLimit) {
        newAlerts.push({
          id: 'credit-over-limit',
          type: 'critical',
          title: 'Credit Limit Exceeded',
          message: `Your credit usage (${credit.usagePercentage.toFixed(1)}%) has exceeded the limit. Please contact support.`,
          timestamp: new Date().toISOString(),
          dismissible: false,
        })
      } else if (credit.isNearThreshold) {
        newAlerts.push({
          id: 'credit-near-threshold',
          type: 'warning',
          title: 'Credit Usage High',
          message: `Your credit usage is at ${credit.usagePercentage.toFixed(1)}%. Consider requesting additional credit.`,
          timestamp: new Date().toISOString(),
          dismissible: true,
        })
      }
    }

    // Recent activity alerts (new player registrations, large bets, etc.)
    const activities = activityData?.agents?.agentActivity || []
    activities.forEach((activity: { id: string; type?: string; playerName?: string; timestamp?: string; details?: string }) => {
      if (activity.type === 'PLAYER_REGISTERED') {
        newAlerts.push({
          id: `activity-${activity.id}`,
          type: 'info',
          title: 'New Player Registered',
          message: `${activity.playerName} has registered`,
          timestamp: activity.timestamp,
          dismissible: true,
        })
      } else if (activity.type === 'LARGE_BET') {
        newAlerts.push({
          id: `activity-${activity.id}`,
          type: 'warning',
          title: 'Large Bet Detected',
          message: activity.details || 'A large bet has been placed',
          timestamp: activity.timestamp,
          dismissible: true,
        })
      }
    })

    // Filter out dismissed alerts
    setAlerts(newAlerts.filter(alert => !dismissedAlerts.has(alert.id)))
  }, [creditData, activityData, dismissedAlerts])

  const handleDismiss = (alertId: string) => {
    setDismissedAlerts(prev => new Set([...prev, alertId]))
  }


  return <Card title="Alerts & Notifications" tools={<IconBell size={18} aria-hidden="true" />}>
    {creditLoading || activityLoading ? <LoadingState label="Loading alerts" /> : creditError || activityError ? <Notice tone="error" title="Alerts unavailable">{creditError?.message ?? activityError?.message}</Notice> : alerts.length === 0 ? <EmptyState title="No alerts at this time" /> : <ul className={styles.list}>
      {alerts.map(alert => <li key={alert.id}><Notice tone={alert.type === 'critical' ? 'error' : alert.type === 'warning' ? 'warn' : 'info'} title={alert.title} action={alert.dismissible && <Button variant="ghost" size="sm" onClick={() => handleDismiss(alert.id)}>Dismiss</Button>}>
        {alert.message}{alert.timestamp && Number.isFinite(Date.parse(alert.timestamp)) && <><br /><time dateTime={alert.timestamp}>{formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}</time></>}
      </Notice></li>)}
    </ul>}
  </Card>
}

