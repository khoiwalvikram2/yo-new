import { useMemo } from 'react'
import { useAuthStore } from './authStore'
import { rememberSignOutReason } from './signOutReason'
import { useUIStore } from './uiStore'
import { createSupportClient, supportEndpoint } from '../../../../ui-shared/support/client'

/**
 * Whether the signed-in admin has no support inbox to manage: a Super Admin in core mode, or in whitelabel mode
 * with no site chosen (the same case useSupportPermissionSync skips). The server answers it 403 "Select a
 * whitelabel to manage its support inbox", so Live Chat asks for the choice instead of loading, and opens no
 * socket that would only keep reconnecting.
 */
export function supportNeedsWhitelabel(roles: readonly string[], mode: string, selected: string | null): boolean {
  return roles.some((role) => /super.*admin/i.test(role)) && (mode !== 'whitelabel' || !selected)
}

export function useSupportNeedsWhitelabel(): boolean {
  const roles = useAuthStore((s) => s.roles)
  const mode = useUIStore((s) => s.directorMode)
  const selected = useUIStore((s) => s.selectedWhitelabelId)
  return supportNeedsWhitelabel(roles, mode, selected)
}

/** The inbox and permission refresh must address the same selected tenant. */
export function useAdminSupportClient() {
  const token = useAuthStore((s) => s.token)
  const tenant = useUIStore((s) => s.tenant)
  const selected = useUIStore((s) => s.selectedWhitelabelId)
  const mode = useUIStore((s) => s.directorMode)

  return useMemo(() => createSupportClient(
    import.meta.env.VITE_SUPPORT_API_URL || supportEndpoint(import.meta.env.VITE_GRAPHQL_ENDPOINT || 'http://localhost:4000/graphql'),
    () => {
      const auth = useAuthStore.getState()
      const superAdmin = auth.roles.some((role) => /super.*admin/i.test(role))
      const active = superAdmin ? (mode === 'whitelabel' ? selected : 'default') : tenant
      return {
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        'x-whitelabel-id': active || 'default',
        ...(superAdmin ? { 'x-admin-mode': mode } : {}),
      }
    },
    () => {
      const auth = useAuthStore.getState()
      if (auth.token !== token) return
      // A session the support API refuses (401) has ended as surely as one GraphQL refuses: the sign-in page the
      // route guard then shows says so (N003), as it does after the error link's sign-out.
      rememberSignOutReason('session-ended')
      auth.logout()
    },
  ), [token, tenant, selected, mode])
}
