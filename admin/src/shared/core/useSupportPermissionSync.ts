import { useEffect } from 'react'
import type { ChatBootstrap } from '../../../../shared/src/support/contracts'
import { useAdminSupportClient } from './useAdminSupportClient'
import { useAuthStore } from './authStore'
import { useUIStore } from './uiStore'

const REFRESH_MS = 60_000

/** Refresh only live-chat grants from authenticated server capabilities.
 * Persisted sessions may predate the feature; role names never grant access here.
 */
export function useSupportPermissionSync() {
  const client = useAdminSupportClient()
  const token = useAuthStore((s) => s.token)
  const userId = useAuthStore((s) => s.user?.id)
  const agent = useAuthStore((s) => s.agent)
  const superAdmin = useAuthStore((s) => s.roles.some((role) => /super.*admin/i.test(role)))
  const mode = useUIStore((s) => s.directorMode)
  const selected = useUIStore((s) => s.selectedWhitelabelId)

  useEffect(() => {
    if (!token || !userId || agent || (superAdmin && (mode !== 'whitelabel' || !selected))) return
    let active = true, pending = false, lastAttempt = 0

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
      if (!active || pending || document.visibilityState !== 'visible' || (!force && Date.now() - lastAttempt < REFRESH_MS)) return
      pending = true
      lastAttempt = Date.now()
      try {
        const { actor } = await client.request<ChatBootstrap>('/bootstrap')
        if (actor.kind !== 'admin' || actor.id !== userId) return
        apply(['view', ...(actor.canReply ? ['reply'] : []), ...(actor.canAssign ? ['assign'] : []), ...(actor.canSettings ? ['settings'] : [])])
      } catch (error) {
        if ([401, 403].includes(Number((error as { status?: number }).status))) apply([])
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
  }, [client, token, userId, agent, superAdmin, mode, selected])
}
