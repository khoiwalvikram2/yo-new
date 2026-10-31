import { useState, useMemo, useEffect, type ReactNode } from 'react'
import { useQuery, useMutation, useLazyQuery, gql } from '@apollo/client'
import { IconGripVertical } from '@tabler/icons-react'
import clsx from 'clsx'
import Papa from 'papaparse'
import { format } from 'date-fns'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/ui/components/Button'
import { Checkbox } from '@/ui/components/Checkbox'
import { FileField } from '@/ui/components/FileField'
import { SearchField } from '@/ui/components/SearchField'
import { Tabs } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { Notice } from '@/ui/components/Notice'
import { bonusNotification as notification } from './bonusDetailModel'
import styles from './BonusDetailTabs.module.css'

export interface BonusCampaignRulesJson {
  excludedPlayerIds?: string[]
  excludedAgentIds?: string[]
}

const USERS_QUERY = gql`
  query Users($query: String) {
    users(query: $query, status: ACTIVE) {
      id
      username
      email
      phone
      name
    }
  }
`

const AGENTS_HIERARCHY_QUERY = gql`
  query AgentsHierarchy {
    agentsHierarchy {
      id
      name
      level
      phone
    }
  }
`

const USERS_BY_IDS_QUERY = gql`
  query UsersByIds($ids: [ID!]!) {
    usersByIds(ids: $ids) {
      id
      name
      username
      phone
    }
  }
`

const AGENTS_BY_IDS_QUERY = gql`
  query AgentsByIds($ids: [ID!]!) {
    agentsByIds(ids: $ids) {
      id
      name
      code
      phone
    }
  }
`

const USER_IDS_BY_PHONES_QUERY = gql`
  query UserIdsByPhones($phones: [String!]!) {
    userIdsByPhones(phones: $phones)
  }
`

const AGENT_IDS_BY_USERNAMES_QUERY = gql`
  query AgentIdsByUsernames($usernames: [String!]!) {
    agentIdsByUsernames(usernames: $usernames)
  }
`

const AGENT_EXCLUSION_IMPACT_QUERY = gql`
  query AgentExclusionImpact($agentId: ID!) {
    agentExclusionImpact(agentId: $agentId) {
      descendantAgentIds
      playerIds
    }
  }
`

const UPDATE_BONUS_CAMPAIGN_MUTATION = gql`
  mutation UpdateBonusCampaign($input: BonusCampaignUpdateInput!) {
    updateBonusCampaign(input: $input) {
      success
      message
      campaign {
        id
      }
    }
  }
`

interface ExclusionListTabProps {
  campaignId: string
  excludedPlayerIds?: string[]
  excludedAgentIds?: string[]
  onUpdate?: () => void
}

const GET_BONUS_CAMPAIGN_QUERY = gql`
  query GetBonusCampaign($id: ID!) {
    bonusCampaign(id: $id) {
      id
      rulesJson
      limitsJson
    }
  }
`

const ELIGIBLE_PLAYERS_DROP_ID = 'eligible-players'
const EXCLUDED_PLAYERS_DROP_ID = 'excluded-players'
const ELIGIBLE_AGENTS_DROP_ID = 'eligible-agents'
const EXCLUDED_AGENTS_DROP_ID = 'excluded-agents'

type PlayerRowRecord = { id: string; name?: string; username?: string; phone?: string }
type AgentRowRecord = { id: string; name?: string; code: string; phone?: string | null }

function DraggableRow({ record, source, type, disabled, checked, onCheck }: {
  record: PlayerRowRecord | AgentRowRecord; source: 'eligible' | 'excluded'; type: 'player' | 'agent'; disabled: boolean; checked: boolean; onCheck: (checked: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: type === 'player' ? `${source}-${record.id}` : `agent-${source}-${record.id}`,
    data: type === 'player' ? { type, userId: String(record.id), source } : { type, agentId: String(record.id), source }, disabled,
  })
  const name = type === 'player' ? ('username' in record ? record.username : undefined) ?? record.name ?? '—' : record.name ?? '—'
  return <tr ref={setNodeRef} style={transform ? { transform: CSS.Translate.toString(transform) } : undefined} className={clsx(styles.row, isDragging && styles.dragging)}>
    <td><Checkbox label={`Select ${name}`} hideLabel checked={checked} onChange={onCheck} disabled={disabled} /></td>
    <td><button type="button" className={styles.handle} aria-label={`Drag ${name} to move between lists`} disabled={disabled} {...listeners} {...attributes}><IconGripVertical size={16} aria-hidden /></button></td>
    <td>{name}</td><td>{record.phone ?? '—'}</td>
  </tr>
}
function DroppablePanel({ id, title, excluded, children }: { id: string; title: string; excluded?: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return <section ref={setNodeRef} className={clsx(styles.panel, excluded && styles.excluded, isOver && styles.over)} aria-label={title}><h3 className={styles.panelTitle}>{title}</h3>{children}</section>
}
function TransferTable({ label, records, selected, onSelectedChange, type, source, loading, disabled, empty }: {
  label: string; records: Array<PlayerRowRecord | AgentRowRecord>; selected: Set<string>; onSelectedChange: (next: Set<string>) => void; type: 'player' | 'agent'; source: 'eligible' | 'excluded'; loading?: boolean; disabled: boolean; empty: string
}) {
  const all = records.length > 0 && records.every(row => selected.has(String(row.id)))
  return <div className={styles.scroll}><table className={styles.table} aria-label={label}><thead><tr>
    <th><Checkbox label={`Select all ${label}`} hideLabel checked={all} indeterminate={records.some(row => selected.has(String(row.id))) && !all} disabled={disabled || loading || records.length === 0} onChange={checked => onSelectedChange(checked ? new Set(records.map(row => String(row.id))) : new Set())} /></th>
    <th aria-label="Move" /><th scope="col">Name</th><th scope="col">Phone</th>
  </tr></thead><tbody>{loading ? <tr><td colSpan={4}>Loading...</td></tr> : records.length === 0 ? <tr><td colSpan={4}>{empty}</td></tr> : records.map(record => <DraggableRow key={record.id} record={record} source={source} type={type} disabled={disabled} checked={selected.has(String(record.id))} onCheck={checked => { const next = new Set(selected); if (checked) next.add(String(record.id)); else next.delete(String(record.id)); onSelectedChange(next) }} />)}</tbody></table></div>
}

export function ExclusionListTab({
  campaignId,
  excludedPlayerIds = [],
  excludedAgentIds = [],
  onUpdate,
}: ExclusionListTabProps) {
  const [playerSearch, setPlayerSearch] = useState('')
  const [agentSearch, setAgentSearch] = useState('')
  const [selectedEligiblePlayers, setSelectedEligiblePlayers] = useState<Set<string>>(new Set())
  const [selectedExcludedPlayers, setSelectedExcludedPlayers] = useState<Set<string>>(new Set())
  const [selectedEligibleAgents, setSelectedEligibleAgents] = useState<Set<string>>(new Set())
  const [selectedExcludedAgents, setSelectedExcludedAgents] = useState<Set<string>>(new Set())
  const [agentsSaving, setAgentsSaving] = useState(false)

  // Fetch campaign to get current rulesJson - must be defined before useEffect
  const { data: campaignData } = useQuery(GET_BONUS_CAMPAIGN_QUERY, {
    variables: { id: campaignId },
    errorPolicy: 'all',
  })

  // Initialize from props (normalize to string[] for consistent compare/remove)
  const [excludedPlayers, setExcludedPlayers] = useState<string[]>(() => (excludedPlayerIds || []).map(String))
  const [excludedAgents, setExcludedAgents] = useState<string[]>(() => (excludedAgentIds || []).map(String))

  // Update state when campaign data loads or props change (normalize to string[] for consistent compare/remove)
  useEffect(() => {
    const toStr = (id: string | number) => String(id)
    if (excludedPlayerIds && excludedPlayerIds.length > 0) {
      setExcludedPlayers(excludedPlayerIds.map(toStr))
    } else if (campaignData?.bonusCampaign?.rulesJson) {
      const rulesJson = campaignData.bonusCampaign.rulesJson as BonusCampaignRulesJson | null | undefined
      if (rulesJson?.excludedPlayerIds && Array.isArray(rulesJson.excludedPlayerIds)) {
        setExcludedPlayers(rulesJson.excludedPlayerIds.map(toStr))
      }
    } else if (excludedPlayerIds && excludedPlayerIds.length === 0) {
      setExcludedPlayers([])
    }

    if (excludedAgentIds && excludedAgentIds.length > 0) {
      setExcludedAgents(excludedAgentIds.map(toStr))
    } else if (campaignData?.bonusCampaign?.rulesJson) {
      const rulesJson = campaignData.bonusCampaign.rulesJson as BonusCampaignRulesJson | null | undefined
      if (rulesJson?.excludedAgentIds && Array.isArray(rulesJson.excludedAgentIds)) {
        setExcludedAgents(rulesJson.excludedAgentIds.map(toStr))
      }
    } else if (excludedAgentIds && excludedAgentIds.length === 0) {
      setExcludedAgents([])
    }
  }, [campaignData, excludedPlayerIds, excludedAgentIds])

  // Fetch players: by default load all; when user types, filter by search
  const { data: playersData, loading: playersLoading } = useQuery(USERS_QUERY, {
    variables: {
      query: playerSearch.trim() || undefined,
    },
    errorPolicy: 'all',
  })

  // Fetch agents (for dropdown)
  const { data: agentsData, loading: agentsLoading } = useQuery(AGENTS_HIERARCHY_QUERY, {
    errorPolicy: 'all',
  })

  // Fetch details for all excluded players (no placeholders)
  const { data: excludedPlayersDetailsData } = useQuery(USERS_BY_IDS_QUERY, {
    variables: { ids: excludedPlayers },
    skip: excludedPlayers.length === 0,
    errorPolicy: 'all',
  })

  // Fetch details for all excluded agents (real name/code)
  const { data: excludedAgentsDetailsData } = useQuery(AGENTS_BY_IDS_QUERY, {
    variables: { ids: excludedAgents },
    skip: excludedAgents.length === 0,
    errorPolicy: 'all',
  })

  const [resolvePhonesToIds] = useLazyQuery(USER_IDS_BY_PHONES_QUERY, { errorPolicy: 'all' })
  const [resolveUsernamesToAgentIds] = useLazyQuery(AGENT_IDS_BY_USERNAMES_QUERY, { errorPolicy: 'all' })
  const [fetchAgentExclusionImpact] = useLazyQuery(AGENT_EXCLUSION_IMPACT_QUERY, { errorPolicy: 'all' })

  const [updateCampaign, { loading: updateCampaignLoading }] = useMutation(UPDATE_BONUS_CAMPAIGN_MUTATION, {
    onCompleted: (data) => {
      if (data.updateBonusCampaign.success) {
        onUpdate?.()
      } else {
        notification.error({
          message: 'Error',
          description: data.updateBonusCampaign.message,
        })
      }
    },
    onError: (error) => {
      notification.error({
        message: 'Error',
        description: error.message,
      })
    },
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const handleEligibilityDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const payload = active.data.current as
      | { type: 'player'; userId: string; source: 'eligible' | 'excluded' }
      | undefined
    if (!payload || payload.type !== 'player') return
    const overId = String(over.id)
    if (overId === EXCLUDED_PLAYERS_DROP_ID && payload.source === 'eligible') {
      if (excludedPlayers.includes(payload.userId)) return
      const newExcluded = [...excludedPlayers, payload.userId]
      setExcludedPlayers(newExcluded)
      const currentRulesJson = (campaignData?.bonusCampaign?.rulesJson as BonusCampaignRulesJson | null | undefined) || {}
      saveExclusionAndNotify({
        input: {
          id: campaignId,
          rulesJson: { ...currentRulesJson, excludedPlayerIds: newExcluded, excludedAgentIds: excludedAgents },
        },
      }).catch(() => {})
    } else if (overId === ELIGIBLE_PLAYERS_DROP_ID && payload.source === 'excluded') {
      const newExcluded = excludedPlayers.filter((id) => id !== payload.userId)
      setExcludedPlayers(newExcluded)
      const currentRulesJson = (campaignData?.bonusCampaign?.rulesJson as BonusCampaignRulesJson | null | undefined) || {}
      saveExclusionAndNotify({
        input: {
          id: campaignId,
          rulesJson: { ...currentRulesJson, excludedPlayerIds: newExcluded, excludedAgentIds: excludedAgents },
        },
      }).catch(() => {})
    }
  }

  const handleEligibilityAgentDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const payload = active.data.current as
      | { type: 'agent'; agentId: string; source: 'eligible' | 'excluded' }
      | undefined
    if (!payload || payload.type !== 'agent') return
    const overId = String(over.id)
    const currentRulesJson = (campaignData?.bonusCampaign?.rulesJson as BonusCampaignRulesJson | null | undefined) || {}

    if (overId === EXCLUDED_AGENTS_DROP_ID && payload.source === 'eligible') {
      if (excludedAgents.includes(payload.agentId)) return
      setAgentsSaving(true)
      try {
        const result = await fetchAgentExclusionImpact({ variables: { agentId: payload.agentId } })
        const impact = result.data?.agentExclusionImpact
        const descendantIds = (impact?.descendantAgentIds ?? []).map(String).filter(Boolean)
        const playerIds = (impact?.playerIds ?? []).map(String).filter(Boolean)
        const newExcludedAgents = [...new Set([...excludedAgents, ...descendantIds])]
        const newExcludedPlayers = [...new Set([...excludedPlayers, ...playerIds])]
        setExcludedAgents(newExcludedAgents)
        setExcludedPlayers(newExcludedPlayers)
        await saveExclusionAndNotify({
          input: {
            id: campaignId,
            rulesJson: { ...currentRulesJson, excludedPlayerIds: newExcludedPlayers, excludedAgentIds: newExcludedAgents },
          },
        })
        if (descendantIds.length > 1 || playerIds.length > 0) {
          notification.info({
            message: 'Downline excluded',
            description: `Agent and ${descendantIds.length} downline agent(s), ${playerIds.length} player(s) added to exclusion.`,
          })
        }
      } catch (e) {
        notification.error({
          message: 'Failed to get exclusion impact',
          description: e instanceof Error ? e.message : 'Please try again.',
        })
      } finally {
        setAgentsSaving(false)
      }
    } else if (overId === ELIGIBLE_AGENTS_DROP_ID && payload.source === 'excluded') {
      setAgentsSaving(true)
      try {
        const result = await fetchAgentExclusionImpact({ variables: { agentId: payload.agentId } })
        const impact = result.data?.agentExclusionImpact
        const descendantIds = new Set((impact?.descendantAgentIds ?? []).map(String).filter(Boolean))
        const playerIdsSet = new Set((impact?.playerIds ?? []).map(String).filter(Boolean))
        const newExcludedAgents = excludedAgents.filter((id) => !descendantIds.has(id))
        const newExcludedPlayers = excludedPlayers.filter((id) => !playerIdsSet.has(id))
        setExcludedAgents(newExcludedAgents)
        setExcludedPlayers(newExcludedPlayers)
        await saveExclusionAndNotify({
          input: {
            id: campaignId,
            rulesJson: { ...currentRulesJson, excludedPlayerIds: newExcludedPlayers, excludedAgentIds: newExcludedAgents },
          },
        })
        if (descendantIds.size > 1 || playerIdsSet.size > 0) {
          notification.info({
            message: 'Downline included',
            description: `Agent and ${descendantIds.size} downline agent(s), ${playerIdsSet.size} player(s) removed from exclusion.`,
          })
        }
      } catch (e) {
        notification.error({
          message: 'Failed to get exclusion impact',
          description: e instanceof Error ? e.message : 'Please try again.',
        })
      } finally {
        setAgentsSaving(false)
      }
    }
  }

  const currentRulesJsonRef = useMemo(
    () => (campaignData?.bonusCampaign?.rulesJson as BonusCampaignRulesJson | null | undefined) || {},
    [campaignData?.bonusCampaign?.rulesJson]
  )

  const moveSelectedPlayersToExcluded = async () => {
    if (selectedEligiblePlayers.size === 0) return
    const ids = Array.from(selectedEligiblePlayers)
    const newExcluded = [...new Set([...excludedPlayers, ...ids])]
    setExcludedPlayers(newExcluded)
    setSelectedEligiblePlayers(new Set())
    await saveExclusionAndNotify({
      input: { id: campaignId, rulesJson: { ...currentRulesJsonRef, excludedPlayerIds: newExcluded, excludedAgentIds: excludedAgents } },
    })
  }

  const moveSelectedPlayersToEligible = async () => {
    if (selectedExcludedPlayers.size === 0) return
    const ids = Array.from(selectedExcludedPlayers)
    const newExcluded = excludedPlayers.filter((id) => !ids.includes(id))
    setExcludedPlayers(newExcluded)
    setSelectedExcludedPlayers(new Set())
    await saveExclusionAndNotify({
      input: { id: campaignId, rulesJson: { ...currentRulesJsonRef, excludedPlayerIds: newExcluded, excludedAgentIds: excludedAgents } },
    })
  }

  const moveSelectedAgentsToExcluded = async () => {
    if (selectedEligibleAgents.size === 0) return
    setAgentsSaving(true)
    try {
      let newExcludedAgents = [...excludedAgents]
      let newExcludedPlayers = [...excludedPlayers]
      for (const agentId of selectedEligibleAgents) {
        const result = await fetchAgentExclusionImpact({ variables: { agentId } })
        const impact = result.data?.agentExclusionImpact
        const descendantIds = (impact?.descendantAgentIds ?? []).map(String).filter(Boolean)
        const playerIds = (impact?.playerIds ?? []).map(String).filter(Boolean)
        newExcludedAgents = [...new Set([...newExcludedAgents, ...descendantIds])]
        newExcludedPlayers = [...new Set([...newExcludedPlayers, ...playerIds])]
      }
      setExcludedAgents(newExcludedAgents)
      setExcludedPlayers(newExcludedPlayers)
      setSelectedEligibleAgents(new Set())
      await saveExclusionAndNotify({
        input: { id: campaignId, rulesJson: { ...currentRulesJsonRef, excludedPlayerIds: newExcludedPlayers, excludedAgentIds: newExcludedAgents } },
      })
      notification.success({ message: 'Selected agents and their downline excluded' })
    } catch (e) {
      notification.error({
        message: 'Failed to get exclusion impact',
        description: e instanceof Error ? e.message : 'Please try again.',
      })
    } finally {
      setAgentsSaving(false)
    }
  }

  const moveSelectedAgentsToEligible = async () => {
    if (selectedExcludedAgents.size === 0) return
    setAgentsSaving(true)
    try {
      let newExcludedAgents = [...excludedAgents]
      let newExcludedPlayers = [...excludedPlayers]
      for (const agentId of selectedExcludedAgents) {
        const result = await fetchAgentExclusionImpact({ variables: { agentId } })
        const impact = result.data?.agentExclusionImpact
        const descendantIds = new Set((impact?.descendantAgentIds ?? []).map(String).filter(Boolean))
        const playerIdsSet = new Set((impact?.playerIds ?? []).map(String).filter(Boolean))
        newExcludedAgents = newExcludedAgents.filter((id) => !descendantIds.has(id))
        newExcludedPlayers = newExcludedPlayers.filter((id) => !playerIdsSet.has(id))
      }
      setExcludedAgents(newExcludedAgents)
      setExcludedPlayers(newExcludedPlayers)
      setSelectedExcludedAgents(new Set())
      await saveExclusionAndNotify({
        input: { id: campaignId, rulesJson: { ...currentRulesJsonRef, excludedPlayerIds: newExcludedPlayers, excludedAgentIds: newExcludedAgents } },
      })
      notification.success({ message: 'Selected agents and their downline included' })
    } catch (e) {
      notification.error({
        message: 'Failed to get exclusion impact',
        description: e instanceof Error ? e.message : 'Please try again.',
      })
    } finally {
      setAgentsSaving(false)
    }
  }

  const saveExclusionAndNotify = async (variables: { input: { id: string; rulesJson: BonusCampaignRulesJson } }, customMessage?: { message: string; description: string }) => {
    const result = await updateCampaign({
      variables,
      context: { skipNotification: true },
    })
    if (!result.data?.updateBonusCampaign?.success) {
      const previous = currentRulesJsonRef
      setExcludedPlayers((previous.excludedPlayerIds || []).map(String))
      setExcludedAgents((previous.excludedAgentIds || []).map(String))
      throw new Error(result.data?.updateBonusCampaign?.message || 'Campaign update failed')
    }
    if (customMessage) {
      notification.success(customMessage)
    } else {
      notification.success({
        message: 'Success',
        description: 'Exclusion list updated successfully',
      })
    }
  }

  const players = useMemo<PlayerRowRecord[]>(() => playersData?.users || [], [playersData])
  const eligiblePlayers = useMemo(
    () =>
      (players as PlayerRowRecord[]).filter(
        (p) => !excludedPlayers.includes(String(p.id))
      ),
    [players, excludedPlayers]
  )
  const agents = useMemo(() => {
    if (!agentsData?.agentsHierarchy) return []
    // Flatten the hierarchy tree
    interface AgentNode { id: string; name?: string; level?: number; phone?: string | null; children?: AgentNode[] }
    const flattenAgents = (nodes: AgentNode[]): { id: string; name?: string; code: string; level?: number; phone?: string | null }[] => {
      const result: { id: string; name?: string; code: string; level?: number; phone?: string | null }[] = []
      for (const node of nodes) {
        result.push({
          id: node.id,
          name: node.name,
          code: `AG${node.id}`,
          level: node.level,
          phone: node.phone ?? undefined,
        })
        if (node.children && node.children.length > 0) {
          result.push(...flattenAgents(node.children))
        }
      }
      return result
    }
    return flattenAgents(agentsData.agentsHierarchy)
  }, [agentsData])
  const eligibleAgents = useMemo(
    () =>
      (agents as AgentRowRecord[]).filter(
        (a) => !excludedAgents.includes(String(a.id))
      ),
    [agents, excludedAgents]
  )
  const filteredEligibleAgents = useMemo(() => {
    if (!agentSearch.trim()) return eligibleAgents
    const q = agentSearch.trim().toLowerCase()
    return eligibleAgents.filter(
      (a) =>
        a.name?.toLowerCase().includes(q) ||
        a.code?.toLowerCase().includes(q) ||
        String(a.id).toLowerCase().includes(q)
    )
  }, [eligibleAgents, agentSearch])
  // Download excluded players as simple list of numbers only (one per line) — same format as upload expects
  const handleExportPlayers = () => {
    const numbers = excludedPlayersData
      .map((row: { phone?: string }) => row.phone?.trim?.() ?? '')
      .filter(Boolean)
    if (numbers.length === 0) {
      notification.warning({
        message: 'No Data',
        description: 'No excluded players with phone numbers to export.',
      })
      return
    }
    const content = numbers.join('\n')
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `excluded-players-${format(new Date(), 'yyyy-MM-dd')}.txt`
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(link.href)
    notification.success({
      message: 'Download Successful',
      description: `${numbers.length} number(s) exported. You can re-upload this file to apply the same list.`,
    })
  }

  // Download excluded agents as usernames only (one per line) — same format as upload expects
  const handleExportAgents = () => {
    const usernames = excludedAgentsData
      .map((row: { name?: string; username?: string }) => (row.name ?? row.username ?? '').trim())
      .filter(Boolean)
    if (usernames.length === 0) {
      notification.warning({
        message: 'No Data',
        description: 'No excluded agents to export.',
      })
      return
    }
    const content = usernames.join('\n')
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `excluded-agents-${format(new Date(), 'yyyy-MM-dd')}.txt`
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(link.href)
    notification.success({
      message: 'Download Successful',
      description: `${usernames.length} username(s) exported. You can re-upload this file to apply the same list.`,
    })
  }

  // Parse file to list of usernames only (one per line or CSV with username/name column)
  const parseUsernamesFromFile = (content: string, isCsv: boolean): string[] => {
    const usernames: string[] = []
    if (isCsv) {
      const noHeader = Papa.parse(content, { skipEmptyLines: true })
      noHeader.data.forEach((row: Record<string, unknown>) => {
        const first = Array.isArray(row) ? row[0] : (row && Object.values(row)[0])
        if (first != null && String(first).trim()) usernames.push(String(first).trim())
      })
      if (usernames.length === 0) {
        const withHeader = Papa.parse(content, { header: true, skipEmptyLines: true })
        withHeader.data.forEach((row: Record<string, unknown>) => {
          const u = row.username ?? row.name ?? row['Agent Name'] ?? (withHeader.meta?.fields?.[0] ? row[withHeader.meta.fields[0]] : null)
          const v = (u != null && u !== '') ? String(u).trim() : ''
          if (v) usernames.push(v)
        })
      }
    } else {
      content.split(/\r?\n/).forEach((line) => {
        const v = line.trim()
        if (v) usernames.push(v)
      })
    }
    return [...new Set(usernames)]
  }

  // Parse file to list of numbers only (same format as download: one number per line or CSV with number/phone column)
  const parseNumbersFromFile = (content: string, isCsv: boolean): string[] => {
    const numbers: string[] = []
    if (isCsv) {
      // First try without header (one number per line = one column) so re-upload of downloaded file works
      const noHeader = Papa.parse(content, { skipEmptyLines: true })
      noHeader.data.forEach((row: Record<string, unknown>) => {
        const first = Array.isArray(row) ? row[0] : (row && Object.values(row)[0])
        if (first != null && String(first).trim()) numbers.push(String(first).trim())
      })
      if (numbers.length === 0) {
        const withHeader = Papa.parse(content, { header: true, skipEmptyLines: true })
        withHeader.data.forEach((row: Record<string, unknown>) => {
          const num = row.number ?? row.phone ?? row.Number ?? row.Phone ?? row['Phone Number']
            ?? (withHeader.meta?.fields?.[0] ? row[withHeader.meta.fields[0]] : null)
          const v = (num != null && num !== '') ? String(num).trim() : ''
          if (v) numbers.push(v)
        })
      }
    } else {
      content.split(/\r?\n/).forEach((line) => {
        const v = line.trim()
        if (v) numbers.push(v)
      })
    }
    return [...new Set(numbers)]
  }

  const handleImportPlayers = async (file: File) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase()
    if (fileExtension !== 'csv' && fileExtension !== 'txt' && fileExtension !== 'text') {
      notification.error({
        message: 'Unsupported Format',
        description: 'Please upload a .txt or .csv file with one number per line (same as downloaded).',
      })
      return false
    }

    try {
      const text = await file.text()
      const numbers = parseNumbersFromFile(text, fileExtension === 'csv')
      if (numbers.length === 0) {
        notification.warning({
          message: 'No Numbers Found',
          description: 'File should contain one phone number per line (or a number column in CSV).',
        })
        return false
      }

      const result = await resolvePhonesToIds({ variables: { phones: numbers } })
      if (result.error) throw result.error
      const resolvedIds: string[] = (result.data?.userIdsByPhones ?? []).map(String).filter(Boolean)
      const excludedSet = new Set(excludedPlayers.map(String))
      const newIds = resolvedIds.filter((id) => !excludedSet.has(id))
      const uniqueNewIds = [...new Set(newIds)]

      if (uniqueNewIds.length === 0) {
        notification.info({
          message: 'No New Players to Add',
          description: resolvedIds.length === 0
            ? 'No numbers in the file matched any player in this tenant.'
            : 'All matched players are already in the exclusion list.',
        })
        return false
      }

      const newExcludedPlayers = [...excludedPlayers, ...uniqueNewIds]
      setExcludedPlayers(newExcludedPlayers)

      const currentRulesJson = (campaignData?.bonusCampaign?.rulesJson as BonusCampaignRulesJson | null | undefined) || {}
      const updatedRulesJson = {
        ...currentRulesJson,
        excludedPlayerIds: newExcludedPlayers,
        excludedAgentIds: excludedAgents,
      }

      const unresolvedCount = numbers.length - resolvedIds.length
      await saveExclusionAndNotify(
        {
          input: {
            id: campaignId,
            rulesJson: updatedRulesJson,
          },
        },
        {
          message: 'Upload Successful',
          description: `${uniqueNewIds.length} player(s) added to exclusion list.${unresolvedCount > 0 ? ` ${unresolvedCount} number(s) could not be matched.` : ''}`,
        }
      )
    } catch (err: unknown) {
      notification.error({
        message: 'Import Failed',
        description: err instanceof Error ? err.message : 'Failed to import. Use a file with one number per line (same as download).',
      })
    }

    return false
  }

  const handleImportAgents = async (file: File) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase()
    if (fileExtension !== 'csv' && fileExtension !== 'txt' && fileExtension !== 'text') {
      notification.error({
        message: 'Unsupported Format',
        description: 'Please upload a .txt or .csv file with one username per line (same as downloaded).',
      })
      return false
    }

    try {
      const text = await file.text()
      const usernames = parseUsernamesFromFile(text, fileExtension === 'csv')
      if (usernames.length === 0) {
        notification.warning({
          message: 'No Usernames Found',
          description: 'File should contain one agent username per line (or a username column in CSV).',
        })
        return false
      }

      const { data } = await resolveUsernamesToAgentIds({ variables: { usernames } })
      const resolvedIds: string[] = (data?.agentIdsByUsernames ?? []).map(String).filter(Boolean)
      const excludedSet = new Set(excludedAgents.map(String))
      const newIds = resolvedIds.filter((id: string) => !excludedSet.has(id))
      const uniqueNewIds: string[] = [...new Set(newIds)]

      if (uniqueNewIds.length === 0) {
        notification.info({
          message: 'No New Agents',
          description: 'All resolved agents from the file are already excluded.',
        })
        return false
      }

      const newExcludedAgents: string[] = [...excludedAgents.map(String), ...uniqueNewIds]
      setExcludedAgents(newExcludedAgents)

      const currentRulesJson = (campaignData?.bonusCampaign?.rulesJson as BonusCampaignRulesJson | null | undefined) || {}
      const updatedRulesJson = {
        ...currentRulesJson,
        excludedPlayerIds: excludedPlayers,
        excludedAgentIds: newExcludedAgents,
      }

      const unresolvedCount = usernames.length - resolvedIds.length
      await saveExclusionAndNotify(
        {
          input: {
            id: campaignId,
            rulesJson: updatedRulesJson,
          },
        },
        {
          message: 'Upload Successful',
          description: `${uniqueNewIds.length} agent(s) added to exclusion list.${unresolvedCount > 0 ? ` ${unresolvedCount} username(s) could not be matched.` : ''}`,
        }
      )
    } catch (err: unknown) {
      notification.error({
        message: 'Import Failed',
        description: err instanceof Error ? err.message : 'Failed to import. Use a file with one username per line (same as download).',
      })
    }

    return false
  }

  // Excluded players table: use usersByIds result so all excluded players show with real details (no placeholders)
  const excludedPlayersData = useMemo<PlayerRowRecord[]>(() => {
    const details = excludedPlayersDetailsData?.usersByIds
    if (details && details.length > 0) {
      return details.map((p: { id: string; name?: string; username?: string; phone?: string }) => ({
        id: p.id,
        name: p.name ?? p.username ?? '',
        username: p.username ?? p.name ?? '',
        phone: p.phone ?? '',
      }))
    }
    // Fallback: match from current search results only
    return excludedPlayers
      .map((id) => {
        const player = players.find((p: { id: string }) => String(p.id) === id)
        if (player) {
          return {
            id: player.id,
            name: player.name || player.username || '',
            username: player.username || player.name || '',
            phone: player.phone ?? '',
          }
        }
        return null
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
  }, [excludedPlayers, excludedPlayersDetailsData?.usersByIds, players])

  // Excluded agents table: use agentsByIds result so all excluded agents show with real name/code
  const excludedAgentsData = useMemo<AgentRowRecord[]>(() => {
    const details = excludedAgentsDetailsData?.agentsByIds
    if (details && details.length > 0) {
      return details.map((a: { id: string; name?: string; code?: string; phone?: string | null }) => ({
        id: a.id,
        name: a.name,
        code: a.code ?? a.id,
        phone: a.phone ?? undefined,
      }))
    }
    // Fallback: match from hierarchy
    return excludedAgents
      .map((id) => {
        const agent = agents.find((a: { id: string }) => String(a.id) === id)
        if (agent) {
          return {
            id: agent.id,
            name: agent.name,
            code: agent.code ?? agent.id,
            phone: agent.phone ?? undefined,
          }
        }
        return null
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
  }, [excludedAgents, excludedAgentsDetailsData?.agentsByIds, agents])

  const [activeTab, setActiveTab] = useState<'players' | 'agents'>('players')
  const saving = updateCampaignLoading || agentsSaving
  const isPlayers = activeTab === 'players'
  const leftRows = isPlayers ? eligiblePlayers : filteredEligibleAgents
  const rightRows = isPlayers ? excludedPlayersData : excludedAgentsData
  const leftSelection = isPlayers ? selectedEligiblePlayers : selectedEligibleAgents
  const rightSelection = isPlayers ? selectedExcludedPlayers : selectedExcludedAgents
  return <div className={styles.stack}>
    <div className={styles.tabs}><Tabs value={activeTab} items={[{ value: 'players', label: `Players${excludedPlayers.length ? ` (${excludedPlayers.length} excluded)` : ''}` }, { value: 'agents', label: `Agents${excludedAgents.length ? ` (${excludedAgents.length} excluded)` : ''}` }]} onChange={setActiveTab} label="Exclusion lists" idPrefix="bonus-exclusions" /></div>
    <div className={styles.stack} role="tabpanel" id={tabPanelId('bonus-exclusions', activeTab)} aria-labelledby={tabId('bonus-exclusions', activeTab)} aria-busy={saving}>
      <p className={styles.muted}>{isPlayers ? 'Drag between lists or select and use the move button.' : 'Drag between lists or select and move. Agent exclusion includes downline.'}</p>
      <div className={styles.toolbar}><Button size="sm" disabled={saving} onClick={isPlayers ? handleExportPlayers : handleExportAgents}>Download</Button>{saving && <span role="status">Saving...</span>}</div>
      {/* The import still runs straight from the picked file; the field lists nothing, the panels below are the result. */}
      <FileField key={activeTab} label={`Upload ${isPlayers ? 'phone numbers' : 'agent usernames'}`} inputLabel={isPlayers ? 'Upload player exclusions' : 'Upload agent exclusions'} accept=".txt,.text,.csv" disabled={saving} files={[]}
        help={`One ${isPlayers ? 'phone number' : 'agent username'} per line, in a .txt or .csv file (same as downloaded).`}
        onFiles={([file]) => { if (file) void (isPlayers ? handleImportPlayers(file) : handleImportAgents(file)) }} />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={isPlayers ? handleEligibilityDragEnd : handleEligibilityAgentDragEnd}>
        <div className={styles.panels}>
          <DroppablePanel id={isPlayers ? ELIGIBLE_PLAYERS_DROP_ID : ELIGIBLE_AGENTS_DROP_ID} title="Gets bonus">
            <div className={styles.stack}><Button variant="primary" size="sm" disabled={leftSelection.size === 0 || saving} onClick={() => void (isPlayers ? moveSelectedPlayersToExcluded() : moveSelectedAgentsToExcluded()).catch(() => {})}>→ Won&apos;t get bonus ({leftSelection.size})</Button>
              <SearchField label={isPlayers ? 'Search players' : 'Search agents'} placeholder={isPlayers ? 'Search players...' : 'Search agents...'} value={isPlayers ? playerSearch : agentSearch} onChange={isPlayers ? setPlayerSearch : setAgentSearch} disabled={saving} /></div>
            <TransferTable label={isPlayers ? 'Eligible players' : 'Eligible agents'} records={leftRows} selected={leftSelection} onSelectedChange={isPlayers ? setSelectedEligiblePlayers : setSelectedEligibleAgents} type={isPlayers ? 'player' : 'agent'} source="eligible" disabled={saving} loading={isPlayers ? playersLoading : agentsLoading} empty={isPlayers ? playerSearch.trim() ? 'No matches.' : 'No eligible players.' : eligibleAgents.length === 0 ? 'No eligible agents.' : 'No matches.'} />
          </DroppablePanel>
          <DroppablePanel id={isPlayers ? EXCLUDED_PLAYERS_DROP_ID : EXCLUDED_AGENTS_DROP_ID} title="Won't get bonus" excluded>
            <Button variant="secondary" size="sm" disabled={rightSelection.size === 0 || saving} onClick={() => void (isPlayers ? moveSelectedPlayersToEligible() : moveSelectedAgentsToEligible()).catch(() => {})}>→ Gets bonus ({rightSelection.size})</Button>
            <TransferTable label={isPlayers ? 'Excluded players' : 'Excluded agents'} records={rightRows} selected={rightSelection} onSelectedChange={isPlayers ? setSelectedExcludedPlayers : setSelectedExcludedAgents} type={isPlayers ? 'player' : 'agent'} source="excluded" disabled={saving} empty="None excluded. Drag from left or upload." />
          </DroppablePanel>
        </div>
      </DndContext>
      {isPlayers && excludedPlayers.length > excludedPlayersData.length && <Notice tone="warn">{excludedPlayers.length - excludedPlayersData.length} of {excludedPlayers.length} excluded player(s) could not be resolved (may be deleted or from another tenant). They remain excluded.</Notice>}
      {!isPlayers && excludedAgents.length > excludedAgentsData.length && <Notice tone="warn">{excludedAgents.length - excludedAgentsData.length} of {excludedAgents.length} excluded agent(s) could not be resolved. They remain excluded.</Notice>}
    </div>
    <Notice title="Note">Excluded users are not eligible for this campaign. Lists are stored per campaign and applied during bonus validation.</Notice>
  </div>
}
