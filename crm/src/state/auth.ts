import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CrmPermissionPair = { domain: string; actions: string[] }

export type CrmMe = {
  id: string
  name: string
  email: string | null
  status: string
  requirePasswordReset: boolean
  tenant: string
  whitelabelName: string | null
  permissions: CrmPermissionPair[]
  bookIds: string[]
  canViewAllPlayers: boolean
  sessionIdleMinutes: number
  /** While set and in the future, escalations skip this user. */
  outOfOfficeUntil: string | null
  delegateTo: string | null
}

type AuthState = {
  token: string | null
  me: CrmMe | null
  /** When the last request was made, used to end an idle session. */
  lastActivityAt: number
  signIn: (token: string, me: CrmMe) => void
  setMe: (me: CrmMe | null) => void
  touch: () => void
  signOut: () => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      me: null,
      lastActivityAt: Date.now(),
      signIn: (token, me) => set({ token, me, lastActivityAt: Date.now() }),
      setMe: (me) => set({ me }),
      touch: () => set({ lastActivityAt: Date.now() }),
      signOut: () => set({ token: null, me: null }),
    }),
    { name: 'crm-auth' }
  )
)

/**
 * Whether the caller holds a permission.
 *
 * The same matching the server does, so a button that appears is a button that
 * works. It is a convenience for the UI, never the enforcement — every
 * operation is checked again on the server, because a hidden button is not a
 * closed door.
 */
export function can(me: CrmMe | null, domain: string, action: string): boolean {
  if (!me) return false
  const p = me.permissions.find((x) => x.domain === domain)
  return !!p && (p.actions.includes(action) || p.actions.includes('*'))
}

/** True once the session has been idle longer than the whitelabel allows. */
export function isIdleExpired(state: { me: CrmMe | null; lastActivityAt: number }): boolean {
  if (!state.me) return false
  const minutes = state.me.sessionIdleMinutes || 60
  return Date.now() - state.lastActivityAt > minutes * 60_000
}
