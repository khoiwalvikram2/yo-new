import { useState, type ReactNode } from 'react'
import { useMutation, gql } from '@apollo/client'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { IconEye, IconWallet, IconCoins, IconGift, IconEdit, IconDots, IconCopy, IconDownload } from '@tabler/icons-react'
import type { Player } from '@/shared/types/player'
import { useAuthStore } from '@/shared/core/authStore'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { notify } from '@/shared/services/notification'
import { AccountListPanel } from '@/modules/account-lists/AccountList'
import { ChipActions, chipTone, isDirectParent, refPnlNote, signedChips, useChipActor, useChipFormat, type ChipAccount } from '@/modules/chips'
import { Button } from '@/ui/components/Button'
import { IconButton } from '@/ui/components/IconButton'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Dialog } from '@/ui/components/Dialog'
import { Textarea } from '@/ui/components/Textarea'
import { StatusPill } from '@/ui/components/StatusPill'
import { Avatar } from '@/ui/components/Avatar'
import { Notice } from '@/ui/components/Notice'
import { exportPlayerListToExcel } from '../utils/exportPlayerList'
import { getAllHeaders, shouldShowColumnForParentType, shouldShowColumnForPlayer, isCreditPlayer, type SearchPlayer } from '../playersSearchModel'
import styles from '../PlayersSearch.module.css'
dayjs.extend(relativeTime)
type PlayersTableProps = {
  players: SearchPlayer[]
  fetching: boolean
  total?: number
  parentType?: string // 'ALL', 'DIRECT', 'SHARING', 'CREDIT', 'COMMISSION', 'SUB_AGENTS'
  loggedInAgentSchemeType?: string // 'SHARING', 'CREDIT', 'COMMISSION' - scheme type of logged-in agent
  convertFromWhitelabelCurrency: (n: number) => number
  onOpenActions: (p: Player) => void
  onAdjustBalance?: (p: Player) => void
  onSpecialBonus?: (p: Player) => void
  onView?: (id: string) => void
  /** After a change made from the table, a chip move included: the list asks again. */
  onRefetch?: () => void
  /** Every row under the current filters, for Export Excel. Without it the export holds the rows shown. */
  loadAllForExport?: () => Promise<SearchPlayer[]>
  footer?: ReactNode
}

const MASK = '••••'

/* A credit player's chips (spec 2026-11-02 §2), in the whitelabel's currency as the server keeps them and
   masked like every credit figure without players.credit:view. */
function ChipBalanceCell({ chips, visible }: { chips?: ChipAccount | null; visible: boolean }) {
  const format = useChipFormat(chips?.currency)
  if (!chips) return <>—</>
  return <div className={styles.cell}><span>Chips: {visible ? format(chips.balance) : MASK}</span><span className={styles.secondary}>Available: {visible ? format(chips.available) : MASK}</span></div>
}

function CreditRefCell({ chips, visible }: { chips?: ChipAccount | null; visible: boolean }) {
  const format = useChipFormat(chips?.currency)
  if (!chips) return <>—</>
  return <div className={styles.cell}><span>{visible ? format(chips.creditReference) : MASK}</span><span className={styles.secondary}>Reference only</span></div>
}

/** Ref P/L: green when the upline owes the player, rose when the player owes the upline, with the words under it. */
function RefPnlCell({ chips, visible }: { chips?: ChipAccount | null; visible: boolean }) {
  const format = useChipFormat(chips?.currency)
  if (!chips) return <>—</>
  if (!visible) return <>{MASK}</>
  const tone = chipTone(chips.refPnl)
  return <div className={styles.cell}><span className={tone === 'gain' ? styles.positive : tone === 'loss' ? styles.negative : undefined}>{signedChips(chips.refPnl, format)}</span><span className={styles.secondary}>{refPnlNote(chips.refPnl)}</span></div>
}


const UpdatePlayerRemarkMutation = gql`
  mutation UpdatePlayerRemark($userId: ID!, $remark: String) {
    updatePlayerRemark(userId: $userId, remark: $remark) {
      success
      message
      user { id remark }
    }
  }
`


export function PlayersTable({ players, fetching, total, parentType = 'ALL', loggedInAgentSchemeType, convertFromWhitelabelCurrency, onOpenActions, onAdjustBalance, onSpecialBonus, onView, onRefetch, loadAllForExport, footer }: PlayersTableProps) {
  const { formatAmount } = useCurrency()
  const { formatDateTime } = useFormatDate()
  const agent = useAuthStore(s => s.agent)
  const permissions = useAuthStore(s => s.permissions)
  const isAgentLoggedIn = !!agent
  const canViewWallet = isAgentLoggedIn || hasPermissionWithNested(permissions, 'players.wallet', 'view')
  const canViewCredit = isAgentLoggedIn || hasPermissionWithNested(permissions, 'players.credit', 'view')
  const canGrantSpecialBonus = isAgentLoggedIn || hasPermissionWithNested(permissions, 'players.specialBonus', 'create')
  const mask = MASK
  // Only a credit player's direct parent moves its chips (spec 2026-11-02 decision 3): its own agent, or an admin
  // (as the whitelabel) for a whitelabel credit player. The chip actions check it; anyone else sees why not.
  const chipActor = useChipActor()
  const canMoveChips = (u: SearchPlayer) => Boolean(u.chips && chipActor.canManage && isDirectParent(u.chips, chipActor.agentId))
  const chipsLockedLabel = (u: SearchPlayer) => u.playerType === 'WHITELABEL_CREDIT'
    ? agent ? 'Chips managed by the whitelabel' : 'Moving chips needs agents.credit:update'
    : "Chips managed by the player's agent"
  const [exporting, setExporting] = useState(false)
  const [remarkModalPlayer, setRemarkModalPlayer] = useState<Player | null>(null)
  const [remarkValue, setRemarkValue] = useState('')
  const [remarkError, setRemarkError] = useState('')
  const [updateRemark, { loading: updatingRemark }] = useMutation(UpdatePlayerRemarkMutation)
  async function saveRemark() {
    if (!remarkModalPlayer || updatingRemark) return
    setRemarkError('')
    try {
      const { data } = await updateRemark({ variables: { userId: remarkModalPlayer.id, remark: remarkValue.trim() || null } })
      if (!data?.updatePlayerRemark?.success) throw new Error(data?.updatePlayerRemark?.message || 'Could not update remark')
      notify.success(data.updatePlayerRemark.message || 'Remark updated', 'Remark updated')
      setRemarkModalPlayer(null); setRemarkValue(''); onRefetch?.()
    } catch (cause) { const message = cause instanceof Error ? cause.message : 'Could not update remark'; setRemarkError(message); notify.error(message, 'Update failed') }
  }
  async function handleExport() {
    if (!players.length) { notify.warning('There are no players to export.', 'No Data'); return }
    setExporting(true)
    // The file's title counts the rows it holds: it used to claim the whole list over the current page's rows.
    try { const rows = loadAllForExport ? await loadAllForExport() : players; await exportPlayerListToExcel(rows, rows.length); notify.success('Player list exported to Excel successfully.', 'Export Complete') }
    catch (cause) { notify.error(cause instanceof Error ? cause.message : 'Something went wrong during export.', 'Export Failed') }
    finally { setExporting(false) }
  }
  function money(value: number | null | undefined) { return value == null ? '—' : formatAmount(convertFromWhitelabelCurrency(Number(value))) }
  function view(u: Player) { if (onView) onView(u.id); else window.location.href = '/players/profile/' + u.id }
  function copy(value: string, label: string) { void navigator.clipboard?.writeText(value); notify.success(label + ' copied') }
  function trend(value: string | null | undefined) { return value ? <StatusPill tone={value === 'up' ? 'ok' : value === 'down' ? 'neg' : 'neutral'}>{value === 'up' ? 'Up' : value === 'down' ? 'Down' : 'Neutral'}</StatusPill> : null }
  const cell = (u: SearchPlayer, header: string): ReactNode => {
    const stats = u.stats || {}; const type = u.playerType || 'REGULAR'
    if (!shouldShowColumnForPlayer(header, type)) return '—'
    switch (header) {
      case 'Player': return <div className={styles.cell}><div className={styles.person}><Avatar name={u.name || u.username} hue="auto" /><div><button type="button" className={styles.link} onClick={() => view(u)}>{u.name || u.username || '—'}</button><div className={styles.username}><span>{u.username ? '@' + u.username : 'ID ' + u.id}</span><IconButton label={(u.username ? 'Copy username ' : 'Copy player ID ') + u.id} size="sm" icon={<IconCopy size={12} />} onClick={() => copy(u.username || u.id, u.username ? 'Username' : 'Player ID')} /></div></div>{u.vipTierName && !['null','undefined'].includes(u.vipTierName) && <StatusPill tone="info">{u.vipTierName}</StatusPill>}</div>
        {[{ label: 'Phone', value: u.phone }].map(row => <div key={row.label} className={styles.row}><span className={styles.secondary}>{row.label}: {row.value || '—'}</span>{row.value && <IconButton label={'Copy ' + row.label.toLowerCase() + ' ' + u.id} size="sm" icon={<IconCopy size={12} />} onClick={() => copy(row.value!, row.label)} />}</div>)}
        {u.parentAgent?.id && !(agent && agent.id === u.agentId) && <p className={styles.secondary}>Agent: {u.parentAgent.username || u.parentAgent.id.substring(0, 8) || 'Agent'}{!agent && ' [' + (u.parentAgent.schemeType || 'SHARING') + ']'}</p>}
        {u.referredBy?.id && <p className={styles.secondary}>Referred by: {u.referredBy.name || u.referredBy.username || u.referredBy.id}{u.referredBy.phone && ' (' + u.referredBy.phone + ')'}</p>}
        {u.remark?.trim() && <p className={styles.secondary}>Remark: {u.remark}</p>}
      </div>
      case 'Status': return <StatusPill tone={u.status === 'ACTIVE' ? 'ok' : u.status === 'SUSPENDED' ? 'neg' : 'neutral'}>{u.status === 'ACTIVE' ? 'Active' : u.status === 'SUSPENDED' ? 'Suspended' : 'Inactive'}</StatusPill>
      case 'Balance': return isCreditPlayer(type) ? <ChipBalanceCell chips={u.chips} visible={canViewCredit} /> : <div className={styles.cell}><span>Main: {canViewWallet ? u.wallet ? money(u.wallet.balance) : '—' : mask}</span><span className={styles.secondary}>Bonus: {canViewWallet ? u.wallet ? money(u.wallet.bonus) : '—' : mask}</span></div>
      case 'Credit Ref': return <CreditRefCell chips={u.chips} visible={canViewCredit} />
      case 'Ref P/L': return <RefPnlCell chips={u.chips} visible={canViewCredit} />
      case 'Deposits/Withdrawals': return <div className={styles.cell}><span>Deposits: {canViewWallet ? money(stats.totalDeposits) : mask}</span><span className={styles.secondary}>D: {stats.depositCount ?? 0} | M: {stats.manualDepositCount ?? 0}</span><span>Withdrawals: {canViewWallet ? money(stats.totalWithdrawals) : mask}</span><span className={styles.secondary}>D: {stats.withdrawalCount ?? 0} | M: {stats.manualWithdrawalCount ?? 0}</span></div>
      case 'Performance': return <div className={styles.cell}><span>GGR: {canViewWallet ? money(stats.ggr) : mask}</span><div className={styles.actions}><span className={(stats.profitLoss ?? 0) >= 0 ? styles.positive : styles.negative}>P/L: {canViewWallet ? money(stats.profitLoss) : mask}</span>{canViewWallet && trend(stats.plTrend)}</div>{stats.betCount != null && <span className={styles.secondary}>{stats.betCount} bets</span>}</div>
      case 'Commission': return <div className={styles.cell}><span>Earned: {canViewWallet ? money(stats.commissionEarned) : mask}</span>{canViewWallet && trend(stats.commissionTrend)}</div>
      case 'Turnover': return canViewWallet ? money(stats.turnover) : mask
      case 'Exposure': return canViewWallet ? u.wallet ? money(u.wallet.exposure) : '—' : mask
      case 'Last Activity': { const last = stats.lastActivityAt ?? stats.lastLogin; return <div className={styles.cell}><span>{last ? dayjs(last).fromNow() : 'Never'}</span>{last && <span className={styles.secondary}>{formatDateTime(last, 'dd MMM yyyy, hh:mm a')}</span>}{stats.lastBetAt && <span className={styles.secondary}>Last bet: {formatDateTime(stats.lastBetAt, 'dd MMM yyyy, hh:mm a')}</span>}{stats.daysSinceLastBet != null && <span className={styles.secondary}>{stats.daysSinceLastBet === 0 ? 'Today' : stats.daysSinceLastBet + 'd since last bet'}</span>}</div> }
      case 'Actions': {
        // A credit player's chips move by D / W (and its credit reference by CR) from its direct parent only.
        const chipsAction = isCreditPlayer(type)
          ? u.chips && canMoveChips(u) ? <ChipActions account={u.chips} onDone={onRefetch} /> : <IconButton disabled label={chipsLockedLabel(u)} icon={<IconCoins size={16} />} />
          : null
        return <div className={styles.actions}>
          <IconButton label={'View Profile ' + u.id} icon={<IconEye size={16} />} onClick={() => view(u)} />
          {isCreditPlayer(type) ? chipsAction : !agent && <IconButton label={'Adjust Balance ' + u.id} icon={<IconWallet size={16} />} onClick={() => onAdjustBalance ? onAdjustBalance(u) : onOpenActions(u)} />}
          {/* No bonus for a credit player or one whose bonus eligibility is off: the server refuses both. */}
          {onSpecialBonus && canGrantSpecialBonus && !agent && loggedInAgentSchemeType !== 'SHARING' && !isCreditPlayer(type) && u.bonusAllowed !== false && <IconButton label={'Special Bonus ' + u.id} icon={<IconGift size={16} />} onClick={() => onSpecialBonus(u)} />}
          {!agent && <IconButton label={'Update Remark ' + u.id} icon={<IconEdit size={16} />} onClick={() => { setRemarkError(''); setRemarkValue(u.remark || ''); setRemarkModalPlayer(u) }} />}
          <IconButton label={'More Actions ' + u.id} icon={<IconDots size={16} />} onClick={() => onOpenActions(u)} />
        </div>
      }
      default: return null
    }
  }
  const columns: DataTableColumn<SearchPlayer>[] = getAllHeaders().filter(header => shouldShowColumnForParentType(header, parentType, loggedInAgentSchemeType)).map(header => ({ key: header, header, cell: u => cell(u, header), sticky: header === 'Actions' ? 'end' : undefined, minWidth: header === 'Player' ? 250 : header === 'Actions' ? 220 : 135 }))
  return <><AccountListPanel title="Players" sub={(total ?? players.length).toLocaleString() + ((total ?? players.length) === 1 ? ' player' : ' players')} body="table" tools={<Button size="sm" icon={<IconDownload size={16} />} loading={exporting} disabled={!players.length || fetching} onClick={() => void handleExport()}>Export Excel</Button>}>
    <DataTable label="Players" columns={columns} rows={players} rowKey={u => u.id} state={fetching ? 'loading' : 'ready'} empty="No players found" pagination={false} />
    {footer && <div className={styles.footer}>{footer}</div>}
  </AccountListPanel>
    <Dialog title="Update Remark" open={!!remarkModalPlayer} onOpenChange={next => { if (!next && !updatingRemark) { setRemarkModalPlayer(null); setRemarkValue('') } }} dismissible={!updatingRemark} footer={<><Button disabled={updatingRemark} onClick={() => { setRemarkModalPlayer(null); setRemarkValue('') }}>Cancel</Button><Button variant="primary" loading={updatingRemark} onClick={() => void saveRemark()}>Save</Button></>}>
      <div className={styles.stack}><p className={styles.secondary}>Player: <strong>{remarkModalPlayer?.name || remarkModalPlayer?.username || remarkModalPlayer?.id}</strong></p><Textarea label="Remark" value={remarkValue} onChange={setRemarkValue} rows={4} maxLength={512} showCount placeholder="Enter remark (visible in player list)..." disabled={updatingRemark} />{remarkError && <Notice tone="error" live="assertive">{remarkError}</Notice>}</div>
    </Dialog>
  </>
}
