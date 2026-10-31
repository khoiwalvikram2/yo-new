import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import {
  Users,
  Wallet,
  History,
  BarChart3,
  Copy,
  Check,
  Gift,
  RefreshCw,
  TrendingUp,
  ArrowRightLeft,
  Share2,
  UserPlus,
  IndianRupee,
  Clock,
  ChevronDown,
  ChevronUp,
  Info,
  Search,
  X,
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import type { CurrencyCode } from '@/types'
import { formatAmount, getDefaultLocale } from '@/lib/currency'
import {
  getReferralProgram,
  getMyReferralLink,
  getReferralUsers,
  getReferralTransactions,
  getReferralAggregate,
  getActiveReferralRules,
  getUserDetail,
  transferReferralBalanceToCash,
} from '@/lib/api/user'
import { notify } from '@/lib/notify'
import { extractApiMessage } from '@/lib/errors'
import StakePageHeader from '@/components/StakePageHeader'
import { SegmentedTabs } from '@/components/bonus/SegmentedTabs'
import { usePageSEO } from '@/hooks/usePageSEO'
import type { ReferralUserItem } from '@/lib/api/user'
import type { ReferralAggregateItem } from '@/lib/api/user'
import type { ReferralTxnItem } from '@/lib/api/user'
import '@/styles/account/referral.css'

type TabKey = 'overview' | 'referred-users' | 'history'

/* ─── helpers ─── */
const maskMobile = (m?: string | null) => {
  if (!m) return null
  if (m.length <= 4) return m
  return m.slice(0, 2) + '****' + m.slice(-2)
}

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(getDefaultLocale(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(getDefaultLocale(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Referred-user status -> matchbook chip tone (nova-account.css).
const statusColor: Record<string, string> = {
  active: 'is-success',
  pending: 'is-pending',
  blocked: 'is-failed',
  inactive: 'is-neutral',
}

/* ─── rule-type helpers ─── */
const ruleTypeIcons: Record<string, typeof Gift> = {
  SIGNUP_CPA: UserPlus,
  FIRST_DEPOSIT_PCT: IndianRupee,
  RELOAD_DEPOSITS_PCT: ArrowRightLeft,
  REVSHARE: TrendingUp,
  LOSS_SHARE: BarChart3,
  TURNOVER_MILESTONE: TrendingUp,
}

/** Rule types the player never sees (owner request: revenue share is removed from the referral page). */
const HIDDEN_RULE_TYPES = new Set(['REVSHARE'])

export default function ReferralPage() {
  const { t } = useTranslation()
  usePageSEO({ title: t('referral.title'), description: t('referral.description') })

  const { user, refreshUser } = useAuth()
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [program, setProgram] = useState<{
    id: string
    name: string
    enabledRewardTypes?: string[]
    minReferralBalanceForCashTransfer?: number
  } | null>(null)
  const [myLink, setMyLink] = useState<{ code: string; url: string } | null>(null)
  const [referralBalance, setReferralBalance] = useState<number>(0)
  const [referralUsers, setReferralUsers] = useState<ReferralUserItem[]>([])
  const [transactions, setTransactions] = useState<ReferralTxnItem[]>([])
  const [aggregate, setAggregate] = useState<ReferralAggregateItem[]>([])
  const [rules, setRules] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [transferAmount, setTransferAmount] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [showRulesDetail, setShowRulesDetail] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [txnSearch, setTxnSearch] = useState('')
  const referralBonusBalance = Number(
    (user as { referralBonusBalance?: number })?.referralBonusBalance ?? 0
  )
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const playerType = (user as { playerType?: string })?.playerType ?? 'REGULAR'
  const isCreditPlayer = playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT'

  /* ─── data loading ─── */
  const loadReferralData = async () => {
    if (!user) {
      setLoading(false)
      setError(false)
      setProgram(null)
      setMyLink(null)
      setReferralBalance(0)
      setReferralUsers([])
      setTransactions([])
      setAggregate([])
      setRules([])
      return
    }
    setLoading(true)
    setError(false)
    try {
      const [programRes, linkRes, usersRes, txnRes, aggRes, rulesRes] = await Promise.all([
        getReferralProgram(),
        getMyReferralLink(),
        getReferralUsers(),
        getReferralTransactions(),
        getReferralAggregate(),
        getActiveReferralRules(),
      ])
      if (programRes.data) setProgram(programRes.data)
      if (linkRes.data) setMyLink(linkRes.data)
      if (usersRes.data) setReferralUsers(usersRes.data)
      if (txnRes.data) setTransactions(txnRes.data)
      if (aggRes.data) setAggregate(aggRes.data)
      if (rulesRes.data) setRules(rulesRes.data)

      const balance = (user as { referralBalance?: number })?.referralBalance
      if (typeof balance === 'number') setReferralBalance(balance)
      else if (user) {
        const detailRes = await getUserDetail()
        const d = detailRes.data as { refBonus?: number; referralBalance?: number }
        const refBal = d?.referralBalance ?? d?.refBonus
        if (typeof refBal === 'number') setReferralBalance(refBal)
      }
    } catch (e: unknown) {
      setError(true)
      notify.error(extractApiMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReferralData()
  }, [user])

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  /* ─── derived stats ─── */
  const totalEarned = useMemo(
    () => aggregate.reduce((s, a) => s + (a.totalPl ?? 0), 0),
    [aggregate]
  )
  const totalBonusEarned = useMemo(
    () => aggregate.reduce((s, a) => s + (a.totalBonus ?? 0), 0),
    [aggregate]
  )
  const totalReferrals = referralUsers.length

  /* ─── filtered referred users ─── */
  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return referralUsers
    const q = userSearch.toLowerCase().trim()
    return referralUsers.filter(
      (u) =>
        u.name?.toLowerCase().includes(q) ||
        u.mobileNo?.toLowerCase().includes(q) ||
        u.status?.toLowerCase().includes(q) ||
        u.referralCode?.toLowerCase().includes(q)
    )
  }, [referralUsers, userSearch])

  /* ─── rule labels (above filteredTxns, which calls ruleLabel while rendering) ─── */
  const ruleLabel = (ruleType: string) =>
    t(`referral.ruleTypes.${ruleType}` as any) || ruleType
  // Revenue share is not offered to players: its rule and its earnings line are not shown, and its
  // history rows carry no type tag. Its money still counts in the totals above.
  const isShownRuleType = (ruleType?: string | null) => !ruleType || !HIDDEN_RULE_TYPES.has(ruleType)
  const shownAggregate = aggregate.filter(a => isShownRuleType(a.ruleType))
  const shownRules = rules.filter((rule: any) => isShownRuleType(rule?.ruleType))

  /* ─── filtered transactions ─── */
  const filteredTxns = useMemo(() => {
    if (!txnSearch.trim()) return transactions
    const q = txnSearch.toLowerCase().trim()
    return transactions.filter(
      (txn) =>
        txn.userName?.toLowerCase().includes(q) ||
        txn.mobileNo?.toLowerCase().includes(q) ||
        txn.ruleType?.toLowerCase().includes(q) ||
        ruleLabel(txn.ruleType ?? '').toLowerCase().includes(q)
    )
  }, [transactions, txnSearch])

  /* ─── copy ─── */
  const handleCopy = async () => {
    const urlToCopy = displayUrl || myLink?.url
    if (!urlToCopy) return
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current)
      copyTimeoutRef.current = null
    }
    try {
      await navigator.clipboard.writeText(urlToCopy)
      setCopied(true)
      notify.success(t('referral.copied'))
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false)
        copyTimeoutRef.current = null
      }, 2000)
    } catch {
      notify.error(t('referral.copyFailed'))
    }
  }

  /* ─── share ─── */
  const handleShare = async () => {
    const urlToShare = displayUrl || myLink?.url
    if (!urlToShare) return
    if (navigator.share) {
      try {
        await navigator.share({
          title: t('referral.title'),
          text: t('referral.description'),
          url: urlToShare,
        })
      } catch {
        /* user cancelled */
      }
    } else {
      handleCopy()
    }
  }

  const minTransfer = program?.minReferralBalanceForCashTransfer ?? 0

  const referralFullUrl =
    myLink?.url &&
    (myLink.url.startsWith('/')
      ? typeof window !== 'undefined'
        ? `${window.location.origin}${myLink.url}`
        : myLink.url
      : myLink.url)
  const displayUrl = referralFullUrl ?? myLink?.url ?? ''

  /* ─── transfer ─── */
  const handleTransferToCash = async () => {
    const amount = Number(transferAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      notify.error('Enter a valid amount')
      return
    }
    if (referralBalance < minTransfer) {
      notify.error(
        `Minimum referral balance of ${formatAmount(minTransfer)} is required to transfer to cash`
      )
      return
    }
    if (amount < minTransfer) {
      notify.error(`Minimum transfer amount is ${formatAmount(minTransfer)}`)
      return
    }
    if (amount > referralBalance) {
      notify.error('Amount exceeds referral balance')
      return
    }
    setTransferring(true)
    try {
      const result = await transferReferralBalanceToCash(amount)
      if (result.success) {
        notify.success(result.message ?? 'Transferred to cash wallet')
        setTransferAmount('')
        setReferralBalance(
          typeof result.newReferralBalance === 'number'
            ? result.newReferralBalance
            : referralBalance - amount
        )
        await refreshUser?.()
      } else {
        notify.error(result.message ?? 'Transfer failed')
      }
    } catch (e: unknown) {
      notify.error(extractApiMessage(e))
    } finally {
      setTransferring(false)
    }
  }


  if (isCreditPlayer) return <Navigate to="/" replace />

  /* ─── loading ─── */
  if (loading) {
    return (
      <div className="ref-page">
        <StakePageHeader title={t('referral.title')} />
        <div
          className="nova-acct-panel ref-loading"
          aria-busy="true"
          aria-label={t('referral.title')}
        >
          <RefreshCw className="ref-loading-icon animate-spin" />
        </div>
      </div>
    )
  }

  /* ─── error ─── */
  if (error) {
    return (
      <div className="ref-page">
        <StakePageHeader title={t('referral.title')} />
        <div className="nova-acct-panel ref-empty is-error">
          <div className="ref-empty-icon">
            <Gift aria-hidden="true" />
          </div>
          <p className="ref-empty-title">
            {t('referral.loadFailed')}
          </p>
          <button
            type="button"
            onClick={() => loadReferralData()}
            aria-label={t('referral.retry')}
            className="ref-btn ref-btn-primary ref-empty-action"
          >
            {t('referral.retry')}
          </button>
        </div>
      </div>
    )
  }

  /* ─── main ─── */
  return (
    <div className="ref-page" aria-label={t('referral.title')}>
      <StakePageHeader title={t('referral.title')} />

      {/* Tabs */}
      <div className="w-full">
        <SegmentedTabs
          theme="slate"
          fullWidth
          tabs={[
            { key: 'overview', label: t('referral.tabOverview'), icon: <BarChart3 className="h-3.5 w-3.5" /> },
            { key: 'referred-users', label: t('referral.tabReferredUsers'), icon: <Users className="h-3.5 w-3.5" /> },
            { key: 'history', label: t('referral.tabHistory'), icon: <History className="h-3.5 w-3.5" /> },
          ]}
          value={activeTab}
          onChange={(k) => setActiveTab(k as TabKey)}
        />
      </div>

      {/* ═══════════════════════ OVERVIEW TAB ═══════════════════════ */}
      {activeTab === 'overview' && (
        <div className="ref-section">
          {/* Hero: Referral link share card */}
          <section className="ref-hero">
            <div className="ref-hero-main">
              <div className="ref-hero-title">
                <div className="ref-hero-icon">
                  <Share2 aria-hidden="true" />
                </div>
                <div>
                  <h3>
                    {t('referral.myLink')}
                  </h3>
                  <p>
                    {t('referral.programInfo')}
                  </p>
                </div>
              </div>

              {myLink ? (
                <div className="ref-share">
                  {/* Referral code badge */}
                  {myLink.code && (
                    <div className="ref-code">
                      <span className="ref-code-label">Code</span>
                      <span className="ref-code-value">
                        {myLink.code}
                      </span>
                    </div>
                  )}
                  {/* URL + actions */}
                  <div className="ref-link">
                    <input
                      readOnly
                      value={displayUrl}
                      aria-label={t('referral.myLink')}
                      className="ref-link-input"
                    />
                    <div className="ref-link-actions">
                      <button
                        type="button"
                        onClick={handleCopy}
                        aria-label={t('referral.copyLinkAria')}
                        className={`ref-btn ref-btn-primary ref-copy${copied ? ' is-copied' : ''}`}
                      >
                        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                        {copied ? t('referral.copied') : t('referral.copy')}
                      </button>
                      <button
                        type="button"
                        onClick={handleShare}
                        aria-label="Share referral link"
                        className="ref-btn ref-share-btn"
                      >
                        <Share2 aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="ref-hero-note">
                  {t('referral.unableToLoadLink')}
                </p>
              )}
            </div>
            <div className="ref-hero-art" aria-hidden="true">
              <span className="ref-hero-ring" />
              <Gift />
            </div>
          </section>

          {/* Stats cards grid */}
          <div className="ref-stats">
            {/* Referral Balance */}
            <div className="ref-stat is-red">
              <div className="ref-stat-head">
                <Wallet aria-hidden="true" />
                <span className="ref-stat-label">
                  Referral Balance
                </span>
              </div>
              <p className="ref-stat-value">
                {formatAmount(referralBalance)}
              </p>
            </div>

            {/* Bonus Wallet */}
            <div className="ref-stat is-gold">
              <div className="ref-stat-head">
                <Gift aria-hidden="true" />
                <span className="ref-stat-label">
                  Referral Bonus Wallet
                </span>
              </div>
              <p className="ref-stat-value">
                {formatAmount(referralBonusBalance)}
              </p>
            </div>

            {/* Total Referrals */}
            <div className="ref-stat is-dark">
              <div className="ref-stat-head">
                <Users aria-hidden="true" />
                <span className="ref-stat-label">
                  Total Referrals
                </span>
              </div>
              <p className="ref-stat-value">
                {totalReferrals}
              </p>
            </div>

            {/* Total Earned */}
            <div className="ref-stat is-green">
              <div className="ref-stat-head">
                <TrendingUp aria-hidden="true" />
                <span className="ref-stat-label">
                  Total Referral Earned
                </span>
              </div>
              <p className="ref-stat-value">
                {formatAmount(totalEarned)}
              </p>
              {totalBonusEarned > 0 && (
                <p className="ref-stat-sub">
                  +{formatAmount(totalBonusEarned)} bonus
                </p>
              )}
            </div>
          </div>

          {/* Transfer to Cash Wallet */}
          <section className="nova-acct-panel ref-panel">
            <div className="nova-acct-panel-head">
              <ArrowRightLeft aria-hidden="true" />
              <h3>
                Transfer to Cash Wallet
              </h3>
            </div>
            <div className="ref-transfer">
              <p className="ref-transfer-text">
                Move your referral earnings to your main cash wallet.
                {referralBonusBalance > 0 && (
                  <span className="ref-transfer-sub">
                    Referral bonus wallet ({formatAmount(referralBonusBalance)}) can only be used for
                    casino games. Winnings are credited to your referral balance.
                  </span>
                )}
              </p>

              {minTransfer > 0 && (
                <div className="ref-note">
                  <Info aria-hidden="true" />
                  <p>
                    Minimum balance to transfer: {formatAmount(minTransfer)}
                  </p>
                </div>
              )}

              <div className="ref-transfer-form">
                <div className="ref-transfer-field">
                  <label className="ref-label">
                    Amount
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={referralBalance > 0 ? referralBalance : undefined}
                    step="0.01"
                    placeholder="Enter amount"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="ref-input"
                    aria-label="Amount to transfer to cash wallet"
                  />
                </div>
                {referralBalance > 0 && (
                  <button
                    type="button"
                    onClick={() => setTransferAmount(String(referralBalance))}
                    className="ref-max"
                  >
                    Max: {formatAmount(referralBalance)}
                  </button>
                )}
                <button
                  type="button"
                  disabled={
                    referralBalance <= 0 ||
                    referralBalance < minTransfer ||
                    transferring ||
                    !transferAmount ||
                    (Number(transferAmount) > 0 && Number(transferAmount) < minTransfer)
                  }
                  onClick={handleTransferToCash}
                  aria-label="Transfer referral balance to cash wallet"
                  className="ref-btn ref-btn-primary ref-transfer-btn"
                >
                  {transferring ? (
                    <span className="ref-btn-busy">
                      <RefreshCw className="animate-spin" aria-hidden="true" />
                      Transferring…
                    </span>
                  ) : (
                    'Transfer'
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* Earnings by Type */}
          {shownAggregate.length > 0 && (
            <section className="nova-acct-panel ref-panel">
              <div className="nova-acct-panel-head">
                <BarChart3 aria-hidden="true" />
                <h3>
                  {t('referral.earningsByType')}
                </h3>
              </div>
              <div className="ref-earn-grid">
                {shownAggregate.map((a, i) => {
                  const IconComp = ruleTypeIcons[a.ruleType ?? ''] ?? Gift
                  return (
                    <div
                      key={i}
                      className="ref-earn"
                    >
                      <div className="ref-earn-icon">
                        <IconComp aria-hidden="true" />
                      </div>
                      <div className="ref-earn-main">
                        <p className="ref-earn-name">
                          {ruleLabel(a.ruleType ?? '') || '—'}
                        </p>
                        <p className="ref-earn-count">
                          {a.count ?? 0} transaction{(a.count ?? 0) !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="ref-earn-amount">
                        <p className="ref-earn-pl">
                          {formatAmount(a.totalPl ?? 0, (a.currency ?? 'INR') as CurrencyCode)}
                        </p>
                        {(a.totalBonus ?? 0) > 0 && (
                          <p className="ref-earn-bonus">
                            +{formatAmount(a.totalBonus ?? 0, (a.currency ?? 'INR') as CurrencyCode)} bonus
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Referral Rules / How it works */}
          {shownRules.length > 0 && (
            <section className="nova-acct-panel ref-panel ref-rules">
              <button
                type="button"
                onClick={() => setShowRulesDetail(!showRulesDetail)}
                aria-expanded={showRulesDetail}
                className="nova-acct-panel-head ref-rules-toggle"
              >
                <Info aria-hidden="true" />
                <h3>
                  How you earn
                </h3>
                {showRulesDetail ? (
                  <ChevronUp className="ref-rules-chevron" aria-hidden="true" />
                ) : (
                  <ChevronDown className="ref-rules-chevron" aria-hidden="true" />
                )}
              </button>
              {showRulesDetail && (
                <div className="ref-rules-list">
                  {shownRules.map((rule: any, idx: number) => {
                    const IconComp = ruleTypeIcons[rule.ruleType] ?? Gift
                    return (
                      <div
                        key={rule.id ?? idx}
                        className="ref-rule"
                      >
                        <div className="ref-rule-head">
                          <span className="ref-rule-icon">
                            <IconComp aria-hidden="true" />
                          </span>
                          <span className="ref-rule-name">
                            {ruleLabel(rule.ruleType)}
                          </span>
                          {rule.status && (
                            <span className="nova-acct-chip is-success">
                              {rule.status}
                            </span>
                          )}
                        </div>
                        {rule.description && (
                          <p className="ref-rule-desc">{rule.description}</p>
                        )}
                        <div className="ref-rule-terms">
                          {rule.tierRates && typeof rule.tierRates === 'object' && Object.keys(rule.tierRates).length > 0 && (
                            <div className="ref-term is-wide">
                              <span>Tier rates: </span>
                              <span>
                                {Object.entries(rule.tierRates)
                                  .map(([tier, rate]) => `Tier ${tier}: ${rate}%`)
                                  .join(', ')}
                              </span>
                            </div>
                          )}
                          {rule.fixedAmount != null && (
                            <div className="ref-term">
                              <span>Fixed amount: </span>
                              <span>
                                {formatAmount(Number(rule.fixedAmount))}
                              </span>
                            </div>
                          )}
                          {rule.cap != null && (
                            <div className="ref-term">
                              <span>Cap: </span>
                              <span>
                                {formatAmount(Number(rule.cap))}
                              </span>
                            </div>
                          )}
                          {rule.threshold != null && (
                            <div className="ref-term">
                              <span>Threshold: </span>
                              <span>
                                {formatAmount(Number(rule.threshold))}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* ═══════════════════════ REFERRED USERS TAB ═══════════════════════ */}
      {activeTab === 'referred-users' && (
        <div className="ref-section">
          {/* Summary bar */}
          <div className="ref-stats is-three">
            <div className="ref-stat is-dark">
              <p className="ref-stat-label">
                Total
              </p>
              <p className="ref-stat-value">
                {referralUsers.length}
              </p>
            </div>
            <div className="ref-stat is-green">
              <p className="ref-stat-label">
                Active
              </p>
              <p className="ref-stat-value is-green">
                {referralUsers.filter((u) => u.status === 'active').length}
              </p>
            </div>
            <div className="ref-stat is-red">
              <p className="ref-stat-label">
                Earned
              </p>
              <p className="ref-stat-value">
                {formatAmount(referralUsers.reduce((s, u) => s + (u.totalPl ?? 0), 0))}
              </p>
            </div>
          </div>

          <div className="nova-acct-panel ref-list">
            {/* Search */}
            {referralUsers.length > 0 && (
              <div className="ref-toolbar">
                <div className="ref-search">
                  <Search className="ref-search-icon" aria-hidden="true" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search by name, mobile, status..."
                    className="ref-search-input"
                  />
                  {userSearch && (
                    <button
                      onClick={() => setUserSearch('')}
                      className="ref-search-clear"
                      aria-label="Clear search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {filteredUsers.length === 0 ? (
              <div className="ref-empty">
                <div className="ref-empty-icon">
                  <Users aria-hidden="true" />
                </div>
                <p className="ref-empty-title">
                  {userSearch ? 'No results found' : t('referral.noReferredUsers')}
                </p>
                <p className="ref-empty-text">
                  {userSearch
                    ? 'Try a different search term'
                    : 'Share your referral link to start inviting friends!'}
                </p>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden xl:block ref-table-wrap">
                  <table className="ref-table">
                    <thead>
                      <tr>
                        <th>
                          User
                        </th>
                        <th>
                          Status
                        </th>
                        <th>
                          Joined
                        </th>
                        <th className="is-num">
                          Your Earnings
                        </th>
                        <th className="is-center">
                          Tier
                        </th>
                        <th>
                          Source
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => (
                        <tr
                          key={u.id ?? u._id ?? String(u.mobileNo ?? u.name)}
                        >
                          <td>
                            <div>
                              <span className="ref-cell-name">
                                {u.name || '—'}
                              </span>
                              {u.mobileNo && (
                                <span className="ref-cell-sub">
                                  {maskMobile(u.mobileNo)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`nova-acct-chip ${
                                statusColor[u.status ?? ''] ??
                                'is-neutral'
                              }`}
                            >
                              {u.status ?? '—'}
                            </span>
                            {u.reason && (
                              <span className="ref-cell-sub">
                                {u.reason}
                              </span>
                            )}
                          </td>
                          <td className="ref-cell-date">
                            {fmtDate(u.createdAt)}
                          </td>
                          <td className="is-num">
                            <span className={`ref-cell-amount${(u.totalPl ?? 0) > 0 ? ' is-pos' : ''}`}>
                              {formatAmount(u.totalPl ?? 0)}
                            </span>
                          </td>
                          <td className="is-center">
                            {u.tier != null ? (
                              <span className="ref-tier">
                                {u.tier}
                              </span>
                            ) : (
                              <span className="ref-cell-sub">—</span>
                            )}
                          </td>
                          <td>
                            {u.utmSource || u.utmCampaign || u.utmMedium ? (
                              <div className="ref-tags">
                                {u.utmSource && (
                                  <span className="ref-tag">
                                    {u.utmSource}
                                  </span>
                                )}
                                {u.utmMedium && (
                                  <span className="ref-tag">
                                    {u.utmMedium}
                                  </span>
                                )}
                                {u.utmCampaign && (
                                  <span className="ref-tag">
                                    {u.utmCampaign}
                                  </span>
                                )}
                              </div>
                            ) : u.firstClickAt ? (
                              <span className="ref-cell-sub">
                                Click: {fmtDate(u.firstClickAt)}
                              </span>
                            ) : (
                              <span className="ref-cell-sub">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="xl:hidden ref-mlist">
                  {filteredUsers.map((u) => (
                    <div
                      key={u.id ?? u._id ?? String(u.mobileNo ?? u.name)}
                      className="ref-mrow"
                    >
                      {/* Header row */}
                      <div className="ref-mrow-head">
                        <div className="ref-mrow-title">
                          <p className="ref-cell-name">
                            {u.name || maskMobile(u.mobileNo) || '—'}
                          </p>
                          {u.name && u.mobileNo && (
                            <p className="ref-cell-sub">
                              {maskMobile(u.mobileNo)}
                            </p>
                          )}
                        </div>
                        <span
                          className={`nova-acct-chip ${
                            statusColor[u.status ?? ''] ??
                            'is-neutral'
                          }`}
                        >
                          {u.status ?? '—'}
                        </span>
                      </div>

                      {/* Details grid */}
                      <div className="ref-rows">
                        <div className="ref-row">
                          <span>Joined</span>
                          <span>
                            {fmtDate(u.createdAt)}
                          </span>
                        </div>
                        <div className="ref-row">
                          <span>Your Earnings</span>
                          <span className={`ref-cell-amount${(u.totalPl ?? 0) > 0 ? ' is-pos' : ''}`}>
                            {formatAmount(u.totalPl ?? 0)}
                          </span>
                        </div>
                        {u.tier != null && (
                          <div className="ref-row">
                            <span>Tier</span>
                            <span>
                              Tier {u.tier}
                            </span>
                          </div>
                        )}
                        {u.reason && (
                          <div className="ref-row">
                            <span>Reason</span>
                            <span>{u.reason}</span>
                          </div>
                        )}
                        {u.firstClickAt && (
                          <div className="ref-row">
                            <span>First Click</span>
                            <span>
                              {fmtDate(u.firstClickAt)}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* UTM tags */}
                      {(u.utmSource || u.utmCampaign || u.utmMedium) && (
                        <div className="ref-tags">
                          {u.utmSource && (
                            <span className="ref-tag">
                              {u.utmSource}
                            </span>
                          )}
                          {u.utmMedium && (
                            <span className="ref-tag">
                              {u.utmMedium}
                            </span>
                          )}
                          {u.utmCampaign && (
                            <span className="ref-tag">
                              {u.utmCampaign}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Results count */}
                {userSearch && (
                  <div className="ref-list-foot">
                    <p>
                      {filteredUsers.length} of {referralUsers.length} users
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════ HISTORY TAB ═══════════════════════ */}
      {activeTab === 'history' && (
        <div className="ref-section">
          {/* Summary stats */}
          <div className="ref-stats is-three">
            <div className="ref-stat is-dark">
              <p className="ref-stat-label">
                Transactions
              </p>
              <p className="ref-stat-value">
                {transactions.length}
              </p>
            </div>
            <div className="ref-stat is-green">
              <p className="ref-stat-label">
                Total Cash
              </p>
              <p className="ref-stat-value is-green">
                {formatAmount(transactions.reduce((s, txn) => s + (txn.pl ?? 0), 0))}
              </p>
            </div>
            <div className="ref-stat is-gold">
              <p className="ref-stat-label">
                Total Bonus
              </p>
              <p className="ref-stat-value is-amber">
                {formatAmount(transactions.reduce((s, txn) => s + (txn.bonusAmount ?? 0), 0))}
              </p>
            </div>
          </div>

          <div className="nova-acct-panel ref-list">
            {/* Search */}
            {transactions.length > 0 && (
              <div className="ref-toolbar">
                <div className="ref-search">
                  <Search className="ref-search-icon" aria-hidden="true" />
                  <input
                    type="text"
                    value={txnSearch}
                    onChange={(e) => setTxnSearch(e.target.value)}
                    placeholder="Search by name, mobile, type..."
                    className="ref-search-input"
                  />
                  {txnSearch && (
                    <button
                      onClick={() => setTxnSearch('')}
                      className="ref-search-clear"
                      aria-label="Clear search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {filteredTxns.length === 0 ? (
              <div className="ref-empty">
                <div className="ref-empty-icon">
                  <History aria-hidden="true" />
                </div>
                <p className="ref-empty-title">
                  {txnSearch ? 'No results found' : t('referral.noTransactions')}
                </p>
                <p className="ref-empty-text">
                  {txnSearch
                    ? 'Try a different search term'
                    : 'Your referral earnings will appear here'}
                </p>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden xl:block ref-table-wrap">
                  <table className="ref-table">
                    <thead>
                      <tr>
                        <th>
                          Referred User
                        </th>
                        <th>
                          Type
                        </th>
                        <th className="is-num">
                          Cash Earned
                        </th>
                        <th className="is-num">
                          Bonus
                        </th>
                        <th className="is-center">
                          Tier
                        </th>
                        <th>
                          Period
                        </th>
                        <th>
                          Date
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTxns.map((txn, idx) => (
                        <tr
                          key={txn.id ?? txn._id ?? `txn-${idx}`}
                        >
                          <td>
                            <span className="ref-cell-name">
                              {txn.userName || '—'}
                            </span>
                            {txn.mobileNo && (
                              <span className="ref-cell-sub">
                                {maskMobile(txn.mobileNo)}
                              </span>
                            )}
                          </td>
                          <td>
                            {txn.ruleType && isShownRuleType(txn.ruleType) ? (
                              <span className="ref-tag is-type">
                                {ruleLabel(txn.ruleType)}
                              </span>
                            ) : (
                              <span className="ref-cell-sub">—</span>
                            )}
                          </td>
                          <td className="is-num">
                            <span className="ref-cell-amount is-pos">
                              +{formatAmount(txn.pl ?? 0, (txn.currency ?? 'INR') as CurrencyCode)}
                            </span>
                          </td>
                          <td className="is-num">
                            {(txn.bonusAmount ?? 0) > 0 ? (
                              <span className="ref-cell-amount is-bonus">
                                +{formatAmount(txn.bonusAmount ?? 0, (txn.currency ?? 'INR') as CurrencyCode)}
                              </span>
                            ) : (
                              <span className="ref-cell-sub">—</span>
                            )}
                          </td>
                          <td className="is-center">
                            {txn.tier != null ? (
                              <span className="ref-tier">
                                {txn.tier}
                              </span>
                            ) : (
                              <span className="ref-cell-sub">—</span>
                            )}
                          </td>
                          <td className="ref-cell-date">
                            {txn.weekStartDate && txn.weekEndDate ? (
                              <div className="ref-period">
                                <Clock aria-hidden="true" />
                                <span>
                                  {fmtDate(txn.weekStartDate)} – {fmtDate(txn.weekEndDate)}
                                </span>
                              </div>
                            ) : (
                              <span className="ref-cell-sub">—</span>
                            )}
                          </td>
                          <td className="ref-cell-date">
                            {fmtDateTime(txn.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="xl:hidden ref-mlist">
                  {filteredTxns.map((txn, idx) => (
                    <div key={txn.id ?? txn._id ?? `txn-${idx}`} className="ref-mrow">
                      {/* Header */}
                      <div className="ref-mrow-head">
                        <div className="ref-mrow-title">
                          <p className="ref-cell-name">
                            {txn.userName || maskMobile(txn.mobileNo) || '—'}
                          </p>
                          {txn.userName && txn.mobileNo && (
                            <p className="ref-cell-sub">
                              {maskMobile(txn.mobileNo)}
                            </p>
                          )}
                        </div>
                        <span className="ref-cell-amount is-pos is-lg">
                          +{formatAmount(txn.pl ?? 0, (txn.currency ?? 'INR') as CurrencyCode)}
                        </span>
                      </div>

                      {/* Tags */}
                      <div className="ref-tags">
                        {txn.ruleType && isShownRuleType(txn.ruleType) && (
                          <span className="ref-tag is-type">
                            {ruleLabel(txn.ruleType)}
                          </span>
                        )}
                        {txn.tier != null && (
                          <span className="ref-tag">
                            Tier {txn.tier}
                          </span>
                        )}
                        {(txn.bonusAmount ?? 0) > 0 && (
                          <span className="ref-tag is-bonus">
                            +{formatAmount(txn.bonusAmount ?? 0, (txn.currency ?? 'INR') as CurrencyCode)} bonus
                          </span>
                        )}
                      </div>

                      {/* Details */}
                      <div className="ref-rows">
                        {txn.weekStartDate && txn.weekEndDate && (
                          <div className="ref-row">
                            <span>Period</span>
                            <span>
                              {fmtDate(txn.weekStartDate)} – {fmtDate(txn.weekEndDate)}
                            </span>
                          </div>
                        )}
                        <div className="ref-row">
                          <span>Date</span>
                          <span>
                            {fmtDateTime(txn.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Results count */}
                {txnSearch && (
                  <div className="ref-list-foot">
                    <p>
                      {filteredTxns.length} of {transactions.length} transactions
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
