import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { confirmQueue } from './confirm'

/** Renders the oldest queued imperative confirmation. Mount exactly once with AppProviders. */
export function ConfirmHost() {
  const hostId = useRef(Symbol('confirm-host')).current
  const getSnapshot = useCallback(() => confirmQueue.currentForHost(hostId), [hostId])
  const request = useSyncExternalStore(confirmQueue.subscribe, getSnapshot, getSnapshot)

  useEffect(() => confirmQueue.registerHost(hostId), [hostId])

  const originRef = useMemo(
    () => ({ current: request?.origin ?? null }),
    [request?.origin],
  )

  if (!request) return null

  return (
    <ConfirmDialog
      key={request.id}
      open
      title={request.title}
      description={request.description}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      tone={request.tone}
      busy={request.state === 'running'}
      initialError={request.error}
      themeFrom={originRef}
      restoreFocusTo={originRef}
      onOpenChange={(open) => {
        if (!open) confirmQueue.cancel(request.id)
      }}
      onConfirm={() => confirmQueue.execute(request.id)}
    />
  )
}
