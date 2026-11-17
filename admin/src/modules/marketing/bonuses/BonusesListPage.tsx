import { useQuery, useMutation, useLazyQuery } from '@apollo/client'
import { useState, useMemo } from 'react'
import { gql } from '@apollo/client'
import { Link, useSearchParams } from 'react-router-dom'
import { IconPlus } from '@tabler/icons-react'
import { useSearchParamUpdates } from '@/shared/hooks/useSearchParamUpdates'
import { StatsCards } from './components/StatsCards'
import { FiltersBar } from './components/FiltersBar'
import { BonusesTable } from './components/BonusesTable'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { Dialog } from '@/ui/components/Dialog'
import { strokeFor } from '@/ui/components/icons'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Pagination } from '@/ui/components/Pagination'
import { toast } from '@/ui/components/toast'
import {
  bonusPageSlice,
  buildBonusCampaignsVariables,
  distributeBlocked,
  distributedMessage,
  type BonusCampaignRow,
  type DistributionPreview,
} from './bonusesListModel'
import styles from './BonusesListPage.module.css'

/* The page raised antd notifications, whose default was 4.5 seconds; the kit toasts keep that timing,
   as shared/services/notification.ts and the Create Bonus page do. */
const NOTIFICATION_DURATION_MS = 4500

const ACCESS_REQUIREMENT = [{ domain: 'bonuses.list', actions: ['view'] }]

function notifySuccess(message: string) {
  toast({ title: 'Success', message, tone: 'ok', duration: NOTIFICATION_DURATION_MS })
}

function notifyError(message: string) {
  toast({ title: 'Error', message, tone: 'error', duration: NOTIFICATION_DURATION_MS })
}

/* The page reports each mutation's outcome itself (above), so the global mutation toast is skipped:
   every save, end and status change was said twice (MAR-06). */
const PAGE_REPORTS_OUTCOME = { skipNotification: true } as const

const BONUS_CAMPAIGNS_QUERY = gql`
  query BonusCampaigns($status: BonusStatus, $domain: BonusDomain, $type: String, $search: String) {
    bonusCampaigns(status: $status, domain: $domain, type: $type, search: $search) {
      id
      name
      domain
      type
      status
      budgetNumeric
      currency
      validFrom
      validTo
      createdAt
      directSubType
      depositConditionType
      depositConditionAmount
      distributionType
      amountType
      amount
      percentage
      numberOfPlayers
      usagePerPlayer
      startDate
      endDate
      wagering
      distributedAt
    }
  }
`

const PREVIEW_DISTRIBUTION_QUERY = gql`
  query PreviewBonusDistribution($campaignId: ID!) {
    previewBonusDistribution(campaignId: $campaignId) {
      eligibleCount
      campaignName
      campaignType
      alreadyDistributed
      distributedAt
    }
  }
`

const DISTRIBUTE_MUTATION = gql`
  mutation DistributeBonusCampaign($campaignId: ID!) {
    distributeBonusCampaign(campaignId: $campaignId) {
      success
      message
      distributedCount
    }
  }
`

const DELETE_CAMPAIGN_MUTATION = gql`
  mutation DeleteBonusCampaign($id: ID!) {
    deleteBonusCampaign(id: $id) {
      success
      message
    }
  }
`

const UPDATE_CAMPAIGN_STATUS_MUTATION = gql`
  mutation UpdateBonusCampaignStatus($input: BonusCampaignUpdateInput!) {
    updateBonusCampaign(input: $input) {
      success
      message
      campaign {
        id
        status
      }
    }
  }
`

export default function BonusesListPage() {
  return (
    <RBACGuard required={ACCESS_REQUIREMENT}>
      <BonusesListPageContent />
    </RBACGuard>
  );
}

function BonusesListPageContent() {
  const pageEyebrow = usePageEyebrow()
  // A link may carry the search (?search=, the global search's "See all Bonuses").
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '')
  useSearchParamUpdates(setSearch)
  const [status, setStatus] = useState('')
  const [domain, setDomain] = useState('')
  const [type, setType] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [distributeModalOpen, setDistributeModalOpen] = useState(false)
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<DistributionPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Memoize variables to prevent identity change on every render
  const queryVariables = useMemo(
    () => buildBonusCampaignsVariables({ search, status, domain, type }),
    [status, domain, type, search],
  )

  const { data, loading, refetch } = useQuery(BONUS_CAMPAIGNS_QUERY, {
    variables: queryVariables,
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  })

  const [deleteCampaign, { loading: deleting }] = useMutation(DELETE_CAMPAIGN_MUTATION, {
    context: PAGE_REPORTS_OUTCOME,
    onCompleted: (data) => {
      if (data.deleteBonusCampaign.success) {
        notifySuccess(data.deleteBonusCampaign.message)
        refetch()
      } else {
        notifyError(data.deleteBonusCampaign.message)
      }
    },
    onError: (error) => {
      notifyError(error.message)
    },
  })

  const [updateCampaignStatus, { loading: updatingStatus }] = useMutation(UPDATE_CAMPAIGN_STATUS_MUTATION, {
    context: PAGE_REPORTS_OUTCOME,
    onCompleted: (data) => {
      if (data.updateBonusCampaign.success) {
        notifySuccess(data.updateBonusCampaign.message)
        refetch()
      } else {
        notifyError(data.updateBonusCampaign.message || 'Failed to update campaign status')
      }
    },
    onError: (error) => {
      notifyError(error.message)
    },
  })

  const [previewDistribution] = useLazyQuery(PREVIEW_DISTRIBUTION_QUERY, {
    fetchPolicy: 'network-only',
  })

  const [distributeBonusCampaign, { loading: distributing }] = useMutation(DISTRIBUTE_MUTATION, {
    context: PAGE_REPORTS_OUTCOME,
    onCompleted: (data) => {
      const result = data.distributeBonusCampaign
      if (result.success) {
        notifySuccess(distributedMessage(result.distributedCount))
        refetch()
        setDistributeModalOpen(false)
        setSelectedCampaignId(null)
        setPreviewData(null)
      } else {
        notifyError(result.message)
        setDistributeModalOpen(false)
      }
    },
    onError: (error) => {
      notifyError(error.message)
      setDistributeModalOpen(false)
    },
  })

  const campaigns = useMemo<BonusCampaignRow[]>(() => data?.bonusCampaigns || [], [data])

  // Pagination (client-side over the whole list); a page past the end shows the last page.
  const paginated = useMemo(
    () => bonusPageSlice(campaigns, currentPage, pageSize),
    [campaigns, currentPage, pageSize],
  )

  // Each handler returns the mutation, so its confirmation stays busy until the server answers.
  // deleteBonusCampaign ends the campaign (status ended); it does not remove it.
  const handleEnd = (id: string) => deleteCampaign({ variables: { id } })

  const handleActivate = (id: string) =>
    updateCampaignStatus({
      variables: {
        input: {
          id,
          status: 'active',
        },
      },
    })

  const handleDeactivate = (id: string) =>
    updateCampaignStatus({
      variables: {
        input: {
          id,
          status: 'paused',
        },
      },
    })

  const handleClearAll = () => {
    setSearch('')
    setStatus('')
    setDomain('')
    setType('')
    setCurrentPage(1)
  }

  const handleDistributeClick = async (campaignId: string) => {
    setSelectedCampaignId(campaignId)
    setPreviewData(null)
    setPreviewLoading(true)
    setDistributeModalOpen(true)
    try {
      const result = await previewDistribution({ variables: { campaignId } })
      const { data, error } = result
      if (error) {
        notifyError(error.message || 'Failed to load distribution preview')
        setDistributeModalOpen(false)
        return
      }
      if (data?.previewBonusDistribution) {
        setPreviewData(data.previewBonusDistribution)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load distribution preview'
      notifyError(message)
      setDistributeModalOpen(false)
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleDistributeConfirm = () => {
    if (!selectedCampaignId) return
    distributeBonusCampaign({ variables: { campaignId: selectedCampaignId } })
  }

  const closeDistribute = () => {
    setDistributeModalOpen(false)
    setSelectedCampaignId(null)
    setPreviewData(null)
  }

  // The create action is a router link with the primary button's look (it navigated to /bonuses/new).
  const createLinkClass = buttonClassName({ variant: 'primary', className: styles.createLink })

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Bonus Campaigns"
        sub="Manage bonus campaigns and rewards"
        actions={(
          <Link to="/bonuses/new" className={createLinkClass}>
            <IconPlus size={16} stroke={strokeFor(16)} aria-hidden="true" />
            <span>Create Campaign</span>
          </Link>
        )}
      />

      <div className={styles.content}>
        <StatsCards campaigns={campaigns} loading={loading} />

        <FiltersBar
          search={search}
          status={status}
          domain={domain}
          type={type}
          onSearchChange={setSearch}
          onStatusChange={setStatus}
          onDomainChange={setDomain}
          onTypeChange={setType}
          onClearAll={handleClearAll}
        />

        <BonusesTable
          campaigns={paginated.rows}
          exportRows={campaigns}
          loading={loading || deleting || updatingStatus}
          onEnd={handleEnd}
          onActivate={handleActivate}
          onDeactivate={handleDeactivate}
          onDistribute={(campaignId) => void handleDistributeClick(campaignId)}
          footer={!loading && campaigns.length > 0 ? (
            <Pagination
              current={paginated.page}
              pageSize={pageSize}
              total={campaigns.length}
              onChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              itemName="campaigns"
              variant="embedded"
            />
          ) : null}
        />
      </div>

      {/* BEYOND-MOCKUP: the mockup draws no distribution step; the legacy modal becomes the kit Dialog
          with the legacy copy, the danger action and its legacy disabled rule. */}
      <Dialog
        open={distributeModalOpen}
        onOpenChange={(open) => {
          if (!open) closeDistribute()
        }}
        title="Distribute Bonus"
        size="md"
        footer={(
          <>
            <Button onClick={closeDistribute}>Cancel</Button>
            <Button
              variant="dangerSolid"
              loading={distributing}
              disabled={distributeBlocked(previewLoading, previewData)}
              onClick={handleDistributeConfirm}
            >
              Distribute
            </Button>
          </>
        )}
      >
        {previewLoading ? (
          // the usual preview: two 18.85px lines and one 48.85px notice, 10px apart (.preview)
          <LoadingState label="Loading distribution preview" height={107} />
        ) : previewData ? (
          <div className={styles.preview}>
            <p className={styles.previewLine}>
              Campaign: <strong>{previewData.campaignName}</strong>
            </p>
            <p className={styles.previewLine}>
              Eligible users: <strong>{previewData.eligibleCount}</strong>
            </p>
            {previewData.alreadyDistributed ? (
              <Notice tone="info">This campaign has already been distributed.</Notice>
            ) : null}
            {previewData.eligibleCount === 0 && !previewData.alreadyDistributed ? (
              <Notice tone="warn">No eligible users for distribution.</Notice>
            ) : null}
            <Notice tone="warn">This action can only be done once and cannot be undone.</Notice>
          </div>
        ) : (
          <p className={styles.previewEmpty}>Unable to load preview.</p>
        )}
      </Dialog>
    </Page>
  )
}
