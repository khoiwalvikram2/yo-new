import { useState, useEffect, useRef } from 'react'
import { Drawer } from '@/ui/components/Drawer'
import { Button } from '@/ui/components/Button'
import { Notice } from '@/ui/components/Notice'
import { LoadingState } from '@/ui/components/LoadingState'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { StatusPill } from '@/ui/components/StatusPill'
import { Avatar } from '@/ui/components/Avatar'
import { MovePlayerToAgentModal } from './MovePlayerToAgentModal'
import styles from '../PlayersSearch.module.css'
import { useQuery, gql } from '@apollo/client'
import { IconSettings, IconAdjustmentsHorizontal, IconWallet, IconCurrencyDollar, IconShare } from '@tabler/icons-react'
import type { Player } from '@/shared/types/player'
import { Section } from './actionsDrawer/Section'
import { AccountAdminSection } from './actionsDrawer/AccountAdminSection'
import { VipAuditSection } from './actionsDrawer/VipAuditSection'
import { BettingControlsSection } from './actionsDrawer/BettingControlsSection'
import { LimitsSection } from './actionsDrawer/LimitsSection'
import { WalletBonusSection } from './actionsDrawer/WalletBonusSection'
import { CommissionInfoSection } from './actionsDrawer/CommissionInfoSection'
import { SharingInfoSection } from './actionsDrawer/SharingInfoSection'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { usePlayersUiStore } from '@/state/playersUiStore'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

// Helper function to check if player is a credit player
const isCreditPlayer = (playerType: string | undefined | null): boolean => {
  if (!playerType) return false
  const normalizedType = String(playerType).toUpperCase().trim()
  return normalizedType === 'AGENT_CREDIT' || normalizedType === 'WHITELABEL_CREDIT'
}

// Helper function to check if player is a commission player
const isCommissionPlayer = (playerType: string | undefined): boolean => {
  return playerType === 'COMMISSION_AGENT_PLAYER'
}

// Helper function to check if player is a sharing agent player
const isSharingAgentPlayer = (playerType: string | undefined): boolean => {
  return playerType === 'SHARING_AGENT_PLAYER'
}

type ActionsDrawerProps = {
  user: Player | null
  open: boolean
  onClose: () => void
  onRefetch: () => void
}

export function ActionsDrawer({ user, open, onClose, onRefetch }: ActionsDrawerProps) {
  const [moveOpen, setMoveOpen] = useState(false)
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const setSavingFlag = (key: string, val: boolean) => setSaving((s) => ({ ...s, [key]: val }))
  const { formatAmount } = useCurrency()
  const drawerUi = usePlayersUiStore((s) => s.drawer)
  const setOpenSection = usePlayersUiStore((s) => s.setOpenSection)
  const closeDrawer = usePlayersUiStore((s) => s.closeDrawer)
  const setSelectedUser = usePlayersUiStore((s) => s.setSelectedUser)
  const agent = useAuthStore(s => s.agent)
  const permissions = useAuthStore(s => s.permissions)
  const canViewWallet = !!agent || hasPermissionWithNested(permissions, 'players.wallet', 'view')
  const canViewCredit = !!agent || hasPermissionWithNested(permissions, 'players.credit', 'view')
  const mask = '••••'
  const isSharingAgent = agent?.schemeType === 'SHARING'

  // UI-only scaffold state
  const [dailyStakeLimit, setDailyStakeLimit] = useState<number | null>(null)
  const [weeklyStakeLimit, setWeeklyStakeLimit] = useState<number | null>(null)
  const [exposureCapOverride, setExposureCapOverride] = useState<number | null>(null)
  const [maxBetSports, setMaxBetSports] = useState<number | null>(null)
  const [maxBetCasino, setMaxBetCasino] = useState<number | null>(null)
  const [maxBetMatka, setMaxBetMatka] = useState<number | null>(null)
  const [cooldownSeconds, setCooldownSeconds] = useState<number | null>(null)
  const [withdrawalLock, setWithdrawalLock] = useState(false)
  const [bonusAllowed, setBonusAllowed] = useState(true)
  const limitsPopulatedForUserIdRef = useRef<string | null>(null)

  // Load player limits when drawer opens
  const PlayerLimitsQuery = gql`
    query PlayerLimits($userId: ID!) {
      playerLimits(userId: $userId) {
        userId
        dailyStakeLimit
        weeklyStakeLimit
        exposureCapOverride
        cooldownSeconds
        maxBetSports
        maxBetCasino
        maxBetMatka
      }
    }
  `

  const { data: limitsData } = useQuery(PlayerLimitsQuery, {
    variables: user ? { userId: user.id } : undefined,
    skip: !user || !open,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  const DrawerUserQuery = gql`
    query DrawerUser($id: ID!) {
      user(id: $id) {
        id
        name
        email
        phone
        username
        status
        vipTierId
        vipTierName
        vipTierMode
        vipDepositAccess { eligible message tierId tierName mode programStartedAt monthlyDeposits }
        riskType
        sportsVisible
        sportsBetAllowed
        casinoVisible
        casinoBetAllowed
        matkaVisible
        matkaBetAllowed
        bonusAllowed
        withdrawalLock
        playerType
        creditLimit
        creditUsed
        creditAvailable
        agentId
        parentAgent {
          id
          username
          schemeType
        }
      }
      wallet(userId: $id) {
        userId
        currency
        balance
        bonus
        exposure
        updatedAt
      }
    }
  `

  const AgentProfileQuery = gql`
    query AgentProfileForDrawer($agentId: ID!) {
      agents {
        agentProfile(id: $agentId) {
          id
          username
          schemeType
          commissionRates {
            domain
            rate
          }
          sharingRates {
            domain
            rate
          }
        }
      }
    }
  `

  const { data: drawerUserData, loading: drawerLoading, refetch: refetchDrawerUser } = useQuery(DrawerUserQuery, {
    variables: drawerUi.activeUserId ? { id: drawerUi.activeUserId } : undefined,
    skip: !drawerUi.activeUserId || !open,
    fetchPolicy: 'network-only', // Force fresh fetch to avoid cache issues
    errorPolicy: 'all',
  })

  const agentId = drawerUserData?.user?.agentId
  const { data: agentData } = useQuery(AgentProfileQuery, {
    variables: agentId ? { agentId } : undefined,
    skip: !agentId || !open,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  // Refetch both drawer query and parent query when onRefetch is called
  const handleRefetch = () => {
    if (drawerUi.activeUserId && open) {
      refetchDrawerUser()
    }
    onRefetch()
  }

  // Use query data if available, otherwise fall back to user prop
  // CRITICAL: Always prefer fresh query data for accuracy
  const effectiveUser: Player | null = drawerUserData?.user
    ? ({ 
        ...drawerUserData.user, 
        wallet: drawerUserData.wallet,
        // Ensure ALL fields are from query
        creditLimit: drawerUserData.user.creditLimit,
        creditUsed: drawerUserData.user.creditUsed,
        creditAvailable: drawerUserData.user.creditAvailable,
        playerType: drawerUserData.user.playerType,
        vipTierId: drawerUserData.user.vipDepositAccess?.tierId ?? drawerUserData.user.vipTierId,
        vipTierName: drawerUserData.user.vipDepositAccess?.tierName ?? drawerUserData.user.vipTierName,
        vipTierMode: drawerUserData.user.vipDepositAccess?.mode ?? drawerUserData.user.vipTierMode,
        // Include parent agent info with rates from separate query
        parentAgent: agentData?.agents?.agentProfile || drawerUserData.user.parentAgent,
        agentId: drawerUserData.user.agentId,
      } as Player)
    : user || null

  // Sync withdrawalLock & bonusAllowed from server data when drawer opens or user changes
  useEffect(() => {
    if (effectiveUser?.withdrawalLock !== undefined) {
      setWithdrawalLock(!!effectiveUser.withdrawalLock)
    }
    if (effectiveUser?.bonusAllowed !== undefined) {
      setBonusAllowed(!!effectiveUser.bonusAllowed)
    }
  }, [effectiveUser?.withdrawalLock, effectiveUser?.bonusAllowed])

  // Reset limits-populated ref when drawer closes or user changes so next open populates from server
  useEffect(() => {
    if (!open || !user?.id) {
      limitsPopulatedForUserIdRef.current = null
    }
  }, [open, user?.id])

  useEffect(() => {
    const pl = limitsData?.playerLimits
    const userId = user?.id
    if (!pl || !userId) return
    // Guard: ensure the returned limits belong to the currently open user
    if (pl.userId && String(pl.userId) !== String(userId)) return
    if (limitsPopulatedForUserIdRef.current === userId) return
    limitsPopulatedForUserIdRef.current = userId
    setDailyStakeLimit(pl.dailyStakeLimit ?? null)
    setWeeklyStakeLimit(pl.weeklyStakeLimit ?? null)
    setExposureCapOverride(pl.exposureCapOverride ?? null)
    setCooldownSeconds(pl.cooldownSeconds ?? null)
    setMaxBetSports(pl.maxBetSports ?? null)
    setMaxBetCasino(pl.maxBetCasino ?? null)
    setMaxBetMatka(pl.maxBetMatka ?? null)
  }, [limitsData, user?.id])

  function close() { closeDrawer(); onClose(); setSelectedUser(null) }
  const money = (value: number | undefined, visible: boolean) => !visible ? mask : value ? formatAmount(Number(value), effectiveUser?.wallet?.currency) : '—'
  return <>
    <Drawer title="Player Actions" open={open && !moveOpen} onOpenChange={next => { if (!next) close() }} size="lg" footer={<div className={styles.row}><p className={styles.secondary}>Manage player account settings, limits, and wallet controls</p><Button size="sm" onClick={close}>Close</Button></div>}>
      {drawerLoading && !effectiveUser ? <LoadingState label="Loading player data" /> : effectiveUser ? <div className={styles.stack}>
        <div className={styles.row}><div className={styles.person}><Avatar name={effectiveUser.name} hue="auto" /><div><div className={styles.name}>{effectiveUser.name || effectiveUser.username || 'Player'}</div><p className={styles.secondary}>{effectiveUser.email || effectiveUser.phone || 'No contact info'}</p></div></div><StatusPill tone={effectiveUser.status === 'ACTIVE' ? 'ok' : effectiveUser.status === 'SUSPENDED' ? 'neg' : 'neutral'}>{effectiveUser.status === 'ACTIVE' ? 'Active' : effectiveUser.status === 'SUSPENDED' ? 'Suspended' : 'Inactive'}</StatusPill></div>
        {!isSharingAgent && <div><h3 className={styles.name}>{isCreditPlayer(effectiveUser.playerType) ? 'Credit Information' : 'Wallet Balance'}</h3><DescriptionList items={isCreditPlayer(effectiveUser.playerType) ? [{ term: 'Limit', value: money(effectiveUser.creditLimit, canViewCredit) }, { term: 'Used', value: money(effectiveUser.creditUsed, canViewCredit) }, { term: 'Available', value: money(effectiveUser.creditAvailable, canViewCredit) }] : [{ term: 'Balance', value: canViewWallet ? effectiveUser.wallet ? formatAmount(effectiveUser.wallet.balance, effectiveUser.wallet.currency) : '—' : mask }, { term: 'Exposure', value: canViewWallet ? effectiveUser.wallet ? formatAmount(effectiveUser.wallet.exposure, effectiveUser.wallet.currency) : '—' : mask }, { term: 'Bonus', value: canViewWallet ? effectiveUser.wallet ? formatAmount(effectiveUser.wallet.bonus || 0, effectiveUser.wallet.currency) : '—' : mask }]} /></div>}
        {drawerLoading && <Notice tone="info">Refreshing player data…</Notice>}
          {/* Content Area */}
          <div className={styles.stack}>
            {/* Account & Admin */}
            <div className={styles.stack}>
              <Section
                id="account"
                title="Account & Admin"
                subtitle="User status and administrative controls"
                icon={<IconSettings className={styles.stack} />}
                openSection={drawerUi.openSection}
                setOpenSection={setOpenSection}
              >
                <AccountAdminSection
                  user={effectiveUser}
                  saving={saving}
                  setSavingFlag={setSavingFlag}
                  onRefetch={handleRefetch}
                />
              </Section>
            </div>

            {/* VIP & Audit - Hidden for all agents, only visible for whitelabel admins */}
            {!agent && !isCreditPlayer(effectiveUser.playerType) && effectiveUser.parentAgent?.schemeType !== 'CREDIT' && effectiveUser.vipDepositAccess?.eligible !== false && (
              <div className={styles.stack}>
                <Section
                  id="vip-audit"
                  title="VIP Tier"
                  subtitle="Tier assignment and deposit access"
                  icon={<IconSettings className={styles.stack} />}
                  openSection={drawerUi.openSection}
                  setOpenSection={setOpenSection}
                >
                  <VipAuditSection
                    user={effectiveUser}
                    saving={saving}
                    setSavingFlag={setSavingFlag}
                    onRefetch={handleRefetch}
                  />
                </Section>
              </div>
            )}

            {/* Betting Controls */}
            <div className={styles.stack}>
              <Section
                id="betting-controls"
                title="Betting Controls"
                subtitle="Domain permissions and betting access"
                icon={<IconAdjustmentsHorizontal className={styles.stack} />}
                openSection={drawerUi.openSection}
                setOpenSection={setOpenSection}
              >
                <BettingControlsSection
                  user={effectiveUser}
                  saving={saving}
                  setSavingFlag={setSavingFlag}
                />
              </Section>
            </div>

            {/* Limits */}
            <div className={styles.stack}>
              <Section
                id="limits"
                title="Limits"
                subtitle="Stake and betting limits management"
                icon={<IconAdjustmentsHorizontal className={styles.stack} />}
                openSection={drawerUi.openSection}
                setOpenSection={setOpenSection}
              >
                <LimitsSection
                  user={effectiveUser}
                  saving={saving}
                  setSavingFlag={setSavingFlag}
                  dailyStakeLimit={dailyStakeLimit}
                  setDailyStakeLimit={setDailyStakeLimit}
                  weeklyStakeLimit={weeklyStakeLimit}
                  setWeeklyStakeLimit={setWeeklyStakeLimit}
                  exposureCapOverride={exposureCapOverride}
                  setExposureCapOverride={setExposureCapOverride}
                  cooldownSeconds={cooldownSeconds}
                  setCooldownSeconds={setCooldownSeconds}
                  maxBetSports={maxBetSports}
                  setMaxBetSports={setMaxBetSports}
                  maxBetCasino={maxBetCasino}
                  setMaxBetCasino={setMaxBetCasino}
                  maxBetMatka={maxBetMatka}
                  setMaxBetMatka={setMaxBetMatka}
                />
              </Section>
            </div>

            {/* Wallet & Bonus - Only for normal players, hidden for sharing agents */}
            {!isSharingAgent && !isCreditPlayer(effectiveUser?.playerType) && (
              <div className={styles.stack}>
                <Section
                  id="wallet"
                  title="Wallet & Bonus"
                  subtitle="Financial controls and bonus management"
                  icon={<IconWallet className={styles.stack} />}
                  openSection={drawerUi.openSection}
                  setOpenSection={setOpenSection}
                >
                  <WalletBonusSection
                    user={effectiveUser}
                    saving={saving}
                    setSavingFlag={setSavingFlag}
                    onRefetch={handleRefetch}
                    withdrawalLock={withdrawalLock}
                    setWithdrawalLock={setWithdrawalLock}
                    bonusAllowed={bonusAllowed}
                    setBonusAllowed={setBonusAllowed}
                  />
                </Section>
              </div>
            )}

            {/* Commission Info - Only for commission agent players */}
            {isCommissionPlayer(effectiveUser?.playerType) && (
              <div className={styles.stack}>
                <Section
                  id="commission"
                  title="Commission Information"
                  subtitle="Commission rates, earnings, and turnover"
                  icon={<IconCurrencyDollar className={styles.stack} />}
                  openSection={drawerUi.openSection}
                  setOpenSection={setOpenSection}
                >
                  <CommissionInfoSection user={effectiveUser} onRefetch={handleRefetch} onMove={() => setMoveOpen(true)} />
                </Section>
              </div>
            )}

            {/* Sharing Info - Only for sharing agent players, hidden when sharing agent is logged in */}
            {!isSharingAgent && isSharingAgentPlayer(effectiveUser?.playerType) && (
              <div className={styles.stack}>
                <Section
                  id="sharing"
                  title="Sharing Information"
                  subtitle="Sharing rates, GGR share, and settlement info"
                  icon={<IconShare className={styles.stack} />}
                  openSection={drawerUi.openSection}
                  setOpenSection={setOpenSection}
                >
                  <SharingInfoSection user={effectiveUser} />
                </Section>
              </div>
            )}
          </div>

      </div> : <Notice>No player selected</Notice>}
    </Drawer>
    {effectiveUser && <MovePlayerToAgentModal open={open && moveOpen} playerId={effectiveUser.id} currentAgentId={effectiveUser.agentId} playerType={effectiveUser.playerType} onClose={() => setMoveOpen(false)} onSuccess={() => { setMoveOpen(false); handleRefetch() }} />}
  </>
}
