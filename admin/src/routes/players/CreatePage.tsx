import { useState } from 'react'
import { useMutation, gql } from '@apollo/client'
import { notify } from '@/shared/services/notification'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { RBACGuard } from '@/shared/core/RBACGuard'
import AgentCreatePlayerPage from './AgentCreatePlayerPage'
import { PlayerCreateForm } from './PlayerCreateForm'
import { adminPlayerInput, type PlayerCreateValues } from './playerCreateModel'

const CreatePlayerMutation = /* GraphQL */ `
  mutation CreatePlayer($input: CreatePlayerInput!) {
    createPlayer(input: $input) {
      success
      message
      user { id name email phone username }
    }
  }
`;

export default function CreatePlayerPage() {
  const agent = useAuthStore((state) => state.agent)
  if (agent) return <AgentCreatePlayerPage />
  return <RBACGuard required={[{ domain: 'players.create', actions: ['view', 'create'] }]}><AdminPlayerCreateContent /></RBACGuard>
}
function AdminPlayerCreateContent() {
  const { getWhitelabelBaseCurrencyCode } = useCurrency()
  const [createPlayer] = useMutation(gql`${CreatePlayerMutation}`)
  const [revision, setRevision] = useState(0)
  const [success, setSuccess] = useState('')
  async function save(values: PlayerCreateValues) {
    try {
      const result = await createPlayer({ variables: { input: adminPlayerInput(values, getWhitelabelBaseCurrencyCode()) } })
      if (!result.data?.createPlayer?.success) throw new Error(result.data?.createPlayer?.message || 'Failed to create player. Please try again.')
      setSuccess(result.data.createPlayer.message || 'Player created successfully')
      setRevision((value) => value + 1)
    } catch (error) {
      notify.error('Failed to create player. Please try again.')
      throw error
    }
  }
  return <PlayerCreateForm key={revision} onSave={save} successMessage={success} />
}
