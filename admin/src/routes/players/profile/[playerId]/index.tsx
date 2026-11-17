import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, gql } from '@apollo/client'
import { useAuthStore } from '@/shared/core/authStore'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePlayerProfileStore, defaultProfileFilters } from '@/state/playerProfileStore'
import { usePlayersUiStore } from '@/state/playersUiStore'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Button } from '@/ui/components/Button'
import { Notice } from '@/ui/components/Notice'
import { LoadingState } from '@/ui/components/LoadingState'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { useChipAccount } from '@/modules/chips'
import { SELECT_WHITELABEL_TITLE, useNeedsWhitelabelSelection } from '@/modules/matka/whitelabelScope'
import { isCreditPlayerType, showChipsTab, type PlayerProfile, type ProfileOverview } from './profileModel'
import styles from './PlayerProfile.module.css'
import { SummaryHeader } from "./components/SummaryHeader";
import { ProfilePeriod } from "./components/KpiGrid";
import { OverviewTab } from "./components/OverviewTab";
import { BetsTab } from "./components/BetsTab";
import { TransactionsTab } from "./components/TransactionsTab";
import { LedgerTab } from "./components/LedgerTab";
import { BonusesTab } from "./components/BonusesTab";
import { VipTab } from "./components/VipTab";
import { ResponsibleGamingTab } from "./components/ResponsibleGamingTab";
import { DevicesSessionsTab } from "./components/DevicesSessionsTab";
import { NotesCommsTab } from "./components/NotesCommsTab";
import { SecurityAuditTab } from "./components/SecurityAuditTab";
import { ReferralBonusTab } from "./components/ReferralBonusTab";
import { PayoutAccountTab } from "./components/PayoutAccountTab";
import { ChipsTab } from "./components/ChipsTab";


export const PLAYER_PROFILE_QUERY = gql`
  query PlayerProfile($id: ID!) {
    playerProfile(id: $id) {
      id
      name
      email
      phone
      username
      status
      tenant
      createdAt
      lastLogin
      lastBet
      firstDeposit
      riskType
      kycLevel
      kycStatus
      kycLastUpdate
      vipTierId
      vipTierName
      playerType
      agentId
      creditLimit
      referredBy {
        id
        username
        name
        phone
      }
      wallet {
        userId
        currency
        balance
        bonus
        exposure
        referralBalance
        referralBonusBalance
        updatedAt
      }
      limits {
        userId
        dailyStakeLimit
        weeklyStakeLimit
        exposureCapOverride
        cooldownSeconds
        maxBetSports
        maxBetCasino
        maxBetMatka
      }
      access {
        canLogin
        canDeposit
        canWithdraw
        bonusEligible
        sports {
          visible
          canBet
        }
        casino {
          visible
          canBet
        }
        matka {
          visible
          canBet
        }
      }
    }
  }
`;

const PLAYER_OVERVIEW_QUERY = gql`
  query PlayerOverview($input: PlayerOverviewInput!) {
    playerOverview(input: $input) {
      kpis {
        lifetimeValue
        totalWagered
        totalWinnings
        netGamingRevenue
        netDeposits
        depositCount
        depositVolume
        withdrawalCount
        withdrawalVolume
        manualDepositCount
        manualDepositVolume
        manualWithdrawalCount
        manualWithdrawalVolume
        chargebackCount
        chargebackVolume
        openBetsCount
        settledBetsCount
        averageBetSize
        bonusBalance
        activeBonusesCount
        wageringCompletionPercent
        casinoRTP
        casinoHitRate
        activeDays
        sessionsCount
        averageSessionLength
        ggr
        profitLoss
        ggrByWalletType {
          cash
          bonus
          referralBonus
        }
        plByWalletType {
          cash
          bonus
          referralBonus
        }
        bonusToCashTransfer
        referralToCashTransfer
        settledBetCountByWalletType {
          cash
          bonus
          referralBonus
        }
        plByProduct {
          sports
          casino
          matka
        }
        ggrByProduct {
          sports
          casino
          matka
        }
        totalSportsStake
        totalSportsOpenStake
        totalCasinoStake
        totalMatkaStake
      }
      recentActivity {
        id
        type
        timestamp
        description
        metadata
      }
      exposureByProduct {
        product
        exposure
        currency
      }
      topProducts {
        product
        identifier
        name
        betCount
        totalStake
        totalReturn
        netAmount
      }
    }
  }
`;

export default function PlayerProfilePage() {
  const navigate = useNavigate()
  return <RBACGuard required={[{ domain: 'players.profile', actions: ['view'] }]} bypassForAgents fallback={<Page><Notice title="Access Denied" tone="warn" action={<Button onClick={() => navigate('/players/search')}>Back to Players</Button>}>You don't have permission to view player profiles. Please contact your administrator.</Notice></Page>}>
    <PlayerProfileContent />
  </RBACGuard>
}

function PlayerProfileContent() {
  const { playerId } = useParams<{ playerId: string }>()
  const navigate = useNavigate()
  const profileFilters = usePlayerProfileStore((state) => (playerId ? state.profiles[playerId] : undefined) ?? defaultProfileFilters)
  const setProfileTabGlobal = usePlayersUiStore((state) => state.setProfileTab)
  const setActiveTab = usePlayerProfileStore((state) => state.setActiveTab)
  const resetProfile = usePlayerProfileStore((state) => state.resetProfile)
  const { activeTab, dateRange, dateFrom, dateTo } = profileFilters
  const prevPlayerIdRef = useRef<string | undefined>(undefined)
  useEffect(() => { if (playerId && prevPlayerIdRef.current !== playerId) { prevPlayerIdRef.current = playerId; resetProfile(playerId) } }, [playerId, resetProfile])
  const { data: profileData, loading: profileLoading, error: profileError, refetch: refetchProfile } = useQuery<{ playerProfile?: PlayerProfile }>(PLAYER_PROFILE_QUERY, {
    variables: { id: playerId! }, skip: !playerId, errorPolicy: 'all', fetchPolicy: 'network-only',
  })
  const { data: overviewData, loading: overviewLoading, error: overviewError, refetch: refetchOverview } = useQuery<{ playerOverview?: ProfileOverview }>(PLAYER_OVERVIEW_QUERY, {
    variables: { input: { playerId: playerId!, dateRange, dateFrom, dateTo } }, skip: !playerId, errorPolicy: 'all', fetchPolicy: 'network-only',
  })
  const roles = useAuthStore((state) => state.roles) ?? []
  const permissions = useAuthStore((state) => state.permissions)
  const agent = useAuthStore((state) => state.agent)
  // A Super Admin in core mode reads the players of the 'default' tenant only, so a whitelabel's player (linked from
  // the platform-wide dashboard, or a search) is "not found" there: the error says how to open it instead.
  const needsWhitelabel = useNeedsWhitelabelSelection()
  // A credit player is on chips (spec 2026-11-02 §2): one read of its chips account feeds the head's strip, the
  // D / W / CR actions and the Chips tab. Both credit types; admins need players.credit:view to see them.
  const canSeeChips = showChipsTab({ playerType: profileData?.playerProfile?.playerType, isAgent: !!agent, permissions })
  const chips = useChipAccount('PLAYER', playerId, { skip: !canSeeChips })
  const back = <Button onClick={() => navigate('/players/search')}>Back to Players</Button>
  if (!playerId) return <Page><Notice title="Invalid Player" tone="error" action={back}>No player ID provided</Notice></Page>
  const profile = profileData?.playerProfile
  const overview = overviewData?.playerOverview
  const chipAccount = canSeeChips && isCreditPlayerType(profile?.playerType) ? chips.account : null
  const isWhitelabelAdmin = roles.some((role) => role === 'Whitelabel Admin' || role.toLowerCase() === 'whitelabel_admin' || role.toLowerCase().includes('whitelabel'))
  // In the order of the 2026-10-28 redesign: play and money, then bonus, VIP and chips, then the account's safety and records.
  const items: TabItem<string>[] = [
    { value: 'overview', label: 'Overview' }, { value: 'bets', label: 'Bets History' }, { value: 'transactions', label: 'Transactions' }, { value: 'ledger', label: 'Ledger' },
    { value: 'bonuses', label: 'Bonuses' }, { value: 'referral-bonus', label: 'Referral Bonus' }, { value: 'vip', label: 'VIP Status' },
    ...(canSeeChips ? [{ value: 'chips', label: 'Chips' }] : []),
    { value: 'activity-log', label: 'Activity Log' }, { value: 'devices-sessions', label: 'Devices & Sessions' }, { value: 'responsible-gaming', label: 'Responsible Gaming' },
    { value: 'notes-comms', label: 'Notes & Comms' },
    ...(isWhitelabelAdmin ? [{ value: 'payout-account', label: 'Payout Account' }] : []),
  ]
  // Hairlines between the mockup's groups: play and money, bonus/VIP/credit, safety, then notes and payout.
  const tabItems = items.map((item) => ['bets', 'bonuses', 'activity-log', 'notes-comms'].includes(item.value) ? { ...item, divider: true } : item)
  const value = items.some((item) => item.value === activeTab) ? activeTab : 'overview'
  const changeTab = (next: string) => { setActiveTab(playerId, next); setProfileTabGlobal(playerId, next) }
  // After a change made from the head (Adjust Balance, status, ...) or a chip move: the Overview's money flow is
  // read again with the head. Its query lives here, so switching tabs never refreshed it.
  const refetchProfileAndOverview = () => { void refetchProfile(); void refetchOverview() }
  return <Page maxWidth="wide" className={clsx(styles.stack, styles.profilePage)}>
      {/* Loaded, the summary renders the title row with the player's actions on its right. */}
      {profileLoading || profileError || !profile ? <PageHeader title="Player Profile" back={{ to: '/players/search', label: 'Back to Players' }} className={styles.pageHeader} /> : null}
      {profileLoading ? <LoadingState label="Loading player profile" /> : (profileError || !profile) && needsWhitelabel && /player not found/i.test(profileError?.message || 'Player not found')
        ? <Notice title={SELECT_WHITELABEL_TITLE} tone="warn" action={back}>Core mode lists the platform's own players only. To open this player, switch to Whitelabel mode in the top bar and choose the player's site.</Notice>
        : profileError || !profile ? <Notice title="Error loading player profile" tone="error" action={<div className={styles.row}>{back}<Button onClick={() => void refetchProfile()}>Retry</Button></div>}>{profileError?.message || 'Player not found'}</Notice> : <>
        <SummaryHeader profile={profile} chipAccount={chipAccount} chipLoading={chips.loading} onRefetch={refetchProfileAndOverview} onTabChange={changeTab} />
        <div className={styles.tabScroll}><Tabs label="Player profile tabs" idPrefix="player-profile" items={tabItems} value={value} onChange={changeTab} variant="line" /></div>
        <section role="tabpanel" id={tabPanelId('player-profile', value)} aria-labelledby={tabId('player-profile', value)} tabIndex={0} className={styles.panel}>
          {value === 'overview' && <OverviewTab playerId={playerId} profile={profile} overview={overview} loading={overviewLoading} error={overviewError} onRetry={() => void refetchOverview()} onTabChange={changeTab} />}
          {/* Bets and Transactions read the same period as the Overview. */}
          {(value === 'bets' || value === 'transactions') && <div className={styles.periodBar}><ProfilePeriod playerId={playerId} /></div>}
          {value === 'bets' && <BetsTab playerId={playerId} dateRange={dateRange} dateFrom={dateFrom} dateTo={dateTo} />}
          {value === 'transactions' && <TransactionsTab playerId={playerId} dateRange={dateRange} dateFrom={dateFrom} dateTo={dateTo} />}
          {value === 'ledger' && <LedgerTab playerId={playerId} />}
          {value === 'bonuses' && <BonusesTab playerId={playerId} currency={profile.wallet?.currency} />}
          {value === 'referral-bonus' && <ReferralBonusTab playerId={playerId} />}
          {value === 'vip' && <VipTab playerId={playerId} />}
          {value === 'chips' && canSeeChips && <ChipsTab playerId={playerId} account={chipAccount} loading={chips.loading} error={chips.error} onRetry={() => void chips.refetch()} onChanged={refetchProfileAndOverview} />}
          {value === 'payout-account' && isWhitelabelAdmin && <PayoutAccountTab playerId={playerId} />}
          {value === 'activity-log' && <SecurityAuditTab playerId={playerId} />}
          {value === 'responsible-gaming' && <ResponsibleGamingTab playerId={playerId} profile={profile} />}
          {value === 'devices-sessions' && <DevicesSessionsTab />}
          {value === 'notes-comms' && <NotesCommsTab playerId={playerId} />}
        </section>
      </>}
    </Page>
}
