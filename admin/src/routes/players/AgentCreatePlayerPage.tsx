import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, gql } from '@apollo/client'
import { notify } from '@/shared/services/notification'
import { useAuthStore } from '@/shared/core/authStore'
import { useCurrentWhitelabel } from '@/shared/core/useWhitelabels'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAgentSubtree } from '@/shared/hooks/useAgentSubtree'
import { Page } from '@/ui/components/Page'
import { Notice } from '@/ui/components/Notice'
import { PlayerCreateForm, type PlayerOwnerOption } from './PlayerCreateForm'
import { agentPlayerInput, type PlayerCreateValues } from './playerCreateModel'

const CREATE_PLAYER_FOR_AGENT_MUTATION = gql`
  mutation CreatePlayerForAgent($input: CreatePlayerForAgentInput!) {
    createPlayerForAgent(input: $input) {
      success
      message
      playerId
    }
  }
`

const CHECK_PHONE_AVAILABLE_QUERY = gql`
  query CheckPhoneAvailable($phone: String!, $excludeUserId: Int) {
    checkPhoneAvailable(phone: $phone, excludeUserId: $excludeUserId) {
      available
      message
    }
  }
`

export default function AgentCreatePlayerPage() {
  const navigate = useNavigate()
  const agent = useAuthStore((state) => state.agent)
  const { whitelabel } = useCurrentWhitelabel()
  const { getWhitelabelBaseCurrencyCode } = useCurrency()
  const [createPlayer] = useMutation(CREATE_PLAYER_FOR_AGENT_MUTATION)
  // The player may belong to the agent or to any sub-agent below it on the same scheme, as long as that
  // sub-agent and every agent above it are ACTIVE (a suspended agent blocks its whole subtree).
  const subtree = useAgentSubtree(agent?.id)
  const ownerOptions = useMemo<PlayerOwnerOption[]>(() => agent ? [{ value: 'self', label: `Myself (${agent.username || 'Agent'})` },
    ...subtree.agents.filter((subAgent) => subAgent.effectivelyActive && subAgent.schemeType === agent.schemeType)
      .map((subAgent) => ({ value: subAgent.id, label: subAgent.username || subAgent.id, description: `L${subAgent.levelIndex ?? subAgent.depth + 1} sub-agent` }))] : [], [agent, subtree.agents])
  if (!agent) return <Page><Notice tone="error" title="Not Authenticated">Please log in as an agent to create players.</Notice></Page>
  const baseCurrency = whitelabel?.id ? getWhitelabelBaseCurrencyCode() : 'INR'
  async function save(values: PlayerCreateValues) {
    try {
      if (!agent?.id) throw new Error('Agent ID is missing. Please log in again.')
      const result = await createPlayer({ variables: { input: agentPlayerInput(values, agent, baseCurrency) } })
      if (!result.data?.createPlayerForAgent?.success) throw new Error(result.data?.createPlayerForAgent?.message || 'Failed to create player')
      notify.success(result.data.createPlayerForAgent.message || 'Player created successfully')
      navigate('/players')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create player'
      notify.error(message)
      throw new Error(message)
    }
  }
  return <PlayerCreateForm creator={agent} onSave={save} phoneQuery={CHECK_PHONE_AVAILABLE_QUERY}
    ownerOptions={ownerOptions} ownersLoading={subtree.loading} ownersError={subtree.error?.message} />
}

