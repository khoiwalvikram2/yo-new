import { useState, useEffect, useMemo } from 'react'
import { Gift, RefreshCw, Clock, CheckCircle, XCircle, AlertCircle, Calendar, Search, X, Lock } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import ModalSurface from '@/components/modals/ModalSurface'
import { formatAmount, getDefaultLocale } from '@/lib/currency'
import { graphqlRequest } from '@/lib/graphqlClient'
import { requestWithToast } from '@/lib/request'
import { notify } from '@/lib/notify'
import { extractApiMessage } from '@/lib/errors'
import type { CurrencyCode } from '@/types'
import { useNavigate } from 'react-router-dom'
import StakePageHeader from '@/components/StakePageHeader'
import { SegmentedTabs } from '@/components/bonus/SegmentedTabs'
import { SwitchBonusModal } from '@/components/bonus/SwitchBonusModal'
import { usePageSEO } from '@/hooks/usePageSEO'
import { getBonusHistory, switchBonus } from '@/lib/api/user'
import CustomDatePicker from '@/components/statements/CustomDatePicker'
import {
  getStartOfDayKolkata,
  getEndOfDayKolkata,
  getTodayKolkata,
  getYesterdayKolkata,
  addDaysKolkata,
} from '@/lib/dateUtils'
import '@/styles/account/bonus.css'

type BonusStatus = 'available' | 'active' | 'completed' | 'claimed' | 'expired' | 'forfeited'

type BonusItem = {
  id: string
  name: string
  amount: number
  createdAt: string
  awardedAt?: string | null
  completedAt?: string | null
  claimedAt?: string | null
  depositAmount?: number | null
  expiry: string | null
  rollingX: number
  wagered: number
  imageUrl?: string
  status: BonusStatus
  firstDepositRequired?: boolean
  firstDepositMade?: boolean
  activatedAt?: string
  campaignDetails?: {
    id: string
    name: string
    type: string
    domain: string
    status: string
    currency?: string
    distributionType?: string
    amountType?: string
    percentage?: number
    wagering?: number
    depositConditionType?: string
    depositConditionAmount?: number
    releaseType?: string
    expiryBonusDays?: number
  } | null
  distributionType?: string
  currency?: string
  domain?: string
  type?: string
}

type BonusHistoryItem = {
  id: string
  name: string
  amount: number
  status: string
  currency: string
  awardedAt: string
  completedAt?: string
  claimedAt?: string
  domain?: string
  type?: string
  distributionType?: string
  depositAmount?: number
  wageringAmount?: number
  fulfilledAmount?: number
  expiresAt?: string
  amountType?: string
  percentage?: number
  wagering?: number
  releaseType?: string
  expiryBonusDays?: number
}

type TabKey = 'active-bonus' | 'available' | 'history'

const bonusTypeLabels: Record<string, string> = {
  deposit: 'Deposit',
  signup: 'Sign Up',
  direct_freebet: 'Free Bet',
  direct_free_spin: 'Free Spin',
  direct_amount: 'Direct Amount',
  referral_deposit: 'Referral',
  deposit_match: 'Deposit Match',
  cashback_loss: 'Cashback',
  direct_event: 'Event',
  free_bet: 'Free Bet',
  free_spins: 'Free Spins',
  casino_credit: 'Casino Credit',
  loyalty: 'Loyalty',
  reload: 'Reload',
}

const domainLabels: Record<string, string> = {
  sports: 'Sports',
  casino: 'Casino',
  matka: 'Matka',
  global: 'Global',
}

// Domain tags stay neutral; the modifier only colours the small dot in front (styles/account/bonus.css).
const domainColors: Record<string, string> = {
  sports: 'is-sports',
  casino: 'is-casino',
  matka: 'is-matka',
  global: 'is-global',
}

const distributionTypeLabels: Record<string, string> = {
  instant_otp: 'Instant OTP',
  instant_cash: 'Instant Cash',
  roll_over: 'Roll Over',
}

const depositConditionLabels: Record<string, string> = {
  greater_than: '>',
  equal_to: '=',
  less_than: '<',
  greater_equal: '≥',
  less_equal: '≤',
}

const releaseTypeLabels: Record<string, string> = {
  bonus_amount_only: 'Bonus Amount Only',
  total_bonus_wallet: 'Total Bonus Wallet',
}

/** History status as a matchbook chip (nova-account.css); unknown statuses render nothing, as before. */
function HistoryStatusChip({ status }: { status: string }) {
  if (status === 'claimed') return <span className="nova-acct-chip is-success"><CheckCircle aria-hidden="true" />Claimed</span>
  if (status === 'completed') return <span className="nova-acct-chip is-info"><CheckCircle aria-hidden="true" />Completed</span>
  if (status === 'active') return <span className="nova-acct-chip is-success"><Clock aria-hidden="true" />Active</span>
  if (status === 'expired') return <span className="nova-acct-chip is-neutral"><XCircle aria-hidden="true" />Expired</span>
  if (status === 'forfeited') return <span className="nova-acct-chip is-failed"><XCircle aria-hidden="true" />Forfeited</span>
  if (status === 'available') return <span className="nova-acct-chip is-pending"><AlertCircle aria-hidden="true" />Available</span>
  return null
}

export default function BonusPage() {
  usePageSEO({ 
    title: 'Bonuses', 
    description: 'View and claim your bonuses and rewards' 
  })
  
  const { isAuthenticated, openAuthModal, user, syncWallet } = useAuth()
  const navigate = useNavigate()

  // Check if user is a credit player (should not access bonus page)
  const playerType = (user as any)?.playerType || 'REGULAR'
  const isCreditPlayer = playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT'

  // Redirect credit players - they cannot access bonus page
  useEffect(() => {
    if (isAuthenticated && isCreditPlayer) {
      navigate('/', { replace: true })
    }
  }, [isAuthenticated, isCreditPlayer, navigate])

  const [activeTab, setActiveTab] = useState<TabKey>('active-bonus')
  const [myBonuses, setMyBonuses] = useState<BonusItem[]>([])
  const [bonusHistory, setBonusHistory] = useState<BonusHistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)

  // Switch bonus modal state
  const [showSwitchModal, setShowSwitchModal] = useState(false)
  const [pendingBonusToActivate, setPendingBonusToActivate] = useState<BonusItem | null>(null)
  const [isSwitching, setIsSwitching] = useState(false)

  // First deposit required modal state
  const [showFirstDepositModal, setShowFirstDepositModal] = useState(false)
  const [claimingBonus, setClaimingBonus] = useState(false)

  // Get current active bonus
  const currentActiveBonus = useMemo(() => {
    return myBonuses.find((bonus) => bonus.status === 'active') || null
  }, [myBonuses])

  // Bonus History filters (same pattern as Account Statement)
  const [historyDateFilter, setHistoryDateFilter] = useState<string>('month')
  const [historyCustomStartDate, setHistoryCustomStartDate] = useState<string>('')
  const [historyCustomEndDate, setHistoryCustomEndDate] = useState<string>('')
  const [showHistoryCustomDate, setShowHistoryCustomDate] = useState(false)
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('all')
  const [historySearchQuery, setHistorySearchQuery] = useState('')

  const getHistoryDateRange = () => {
    let startDate: Date
    let endDate: Date
    if (historyDateFilter === 'today') {
      const todayStr = getTodayKolkata()
      startDate = getStartOfDayKolkata(todayStr)
      endDate = getEndOfDayKolkata(todayStr)
    } else if (historyDateFilter === 'yesterday') {
      const yesterdayStr = getYesterdayKolkata()
      startDate = getStartOfDayKolkata(yesterdayStr)
      endDate = getEndOfDayKolkata(yesterdayStr)
    } else if (historyDateFilter === '7days') {
      const todayStr = getTodayKolkata()
      const sevenDaysAgoStr = addDaysKolkata(todayStr, -7)
      startDate = getStartOfDayKolkata(sevenDaysAgoStr)
      endDate = getEndOfDayKolkata(todayStr)
    } else if (historyDateFilter === 'month') {
      const todayStr = getTodayKolkata()
      const [year, month] = todayStr.split('-').map(Number)
      const firstDayStr = `${year}-${String(month).padStart(2, '0')}-01`
      startDate = getStartOfDayKolkata(firstDayStr)
      endDate = getEndOfDayKolkata(todayStr)
    } else if (historyDateFilter === 'custom') {
      if (historyCustomStartDate && historyCustomEndDate) {
        startDate = getStartOfDayKolkata(historyCustomStartDate)
        endDate = getEndOfDayKolkata(historyCustomEndDate)
      } else {
        const todayStr = getTodayKolkata()
        startDate = getStartOfDayKolkata(todayStr)
        endDate = getEndOfDayKolkata(todayStr)
      }
    } else {
      const todayStr = getTodayKolkata()
      startDate = getStartOfDayKolkata(todayStr)
      endDate = getEndOfDayKolkata(todayStr)
    }
    return { start: startDate.toISOString(), end: endDate.toISOString() }
  }

  // Load bonuses function - can be called to refresh data
  const loadBonuses = async (showLoadingState = true) => {
    if (showLoadingState) setLoading(true)
    try {
      // Load my bonuses
      const bonusData = await graphqlRequest<{ bonusData: { meta: any; data: any[] } }>(`
        query {
          bonusData {
            meta { code message }
            data {
              id
              bonusAmount
              createdAt
              awardedAt
              completedAt
              claimedAt
              depositAmount
              expiresAt
              wageringAmount
              fulfilledAmount
              status
              firstDepositRequired
              firstDepositMade
              currency
              distributionType
              domain
              type
              campaignDetails {
                id
                name
                type
                domain
                status
                currency
                distributionType
                amountType
                percentage
                wagering
                depositConditionType
                depositConditionAmount
                releaseType
                expiryBonusDays
              }
            }
          }
        }
      `)

      if (bonusData.bonusData?.data) {
        const bonuses = bonusData.bonusData.data.map((b: any) => ({
          id: b.id,
          name: b.campaignDetails?.name || 'Bonus',
          amount: b.bonusAmount || 0,
          createdAt: b.createdAt,
          awardedAt: b.awardedAt ?? null,
          completedAt: b.completedAt ?? null,
          claimedAt: b.claimedAt ?? null,
          depositAmount: b.depositAmount ?? null,
          expiry: b.expiresAt,
          rollingX: b.wageringAmount || 0,
          wagered: b.fulfilledAmount || 0,
          status: (b.status === 'active' ? 'active' : b.status === 'completed' ? 'completed' : b.status === 'claimed' ? 'claimed' : b.status === 'expired' ? 'expired' : b.status === 'cancelled' ? 'forfeited' : 'available') as BonusStatus,
          firstDepositRequired: b.firstDepositRequired ?? false,
          firstDepositMade: b.firstDepositMade ?? false,
          currency: b.currency || b.campaignDetails?.currency,
          campaignDetails: b.campaignDetails,
          distributionType: b.distributionType ?? b.campaignDetails?.distributionType,
          domain: b.domain ?? b.campaignDetails?.domain,
          type: b.type ?? b.campaignDetails?.type,
        }))
        setMyBonuses(bonuses)
      }

    } catch (error: any) {
      console.error('Failed to load bonuses:', error)
      notify.error(extractApiMessage(error))
    } finally {
      if (showLoadingState) setLoading(false)
    }
  }

  // Load bonuses on mount
  useEffect(() => {
    if (!isAuthenticated) return
    loadBonuses()
  }, [isAuthenticated])

  // Load bonus history when history tab is selected or filters change
  useEffect(() => {
    if (!isAuthenticated || activeTab !== 'history') return

    const loadHistory = async () => {
      setHistoryLoading(true)
      try {
        const { start, end } = getHistoryDateRange()
        const filters: { fromDate?: string; toDate?: string; status?: string } = {
          fromDate: start,
          toDate: end,
        }
        if (historyStatusFilter !== 'all') {
          filters.status = historyStatusFilter
        }
        const response = await getBonusHistory(filters)
        if (response.data) {
          setBonusHistory(
            response.data.map((item: BonusHistoryItem) => ({
              ...item,
              status: item.status === 'cancelled' ? 'forfeited' : item.status,
            }))
          )
        }
      } catch (error: any) {
        console.error('Failed to load bonus history:', error)
        notify.error(extractApiMessage(error))
      } finally {
        setHistoryLoading(false)
      }
    }

    loadHistory()
  }, [isAuthenticated, activeTab, historyDateFilter, historyCustomStartDate, historyCustomEndDate, historyStatusFilter])

  const handleActivateBonus = async (bonusId: string) => {
    // Find the bonus to activate
    const bonusToActivate = myBonuses.find((b) => b.id === bonusId)
    if (!bonusToActivate) {
      notify.error('Bonus not found')
      return
    }

    // Check if first deposit is required but not made yet - show modal
    if (bonusToActivate.firstDepositRequired && !bonusToActivate.firstDepositMade) {
      setShowFirstDepositModal(true)
      return
    }

    // Check if user already has an active bonus
    if (currentActiveBonus) {
      // Show switch modal instead of directly activating
      setPendingBonusToActivate(bonusToActivate)
      setShowSwitchModal(true)
      return
    }

    // No active bonus, proceed with normal activation
    setClaimingBonus(true)
    try {
      // `bonusId` goes in as a variable, not spliced into the document text.
      // Written the other way it could not be validated by anything short of
      // running it, and a value carrying a quote would change what the mutation
      // asks for rather than failing.
      const result = await graphqlRequest<{ activateBonus: { meta: any; data: any[] } }>(
        `
        mutation ActivateBonus($bonusId: ID!) {
          activateBonus(bonusId: $bonusId) {
            meta { code message }
            data {
              id
              status
            }
          }
        }
      `,
        { bonusId }
      )
      
      if (result.activateBonus?.meta?.code !== 200) {
        notify.error(result.activateBonus?.meta?.message || 'Failed to activate bonus')
        return
      }
      
      notify.success('Bonus activated successfully! Check "Active Bonus" tab.')
      await syncWallet?.()
      await loadBonuses(false)
    } catch (error: any) {
      notify.error(extractApiMessage(error))
    } finally {
      setClaimingBonus(false)
    }
  }

  const handleSwitchBonus = async () => {
    if (!pendingBonusToActivate) return
    
    setIsSwitching(true)
    try {
      const result = await switchBonus(pendingBonusToActivate.id)
      if (result.meta?.code === 200) {
        notify.success('Bonus switched successfully! Check "Active Bonus" tab.')
        setShowSwitchModal(false)
        setPendingBonusToActivate(null)
        await syncWallet?.()
        await loadBonuses(false)
      } else {
        notify.error(result.meta?.message || 'Failed to switch bonus')
      }
    } catch (error: any) {
      notify.error(extractApiMessage(error))
    } finally {
      setIsSwitching(false)
    }
  }

  const handleCloseSwitchModal = () => {
    setShowSwitchModal(false)
    setPendingBonusToActivate(null)
  }

  const handleClaimBonus = async (_bonusId: string) => {
    try {
      await requestWithToast(
        () => graphqlRequest<{ claimBonus: { meta: any; data: any[] } }>(`
          mutation {
            claimBonus {
              meta { code message }
              data {
                id
                status
              }
            }
          }
        `),
        {
          success: 'Bonus claimed successfully',
          error: 'Failed to claim bonus',
        }
      )
      await syncWallet?.()
      await loadBonuses(false)
    } catch (error: any) {
      notify.error(extractApiMessage(error))
    }
  }

  // Client-side search for bonus history
  const historyFiltered = useMemo(() => {
    if (!historySearchQuery.trim()) return bonusHistory
    const q = historySearchQuery.toLowerCase().trim()
    return bonusHistory.filter(
      (item) =>
        item.name?.toLowerCase().includes(q) ||
        item.id?.toLowerCase().includes(q) ||
        item.amount?.toString().includes(q) ||
        item.status?.toLowerCase().includes(q) ||
        item.currency?.toLowerCase().includes(q) ||
        (item.type && (bonusTypeLabels[item.type] || item.type).toLowerCase().includes(q)) ||
        (item.domain && (domainLabels[item.domain] || item.domain).toLowerCase().includes(q)) ||
        (item.distributionType && (distributionTypeLabels[item.distributionType] || item.distributionType).toLowerCase().includes(q))
    )
  }, [bonusHistory, historySearchQuery])

  if (!isAuthenticated) {
    // Runs after every hook: an early return above the hooks would change hook
  // order between renders (playerType arrives asynchronously) and crash the
  // page. The redirect is handled by the effect above.
  if (isCreditPlayer) {
    return null
  }

  return (
      <div className="bon-page">
        <StakePageHeader title="Bonuses" />
        <div className="nova-acct-panel bon-empty is-login">
          <div className="bon-empty-icon is-gift">
            <Gift aria-hidden="true" />
          </div>
          <h2 className="bon-empty-title">
            Access Your Bonuses
          </h2>
          <p className="bon-empty-text">
            Please log in to view and claim your bonuses
          </p>
          <button
            type="button"
            onClick={() => openAuthModal()}
            className="bon-btn bon-btn-primary bon-empty-action"
          >
            Log In
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bon-page">
      <StakePageHeader title="Bonuses" />

      {/* Tab Navigation */}
      <div className="w-full">
        <SegmentedTabs
          theme="slate"
          fullWidth
          tabs={[
            { key: 'active-bonus', label: 'Active Bonus' },
            { key: 'available', label: 'Available' },
            { key: 'history', label: 'Bonus History' },
          ]}
          value={activeTab}
          onChange={(k: string) => setActiveTab(k as TabKey)}
        />
      </div>

      {/* Bonus Code Redemption – hidden */}

      {/* Active Bonus Tab - Only shows bonuses with status 'active' */}
      {activeTab === 'active-bonus' && (
        <div className="bon-section">
          {loading ? (
            <div className="nova-acct-panel bon-loading">
              <RefreshCw className="bon-loading-icon animate-spin" aria-hidden="true" />
            </div>
          ) : myBonuses.filter((b) => b.status === 'active').length === 0 ? (
            <div className="nova-acct-panel bon-empty">
              <div className="bon-empty-icon is-gift">
                <Gift aria-hidden="true" />
              </div>
              <p className="bon-empty-title">No active bonus</p>
              <p className="bon-empty-text">Activate a bonus from the Available tab</p>
            </div>
          ) : (
            <div className="bon-grid is-active">
              {myBonuses.filter((b) => b.status === 'active').map((bonus) => {
                const wagerPct = bonus.rollingX > 0 ? Math.min((bonus.wagered / bonus.rollingX) * 100, 100) : 0
                const wagerRemaining = bonus.rollingX > 0 ? Math.max(bonus.rollingX - bonus.wagered, 0) : 0
                const cd = bonus.campaignDetails
                return (
                <article key={bonus.id} className="bon-card is-active">
                  {/* Header: Name, Amount, Status */}
                  <header className="bon-card-head">
                    <div className="bon-card-title">
                      <h3 className="bon-card-name">
                        {bonus.name}
                      </h3>
                      <p className="bon-card-amount">
                        {formatAmount(bonus.amount, bonus.currency as CurrencyCode)}
                        {cd?.amountType === 'percentage' && cd.percentage ? (
                          <span className="bon-card-pct">({cd.percentage}%)</span>
                        ) : null}
                      </p>
                    </div>
                    <span className="nova-acct-chip is-success">
                      Active
                    </span>
                  </header>

                  {/* Tags: Type, Domain, Distribution */}
                  {(bonus.type || bonus.domain || bonus.distributionType) && (
                    <div className="bon-tags">
                      {bonus.type && (
                        <span className="bon-tag">
                          {bonusTypeLabels[bonus.type] || bonus.type}
                        </span>
                      )}
                      {bonus.domain && (
                        <span className={`bon-tag is-domain ${domainColors[bonus.domain] || ''}`}>
                          {domainLabels[bonus.domain] || bonus.domain}
                        </span>
                      )}
                      {bonus.distributionType && (
                        <span className="bon-tag is-outline">
                          {distributionTypeLabels[bonus.distributionType] || bonus.distributionType}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="bon-card-body">
                    {/* Details Grid */}
                    <dl className="bon-rows">
                      {bonus.depositAmount != null && bonus.depositAmount > 0 && (
                        <div className="bon-row">
                          <dt>Deposit:</dt>
                          <dd>
                            {formatAmount(bonus.depositAmount, bonus.currency as CurrencyCode)}
                          </dd>
                        </div>
                      )}
                      {cd?.depositConditionType && cd.depositConditionAmount != null && (
                        <div className="bon-row">
                          <dt>Deposit Condition:</dt>
                          <dd>
                            {depositConditionLabels[cd.depositConditionType] || cd.depositConditionType} {formatAmount(cd.depositConditionAmount, bonus.currency as CurrencyCode)}
                          </dd>
                        </div>
                      )}
                      {bonus.awardedAt && (
                        <div className="bon-row">
                          <dt>Awarded:</dt>
                          <dd>
                            {new Date(bonus.awardedAt).toLocaleDateString(getDefaultLocale(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </dd>
                        </div>
                      )}
                      {bonus.expiry && (
                        <div className="bon-row">
                          <dt>Expires on:</dt>
                          <dd>
                            {new Date(bonus.expiry).toLocaleDateString(getDefaultLocale(), { day: '2-digit', month: 'short', year: 'numeric' })}
                            {cd?.expiryBonusDays ? <span className="bon-row-note">({cd.expiryBonusDays}d)</span> : null}
                          </dd>
                        </div>
                      )}
                      {bonus.claimedAt && (
                        <div className="bon-row">
                          <dt>Claimed:</dt>
                          <dd>
                            {new Date(bonus.claimedAt).toLocaleDateString(getDefaultLocale(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </dd>
                        </div>
                      )}
                      {cd?.releaseType && (
                        <div className="bon-row">
                          <dt>Release:</dt>
                          <dd>
                            {releaseTypeLabels[cd.releaseType] || cd.releaseType}
                          </dd>
                        </div>
                      )}
                    </dl>

                    {/* Wagering Progress */}
                    {bonus.rollingX > 0 && (
                      <div className="bon-wager">
                        <div className="bon-wager-head">
                          <span className="bon-wager-label">
                            Wagering{cd?.wagering ? <span className="bon-wager-x">({cd.wagering}x)</span> : null}
                          </span>
                          <span className="bon-wager-pct">
                            {wagerPct.toFixed(1)}%
                          </span>
                        </div>
                        <div className="bon-bar" aria-hidden="true">
                          <span
                            style={{
                              width: `${wagerPct}%`,
                            }}
                          />
                        </div>
                        <div className="bon-wager-figs">
                          <div>
                            <small>Wagered:</small> <b>{formatAmount(bonus.wagered)}</b>
                          </div>
                          <div>
                            <small>Remaining:</small> <b>{formatAmount(wagerRemaining)}</b>
                          </div>
                          <div>
                            <small>Target:</small> <b>{formatAmount(bonus.rollingX)}</b>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* First Deposit Required */}
                  {bonus.firstDepositRequired && !bonus.firstDepositMade && (
                    <div className="bon-lock">
                      <Lock aria-hidden="true" />
                      First deposit required to unlock
                    </div>
                  )}

                  {bonus.status === 'completed' && bonus.rollingX > 0 && bonus.wagered >= bonus.rollingX && (
                    <div className="bon-card-foot">
                      <button
                        onClick={() => handleClaimBonus(bonus.id)}
                        className="bon-btn bon-btn-claim"
                      >
                        Claim Bonus
                      </button>
                    </div>
                  )}
                </article>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Available Tab - Shows user's available bonuses + campaigns to claim */}
      {activeTab === 'available' && (
        <div className="bon-section">
          {loading ? (
            <div className="nova-acct-panel bon-loading">
              <RefreshCw className="bon-loading-icon animate-spin" aria-hidden="true" />
            </div>
          ) : (
            <>
              {/* User's bonuses that can be activated */}
              {myBonuses.filter((b) => b.status === 'available').length > 0 && (
                <section className="nova-acct-panel bon-panel">
                  <div className="nova-acct-panel-head">
                    <Gift className="bon-head-icon" aria-hidden="true" />
                    <h3>Your Bonuses - Ready to Activate</h3>
                    <span className="bon-head-count">{myBonuses.filter((b) => b.status === 'available').length}</span>
                  </div>
                  <div className="bon-grid is-available">
                    {myBonuses.filter((b) => b.status === 'available').map((bonus) => {
                      const cd = bonus.campaignDetails
                      return (
                      <article key={bonus.id} className="bon-card is-available">
                        {/* Header: Name, Amount, Status */}
                        <header className="bon-card-head">
                          <div className="bon-card-title">
                            <h3 className="bon-card-name">
                              {bonus.name}
                            </h3>
                            <p className="bon-card-amount">
                              {formatAmount(bonus.amount, bonus.currency as CurrencyCode)}
                              {cd?.amountType === 'percentage' && cd.percentage ? (
                                <span className="bon-card-pct">({cd.percentage}%)</span>
                              ) : null}
                            </p>
                          </div>
                          <span className="nova-acct-chip is-ready">
                            Ready
                          </span>
                        </header>

                        {/* Tags: Type, Domain, Distribution */}
                        {(bonus.type || bonus.domain || bonus.distributionType) && (
                          <div className="bon-tags">
                            {bonus.type && (
                              <span className="bon-tag">
                                {bonusTypeLabels[bonus.type] || bonus.type}
                              </span>
                            )}
                            {bonus.domain && (
                              <span className={`bon-tag is-domain ${domainColors[bonus.domain] || ''}`}>
                                {domainLabels[bonus.domain] || bonus.domain}
                              </span>
                            )}
                            {bonus.distributionType && (
                              <span className="bon-tag is-outline">
                                {distributionTypeLabels[bonus.distributionType] || bonus.distributionType}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Details */}
                        <div className="bon-card-body">
                          <dl className="bon-rows">
                            {bonus.depositAmount != null && bonus.depositAmount > 0 && (
                              <div className="bon-row">
                                <dt>Deposit:</dt>
                                <dd>
                                  {formatAmount(bonus.depositAmount, bonus.currency as CurrencyCode)}
                                </dd>
                              </div>
                            )}
                            {cd?.depositConditionType && cd.depositConditionAmount != null && (
                              <div className="bon-row">
                                <dt>Deposit Condition:</dt>
                                <dd>
                                  {depositConditionLabels[cd.depositConditionType] || cd.depositConditionType} {formatAmount(cd.depositConditionAmount, bonus.currency as CurrencyCode)}
                                </dd>
                              </div>
                            )}
                            {cd?.wagering != null && cd.wagering > 0 && (
                              <div className="bon-row">
                                <dt>Wagering:</dt>
                                <dd>{cd.wagering}x</dd>
                              </div>
                            )}
                            {bonus.awardedAt && (
                              <div className="bon-row">
                                <dt>Awarded:</dt>
                                <dd>
                                  {new Date(bonus.awardedAt).toLocaleDateString(getDefaultLocale(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </dd>
                              </div>
                            )}
                            {bonus.expiry && (
                              <div className="bon-row">
                                <dt>Expires on:</dt>
                                <dd>
                                  {new Date(bonus.expiry).toLocaleDateString(getDefaultLocale(), { day: '2-digit', month: 'short', year: 'numeric' })}
                                  {cd?.expiryBonusDays ? <span className="bon-row-note">({cd.expiryBonusDays}d)</span> : null}
                                </dd>
                              </div>
                            )}
                            {cd?.releaseType && (
                              <div className="bon-row">
                                <dt>Release:</dt>
                                <dd>
                                  {releaseTypeLabels[cd.releaseType] || cd.releaseType}
                                </dd>
                              </div>
                            )}
                          </dl>
                        </div>

                        <div className="bon-card-foot">
                          {/* First Deposit Required */}
                          {bonus.firstDepositRequired && !bonus.firstDepositMade && (
                            <div className="bon-lock">
                              <Lock aria-hidden="true" />
                              First deposit required to unlock
                            </div>
                          )}

                          <button
                            onClick={() => handleActivateBonus(bonus.id)}
                            disabled={claimingBonus}
                            className={`bon-btn ${bonus.distributionType === 'instant_cash' ? 'bon-btn-claim' : 'bon-btn-primary'}`}
                          >
                            {claimingBonus ? (
                              <span className="bon-btn-busy">
                                <RefreshCw className="animate-spin" aria-hidden="true" />
                                {bonus.distributionType === 'instant_cash' ? 'Claiming...' : 'Activating...'}
                              </span>
                            ) : bonus.distributionType === 'instant_cash' ? (
                              'Claim'
                            ) : (
                              'Activate Bonus'
                            )}
                          </button>
                        </div>
                      </article>
                      )
                    })}
                  </div>
                </section>
              )}

              {/* Empty state when no bonuses available */}
              {myBonuses.filter((b) => b.status === 'available').length === 0 && (
                <div className="nova-acct-panel bon-empty">
                  <div className="bon-empty-icon is-gift">
                    <Gift aria-hidden="true" />
                  </div>
                  <p className="bon-empty-title">No available bonuses</p>
                  <p className="bon-empty-text">Check back later for new bonus offers</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Bonus History Tab */}
      {activeTab === 'history' && (
        <div className="bon-section">
          {/* Bonus History Filters - one hairline strip, same as Account Statement */}
          <div className="bon-filters">
            <div className="bon-filter-row">
              <div className="bon-search">
                <Search className="bon-filter-icon" aria-hidden="true" />
                <input
                  type="text"
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                  placeholder="Search by name, amount, status..."
                  className="bon-input"
                />
                {historySearchQuery && (
                  <button
                    onClick={() => setHistorySearchQuery('')}
                    className="bon-search-clear"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="bon-date-group">
                <div className="bon-date-select">
                  <Calendar className="bon-filter-icon" aria-hidden="true" />
                  <select
                    value={historyDateFilter}
                    onChange={(e) => {
                      setHistoryDateFilter(e.target.value)
                      setShowHistoryCustomDate(e.target.value === 'custom')
                      if (e.target.value !== 'custom') {
                        setHistoryCustomStartDate('')
                        setHistoryCustomEndDate('')
                      }
                    }}
                    className="bon-select has-icon"
                  >
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="7days">Last 7 Days</option>
                    <option value="month">Current Month</option>
                    <option value="custom">Custom Range</option>
                  </select>
                </div>
                {showHistoryCustomDate && (
                  <div className="bon-range">
                    <CustomDatePicker
                      value={historyCustomStartDate}
                      onChange={setHistoryCustomStartDate}
                      max={historyCustomEndDate || new Date().toISOString().split('T')[0]}
                      placeholder="Start date"
                    />
                    <span className="bon-range-arrow" aria-hidden="true">
                      →
                    </span>
                    <CustomDatePicker
                      value={historyCustomEndDate}
                      onChange={setHistoryCustomEndDate}
                      min={historyCustomStartDate}
                      max={new Date().toISOString().split('T')[0]}
                      placeholder="End date"
                    />
                    {(historyCustomStartDate || historyCustomEndDate) && (
                      <button
                        onClick={() => {
                          setHistoryCustomStartDate('')
                          setHistoryCustomEndDate('')
                        }}
                        className="bon-range-clear"
                        aria-label="Clear dates"
                        title="Clear dates"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
              <select
                value={historyStatusFilter}
                onChange={(e) => setHistoryStatusFilter(e.target.value)}
                className="bon-select bon-status-select"
              >
                <option value="all">All Status</option>
                <option value="claimed">Claimed</option>
                <option value="completed">Completed</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="forfeited">Forfeited</option>
                <option value="available">Available</option>
              </select>
              {(historySearchQuery || historyDateFilter !== 'month' || historyStatusFilter !== 'all') && (
                <div className="bon-count">
                  {historyFiltered.length} result{historyFiltered.length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>

          {historyLoading ? (
            <div className="nova-acct-panel bon-loading">
              <RefreshCw className="bon-loading-icon animate-spin" aria-hidden="true" />
            </div>
          ) : historyFiltered.length === 0 ? (
            <div className="nova-acct-panel bon-empty">
              <div className="bon-empty-icon">
                <Clock aria-hidden="true" />
              </div>
              <p className="bon-empty-title">
                {bonusHistory.length === 0 ? 'No bonus history' : 'No results found'}
              </p>
              <p className="bon-empty-text">
                {bonusHistory.length === 0 ? 'Your bonus history will appear here' : 'Try changing filters or search'}
              </p>
            </div>
          ) : (
            <div className="nova-acct-panel bon-history">
              {/* Desktop Table View */}
              <div className="hidden xl:block bon-table-wrap">
                <table className="bon-table">
                  <thead>
                    <tr>
                      <th>
                        Bonus
                      </th>
                      <th>
                        Amount
                      </th>
                      <th>
                        Type / Domain
                      </th>
                      <th>
                        Status
                      </th>
                      <th>
                        Wagering
                      </th>
                      <th>
                        Dates
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyFiltered.map((item) => {
                      const wagerReq = item.wageringAmount ?? 0
                      const wagerDone = item.fulfilledAmount ?? 0
                      const wagerPct = wagerReq > 0 ? Math.min((wagerDone / wagerReq) * 100, 100) : 0
                      return (
                      <tr key={item.id}>
                        <td>
                          <span className="bon-cell-name">{item.name}</span>
                          {item.distributionType && (
                            <span className="bon-cell-sub">
                              {distributionTypeLabels[item.distributionType] || item.distributionType}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className="bon-cell-amount">
                            {formatAmount(item.amount, item.currency as CurrencyCode)}
                          </span>
                          {item.amountType === 'percentage' && item.percentage ? (
                            <span className="bon-cell-sub is-inline">({item.percentage}%)</span>
                          ) : null}
                          {item.depositAmount != null && item.depositAmount > 0 && (
                            <span className="bon-cell-sub">
                              Dep: {formatAmount(item.depositAmount, item.currency as CurrencyCode)}
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="bon-tags is-tight">
                            {item.type && (
                              <span className="bon-tag">
                                {bonusTypeLabels[item.type] || item.type}
                              </span>
                            )}
                            {item.domain && (
                              <span className={`bon-tag is-domain ${domainColors[item.domain] || ''}`}>
                                {domainLabels[item.domain] || item.domain}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <HistoryStatusChip status={item.status} />
                        </td>
                        <td>
                          {wagerReq > 0 ? (
                            <div className="bon-mini-wager">
                              <div className="bon-mini-wager-head">
                                <span>{item.wagering ? `${item.wagering}x` : 'Wagering'}</span>
                                <b>{wagerPct.toFixed(0)}%</b>
                              </div>
                              <div className="bon-bar is-thin" aria-hidden="true">
                                <span style={{ width: `${wagerPct}%` }} />
                              </div>
                              <div className="bon-mini-wager-figs">
                                {formatAmount(wagerDone)} / {formatAmount(wagerReq)}
                              </div>
                              {item.releaseType && (
                                <div className="bon-mini-wager-figs">
                                  {releaseTypeLabels[item.releaseType] || item.releaseType}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="bon-cell-sub">-</span>
                          )}
                        </td>
                        <td>
                          <div className="bon-dates">
                            <div>
                              <span>Awarded: </span>
                              {item.awardedAt ? new Date(item.awardedAt).toLocaleDateString(getDefaultLocale(), {
                                day: '2-digit', month: 'short', year: 'numeric'
                              }) : '-'}
                            </div>
                            {item.expiresAt && (
                              <div>
                                <span>Expires: </span>
                                {new Date(item.expiresAt).toLocaleDateString(getDefaultLocale(), {
                                  day: '2-digit', month: 'short', year: 'numeric'
                                })}
                                {item.expiryBonusDays ? <span className="bon-dates-note">({item.expiryBonusDays}d)</span> : null}
                              </div>
                            )}
                            {item.status === 'claimed' && item.claimedAt ? (
                              <div className="is-claimed">
                                <span>Claimed: </span>
                                {new Date(item.claimedAt).toLocaleDateString(getDefaultLocale(), {
                                  day: '2-digit', month: 'short', year: 'numeric'
                                })}
                              </div>
                            ) : item.status === 'forfeited' && item.completedAt ? (
                              <div className="is-forfeited">
                                <span>Forfeited: </span>
                                {new Date(item.completedAt).toLocaleDateString(getDefaultLocale(), {
                                  day: '2-digit', month: 'short', year: 'numeric'
                                })}
                              </div>
                            ) : item.completedAt ? (
                              <div>
                                <span>Completed: </span>
                                {new Date(item.completedAt).toLocaleDateString(getDefaultLocale(), {
                                  day: '2-digit', month: 'short', year: 'numeric'
                                })}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="xl:hidden bon-hlist">
                {historyFiltered.map((item) => {
                  const wagerReq = item.wageringAmount ?? 0
                  const wagerDone = item.fulfilledAmount ?? 0
                  const wagerPct = wagerReq > 0 ? Math.min((wagerDone / wagerReq) * 100, 100) : 0
                  return (
                  <div key={item.id} className="bon-hrow">
                    {/* Header: Name, Amount, Status */}
                    <div className="bon-hrow-head">
                      <div className="bon-hrow-title">
                        <h4>{item.name}</h4>
                        <p className="bon-hrow-amount">
                          {formatAmount(item.amount, item.currency as CurrencyCode)}
                          {item.amountType === 'percentage' && item.percentage ? (
                            <span className="bon-card-pct">({item.percentage}%)</span>
                          ) : null}
                        </p>
                      </div>
                      <div className="bon-hrow-status">
                        <HistoryStatusChip status={item.status} />
                      </div>
                    </div>

                    {/* Tags: Type, Domain, Distribution */}
                    {(item.type || item.domain || item.distributionType) && (
                      <div className="bon-tags is-tight">
                        {item.type && (
                          <span className="bon-tag">
                            {bonusTypeLabels[item.type] || item.type}
                          </span>
                        )}
                        {item.domain && (
                          <span className={`bon-tag is-domain ${domainColors[item.domain] || ''}`}>
                            {domainLabels[item.domain] || item.domain}
                          </span>
                        )}
                        {item.distributionType && (
                          <span className="bon-tag is-outline">
                            {distributionTypeLabels[item.distributionType] || item.distributionType}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Details */}
                    <dl className="bon-rows is-dense">
                      {item.depositAmount != null && item.depositAmount > 0 && (
                        <div className="bon-row">
                          <dt>Deposit:</dt>
                          <dd>
                            {formatAmount(item.depositAmount, item.currency as CurrencyCode)}
                          </dd>
                        </div>
                      )}
                      <div className="bon-row">
                        <dt>Awarded:</dt>
                        <dd>
                          {item.awardedAt ? new Date(item.awardedAt).toLocaleDateString(getDefaultLocale(), {
                            day: '2-digit', month: 'short', year: 'numeric'
                          }) : '-'}
                        </dd>
                      </div>
                      {item.expiresAt && (
                        <div className="bon-row">
                          <dt>Expires:</dt>
                          <dd>
                            {new Date(item.expiresAt).toLocaleDateString(getDefaultLocale(), {
                              day: '2-digit', month: 'short', year: 'numeric'
                            })}
                            {item.expiryBonusDays ? <span className="bon-row-note">({item.expiryBonusDays}d)</span> : null}
                          </dd>
                        </div>
                      )}
                      {(item.claimedAt || item.completedAt || item.status === 'forfeited') && (
                        <div className="bon-row">
                          <dt>
                            {item.status === 'forfeited'
                              ? 'Forfeited:'
                              : item.claimedAt
                                ? 'Claimed:'
                                : 'Completed:'}
                          </dt>
                          <dd>
                            {item.status === 'forfeited'
                              ? (item.completedAt
                                  ? new Date(item.completedAt).toLocaleDateString(getDefaultLocale(), { day: '2-digit', month: 'short', year: 'numeric' })
                                  : '-')
                              : item.claimedAt
                                ? new Date(item.claimedAt).toLocaleDateString(getDefaultLocale(), { day: '2-digit', month: 'short', year: 'numeric' })
                                : item.completedAt
                                  ? new Date(item.completedAt).toLocaleDateString(getDefaultLocale(), { day: '2-digit', month: 'short', year: 'numeric' })
                                  : '-'}
                          </dd>
                        </div>
                      )}
                      {item.releaseType && (
                        <div className="bon-row">
                          <dt>Release:</dt>
                          <dd>
                            {releaseTypeLabels[item.releaseType] || item.releaseType}
                          </dd>
                        </div>
                      )}
                    </dl>

                    {/* Wagering Progress */}
                    {wagerReq > 0 && (
                      <div className="bon-wager is-compact">
                        <div className="bon-wager-head">
                          <span className="bon-wager-label">Wagering{item.wagering ? ` (${item.wagering}x)` : ''}</span>
                          <span className="bon-wager-pct">{wagerPct.toFixed(1)}%</span>
                        </div>
                        <div className="bon-bar is-thin" aria-hidden="true">
                          <span style={{ width: `${wagerPct}%` }} />
                        </div>
                        <div className="bon-wager-figs is-two">
                          <div><small>Wagered:</small> <b>{formatAmount(wagerDone)}</b></div>
                          <div><small>Target:</small> <b>{formatAmount(wagerReq)}</b></div>
                        </div>
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Switch Bonus Modal */}
      <SwitchBonusModal
        isOpen={showSwitchModal}
        onClose={handleCloseSwitchModal}
        onConfirm={handleSwitchBonus}
        currentBonus={currentActiveBonus ? {
          id: currentActiveBonus.id,
          name: currentActiveBonus.name,
          amount: currentActiveBonus.amount,
          currency: currentActiveBonus.currency,
          wagered: currentActiveBonus.wagered,
          rollingX: currentActiveBonus.rollingX,
        } : null}
        newBonus={pendingBonusToActivate ? {
          id: pendingBonusToActivate.id,
          name: pendingBonusToActivate.name,
          amount: pendingBonusToActivate.amount,
          currency: pendingBonusToActivate.currency,
        } : null}
        isLoading={isSwitching}
      />

      {/* First Deposit Required Modal */}
      {showFirstDepositModal && (
        <ModalSurface open={showFirstDepositModal} onClose={() => setShowFirstDepositModal(false)} title="First Deposit Required" size="md" className="nova-first-deposit-modal bon-modal">
            <div className="nova-modal-body bon-firstdep">
              {/* Icon */}
              <div className="bon-firstdep-icon">
                <AlertCircle aria-hidden="true" />
              </div>

              {/* Message */}
              <p className="bon-firstdep-text">
                To activate the Sign Up Bonus, you need to make your first deposit. Complete your deposit and come back to claim your bonus!
              </p>

              {/* Buttons */}
              <div className="nova-modal-actions bon-firstdep-actions">
                <button
                  type="button"
                  onClick={() => {
                    setShowFirstDepositModal(false)
                    navigate('/deposit')
                  }}
                  className="nova-button w-full"
                >
                  Go to Deposit
                </button>
                <button
                  type="button"
                  onClick={() => setShowFirstDepositModal(false)}
                  className="nova-button nova-button-secondary w-full"
                >
                  Maybe Later
                </button>
              </div>
            </div>
        </ModalSurface>
      )}
    </div>
  )
}
