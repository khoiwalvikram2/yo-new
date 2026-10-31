import { useMutation, useQuery } from '@apollo/client'
import { IconArrowLeft, IconCircleX, IconLink, IconPlus, IconRefresh } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { AGENT_REFERRAL_LINK_QUERY, GENERATE_AGENT_REFERRAL_LINK_MUTATION } from '@/lib/graphql/agents'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { environmentConfig } from '@/shared/config/environment'
import { useAuthStore } from '@/shared/core/authStore'
import { Button } from '@/ui/components/Button'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import {
  isMissingReferralError,
  referralAccess,
  referralUrl,
} from './agentReferralModel'
import ReferralLinkCard from './components/ReferralLinkCard'
import styles from './AgentReferralLinkPage.module.css'

interface ReferralLinkRecord {
  id: string
  code: string
  agentId: string
  qrCodeUrl?: string | null
  isActive: boolean
  createdAt?: string | null
}

interface ReferralLinkQueryData {
  agentReferralLink?: ReferralLinkRecord | null
}

interface GenerateReferralLinkData {
  generateReferralLink?: {
    success: boolean
    message?: string | null
    link?: ReferralLinkRecord | null
  } | null
}

export default function AgentReferralLinkPage() {
  const navigate = useNavigate()
  const agent = useAuthStore((state) => state.agent)
  const pageEyebrow = usePageEyebrow()
  const access = referralAccess(agent)

  const { data, loading, error, refetch } = useQuery<ReferralLinkQueryData>(
    AGENT_REFERRAL_LINK_QUERY,
    {
      variables: { agentId: agent?.id },
      skip: !agent?.id,
      errorPolicy: 'all',
    },
  )

  const [generateLink, { loading: generating }] = useMutation<GenerateReferralLinkData>(
    GENERATE_AGENT_REFERRAL_LINK_MUTATION,
    {
      onCompleted: (result) => {
        const outcome = result?.generateReferralLink
        if (outcome?.success) {
          toast({
            title: 'Referral Link Generated',
            message: 'Your referral link has been created successfully!',
            tone: 'ok',
            duration: 3000,
          })
          void refetch()
          return
        }
        toast({
          title: 'Failed to Generate Link',
          message: outcome?.message || 'Failed to generate referral link. Please try again.',
          tone: 'error',
          duration: 5000,
        })
      },
      onError: (mutationError) => {
        toast({
          title: 'Error',
          message: mutationError.message || 'Failed to generate referral link. Please try again.',
          tone: 'error',
          duration: 5000,
        })
      },
    },
  )

  const generate = () => {
    if (!agent?.id) return
    void generateLink({ variables: { agentId: agent.id } })
  }

  const pageHeader = (
    <PageHeader
      eyebrow={pageEyebrow}
      title="Invite Players"
      sub="Share your referral link to grow your player base and increase your earnings"
      actions={access === 'allowed' && data?.agentReferralLink ? (
        <div className={styles.headerActions}>
          <Button
            icon={<IconRefresh size={16} stroke={strokeFor(16)} />}
            onClick={() => void refetch()}
          >
            Refresh
          </Button>
          <Button
            icon={<IconArrowLeft size={16} stroke={strokeFor(16)} />}
            onClick={() => navigate('/agent')}
          >
            Back to Dashboard
          </Button>
        </div>
      ) : undefined}
    />
  )

  if (access === 'unauthenticated') {
    return (
      <Page>
        {pageHeader}
        <Notice
          className={styles.notice}
          tone="error"
          icon={<IconCircleX size={18} stroke={strokeFor(18)} />}
          title="Not Authenticated"
        >
          Please log in as an agent to view this page.
        </Notice>
      </Page>
    )
  }

  if (access === 'denied') {
    return (
      <Page>
        {pageHeader}
        <Notice
          className={styles.notice}
          tone="error"
          icon={<IconCircleX size={18} stroke={strokeFor(18)} />}
          title="Access Denied"
          action={
            <Button variant="primary" onClick={() => navigate('/agent')}>
              Go to Dashboard
            </Button>
          }
        >
          Referral links are only available for SHARING and COMMISSION agents.
        </Notice>
      </Page>
    )
  }

  if (loading) {
    return (
      <Page>
        {pageHeader}
        <LoadingState label="Loading referral link" minHeight={256} />
      </Page>
    )
  }

  if (error && !isMissingReferralError(error.message)) {
    return (
      <Page>
        {pageHeader}
        <Notice
          className={styles.notice}
          tone="error"
          icon={<IconCircleX size={18} stroke={strokeFor(18)} />}
          title="Error Loading Referral Link"
          action={<Button onClick={() => void refetch()}>Retry</Button>}
        >
          {error.message || 'Failed to load referral link. Please try again.'}
        </Notice>
      </Page>
    )
  }

  const link = data?.agentReferralLink
  if (!link) {
    return (
      <Page>
        {pageHeader}
        <Notice
          className={styles.notice}
          tone="warn"
          icon={<IconLink size={18} stroke={strokeFor(18)} />}
          title="Referral Link Not Found"
          action={
            <Button
              variant="primary"
              icon={<IconPlus size={16} stroke={strokeFor(16)} />}
              loading={generating}
              onClick={generate}
            >
              Generate Referral Link
            </Button>
          }
        >
          Your referral link has not been generated yet. Click the button below to generate it now.
        </Notice>
      </Page>
    )
  }

  const publicUrl = referralUrl(
    link,
    environmentConfig.userFrontendUrl,
    window.location.origin,
  )

  return (
    <Page maxWidth="wide">
      {pageHeader}
      <ReferralLinkCard link={publicUrl} code={link.code} isActive={link.isActive} />
    </Page>
  )
}
