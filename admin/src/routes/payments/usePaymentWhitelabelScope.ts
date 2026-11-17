import { useCallback, useMemo } from 'react'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { paymentScopeOf, type PaymentScope } from './paymentWhitelabelScope'

export interface PaymentWhitelabelScope extends PaymentScope {
  /** An inactive agent (view only): the backend refuses their payment actions, so they are not offered. */
  readOnly: boolean
  /** Whether the admin is still on this scope, read from the stores at call time: a payment operation
   *  checks it before it starts, so one begun on a page about to remount never runs. */
  isCurrent: () => boolean
}

function liveScopeKey(): string {
  const auth = useAuthStore.getState()
  const ui = useUIStore.getState()
  return paymentScopeOf({
    userId: auth.user?.id ?? auth.agent?.id,
    roles: auth.roles,
    directorMode: ui.directorMode,
    selectedWhitelabelId: ui.selectedWhitelabelId,
    tenant: ui.tenant,
  }).key
}

/** The payment whitelabel of the signed-in admin (see paymentWhitelabelScope.ts). */
export function usePaymentWhitelabelScope(): PaymentWhitelabelScope {
  const roles = useAuthStore((state) => state.roles)
  const userId = useAuthStore((state) => state.user?.id ?? state.agent?.id)
  const readOnly = useAuthStore((state) => Boolean(state.isReadOnly))
  const directorMode = useUIStore((state) => state.directorMode)
  const selectedWhitelabelId = useUIStore((state) => state.selectedWhitelabelId)
  const tenant = useUIStore((state) => state.tenant)

  const scope = useMemo(
    () => paymentScopeOf({ userId, roles, directorMode, selectedWhitelabelId, tenant }),
    [directorMode, roles, selectedWhitelabelId, tenant, userId],
  )
  const isCurrent = useCallback(() => liveScopeKey() === scope.key, [scope.key])
  return useMemo(() => ({ ...scope, readOnly, isCurrent }), [isCurrent, readOnly, scope])
}
