import { useState, useEffect } from 'react'
import { Trophy } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { graphqlRequest } from '@/lib/graphqlClient'
import StakePageHeader from '@/components/StakePageHeader'
// import { usePageSEO } from '@/hooks/usePageSEO' // SEO hook for future use
import VipHeroBanner from '@/components/vip/VipHeroBanner'
import VipStatusCard from '@/components/vip/VipStatusCard'
import VipHowItWorks from '@/components/vip/VipHowItWorks'
import VipTierCard from '@/components/vip/VipTierCard'
import '@/styles/account/vip.css'

type VIPTier = {
  id: string
  name: string
  level: number
  minMonthlyDeposit: number
  color: string
  benefits: string[]
  perks: Array<{ name: string; description: string; icon?: string | null }>
}

type VIPMember = {
  id: string
  tierId: string
  tierName: string
  tierLevel: number
  tierColor: string
  currentPoints: number
  lifetimePoints: number
  monthlyDeposits: number
  nextTier: VIPTier | null
  pointsToNextTier: number | null
  joinedAt: string
  benefits: string[]
  perks: Array<{ name: string; description: string; icon?: string | null }>
}

/** The status, or 'unavailable' when the account has no VIP programme (a credit player). */
async function getVipStatus(): Promise<VIPMember | null | 'unavailable'> {
  try {
    const data = await graphqlRequest<any>(
      `query VipStatus {
        vipStatus {
          meta { code message }
          data {
            id tierId tierName tierLevel tierColor
            currentPoints lifetimePoints monthlyDeposits
            nextTier { id name level minMonthlyDeposit color benefits perks { name description icon } }
            pointsToNextTier joinedAt benefits perks { name description icon }
          }
        }
      }`
    )
    if (data?.vipStatus?.meta?.code === 403) return 'unavailable'
    return data?.vipStatus?.data ?? null
  } catch (_error) {
    return null
  }
}

/** The tier list, or null when the request failed (an empty list is a programme with no tiers yet). */
async function getAllVipTiers(): Promise<VIPTier[] | null> {
  try {
    const data = await graphqlRequest<any>(
      `query VipTiers {
        vipTiers {
          meta { code message }
          data { id name level minMonthlyDeposit color benefits perks { name description icon } }
        }
      }`
    )
    return data?.vipTiers?.data ?? []
  } catch (_error) {
    return null
  }
}

export default function VipPage() {
  const { isAuthenticated, user } = useAuth()
  const creditPlayer = ['AGENT_CREDIT', 'WHITELABEL_CREDIT'].includes(user?.playerType || '')
  const navigate = useNavigate()
  const [vipStatus, setVipStatus] = useState<VIPMember | null>(null)
  const [allTiers, setAllTiers] = useState<VIPTier[]>([])
  const [loading, setLoading] = useState(true)
  const [tiersFailed, setTiersFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // Redirect to home if not authenticated
  useEffect(() => {
    if (!isAuthenticated || creditPlayer) {
      navigate('/')
    }
  }, [isAuthenticated, creditPlayer, navigate])

  useEffect(() => {
    // Only fetch data if authenticated
    if (!isAuthenticated || creditPlayer) return

    const fetchData = async () => {
      setLoading(true)
      const tiers = await getAllVipTiers()
      setAllTiers(tiers ?? [])
      setTiersFailed(tiers === null)
      const status = await getVipStatus()
      // A player owned by a CREDIT agent can have a non-credit type; the server knows.
      if (status === 'unavailable') { navigate('/'); return }
      setVipStatus(status)
      setLoading(false)
    }
    fetchData()
  }, [isAuthenticated, creditPlayer, reloadKey, navigate])

  // Don't render anything if not authenticated (redirect will happen)
  if (!isAuthenticated || creditPlayer) {
    return null
  }

  if (loading) {
    return (
      <div className="nova-vip-loading" role="status" aria-label="Loading VIP program">
        <span />
      </div>
    )
  }

  const progressPercentage = vipStatus?.nextTier && vipStatus.nextTier.minMonthlyDeposit > 0 && vipStatus
    ? Math.min(100, (vipStatus.monthlyDeposits / vipStatus.nextTier.minMonthlyDeposit) * 100)
    : 100

  return (
    <div className="space-y-4 pb-6">
      <StakePageHeader title="VIP Program" />

      <div className="nova-vip">
        <VipHeroBanner totalTiers={allTiers.length} />

        {isAuthenticated && vipStatus && (
          <VipStatusCard vipStatus={vipStatus} progressPercentage={progressPercentage} />
        )}

        <VipHowItWorks />

        <section className="nova-acct-panel nova-vip-panel">
          <header className="nova-acct-panel-head">
            <Trophy aria-hidden="true" />
            <h2>VIP Membership Tiers</h2>
            <span className="nova-vip-panel-note">Unlock exclusive rewards as you progress through premium tiers</span>
          </header>

          {allTiers.length === 0 ? (
            <div className={`nova-vip-empty${tiersFailed ? ' is-error' : ''}`} role={tiersFailed ? 'alert' : 'status'}>
              <p className="nova-vip-empty-title">{tiersFailed ? 'VIP tiers could not be loaded' : 'VIP tiers are not available yet'}</p>
              <p className="nova-vip-empty-text">{tiersFailed ? 'Please try again.' : 'Tiers and their rewards will appear here once the programme is set up.'}</p>
              {tiersFailed && <button type="button" className="nova-vip-retry" onClick={() => setReloadKey(key => key + 1)}>Try again</button>}
            </div>
          ) : <div className="nova-vip-tiers">
            {allTiers.map((tier) => {
              const isCurrentTier = vipStatus?.tierId === tier.id
              const isUnlocked = vipStatus ? tier.level <= vipStatus.tierLevel : false
              // Tiers follow this month's approved deposits, as in the status card above.
              const monthlyDeposits = isCurrentTier ? vipStatus?.monthlyDeposits : undefined

              return (
                <VipTierCard
                  key={tier.id}
                  tier={tier}
                  isCurrentTier={isCurrentTier}
                  isUnlocked={isUnlocked}
                  monthlyDeposits={monthlyDeposits}
                />
              )
            })}
          </div>}
        </section>
      </div>
    </div>
  )
}
