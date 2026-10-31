import { useMemo } from 'react'
import { useAuthStore } from './authStore'
import { useUIStore } from './uiStore'
import { createSupportClient, supportEndpoint } from '../../../../ui-shared/support/client'

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
      if (auth.token === token) auth.logout()
    },
  ), [token, tenant, selected, mode])
}
