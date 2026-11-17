import { useState, useEffect } from 'react'
import { useQuery, gql } from '@apollo/client'
import { formatDistanceToNow } from 'date-fns'
import { IconBell } from '@tabler/icons-react'
import { Card } from '@/ui/components/Card'
import { Notice } from '@/ui/components/Notice'
import { Button } from '@/ui/components/Button'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import type { ActivityResult } from '../agentHomeModel'
import styles from '../AgentHome.module.css'

// Activity only: the credit-limit alerts (over the limit, near the threshold) went with the credit-limit
// model. Chips have no limit to run out of (spec 2026-11-02 §6, §8).
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

  const { data: activityData, loading: activityLoading, error: activityError } = useQuery<ActivityResult>(AGENT_ACTIVITY_QUERY, {
    variables: { agentId, limit: 5 },
    skip: !agentId,
    pollInterval: autoRefresh ? 30000 : 0,
  })

  useEffect(() => {
    const newAlerts: AlertItem[] = []

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
  }, [activityData, dismissedAlerts])

  const handleDismiss = (alertId: string) => {
    setDismissedAlerts(prev => new Set([...prev, alertId]))
  }


  return <Card title="Alerts & Notifications" tools={<IconBell size={18} aria-hidden="true" />}>
    {activityLoading ? <LoadingState label="Loading alerts" /> : activityError ? <Notice tone="error" title="Alerts unavailable">{activityError.message}</Notice> : alerts.length === 0 ? <EmptyState title="No alerts at this time" /> : <ul className={styles.list}>
      {alerts.map(alert => <li key={alert.id}><Notice tone={alert.type === 'critical' ? 'error' : alert.type === 'warning' ? 'warn' : 'info'} title={alert.title} action={alert.dismissible && <Button variant="ghost" size="sm" onClick={() => handleDismiss(alert.id)}>Dismiss</Button>}>
        {alert.message}{alert.timestamp && Number.isFinite(Date.parse(alert.timestamp)) && <><br /><time dateTime={alert.timestamp}>{formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}</time></>}
      </Notice></li>)}
    </ul>}
  </Card>
}

