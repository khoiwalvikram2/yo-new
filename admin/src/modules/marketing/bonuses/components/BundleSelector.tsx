import { useState } from 'react'
import { useQuery, useMutation, gql } from '@apollo/client'
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { Tabs } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { StatusPill } from '@/ui/components/StatusPill'
import { confirm } from '@/ui/components/confirm'
import { BundleGamesList } from '../../bundles/CasinoGameBundlesPage'
import { bonusNotification as notification, type BonusBundle } from './bonusDetailModel'
import styles from './BonusDetailTabs.module.css'

const CASINO_GAME_BUNDLES_QUERY = gql`
  query CasinoGameBundles($search: String, $domain: BonusDomain) {
    casinoGameBundles(search: $search, domain: $domain) {
      id
      name
      description
      domain
      gameIds
      gameWeights
      gameCount
      createdAt
      updatedAt
    }
  }
`

const SAVE_BONUS_CAMPAIGN_GAMES = gql`
  mutation SaveBonusCampaignGames($campaignId: ID!, $gameIds: [ID!]!, $gameWeights: JSON) {
    saveBonusCampaignGames(campaignId: $campaignId, gameIds: $gameIds, gameWeights: $gameWeights) {
      success
      message
      campaign {
        id
        casinoGameIds
        casinoGameWeights
      }
    }
  }
`

interface BundleSelectorProps {
  campaignId: string
  currentGameIds: string[]
  currentGameWeights: Record<string, number> | null
  domain: string
  onUpdate: () => void
}

export function BundleSelector({
  campaignId,
  currentGameIds,
  currentGameWeights,
  domain,
  onUpdate,
}: BundleSelectorProps) {
  const navigate = useNavigate()
  const { formatDate } = useFormatDate()
  
  // Map domain to valid bundle domain (global -> casino, or use domain if valid)
  const getValidDomain = (dom: string): 'casino' | 'sports' | 'matka' => {
    if (dom === 'global' || !dom) return 'casino'
    if (dom === 'casino' || dom === 'sports' || dom === 'matka') return dom as 'casino' | 'sports' | 'matka'
    return 'casino' // default fallback
  }
  
  const [selectedDomain, setSelectedDomain] = useState<'casino' | 'sports' | 'matka'>(
    getValidDomain(domain)
  )
  const [expandedPanels, setExpandedPanels] = useState<string[]>([])

  const { data: bundlesData, loading: bundlesLoading, error: bundlesError } = useQuery(CASINO_GAME_BUNDLES_QUERY, {
    variables: {
      domain: selectedDomain,
    },
    errorPolicy: 'all',
  })

  const [executeapplyBundle, { loading: applying }] = useMutation(SAVE_BONUS_CAMPAIGN_GAMES, {
    onCompleted: (data) => {
      if (data.saveBonusCampaignGames.success) {
        notification.success({
          message: 'Bundle Applied',
          description: data.saveBonusCampaignGames.message,
        })
        onUpdate()
      } else {
        notification.error({
          message: 'Error',
          description: data.saveBonusCampaignGames.message,
        })
      }
    },
    onError: (error) => {
      notification.error({
        message: 'Error',
        description: error.message,
      })
    },
  })

  const applyBundle = async (options: Parameters<typeof executeapplyBundle>[0]) => {
    const result = await executeapplyBundle(options)
    if (!result.data?.saveBonusCampaignGames?.success) throw new Error(result.data?.saveBonusCampaignGames?.message || 'Campaign update failed')
    return result
  }

  const bundles = bundlesData?.casinoGameBundles || []

  const handleApplyBundle = async (bundle: { gameIds?: string[]; gameWeights?: Record<string, number> }) => {
    const bundleGameIds = bundle.gameIds || []
    const bundleGameWeights = bundle.gameWeights || {}

    // Merge with existing games (avoid duplicates)
    const existingGameIds = new Set(currentGameIds)
    const newGameIds = bundleGameIds.filter((id: string) => !existingGameIds.has(id))
    const allGameIds = [...currentGameIds, ...newGameIds]

    // Merge weights (bundle weights take precedence for new games)
    const newWeights = { ...currentGameWeights }
    bundleGameIds.forEach((gameId: string) => {
      if (bundleGameWeights[gameId] !== undefined) {
        newWeights[gameId] = bundleGameWeights[gameId]
      } else if (!newWeights[gameId]) {
        newWeights[gameId] = 1.0
      }
    })

    await applyBundle({
      variables: {
        campaignId,
        gameIds: allGameIds,
        gameWeights: newWeights,
      },
    })
  }

  return <div className={styles.stack}>
    <div className={styles.tabs}><Tabs value={selectedDomain} items={[{ value: 'casino', label: 'Casino' }, { value: 'sports', label: 'Sports' }, { value: 'matka', label: 'Matka' }]} onChange={(value) => { setSelectedDomain(value); setExpandedPanels([]) }} label="Domain selector" idPrefix="bonus-bundle-domain" /></div>
    {bundlesError && <Notice tone="error" title="Unable to load bundles">{bundlesError.message}</Notice>}
    <div className={styles.stack} role="tabpanel" id={tabPanelId('bonus-bundle-domain', selectedDomain)} aria-labelledby={tabId('bonus-bundle-domain', selectedDomain)}>
      {bundlesLoading ? <LoadingState label="Loading bundles" /> : bundles.length === 0 ? <EmptyState title={`No ${selectedDomain} bundles found`} /> : <>
        <p className={styles.muted}>{selectedDomain === 'casino' ? 'Casino' : selectedDomain === 'matka' ? 'Matka' : 'Sports'} Bundles · {bundles.length} {bundles.length === 1 ? 'bundle' : 'bundles'}</p>
        {bundles.map((bundle: BonusBundle) => {
          const expanded = expandedPanels.includes(bundle.id)
          const panelId = `bundle-games-${bundle.id}`
          return <section className={styles.bundle} key={bundle.id}>
            <div className={styles.bundleHead}>
              <button type="button" className={styles.bundleToggle} aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpandedPanels(expanded ? expandedPanels.filter(id => id !== bundle.id) : [...expandedPanels, bundle.id])}>
                <span><span className={styles.name}>{bundle.name}</span><span className={styles.bundleMeta}><StatusPill tone="info">{(bundle.domain || '').toUpperCase()}</StatusPill><StatusPill>{bundle.gameCount || 0} {bundle.domain === 'matka' ? 'markets' : 'games'}</StatusPill></span></span>{expanded ? <IconChevronUp size={16} aria-hidden /> : <IconChevronDown size={16} aria-hidden />}
              </button>
              <div className={styles.actions}><Button size="sm" loading={applying} onClick={() => void confirm({ title: 'Apply this bundle to the campaign?', description: 'This will add all games from the bundle to the campaign. Existing games will be preserved.', confirmLabel: 'Yes', cancelLabel: 'No', onConfirm: () => handleApplyBundle(bundle) })}>Apply</Button><Button size="sm" onClick={() => navigate(`/bonuses/bundles/${bundle.id}/edit`)}>Edit</Button></div>
            </div>
            {expanded && <div id={panelId} className={styles.bundleBody}>
              {bundle.description && <p className={styles.muted}>{bundle.description}</p>}
              <p className={styles.muted}>Created: {bundle.createdAt ? formatDate(bundle.createdAt, 'dd MMM yyyy') : '—'} · Updated: {bundle.updatedAt ? formatDate(bundle.updatedAt, 'dd MMM yyyy') : '—'}</p>
              {bundle.gameIds && bundle.gameIds.length > 0 ? <BundleGamesList gameIds={bundle.gameIds} domain={bundle.domain || ''} isExpanded={expanded} bundleId={bundle.id} gameWeights={bundle.gameWeights} onWeightsUpdate={() => {}} /> : <EmptyState title={`No ${bundle.domain === 'matka' ? 'markets' : 'games'} in this bundle`} />}
            </div>}
          </section>
        })}
      </>}
    </div>
    {selectedDomain === 'sports' && <Notice tone="warn" title="Sports Bundles">Sports bundle support is coming soon. Currently, only Casino and Matka bundles are available.</Notice>}
  </div>
}
