import { useQuery, gql } from '@apollo/client'
import { useState, useMemo, useEffect, useCallback, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IconEdit } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tabs } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { CasinoGamesTab } from './components/CasinoGamesTab'
import { MatkaGamesTab } from './components/MatkaGamesTab'
import { BundleSelector } from './components/BundleSelector'
import { ExclusionListTab } from './components/ExclusionListTab'
import styles from './BonusViewPage.module.css'

const GET_BONUS_CAMPAIGN_QUERY = gql`
  query GetBonusCampaign($id: ID!) {
    bonusCampaign(id: $id) {
      id
      name
      domain
      type
      status
      currency
      budgetNumeric
      codeMode
      validFrom
      validTo
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
      expiryBonusDays
      depositRequired
      releaseType
      casinoGameIds
      matkaGameIds
      casinoGameWeights
      matkaBidTypeWeights
      rulesJson
      limitsJson
      createdAt
      updatedAt
    }
  }
`

export default function BonusViewPage() {
  return (
    <RBACGuard required={[{ domain: 'bonuses.detail', actions: ['view'] }]}>
      <BonusViewPageContent />
    </RBACGuard>
  )
}

function BonusViewPageContent() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { formatAmount } = useCurrency()
  const { formatDateTime } = useFormatDate()
  const [activeTab, setActiveTab] = useState<string>('details')

  const { data, loading, error, refetch } = useQuery(GET_BONUS_CAMPAIGN_QUERY, {
    variables: { id },
    errorPolicy: 'all',
  })

  // Get campaign and domain early for hooks (handles null safely)
  const campaign = data?.bonusCampaign
  const domain = (campaign?.domain as string) || 'global'

  // All hooks MUST be called before any conditional returns (React rules of hooks)
  const tabOptions = useMemo(() => [
    { label: 'Campaign Details', value: 'details' },
    ...(['casino', 'global'].includes(domain) ? [{ label: 'Casino Games', value: 'casino' }] : []),
    ...(['matka', 'global'].includes(domain) ? [{ label: 'Matka Games', value: 'matka' }] : []),
    ...(['casino', 'matka', 'global'].includes(domain) ? [{ label: 'Bundles', value: 'bundles' }] : []),
    { label: 'Exclusion List', value: 'exclusions' },
  ], [domain])

  const validTabValues = useMemo(() => tabOptions.map((o) => o.value), [tabOptions])
  const effectiveActiveTab = validTabValues.includes(activeTab) ? activeTab : 'details'

  useEffect(() => {
    const validSet = new Set(validTabValues)
    if (!validSet.has(activeTab)) {
      setActiveTab('details')
    }
  }, [domain, activeTab, validTabValues])

  const handleUpdate = useCallback(() => {
    refetch()
  }, [refetch])

  if (loading && !campaign) return <Page><LoadingState label="Loading campaign" /></Page>
  if (!campaign) return <Page><PageHeader title="Bonus Campaign Details" back={{ to: '/bonuses', label: 'Back to List' }} />{error ? <Notice tone="error" title="Unable to load campaign">{error.message}<Button onClick={() => void refetch()}>Retry</Button></Notice> : <EmptyState title="Campaign not found" />}</Page>

  const formatBonusType = (type: string) => {
    if (type === 'direct_amount') return 'Direct Bonus'
    if (type === 'losing_bonus') return 'Losing Bonus'
    if (type === 'special') return 'Special Bonus'
    if (type === 'daily_first_deposit') return 'First Day First Time Deposit'
    return type
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const formatDateDisplay = (date?: string | null) => (date ? formatDateTime(date, 'dd MMM yyyy HH:mm') : '—')

  const renderTabContent = () => {
    if (effectiveActiveTab === 'details') {
      return (
        <dl className={styles.details}>
          <Detail label="Campaign Name">{campaign.name}</Detail>
          <Detail label="Status">
            <StatusPill status={campaign.status}>{campaign.status.toUpperCase()}</StatusPill>
          </Detail>
          <Detail label="Domain">
            <StatusPill tone="info">{domain === 'global' ? 'All' : domain.toUpperCase()}</StatusPill>
          </Detail>
          <Detail label="Bonus Type">{formatBonusType(campaign.type)}</Detail>
          <Detail label="Currency">{campaign.currency}</Detail>
          <Detail label="Budget">
            {formatAmount(campaign.budgetNumeric, campaign.currency)}
          </Detail>
          {campaign.codeMode && (
            <Detail label="Code Mode">
              {campaign.codeMode.replace('_', ' ').toUpperCase()}
            </Detail>
          )}
          {campaign.validFrom && (
            <Detail label="Valid From">
              {formatDateDisplay(campaign.validFrom)}
            </Detail>
          )}
          {campaign.validTo && (
            <Detail label="Valid To">
              {formatDateDisplay(campaign.validTo)}
            </Detail>
          )}
          {campaign.depositConditionType && (
            <>
              <Detail label="Deposit Condition Type">
                {campaign.depositConditionType.replace('_', ' ').toUpperCase()}
              </Detail>
              <Detail label="Deposit Condition Amount">
                {formatAmount(campaign.depositConditionAmount || 0, campaign.currency)}
              </Detail>
            </>
          )}
          <Detail label="Distribution Type">
            {campaign.distributionType
              ? campaign.distributionType.replace('_', ' ').toUpperCase()
              : '—'}
          </Detail>
          {campaign.type === 'signup' && campaign.depositRequired != null && (
            <Detail label="Deposit Required">
              {campaign.depositRequired ? 'Yes' : 'No'}
            </Detail>
          )}
          {campaign.distributionType === 'roll_over' && campaign.releaseType && (
            <Detail label="Release Type">
              {campaign.releaseType === 'bonus_amount_only'
                ? 'Bonus Amount Only'
                : 'Total Amount in Bonus Wallet'}
            </Detail>
          )}
          <Detail label="Amount Type">
            {campaign.amountType ? campaign.amountType.toUpperCase() : '—'}
          </Detail>
          {campaign.amountType === 'fixed' && (
            <Detail label="Amount">
              {formatAmount(campaign.amount || 0, campaign.currency)}
            </Detail>
          )}
          {campaign.amountType === 'percentage' && (
            <Detail label="Percentage">{campaign.percentage || 0}%</Detail>
          )}
          <Detail label="Number of Players">
            {campaign.numberOfPlayers ? campaign.numberOfPlayers : 'Unlimited'}
          </Detail>
          {!['signup', 'direct_amount'].includes(campaign.type) && (
            <Detail label="Usage Per Player">
              {campaign.usagePerPlayer || 1}
            </Detail>
          )}
          {campaign.expiryBonusDays != null && Number(campaign.expiryBonusDays) >= 1 && (
            <Detail label="Expiry bonus">
              {campaign.expiryBonusDays} days after award
            </Detail>
          )}
          <Detail label="Start Date">
            {campaign.startDate ? formatDateDisplay(campaign.startDate) : '—'}
          </Detail>
          <Detail label="End Date">
            {campaign.endDate ? formatDateDisplay(campaign.endDate) : '—'}
          </Detail>
          {campaign.wagering && (
            <Detail label="Wagering Requirement">
              {Number(campaign.wagering).toFixed(2)}x
            </Detail>
          )}
          <Detail label="Created At">{formatDateDisplay(campaign.createdAt)}</Detail>
          <Detail label="Updated At">{formatDateDisplay(campaign.updatedAt)}</Detail>
        </dl>
      )
    }

    if (effectiveActiveTab === 'casino') {
      return (
        <div className={styles.tabContent}>
          <CasinoGamesTab
            campaignId={campaign.id}
            currentGameIds={campaign.casinoGameIds || []}
            currentGameWeights={campaign.casinoGameWeights || null}
            onUpdate={handleUpdate}
          />
        </div>
      )
    }

    if (effectiveActiveTab === 'matka') {
      return (
        <div className={styles.tabContent}>
          <MatkaGamesTab
            campaignId={campaign.id}
            currentMatkaIds={campaign.matkaGameIds || []}
            currentBidTypeWeights={campaign.matkaBidTypeWeights || null}
            onUpdate={handleUpdate}
          />
        </div>
      )
    }

    if (effectiveActiveTab === 'bundles') {
      return (
        <div className={styles.tabContent}>
          <BundleSelector
            campaignId={campaign.id}
            currentGameIds={campaign.casinoGameIds || []}
            currentGameWeights={campaign.casinoGameWeights || null}
            domain={domain}
            onUpdate={handleUpdate}
          />
        </div>
      )
    }

    if (effectiveActiveTab === 'exclusions') {
      return (
        <div className={styles.tabContent}>
          <ExclusionListTab
            campaignId={campaign.id}
            excludedPlayerIds={(campaign.rulesJson as { excludedPlayerIds?: string[] })?.excludedPlayerIds || []}
            excludedAgentIds={(campaign.rulesJson as { excludedAgentIds?: string[] })?.excludedAgentIds || []}
            onUpdate={handleUpdate}
          />
        </div>
      )
    }

    return null
  }

  return (
    <Page maxWidth="wide">
      <PageHeader title={campaign.name} sub="Bonus Campaign Details" back={{ to: '/bonuses', label: 'Back' }}
        actions={<Button variant="primary" icon={<IconEdit size={16} />} onClick={() => navigate(`/bonuses/${id}/edit`)}>Edit</Button>} />
      {error && <Notice tone="warn" title="Campaign data may be incomplete">{error.message}<Button onClick={() => void refetch()}>Retry</Button></Notice>}
      <div className={styles.tabs}><Tabs value={effectiveActiveTab} items={tabOptions} onChange={setActiveTab} label="Tab selector" idPrefix="bonus-detail" /></div>
      <Card title={effectiveActiveTab === 'details' ? 'Campaign Details' : tabOptions.find(t => t.value === effectiveActiveTab)?.label} body={effectiveActiveTab === 'details' ? 'padded' : 'flush'}>
        <div role="tabpanel" id={tabPanelId('bonus-detail', effectiveActiveTab)} aria-labelledby={tabId('bonus-detail', effectiveActiveTab)}>{renderTabContent()}</div>
      </Card>
    </Page>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.detail}><dt>{label}</dt><dd>{children}</dd></div>
}
