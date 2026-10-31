import clsx from 'clsx'
import { useQuery, useMutation } from '@apollo/client'
import { IconClick, IconLink, IconPercentage, IconUserPlus } from '@tabler/icons-react'
import { AGENT_REFERRAL_LINK_QUERY, GENERATE_AGENT_REFERRAL_LINK_MUTATION } from '@/lib/graphql/agents'
import { environmentConfig } from '@/shared/config/environment'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { AccountListMetric } from '@/modules/account-lists/AccountList'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { TextField } from '@/ui/components/TextField'
import { StatusPill } from '@/ui/components/StatusPill'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { profileNotification as notification } from './agentProfileModel'
import styles from './AgentProfileComponents.module.css'

function getUserFrontendUrl(): string {
  if (environmentConfig.userFrontendUrl) {
    return environmentConfig.userFrontendUrl.replace(/\/$/, '')
  }
  const origin = window.location.origin
  if (origin.includes('admin.')) {
    return origin.replace('admin.', '')
  }
  return origin
}

export interface ReferralLinkTabProps {
  agentId: string
  agentUsername?: string | null
}

export function ReferralLinkTab({ agentId, agentUsername }: ReferralLinkTabProps) {
  const { formatDate } = useFormatDate()
  const { data, loading, error, refetch } = useQuery(AGENT_REFERRAL_LINK_QUERY, {
    variables: { agentId },
    skip: !agentId,
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  })

  const [generateLink, { loading: generating }] = useMutation(GENERATE_AGENT_REFERRAL_LINK_MUTATION, {
    onCompleted: (res) => {
      if (res?.generateReferralLink?.success) {
        notification.success({
          message: 'Referral Link Generated',
          description: res.generateReferralLink.message ?? 'Referral link has been created successfully.',
          duration: 3,
        })
        refetch()
      } else {
        notification.error({
          message: 'Failed to Generate Link',
          description: res?.generateReferralLink?.message ?? 'Could not generate referral link.',
          duration: 5,
        })
      }
    },
    onError: (err) => {
      notification.error({
        message: 'Error',
        description: err.message ?? 'Failed to generate referral link.',
        duration: 5,
      })
    },
  })

  const referralLink = data?.agentReferralLink
  const fullUrl = referralLink?.code
    ? `${getUserFrontendUrl()}/r?ref=${referralLink.code}`
    : ''

  const handleCopyUrl = () => {
    if (!fullUrl) return
    navigator.clipboard.writeText(fullUrl).then(
      () => {
        notification.success({
          message: 'Copied',
          description: 'Referral URL copied to clipboard.',
          duration: 2,
        })
      },
      () => {
        notification.error({
          message: 'Copy failed',
          description: 'Could not copy to clipboard.',
        })
      }
    )
  }

  const handleCopyCode = () => {
    if (!referralLink?.code) return
    navigator.clipboard.writeText(referralLink.code).then(
      () => {
        notification.success({
          message: 'Copied',
          description: 'Referral code copied to clipboard.',
          duration: 2,
        })
      },
      () => {
        notification.error({
          message: 'Copy failed',
          description: 'Could not copy to clipboard.',
        })
      }
    )
  }

  const handleGenerate = () => {
    void generateLink({ variables: { agentId } }).catch(() => undefined)
  }

  if (!agentId) return <Notice>Agent ID is required</Notice>
  if (loading) return <LoadingState label="Loading referral link" />
  if (error && !error.message?.includes('not found')) return <Notice tone="error" title="Error Loading Referral Link">{error.message || 'Failed to load referral link.'}<Button size="sm" onClick={() => void refetch()}>Retry</Button></Notice>
  if (!referralLink) return <Card title="Referral Link" sub="Players who sign up through it join this agent">
    <EmptyState title="No referral link yet" icon={<IconLink size={20} />} description={agentUsername ? `Generate a referral link for agent "${agentUsername}" so they can share it with players.` : 'Generate a referral link for this commission agent.'} action={<Button variant="primary" onClick={handleGenerate} loading={generating}>Generate Referral Link</Button>} />
  </Card>
  // One card: the link and its code to share, then how the link is doing.
  const clicks = referralLink.totalClicks, signups = referralLink.totalSignups
  const conversion = referralLink.conversionRate != null && clicks > 0 ? `${Number(referralLink.conversionRate).toFixed(1)}%` : '—'
  return <div className={clsx(styles.stack, styles.tabPanel)}>
    <Card title="Referral Link" sub={referralLink.createdAt ? `Created ${formatDate(referralLink.createdAt, 'dd MMM yyyy')} · players who sign up through it join this agent` : 'Players who sign up through it join this agent'} tools={<div className={styles.actions}><StatusPill tone={referralLink.isActive ? 'ok' : 'muted'}>{referralLink.isActive ? 'Active' : 'Inactive'}</StatusPill><Button size="sm" onClick={() => void refetch()}>Refresh</Button></div>}>
      <div className={styles.stack}>
        <div className={styles.url}><TextField label="Full URL" className={styles.urlField} value={fullUrl} onChange={() => {}} readOnly /><Button variant="primary" onClick={handleCopyUrl}>Copy URL</Button></div>
        <div className={styles.actions}><span className={styles.muted}>Referral code</span><strong className={styles.mono}>{referralLink.code}</strong><Button size="sm" onClick={handleCopyCode}>Copy code</Button></div>
        <div className={clsx(styles.tabKpis, styles.tabKpis3)} role="group" aria-label="Referral figures">
          <AccountListMetric label="Clicks" value={clicks ?? '—'} note="Visits through the link" icon={<IconClick size={18} />} hue="blu" />
          <AccountListMetric label="Signups" value={signups ?? '—'} note="Players who joined" icon={<IconUserPlus size={18} />} hue="grn" />
          <AccountListMetric label="Conversion Rate" value={conversion} note="Signups per click" icon={<IconPercentage size={18} />} hue="vio" />
        </div>
      </div>
    </Card>
  </div>
}
