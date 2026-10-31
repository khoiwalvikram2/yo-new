import { useAuthStore } from '@/shared/core/authStore'
import { deriveTopbarRoles, type TopbarRoles } from './topbarRoles'

/** A fresh `[]` from a zustand selector breaks referential equality on every render; reuse one. */
const EMPTY_ROLES: string[] = []

/** Topbar.tsx:45-66 moved into a hook so every topbar widget reads the same flags. */
export function useTopbarRoles(): TopbarRoles {
  const roles = useAuthStore((s) => s.roles) ?? EMPTY_ROLES
  const isAgent = useAuthStore((s) => s.isAgent())
  const agentSchemeType = useAuthStore((s) => s.agent?.schemeType)
  const userName = useAuthStore((s) => s.user?.name)
  const agentUsername = useAuthStore((s) => s.agent?.username)
  return deriveTopbarRoles({ roles, isAgent, agentSchemeType, userName, agentUsername })
}
