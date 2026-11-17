import { useMemo } from 'react'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { isActiveStatus, statusWord } from './chipModel'

export interface ChipActor {
  /** The signed-in agent's id; null for an admin, who moves chips as the whitelabel. */
  agentId: string | null
  /**
   * May move chips and set credit references at all. An admin needs agents.credit:update, the permission
   * the three chip mutations demand (guardAgentMutations); an agent must be a CREDIT agent that is not
   * read-only. Each account is still checked against the direct-parent rule, and the server has the last word.
   */
  canManage: boolean
  /** Why this caller cannot deposit right now (an agent that is not ACTIVE, spec §4.1), or null. */
  depositBlockedReason: string | null
}

/** Who is acting on the chips screens, read from the session. */
export function useChipActor(): ChipActor {
  const agent = useAuthStore((state) => state.agent)
  const readOnly = useAuthStore((state) => state.isReadOnly)
  const permissions = useAuthStore((state) => state.permissions)

  return useMemo<ChipActor>(() => {
    if (agent) {
      const canManage = agent.schemeType === 'CREDIT' && !readOnly
      return {
        agentId: agent.id,
        canManage,
        depositBlockedReason: canManage && !isActiveStatus(agent.status)
          ? `Deposits are paused while your account is ${statusWord(agent.status)}`
          : null,
      }
    }
    return { agentId: null, canManage: hasPermissionWithNested(permissions, 'agents.credit', 'update'), depositBlockedReason: null }
  }, [agent, readOnly, permissions])
}
