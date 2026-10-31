import { useState } from 'react'
import { useQuery, useLazyQuery, useMutation, gql } from '@apollo/client'
import { Dialog } from '@/ui/components/Dialog'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog'
import { Button } from '@/ui/components/Button'
import { Combobox } from '@/ui/components/Combobox'
import { Textarea } from '@/ui/components/Textarea'
import { Notice } from '@/ui/components/Notice'
import { LoadingState } from '@/ui/components/LoadingState'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from '../PlayersSearch.module.css'
const COMMISSION_AGENTS_QUERY = gql`
  query CommissionAgentsForMove {
    agents {
      agentsPage(schemeType: COMMISSION, limit: 500) {
        items {
          id
          username
          schemeType
          status
          levelIndex
        }
      }
    }
  }
`

const MOVE_PRECHECK_QUERY = gql`
  query MovePlayerPreCheck($playerId: ID!, $targetAgentId: ID!) {
    movePlayerToAgentPreCheck(playerId: $playerId, targetAgentId: $targetAgentId) {
      canMove
      blockers
      warnings
      player {
        id
        name
        username
        phone
        status
      }
      sourceAgent {
        id
        username
        schemeType
        status
        allowedDomains
        commissionRates {
          domain
          rate
        }
        levelIndex
      }
      targetAgent {
        id
        username
        schemeType
        status
        allowedDomains
        commissionRates {
          domain
          rate
        }
        levelIndex
      }
      openBetsCounts {
        sports
        casino
        matka
        total
      }
      activeBonusCount
      walletBalance
      exposure
      commissionCycleStatus
      commissionCycleFrom
      commissionCycleTo
    }
  }
`

const MOVE_PLAYER_MUTATION = gql`
  mutation MovePlayerToAgent($input: MovePlayerToAgentInput!) {
    movePlayerToAgent(input: $input) {
      success
      message
    }
  }
`

interface MovePlayerToAgentModalProps {
  open: boolean
  playerId: string | number
  currentAgentId?: string | null
  playerType?: string | null
  onClose: () => void
  onSuccess: () => void
}


interface MoveAgent { id: string; username?: string | null; schemeType?: string; status?: string; levelIndex?: number; allowedDomains?: string[]; commissionRates?: { domain: string; rate: number }[] }
interface MoveCheck { canMove: boolean; blockers?: string[]; warnings?: string[]; sourceAgent?: MoveAgent; targetAgent?: MoveAgent; openBetsCounts?: { sports: number; casino: number; matka: number; total: number }; activeBonusCount: number; walletBalance?: number | null; exposure?: number | null; commissionCycleStatus?: string | null }
export function MovePlayerToAgentModal({ open, playerId, currentAgentId, playerType, onClose, onSuccess }: MovePlayerToAgentModalProps) {
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState(false)
  const { data: agentsData, loading: agentsLoading, error: agentsError } = useQuery<{ agents: { agentsPage: { items: MoveAgent[] } } }>(COMMISSION_AGENTS_QUERY, { skip: !open, errorPolicy: 'all' })
  const [runPreCheck, { data, loading: preCheckLoading, error: checkError }] = useLazyQuery<{ movePlayerToAgentPreCheck: MoveCheck }>(MOVE_PRECHECK_QUERY, { fetchPolicy: 'network-only', errorPolicy: 'all' })
  const [movePlayer, { loading: moveLoading }] = useMutation(MOVE_PLAYER_MUTATION)
  const check = data?.movePlayerToAgentPreCheck
  const options = (agentsData?.agents?.agentsPage?.items || []).filter(a => a.id !== currentAgentId && a.status === 'ACTIVE').map(a => ({ label: (a.username || a.id) + (a.levelIndex ? ' (L' + a.levelIndex + ')' : ''), value: a.id }))
  const canSubmit = !!targetAgentId && reason.trim().length >= 5 && check?.canMove === true && check.targetAgent?.id === targetAgentId && !preCheckLoading && !moveLoading
  function close() { if (moveLoading) return; setTargetAgentId(null); setReason(''); setConfirm(false); onClose() }
  async function submit() {
    if (!canSubmit || !targetAgentId) throw new Error('Eligibility checks must pass before moving this player')
    const result = await movePlayer({ variables: { input: { playerId: String(playerId), targetAgentId, reason: reason.trim() } } })
    if (!result.data?.movePlayerToAgent?.success) throw new Error(result.data?.movePlayerToAgent?.message || 'Failed to move player')
    setTargetAgentId(null); setReason(''); setConfirm(false); onSuccess(); onClose()
  }
  const agentInfo = (a: MoveAgent) => [{ term: 'Username', value: a.username || a.id }, { term: 'Level', value: a.levelIndex ? 'Level ' + a.levelIndex : 'N/A' }, { term: 'Domains', value: (a.allowedDomains || []).join(', ') || '—' }, { term: 'Commission Rates', value: a.commissionRates?.length ? a.commissionRates.map(r => r.domain + ': ' + (r.rate * 100).toFixed(1) + '%').join(', ') : 'No rates configured' }]
  const number = (value?: number | null) => value == null ? 'N/A' : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return <>
    <Dialog title="Move Player to Another Agent" open={open && !confirm} onOpenChange={next => { if (!next) close() }} size="lg" dismissible={!moveLoading} footer={<><span className={styles.secondary}>This action cannot be easily undone</span><Button disabled={moveLoading} onClick={close}>Cancel</Button><Button variant="dangerSolid" disabled={!canSubmit} onClick={() => setConfirm(true)}>Move Player</Button></>}>
      <div className={styles.stack}>
        {playerType && <p className={styles.secondary}>Player type: <StatusPill>{playerType}</StatusPill></p>}
        {check?.sourceAgent && <div><h3 className={styles.name}>Current Agent</h3><DescriptionList items={agentInfo(check.sourceAgent)} /></div>}
        <Combobox label="Select Target Agent" value={targetAgentId} options={options} loading={agentsLoading} clearable placeholder="Search and select a commission agent..." onChange={value => { setTargetAgentId(value); if (value) void runPreCheck({ variables: { playerId: String(playerId), targetAgentId: value } }) }} />
        {agentsError && <Notice tone="error">{agentsError.message}</Notice>}{checkError && <Notice tone="error">{checkError.message}</Notice>}
        {preCheckLoading && <LoadingState label="Checking eligibility..." />}
        {check && !preCheckLoading && targetAgentId && <>
          {check.targetAgent && <div><h3 className={styles.name}>Target Agent</h3><DescriptionList items={agentInfo(check.targetAgent)} /></div>}
          <div><h3 className={styles.name}>Eligibility Checks</h3><DescriptionList items={[{ term: 'Commission Cycle', value: <StatusPill tone={check.commissionCycleStatus === 'SETTLED' ? 'ok' : ['OPEN','CLOSED_UNSETTLED'].includes(check.commissionCycleStatus || '') ? 'neg' : check.commissionCycleStatus === 'BLOCKED' ? 'warn' : 'neutral'}>{check.commissionCycleStatus || 'No cycle'}</StatusPill> }, { term: 'Open Bets', value: ['sports','casino','matka'].map(domain => domain + ': ' + (check.openBetsCounts?.[domain as 'sports' | 'casino' | 'matka'] ?? 0)).join(', ') }, { term: 'Active/Pending Bonuses', value: check.activeBonusCount }, { term: 'Wallet Balance', value: number(check.walletBalance) }, { term: 'Exposure', value: number(check.exposure) }]} /></div>
          {!!check.blockers?.length && <Notice tone="error" title="Cannot move player">{check.blockers.join('; ')}</Notice>}
          {!!check.warnings?.length && <Notice tone="warn" title="Warnings">{check.warnings.join('; ')}</Notice>}
          {check.canMove && <Notice tone="ok">All checks passed. Player can be moved.</Notice>}
        </>}
        <Textarea label="Reason" required value={reason} onChange={setReason} rows={3} maxLength={500} showCount placeholder="Explain why this player is being moved (min 5 characters)..." error={reason.length > 0 && reason.trim().length < 5 ? 'Reason must be at least 5 characters' : undefined} />
      </div>
    </Dialog>
    <ConfirmDialog title="Confirm Player Transfer" open={open && confirm} onOpenChange={setConfirm} description={'Move this player to ' + (check?.targetAgent?.username || 'selected agent') + '? This will change all future commission attribution.'} tone="danger" confirmLabel="Yes, Move Player" onConfirm={submit} busy={moveLoading} />
  </>
}
