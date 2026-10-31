import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, gql } from '@apollo/client'
import { IconChevronDown, IconStarFilled, IconWallet } from '@tabler/icons-react'
import clsx from 'clsx'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useAuthStore } from '@/shared/core/authStore'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { notify } from '@/shared/services/notification'
import { CreditAdjustmentModal } from '@/routes/players/components/CreditAdjustmentModal'
import { BalanceAdjustmentModal } from '@/routes/players/components/BalanceAdjustmentModal'
import { MovePlayerToAgentModal } from '@/routes/players/components/MovePlayerToAgentModal'
import { Avatar } from '@/ui/components/Avatar'
import { Button } from '@/ui/components/Button'
import { CopyButton } from '@/ui/components/CopyButton'
import { Menu, MenuItem, MenuSeparator } from '@/ui/components/Menu'
import { Notice } from '@/ui/components/Notice'
import { PageHeader } from '@/ui/components/PageHeader'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tooltip } from '@/ui/components/Tooltip'
import { strokeFor } from '@/ui/components/icons'
import { ChangePlayerPasswordModal } from './ChangePlayerPasswordModal'
import { profileError, profileForModal, profilePlayerType, relativeProfileTime, type PlayerProfile } from '../profileModel'
import styles from '../PlayerProfile.module.css'
const SetUserStatus = gql`
  mutation SetUserStatus($id: ID!, $status: PlayerStatus!) {
    setUserStatus(id: $id, status: $status) {
      success
      message
      user { id status }
    }
  }
`

const SetRequirePasswordReset = gql`
  mutation SetRequirePasswordReset($id: ID!, $require: Boolean!) {
    setRequirePasswordReset(id: $id, require: $require) {
      success
      message
      user { id requirePasswordReset }
    }
  }
`

const AGENT_PROFILE_QUERY = gql`
  query AgentProfile($id: ID!) {
    agents {
      agentProfile(id: $id) {
        id
        username
        phone
      }
    }
  }
`

/** The profile's head (2026-10-28 redesign): who the player is, what can be done to them, and their wallets. */
export function SummaryHeader({ profile, onRefetch, onTabChange }: { profile: PlayerProfile; onRefetch?: () => void; onTabChange?: (tab: string) => void }) {
  const { formatAmount } = useCurrency()
  const { formatDate, formatDateTime } = useFormatDate()
  const [balanceOpen, setBalanceOpen] = useState(false)
  const [creditOpen, setCreditOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [setUserStatus] = useMutation(SetUserStatus)
  const [setRequirePasswordReset] = useMutation(SetRequirePasswordReset)
  const [status, setStatus] = useState(profile.status || 'ACTIVE')
  const [statusSaving, setStatusSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const statusInFlight = useRef(false)
  useEffect(() => { setStatus(profile.status || 'ACTIVE') }, [profile.status])
  const { data: agentData } = useQuery<{ agents: { agentProfile?: { id: string; username?: string; phone?: string } } }>(AGENT_PROFILE_QUERY, { variables: { id: profile.agentId }, skip: !profile.agentId, errorPolicy: 'all' })
  const parentAgent = agentData?.agents?.agentProfile
  const permissions = useAuthStore((state) => state.permissions)
  const agent = useAuthStore((state) => state.agent)
  const canChangePassword = hasPermissionWithNested(permissions, 'players.profile', 'change-password')
  const canViewWallet = !!agent || hasPermissionWithNested(permissions, 'players.wallet', 'view')
  const canViewCredit = !!agent || hasPermissionWithNested(permissions, 'players.credit', 'view')
  const canViewBonuses = !!agent || hasPermissionWithNested(permissions, 'players.bonuses', 'view')
  // Balance adjustments (adjustWallet) and whitelabel-credit changes are administrator actions: the API refuses every agent login.
  const canAdjustBalance = !agent
  const isCredit = profile.playerType === 'AGENT_CREDIT' || profile.playerType === 'WHITELABEL_CREDIT'
  const isWhitelabelCredit = profile.playerType === 'WHITELABEL_CREDIT'
  const showParent = (isCredit || profile.playerType === 'SHARING_AGENT_PLAYER' || profile.playerType === 'COMMISSION_AGENT_PLAYER') && profile.agentId
  const player = profileForModal(profile)
  const mask = '••••'
  const money = (value: number | undefined, allowed: boolean) => allowed ? formatAmount(Number(value || 0)) : mask
  const updateStatus = async (next: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED') => {
    if (statusInFlight.current) return
    statusInFlight.current = true; setStatusSaving(true); setActionError(null)
    try {
      const result = await setUserStatus({ variables: { id: profile.id, status: next }, context: { uiToast: 'message' } })
      if (!result.data?.setUserStatus?.success) throw new Error(result.data?.setUserStatus?.message || 'Failed to update status')
      setStatus(next); onRefetch?.()
    } catch (cause) { const message = profileError(cause, 'Failed to update status'); setActionError(message); notify.error(message) }
    finally { statusInFlight.current = false; setStatusSaving(false) }
  }
  const resetPassword = async () => {
    try {
      const result = await setRequirePasswordReset({ variables: { id: profile.id, require: true } })
      if (result.data?.setRequirePasswordReset?.success) { notify.success(result.data.setRequirePasswordReset.message || 'Password reset required'); onRefetch?.() }
      else setActionError(result.data?.setRequirePasswordReset?.message || 'Failed to set password reset')
    } catch (cause) { const message = profileError(cause, 'Failed to set password reset'); setActionError(message); notify.error(message) }
  }
  const meta = (label: string, value: ReactNode) => <span className={styles.metaItem}><span className={styles.metaLabel}>{label}</span>{value}</span>
  const wallets: Array<{ label: string; value: string }> = isCredit
    ? [{ label: 'Credit Limit', value: money(profile.creditLimit, canViewCredit) }, { label: 'Credit Used', value: money(profile.creditUsed, canViewCredit) }, { label: 'Available', value: money(profile.creditAvailable, canViewCredit) }]
    : [{ label: 'Balance', value: money(profile.wallet?.balance, canViewWallet) }, { label: 'Exposure', value: money(profile.wallet?.exposure, canViewWallet) }, { label: 'Bonus Wallet', value: money(profile.wallet?.bonus, canViewBonuses) }, { label: 'Referral Bonus', value: money(profile.wallet?.referralBonusBalance, canViewWallet) }]
  // The actions sit on the page title's row (its right side was empty); the card below is the player itself.
  const actions = <RBACGuard required={[{ domain: 'players.profile', actions: ['update'] }]}>
      <Menu trigger={<Button><span className={styles.menuLabel}>Player actions<IconChevronDown size={16} stroke={strokeFor(16)} aria-hidden /></span></Button>}>
        <MenuItem type="checkbox" checked={status === 'ACTIVE'} disabled={statusSaving || status === 'SUSPENDED'} title="Inactive users cannot place any bets" onSelect={() => void updateStatus(status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')}>Account Active</MenuItem>
        <MenuItem type="checkbox" checked={status === 'SUSPENDED'} disabled={statusSaving} tone="danger" title="Suspended users are force logged out and cannot bet or log in" onSelect={() => void updateStatus(status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED')}>Suspended</MenuItem>
        <MenuSeparator />
        {canChangePassword ? <MenuItem onSelect={() => setPasswordOpen(true)}>Change Password</MenuItem> : null}
        <MenuItem onSelect={() => void resetPassword()}>Reset Password on Next Login</MenuItem>
        <MenuItem onSelect={() => onTabChange?.('activity-log')}>View Activity Logs</MenuItem>
        {profile.playerType === 'COMMISSION_AGENT_PLAYER' && !agent && hasPermissionWithNested(permissions, 'players.move-agent', 'execute') ? <MenuItem onSelect={() => setMoveOpen(true)}>Move to Another Agent</MenuItem> : null}
      </Menu>
      {isWhitelabelCredit && !agent ? <Button variant="primary" onClick={() => setCreditOpen(true)}>Adjust Credit</Button> : null}
      {!isCredit && canAdjustBalance ? <Button variant="primary" icon={<IconWallet size={16} stroke={strokeFor(16)} />} onClick={() => setBalanceOpen(true)}>Adjust Balance</Button> : null}
  </RBACGuard>
  return <>
  <PageHeader title="Player Profile" back={{ to: '/players/search', label: 'Back to Players' }} className={styles.pageHeader} actions={actions} />
  <section className={styles.summary} aria-label="Player summary">
    <div className={styles.summaryTop}>
      <div className={styles.identity}>
        <Avatar name={profile.name || profile.username} hue="auto" className={styles.summaryAvatar} />
        <div className={styles.identityText}>
          <div className={styles.nameRow}>
            <h2 className={styles.playerName}>{profile.name}</h2>
            {profile.username ? <span className={styles.subtle}>@{profile.username}</span> : null}
            <StatusPill status={profile.status}>{profile.status === 'ACTIVE' ? 'Active' : profile.status === 'SUSPENDED' ? 'Suspended' : 'Inactive'}</StatusPill>
            {profile.playerType ? <StatusPill>{profilePlayerType(profile.playerType)}</StatusPill> : null}
            {profile.vipTierName ? <StatusPill tone="warn" icon={<IconStarFilled size={12} aria-hidden />}>{profile.vipTierName}</StatusPill> : null}
            {profile.kycStatus?.toLowerCase() === 'verified' ? <StatusPill tone="ok">KYC verified</StatusPill> : null}
          </div>
          <div className={styles.meta}>
            {meta('ID', <span className={styles.metaValue}>{profile.id}<CopyButton value={String(profile.id)} label="Copy ID" copiedLabel="ID copied" size="sm" /></span>)}
            {profile.phone ? meta('Phone', <span className={styles.metaValue}>{profile.phone}<CopyButton value={profile.phone} label="Copy Phone" copiedLabel="Phone copied" size="sm" /></span>) : null}
            {profile.email ? meta('Email', <span className={styles.metaValue}>{profile.email}<CopyButton value={profile.email} label="Copy Email" copiedLabel="Email copied" size="sm" /></span>) : null}
            {showParent && parentAgent ? meta('Agent', <Link className={styles.link} to={`/agents/${parentAgent.id}`}>{parentAgent.username || parentAgent.phone || parentAgent.id.slice(0, 8)}</Link>) : null}
            {profile.referredBy?.id ? meta('Referred by', <span>{profile.referredBy.name || profile.referredBy.username}{profile.referredBy.phone ? ` (${profile.referredBy.phone})` : ''}</span>) : null}
            {profile.createdAt ? meta('Joined', <Tooltip content={`Registered: ${formatDate(profile.createdAt, 'MMMM d, yyyy')}`}><span tabIndex={0}>{formatDate(profile.createdAt, 'MMM d, yyyy')}</span></Tooltip>) : null}
            {meta('Last seen', <Tooltip content={profile.lastLogin ? `Last login: ${formatDateTime(profile.lastLogin, 'MMM d, yyyy h:mm a')}` : 'Never logged in'}><span tabIndex={0}>{relativeProfileTime(profile.lastLogin)}</span></Tooltip>)}
          </div>
        </div>
      </div>
    </div>
    {actionError ? <div className={styles.summaryNotice}><Notice tone="error" title="Action not completed" live="assertive">{actionError}</Notice></div> : null}
    <div role="group" aria-label={isCredit ? 'Credit' : 'Wallets'}>
      <dl className={clsx(styles.walletStrip, isCredit && styles.walletStripCredit)}>
        {wallets.map((item) => <div key={item.label} className={styles.walletCell}><dt className={styles.walletLabel}>{item.label}</dt><dd className={clsx(styles.walletValue, styles.moneyValue)}>{item.value}</dd></div>)}
      </dl>
    </div>
    {!isCredit ? <BalanceAdjustmentModal open={balanceOpen} player={player} onClose={() => setBalanceOpen(false)} onSuccess={() => { setBalanceOpen(false); onRefetch?.() }} /> : null}
    {isWhitelabelCredit ? <CreditAdjustmentModal open={creditOpen} player={player} initialTab="limit" onClose={() => setCreditOpen(false)} onSuccess={() => { setCreditOpen(false); onRefetch?.() }} /> : null}
    <ChangePlayerPasswordModal open={passwordOpen} playerId={profile.id} playerName={profile.name || profile.username || 'Player'} onClose={() => setPasswordOpen(false)} onSuccess={onRefetch} />
    <MovePlayerToAgentModal open={moveOpen} playerId={profile.id} currentAgentId={profile.agentId} playerType={profile.playerType} onClose={() => setMoveOpen(false)} onSuccess={() => { setMoveOpen(false); onRefetch?.() }} />
  </section>
  </>
}
