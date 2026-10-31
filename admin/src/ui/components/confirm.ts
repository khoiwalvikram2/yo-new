import type { ReactNode } from 'react'

export type ConfirmTone = 'default' | 'danger'
export type ConfirmRequestState = 'idle' | 'running'

export interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
  onConfirm?: () => void | Promise<void>
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number
  state: ConfirmRequestState
  error?: string
  /** The connected page control that began this confirmation chain. */
  origin: HTMLElement | null
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (confirmed: boolean) => void
  runPromise?: Promise<void>
}

type Listener = () => void
type HostId = symbol

let nextId = 1
let pending: PendingConfirm[] = []
const listeners = new Set<Listener>()
const hosts = new Set<HostId>()
let owner: HostId | null = null
let hasMountedHost = false
let hostGeneration = 0

function emit() {
  listeners.forEach((listener) => listener())
}

function activePageOrigin(): HTMLElement | null {
  if (typeof document === 'undefined' || typeof HTMLElement === 'undefined') return null
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === document.body || active === document.documentElement) {
    return null
  }
  return active.isConnected ? active : null
}

function queueOrigin(): HTMLElement | null {
  const existing = pending.find((request) => request.origin?.isConnected)?.origin
  return existing ?? activePageOrigin()
}

export function confirmationErrorMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message
  if (typeof reason === 'string' && reason.trim()) return reason
  return 'The action could not be completed. Please try again.'
}

function flushWithoutHost() {
  if (hosts.size > 0 || pending.length === 0) return

  const abandoned = pending.filter((request) => request.state === 'idle')
  pending = pending.filter((request) => request.state === 'running')
  abandoned.forEach((request) => request.resolve(false))
  emit()
}

function scheduleHostlessFlush() {
  const generation = ++hostGeneration
  queueMicrotask(() => {
    if (generation !== hostGeneration || hosts.size > 0) return
    flushWithoutHost()
  })
}

function settleRequest(id: number, confirmed: boolean) {
  const index = pending.findIndex((request) => request.id === id)
  if (index === -1) return

  const [request] = pending.splice(index, 1)
  request?.resolve(confirmed)
  emit()
}

/**
 * Opens a confirmation through the application-level ConfirmHost.
 *
 * Idle requests are FIFO. A confirmation requested by a running action is placed in front of that
 * action, so an awaited nested confirmation cannot deadlock behind its parent. Every chain retains
 * the connected page origin that started it for final focus restoration and theme inheritance.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const request: PendingConfirm = {
      ...options,
      id: nextId,
      state: 'idle',
      origin: queueOrigin(),
      resolve,
    }
    nextId += 1

    if (pending[0]?.state === 'running') pending.unshift(request)
    else pending.push(request)
    emit()

    // Before the application's first provider mount a request may legitimately wait for its host.
    // After a permanent teardown, however, a late request must not leave its caller pending forever.
    if (hasMountedHost && hosts.size === 0) scheduleHostlessFlush()
  })
}

/** @internal Bridge used only by ConfirmHost and its contract tests. */
export const confirmQueue = {
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  current(): ConfirmRequest | null {
    return pending[0] ?? null
  },

  currentForHost(hostId: HostId): ConfirmRequest | null {
    return owner === hostId ? pending[0] ?? null : null
  },

  settle(id: number, confirmed: boolean) {
    settleRequest(id, confirmed)
  },

  cancel(id: number) {
    const request = pending.find((candidate) => candidate.id === id)
    if (!request || request.state === 'running') return
    settleRequest(id, false)
  },

  execute(id: number): Promise<void> {
    const index = pending.findIndex((request) => request.id === id)
    const request = pending[index]
    if (!request) return Promise.resolve()
    if (request.state === 'running' && request.runPromise) return request.runPromise

    const action = Promise.resolve().then(() => request.onConfirm?.())
    const runPromise = action.then(
      () => {
        settleRequest(id, true)
      },
      (reason: unknown) => {
        const failedIndex = pending.findIndex((candidate) => candidate.id === id)
        const failed = pending[failedIndex]
        if (failed) {
          if (hosts.size === 0 && hasMountedHost) {
            pending.splice(failedIndex, 1)
            failed.resolve(false)
          } else {
            pending[failedIndex] = {
              ...failed,
              state: 'idle',
              error: confirmationErrorMessage(reason),
              runPromise: undefined,
            }
          }
          emit()
        }
        throw reason
      },
    )

    pending[index] = {
      ...request,
      state: 'running',
      error: undefined,
      runPromise,
    }
    emit()
    return runPromise
  },

  registerHost(hostId: HostId) {
    hosts.add(hostId)
    hasMountedHost = true
    hostGeneration += 1
    if (owner === null) owner = hostId
    emit()
    let registered = true

    return () => {
      if (!registered) return
      registered = false
      hosts.delete(hostId)
      if (owner === hostId) owner = hosts.values().next().value ?? null
      emit()
      if (hosts.size === 0) scheduleHostlessFlush()
    }
  },
}
