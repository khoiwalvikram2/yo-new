import { useEffect } from 'react'
import type { ChatBootstrap } from '../../../../shared/src/support/contracts'
import { useAdminSupportClient } from './useAdminSupportClient'
import { useAuthStore } from './authStore'
import { hasPermissionWithNested } from './nestedPermissionMapping'
import { useUIStore } from './uiStore'

const REFRESH_MS = 60_000

/**
 * Whether this session may have a support inbox, so the server is worth asking (N006): the stored support.chat grant
 * (or all:*), or a role the server gives the inbox to whatever the role lists, a Super Admin or the Whitelabel Admin
 * who owns it (named as admin-backend recognises it). Every other admin was answered 403 "Support inbox permission is
 * required" on each sign-in, page load, minute and focus. A role name only lets the hook ask; the answer decides.
 */
export function mayHaveSupportInbox(permissions: Parameters<typeof hasPermissionWithNested>[0], roles: readonly string[]): boolean {
  return hasPermissionWithNested(permissions, 'support.chat', 'view') || roles.some((role) => /super.*admin|whitelabel/i.test(role))
}

/** Refresh only live-chat grants from authenticated server capabilities.
 * Persisted sessions may predate the feature; role names never grant access here.
 */
export function useSupportPermissionSync() {
  const client = useAdminSupportClient()
  const token = useAuthStore((s) => s.token)
  const userId = useAuthStore((s) => s.user?.id)
  const agent = useAuthStore((s) => s.agent)
  const superAdmin = useAuthStore((s) => s.roles.some((role) => /super.*admin/i.test(role)))
  const mayHaveSupport = useAuthStore((s) => mayHaveSupportInbox(s.permissions, s.roles))
  const mode = useUIStore((s) => s.directorMode)
  const selected = useUIStore((s) => s.selectedWhitelabelId)

  useEffect(() => {
    if (!mayHaveSupport || !token || !userId || agent || (superAdmin && (mode !== 'whitelabel' || !selected))) return
    let active = true, pending = false, lastAttempt = 0, refused = false

    const apply = (actions: string[]) => {
      if (!active) return
      useAuthStore.setState((state) => {
        if (state.token !== token || state.user?.id !== userId || state.agent) return state
        const previous = state.permissions.filter((p) => p.domain === 'support.chat')
        if (previous.length === (actions.length ? 1 : 0) && JSON.stringify(previous[0]?.actions) === JSON.stringify(actions.length ? actions : undefined)) return state
        const permissions = state.permissions.filter((p) => p.domain !== 'support.chat')
        return { permissions: actions.length ? [...permissions, { domain: 'support.chat', actions }] : permissions }
      })
    }
    const refresh = async (force = false) => {
      if (!active || refused || pending || document.visibilityState !== 'visible' || (!force && Date.now() - lastAttempt < REFRESH_MS)) return
      pending = true
      lastAttempt = Date.now()
      try {
        const { actor } = await client.request<ChatBootstrap>('/bootstrap')
        if (actor.kind !== 'admin' || actor.id !== userId) return
        apply(['view', ...(actor.canReply ? ['reply'] : []), ...(actor.canAssign ? ['assign'] : []), ...(actor.canSettings ? ['settings'] : [])])
      } catch (error) {
        if ([401, 403].includes(Number((error as { status?: number }).status))) {
          apply([])
          // Refused: no more asking (each answer was another 403 in the console) until the session, its permissions
          // or the chosen whitelabel change, which runs this effect again.
          refused = true
        }
        // Temporary network failures preserve the last server-confirmed grants.
      } finally {
        pending = false
      }
    }
    void refresh(true)
    const visible = () => { void refresh() }
    const interval = setInterval(visible, REFRESH_MS)
    window.addEventListener('focus', visible)
    document.addEventListener('visibilitychange', visible)
    return () => {
      active = false
      clearInterval(interval)
      window.removeEventListener('focus', visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [client, token, userId, agent, superAdmin, mayHaveSupport, mode, selected])
}
