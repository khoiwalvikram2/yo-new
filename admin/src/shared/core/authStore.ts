import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'

type Permission = { domain: string; actions: string[] }

/** Validates rehydrated state shape so corrupted localStorage does not crash the app. */
function safeAuthStorage(): StateStorage {
  const key = 'auth-storage'
  return {
    getItem(name: string): string | null {
      if (name !== key) return null
      try {
        const raw = localStorage.getItem(name)
        if (raw == null) return null
        const parsed = JSON.parse(raw) as { state?: unknown; version?: number }
        const state = parsed?.state
        if (state == null || typeof state !== 'object') return null
        const s = state as Record<string, unknown>
        // Require arrays for list fields; token must be string if present
        if (s.roles != null && !Array.isArray(s.roles)) return null
        if (s.permissions != null && !Array.isArray(s.permissions)) return null
        if (s.agentPermissions != null && !Array.isArray(s.agentPermissions)) return null
        if (s.token != null && typeof s.token !== 'string') return null
        return raw
      } catch {
        return null
      }
    },
    setItem(name: string, value: string): void {
      try {
        localStorage.setItem(name, value)
      } catch {
        // ignore
      }
    },
    removeItem(name: string): void {
      try {
        localStorage.removeItem(name)
      } catch {
        // ignore
      }
    },
  }
}

type AgentAccount = {
  id: string
  tenantId: string
  username: string | null
  phone: string | null
  schemeType: string
  allowedDomains: string[]
  status: string
  parentAgentId: string | null
  levelIndex: number | null
  tallyEnabled: boolean
  tallyDomains: string[] | null
  createdAt: string
}

type AuthState = {
  user?: { id: string; name: string }
  agent?: AgentAccount
  roles: string[]
  permissions: Permission[] // Admin permissions
  agentPermissions: Permission[] // Agent permissions
  token?: string
  isReadOnly?: boolean // true when agent is INACTIVE (view-only, no mutations)
  _hasHydrated: boolean
  login: (payload: { user: { id: string; name: string }; roles: string[]; permissions: Permission[]; token: string }) => void
  agentLogin: (payload: { agent: AgentAccount; permissions: Permission[]; token: string; isReadOnly?: boolean }) => void
  logout: () => void
  setHasHydrated: (state: boolean) => void
  isAgent: () => boolean
  isAdmin: () => boolean
  isAgentReadOnly: () => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: undefined,
      agent: undefined,
      roles: [],
      permissions: [], // Admin permissions
      agentPermissions: [], // Agent permissions
      token: undefined,
      isReadOnly: false,
      _hasHydrated: false,
      login: ({ user, roles, permissions, token }) =>
        set({ user, agent: undefined, roles, permissions, agentPermissions: [], token, isReadOnly: false }),
      agentLogin: ({ agent, permissions, token, isReadOnly }) =>
        set({ user: undefined, agent, roles: [], permissions: [], agentPermissions: permissions, token, isReadOnly: !!isReadOnly }),
      logout: () => {
        // CRITICAL: Clear all localStorage on logout
        if (typeof window !== 'undefined') {
          try {
            // Theme is a device preference, not session data: keep it across sign-out
            const savedTheme = window.localStorage.getItem('theme-mode')
            // Clear all localStorage items
            window.localStorage.clear()
            if (savedTheme !== null) {
              window.localStorage.setItem('theme-mode', savedTheme)
            }
          } catch {
            // Ignore localStorage errors (e.g. private browsing or storage disabled)
          }
        }

        // Reset auth state
        set({
          user: undefined,
          agent: undefined,
          roles: [],
          permissions: [],
          agentPermissions: [],
          token: undefined,
          isReadOnly: false,
        })
      },
      setHasHydrated: (state) => set({ _hasHydrated: state }),
      isAgent: () => !!get().agent,
      isAdmin: () => !!get().user && !get().agent,
      isAgentReadOnly: () => !!get().isReadOnly,
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => safeAuthStorage()),
      partialize: (state) => ({
        user: state.user,
        agent: state.agent,
        roles: state.roles,
        permissions: state.permissions,
        agentPermissions: state.agentPermissions,
        token: state.token,
        isReadOnly: state.isReadOnly,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      }
    }
  )
)

