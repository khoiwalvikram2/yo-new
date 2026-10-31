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
import { AgentCreditAdjustmentModal } from './AgentCreditAdjustmentModal'
import { ChangeAgentPasswordModal } from './ChangeAgentPasswordModal'
import { Avatar } from '@/ui/components/Avatar'
import { Button } from '@/ui/components/Button'
import { StatusPill } from '@/ui/components/StatusPill'
import { CopyButton } from '@/ui/components/CopyButton'
import { Menu, MenuItem, MenuSeparator } from '@/ui/components/Menu'
import { PageHeader } from '@/ui/components/PageHeader'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import { profileLevelNames, profileSchemeLabels, type ProfileStats } from './agentProfileModel'
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
  agent: { id: string; username?: string; phone?: string; status?: string; schemeType?: string; levelIndex?: number; tallyEnabled?: boolean; allowedDomains?: string[]; creditLimit?: number; creditUsed?: number; creditAvailable?: number; parentAgentId?: string; createdAt?: string }
  /** The dashboard stats: the strip's player and downline figures. Absent until they load. */
  stats?: ProfileStats | null
  onRefetch?: () => void
  onTabChange?: (tab: string) => void
}

const domainName = (domain: string) => domain.charAt(0).toUpperCase() + domain.slice(1)

/** The profile's head (2026-10-28 redesign): who the agent is, what can be done, then a strip of its figures. */
export function AgentSummaryHeader({ agent, stats, onRefetch }: AgentSummaryHeaderProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatDate } = useFormatDate()
  const loggedInAgent = useAuthStore((state) => state.agent)
  const roles = useAuthStore((state) => state.roles) ?? []
  const [creditModalVisible, setCreditModalVisible] = useState(false)
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
  const creditLimit = Number(agent.creditLimit || 0)
  const creditUsed = Number(agent.creditUsed || 0)
  const players = { label: 'Players', value: count(stats?.totalPlayers), note: stats ? `${count(stats.directPlayerCount)} direct · ${count(stats.subAgentPlayerCount)} under sub-agents` : 'Loading…' }
  const strip: Array<{ label: string; value: string; note: string; tone?: 'warn' }> = isCredit ? [
    { label: 'Credit Limit', value: formatAmount(creditLimit), note: 'Given to this agent' },
    { label: 'Credit Used', value: formatAmount(creditUsed), note: creditLimit > 0 ? `${Math.round((creditUsed / creditLimit) * 100)}% of the limit` : 'No limit set', tone: creditLimit > 0 && creditUsed / creditLimit > 0.8 ? 'warn' : undefined },
    { label: 'Available', value: formatAmount(Number(agent.creditAvailable || 0)), note: 'Left to allocate' },
    players,
  ] : [
    players,
    { label: 'Sub-agents', value: count(stats?.totalSubAgents), note: 'Directly under this agent' },
    { label: 'Downline Balance', value: stat(stats?.totalDownlineBalance), note: "In players' wallets" },
    { label: 'Downline Exposure', value: stat(stats?.totalDownlineExposure), note: 'In open bets' },
  ]
  const meta = (label: string, value: ReactNode) => <span className={styles.metaItem}><span className={styles.metaLabel}>{label}</span>{value}</span>

  // The actions sit on the page title's row (its right side was empty); the card below is the agent itself.
  const actions = <>
    {isOwnProfile ? null : <RBACGuard required={[{ domain: 'agents.profile', actions: ['update'] }]} bypassForAgents={Boolean(loggedInAgent)} fallback={null}>
      <Menu trigger={<Button><span className={styles.menuLabel}>Agent actions<IconChevronDown size={16} stroke={strokeFor(16)} aria-hidden /></span></Button>}>
        <MenuItem onSelect={() => setPasswordModalVisible(true)}>Reset Password</MenuItem>
        <MenuSeparator />
        {['ACTIVE', 'INACTIVE', 'SUSPENDED'].map(status => <MenuItem key={status} disabled={agent.status === status || statusLoading} tone={status === 'SUSPENDED' ? 'danger' : 'default'} onSelect={() => void handleStatusChange(status)}>{status === 'ACTIVE' ? 'Set Active' : status === 'INACTIVE' ? 'Set Inactive' : 'Suspend'}</MenuItem>)}
      </Menu>
      <Link to={`/agents/${agent.id}/edit`} className={buttonClassName()}>Edit Agent</Link>
      {isCredit && <Button variant="primary" onClick={() => setCreditModalVisible(true)}>Adjust Credit</Button>}
    </RBACGuard>}
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
            {agent.tallyEnabled ? <StatusPill tone="ok">Tally</StatusPill> : null}
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
    <div role="group" aria-label={isCredit ? 'Credit and players' : 'Network'}>
      <dl className={styles.strip}>
        {strip.map(item => <div key={item.label} className={styles.stripCell}>
          <dt className={styles.stripLabel}>{item.label}</dt>
          <dd className={clsx(styles.stripValue, item.tone === 'warn' && styles.warning)}>{item.value}</dd>
          <dd className={styles.stripNote}>{item.note}</dd>
        </div>)}
      </dl>
    </div>
    <AgentCreditAdjustmentModal open={creditModalVisible} agent={agent} onClose={() => setCreditModalVisible(false)} onSuccess={() => { setCreditModalVisible(false); onRefetch?.() }} />
    <ChangeAgentPasswordModal open={passwordModalVisible} agentId={agent.id} agentName={displayName} onClose={() => setPasswordModalVisible(false)} onSuccess={() => setPasswordModalVisible(false)} />
    {canPay ? <CommissionCyclePayDialog open={payOpen} agentId={agent.id} username={agent.username ?? null} onClose={() => setPayOpen(false)} onPaid={() => { onRefetch?.() }} /> : null}
  </section>
  </>
}
