import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, gql } from '@apollo/client'
import { IconChevronDown, IconCash } from '@tabler/icons-react'
import clsx from 'clsx'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useAuthStore } from '@/shared/core/authStore'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { UPDATE_AGENT_STATUS_MUTATION } from '@/lib/graphql/agents'
import { CommissionCyclePayDialog } from '@/routes/commission/components/CommissionCyclePayDialog'
import { agentRowMoneyActions } from '@/routes/agents/components/agentsSearchModel'
import { tallyIsOn } from '@/routes/agents/agentEditorModel'
import { ChipActions, chipTone, refPnlNote, signedChips, useChipFormat, type ChipAccount } from '@/modules/chips'
import { ChangeAgentPasswordModal } from './ChangeAgentPasswordModal'
import { Avatar } from '@/ui/components/Avatar'
import { Button } from '@/ui/components/Button'
import { StatusPill } from '@/ui/components/StatusPill'
import { CopyButton } from '@/ui/components/CopyButton'
import { Menu, MenuItem, MenuSeparator } from '@/ui/components/Menu'
import { Notice } from '@/ui/components/Notice'
import { PageHeader } from '@/ui/components/PageHeader'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import { agentRestrictionNotice, profileLevelNames, profileSchemeLabels, type AgentRestriction, type ProfileStats } from './agentProfileModel'
import styles from './AgentProfileComponents.module.css'

const PARENT_AGENT_QUERY = gql`
  query ParentAgent($id: ID!) {
    agents {
      agentProfile(id: $id) {
        id
        username
        phone
      }
    }
  }
`

interface AgentSummaryHeaderProps {
  agent: { id: string; username?: string; phone?: string; status?: string; schemeType?: string; levelIndex?: number; tallyEnabled?: boolean; tallyDomains?: string[]; allowedDomains?: string[]; parentAgentId?: string; createdAt?: string }
  /** The dashboard stats: the strip's player and downline figures. Absent until they load. */
  stats?: ProfileStats | null
  /** A CREDIT agent's chips account: the strip's chip figures and the D / W / CR actions. */
  chipAccount?: ChipAccount | null
  chipLoading?: boolean
  /** The ancestor whose status blocks this agent or makes it read-only, which its own status pill does not show. */
  restriction?: AgentRestriction | null
  onRefetch?: () => void
  onTabChange?: (tab: string) => void
}

const domainName = (domain: string) => domain.charAt(0).toUpperCase() + domain.slice(1)

/** The profile's head (2026-10-28 redesign): who the agent is, what can be done, then a strip of its figures. */
export function AgentSummaryHeader({ agent, stats, chipAccount = null, chipLoading = false, restriction = null, onRefetch }: AgentSummaryHeaderProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatDate } = useFormatDate()
  const formatChips = useChipFormat(chipAccount?.currency)
  const loggedInAgent = useAuthStore((state) => state.agent)
  const roles = useAuthStore((state) => state.roles) ?? []
  const [passwordModalVisible, setPasswordModalVisible] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [updateStatus, { loading: statusLoading }] = useMutation(UPDATE_AGENT_STATUS_MUTATION)

  const handleStatusChange = async (status: string) => {
    try {
      const result = await updateStatus({ variables: { agentId: agent.id, status } })
      if (!result.data?.agents?.updateAgentStatus) throw new Error('Failed to update status')
      toast({ tone: 'ok', message: `Agent set to ${status.toLowerCase()}` })
      onRefetch?.()
    } catch (err: unknown) {
      toast({ tone: 'error', message: err instanceof Error ? err.message : 'Failed to update status' })
    }
  }

  const { data: parentAgentData } = useQuery(PARENT_AGENT_QUERY, { variables: { id: agent.parentAgentId }, skip: !agent.parentAgentId, errorPolicy: 'all' })
  const parent = parentAgentData?.agents?.agentProfile
  const displayName = agent.username || agent.phone || `Agent ${agent.id.slice(0, 8)}`
  // An agent looking at its own profile gets no management actions: it cannot edit, credit, reset or
  // suspend itself (the API refuses), so the buttons would only lead to an error.
  const isOwnProfile = Boolean(loggedInAgent && loggedInAgent.id === agent.id)
  // Paying follows the agents list: an admin pays a top-level commission agent, an agent pays its direct children.
  const isWhitelabelAdmin = roles.some((role: string) => role === 'Whitelabel Admin' || (role && (role.toLowerCase() === 'whitelabel_admin' || role.toLowerCase().includes('whitelabel'))))
  const canPay = !isOwnProfile && agentRowMoneyActions({ schemeType: agent.schemeType || '', parentAgentId: agent.parentAgentId }, { agentId: loggedInAgent?.id, isWhitelabelAdmin }).pay
  const isCredit = agent.schemeType === 'CREDIT'
  const statusLabel = agent.status === 'ACTIVE' ? 'Active' : agent.status === 'SUSPENDED' ? 'Suspended' : agent.status === 'INACTIVE' ? 'Inactive' : agent.status || 'Unknown'

  const stat = (value: number | undefined) => stats ? formatAmount(convertFromWhitelabelCurrency(Number(value ?? 0))) : '—'
  const count = (value: number | undefined) => stats ? Number(value ?? 0).toLocaleString('en-IN') : '—'
  const players = { label: 'Players', value: count(stats?.totalPlayers), note: stats ? `${count(stats.directPlayerCount)} direct · ${count(stats.subAgentPlayerCount)} under sub-agents` : 'Loading…' }
  // A CREDIT agent's chips (spec 2026-11-02 §2), in the whitelabel's currency as the server keeps them: its
  // own balance with what its downline holds, its credit reference and the Ref P/L between them.
  const chip = (value: number | undefined) => chipAccount ? formatChips(Number(value ?? 0)) : '—'
  const chipNote = (text: string) => chipAccount ? text : chipLoading ? 'Loading…' : 'Not available'
  const refTone = chipAccount ? chipTone(chipAccount.refPnl) : undefined
  const strip: Array<{ label: string; value: string; note: string; tone?: 'warn' | 'gain' | 'loss' }> = isCredit ? [
    { label: 'Balance', value: chip(chipAccount?.balance), note: chipNote(`Downline holds ${chip(chipAccount?.downlineBalance)}`) },
    { label: 'Credit Reference', value: chip(chipAccount?.creditReference), note: chipNote('Reference only') },
    { label: 'Ref P/L', value: chipAccount ? signedChips(chipAccount.refPnl, formatChips) : '—', note: chipNote(chipAccount ? refPnlNote(chipAccount.refPnl) : ''), tone: refTone },
    players,
  ] : [
    players,
    { label: 'Sub-agents', value: count(stats?.totalSubAgents), note: 'Directly under this agent' },
    { label: 'Downline Balance', value: stat(stats?.totalDownlineBalance), note: "In players' wallets" },
    { label: 'Downline Exposure', value: stat(stats?.totalDownlineExposure), note: 'In open bets' },
  ]
  const meta = (label: string, value: ReactNode) => <span className={styles.metaItem}><span className={styles.metaLabel}>{label}</span>{value}</span>
  const restrictionNotice = restriction ? agentRestrictionNotice(restriction, agent.parentAgentId) : null

  // The actions sit on the page title's row (its right side was empty); the card below is the agent itself.
  const actions = <>
    {isOwnProfile ? null : <RBACGuard required={[{ domain: 'agents.profile', actions: ['update'] }]} bypassForAgents={Boolean(loggedInAgent)} fallback={null}>
      <Menu trigger={<Button><span className={styles.menuLabel}>Agent actions<IconChevronDown size={16} stroke={strokeFor(16)} aria-hidden /></span></Button>}>
        <MenuItem onSelect={() => setPasswordModalVisible(true)}>Reset Password</MenuItem>
        <MenuSeparator />
        {['ACTIVE', 'INACTIVE', 'SUSPENDED'].map(status => <MenuItem key={status} disabled={agent.status === status || statusLoading} tone={status === 'SUSPENDED' ? 'danger' : 'default'} onSelect={() => void handleStatusChange(status)}>{status === 'ACTIVE' ? 'Set Active' : status === 'INACTIVE' ? 'Set Inactive' : 'Suspend'}</MenuItem>)}
      </Menu>
      <Link to={`/agents/${agent.id}/edit`} className={buttonClassName()}>Edit Agent</Link>
    </RBACGuard>}
    {/* Deposit / Withdraw chips and the credit reference: they render for the agent's direct parent only (an
        admin for a root agent), behind the permission the chip moves demand. */}
    {isCredit && chipAccount ? <ChipActions account={chipAccount} variant="full" onDone={onRefetch} /> : null}
    {canPay && <Button variant="primary" icon={<IconCash size={16} stroke={strokeFor(16)} />} onClick={() => setPayOpen(true)}>Pay Commission</Button>}
  </>

  return <>
  <PageHeader title="Agent Profile" back={{ to: '/agents', label: 'Back to Agents' }} className={styles.pageHeader} actions={actions} />
  <section className={styles.summary} aria-label="Agent summary">
    <div className={styles.summaryTop}>
      <div className={styles.identity}>
        <Avatar name={displayName} hue="auto" className={styles.summaryAvatar} />
        <div className={styles.identityText}>
          <div className={styles.nameRow}>
            <h2 className={styles.agentName}>{displayName}</h2>
            <CopyButton value={agent.username || displayName} label="Copy username" />
            <StatusPill status={agent.status || ''}>{statusLabel}</StatusPill>
            <StatusPill tone="info">{profileSchemeLabels[agent.schemeType || ''] || 'Unknown'}</StatusPill>
            {agent.levelIndex ? <StatusPill>{`L${agent.levelIndex} ${profileLevelNames[agent.levelIndex] || ''}`.trim()}</StatusPill> : null}
            {tallyIsOn(agent.tallyEnabled, agent.tallyDomains) ? <StatusPill tone="ok">Tally</StatusPill> : null}
          </div>
          <div className={styles.meta}>
            {meta('ID', <span className={styles.metaValue}><span className={styles.mono}>{agent.id.slice(0, 8)}</span><CopyButton value={agent.id} label="Copy agent ID" size="sm" /></span>)}
            {agent.phone ? meta('Phone', <span className={styles.metaValue}>{agent.phone}<CopyButton value={agent.phone} label="Copy phone" size="sm" /></span>) : null}
            {meta('Parent', parent ? <Link className={styles.link} to={`/agents/${parent.id}`}>{parent.username || parent.id}</Link> : agent.parentAgentId ? '…' : 'Top level')}
            {meta('Domains', agent.allowedDomains?.length ? agent.allowedDomains.map(domainName).join(' · ') : 'None')}
            {agent.createdAt ? meta('Joined', formatDate(agent.createdAt, 'MMM d, yyyy')) : null}
          </div>
        </div>
      </div>
    </div>
    <div role="group" aria-label={isCredit ? 'Chips and players' : 'Network'} aria-busy={(isCredit && chipLoading && !chipAccount) || undefined}>
      <dl className={styles.strip}>
        {strip.map(item => <div key={item.label} className={styles.stripCell}>
          <dt className={styles.stripLabel}>{item.label}</dt>
          <dd className={clsx(styles.stripValue, item.tone === 'warn' && styles.warning, item.tone === 'gain' && styles.gain, item.tone === 'loss' && styles.loss)}>{item.value}</dd>
          <dd className={styles.stripNote}>{item.note}</dd>
        </div>)}
      </dl>
    </div>
    <ChangeAgentPasswordModal open={passwordModalVisible} agentId={agent.id} agentName={displayName} onClose={() => setPasswordModalVisible(false)} onSuccess={() => setPasswordModalVisible(false)} />
    {canPay ? <CommissionCyclePayDialog open={payOpen} agentId={agent.id} username={agent.username ?? null} onClose={() => setPayOpen(false)} onPaid={() => { onRefetch?.() }} /> : null}
  </section>
  {/* A suspended (or inactive) ancestor restricts the whole subtree while this agent's own status still reads Active. */}
  {restriction && restrictionNotice ? <Notice tone={restrictionNotice.tone} title={restrictionNotice.title}>
    <Link className={styles.link} to={`/agents/${restriction.id}`}>{restriction.username || `Agent ${restriction.id.slice(0, 8)}`}</Link>{restrictionNotice.text}
  </Notice> : null}
  </>
}
