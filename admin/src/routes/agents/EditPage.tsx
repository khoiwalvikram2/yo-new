import { useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { gql, useMutation, useQuery } from '@apollo/client'
import { notify } from '@/shared/services/notification'
import { useAuthStore } from '@/shared/core/authStore'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Notice } from '@/ui/components/Notice'
import { LoadingState } from '@/ui/components/LoadingState'
import { AgentEditor } from './AgentEditor'
import { updateAgentInput, agentRateInputs, type AgentEditorValues, type AgentRecord } from './agentEditorModel'

const AGENT_PROFILE_QUERY = gql`
  query AgentProfile($id: ID!) {
    agents {
      agentProfile(id: $id) {
        id
        username
        phone
        schemeType
        allowedDomains
        status
        parentAgentId
        levelIndex
        tallyEnabled
        tallyDomains
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
`;

const UpdateAgentMutation = gql`
  mutation UpdateAgent($input: UpdateAgentInput!) {
    agents {
      updateAgent(input: $input) {
        id
        username
        schemeType
        allowedDomains
        status
      }
    }
  }
`;

const SetCommissionConfigMutation = gql`
  mutation SetCommissionConfig($input: SetCommissionConfigInput!) {
    agents {
      setCommissionConfig(input: $input) {
        id
        domain
        commissionRate
      }
    }
  }
`;

const SetSharingConfigMutation = gql`
  mutation SetSharingConfig($input: SetSharingConfigInput!) {
    agents {
      setSharingConfig(input: $input) {
        id
        domain
        shareRate
      }
    }
  }
`;

/**
 * Admins edit any agent (agents.profile update). An agent may edit its sub-agents only, never itself:
 * the rates (within the parent's) and the domains (within the parent's) and status. The level, the
 * parent and the tally are not sent from the agent flow (the API refuses those changes from agents).
 */
export default function EditAgentPage() {
  const agent = useAuthStore((state) => state.agent)
  if (agent) return <EditAgentContent agentCallerId={agent.id} />
  return <RBACGuard required={[{ domain: 'agents.profile', actions: ['update'] }]}><EditAgentContent /></RBACGuard>
}
function EditAgentContent({ agentCallerId }: { agentCallerId?: string }) {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const isSelf = Boolean(agentCallerId && id === agentCallerId)
  const [updateAgent] = useMutation(UpdateAgentMutation)
  const [setCommissionConfig] = useMutation(SetCommissionConfigMutation)
  const [setSharingConfig] = useMutation(SetSharingConfigMutation)
  const { data, loading, error } = useQuery<{ agents: { agentProfile: AgentRecord } }>(AGENT_PROFILE_QUERY, {
    variables: { id }, skip: !id || isSelf, errorPolicy: 'all',
  })
  const record = data?.agents.agentProfile
  // A save can keep some rates and refuse others, and the agent is not read again, so after a refusal `record` no
  // longer says which rates the server holds. The retry then sends every rate (the server inserts nothing for a rate
  // already in force): compared with `record`, a saved rate changed back to its old value would be skipped as unchanged.
  const ratesBehindServer = useRef(false)
  const header = <PageHeader title="Edit Agent" eyebrow="Agents" back={{ to: '/agents', label: 'Back to Agents' }} />
  if (isSelf) return <Page>{header}<Notice tone="warn" title="You cannot edit your own account">Your rates, domains and limits are set by your parent agent or an administrator.</Notice></Page>
  if (loading) return <Page><LoadingState label="Loading agent" /></Page>
  if (error || !record) return <Page>{header}<Notice tone="error" title="Error loading agent">{error?.message || 'Agent not found'}</Notice></Page>
  async function save(values: AgentEditorValues) {
    try {
      if (!id) throw new Error('Agent ID is missing')
      await updateAgent({ variables: { input: updateAgentInput(id, values, { agentCaller: Boolean(agentCallerId) }) } })
      // Only the rates that changed: an unchanged one would add another identical row to the rate history.
      const inputs = agentRateInputs(id, values, new Date().toISOString(), ratesBehindServer.current ? undefined : record)
      const results = await Promise.allSettled(inputs.map((input) => values.schemeType === 'COMMISSION' ?
        setCommissionConfig({ variables: { input } }) : setSharingConfig({ variables: { input } })))
      const failed = inputs.filter((_, index) => results[index].status === 'rejected')
      if (failed.length) {
        ratesBehindServer.current = true
        const reason = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason
        // The settings were saved; say which rates were not, so a retry (Update again) is understood.
        throw new Error(`Agent settings were saved, but the ${failed.map((input) => input.domain).join(', ')} ${failed.length === 1 ? 'rate was' : 'rates were'} not: ${reason instanceof Error ? reason.message : 'unknown error'}`)
      }
      notify.success('Agent updated successfully!')
      navigate('/agents', { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update agent. Please try again.'
      notify.error(message)
      throw new Error(message)
    }
  }
  return <AgentEditor key={record.id} record={record} onSave={save} />
}

