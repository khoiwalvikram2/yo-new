import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type MarketOddsMap = Record<string, any>

const THROTTLE_MS = 100

// Module-scoped socket and simple ref counting to avoid multiple connections
let sharedSocket: Socket | null = null
let sharedDisabled = false
const refCounts = new Map<string, number>()
const listenerMap = new Map<string, Set<(data: any) => void>>()

function cleanupChannel(
  socket: Socket | null,
  code: string,
  myHandler: ((data: any) => void) | null,
  subscribed: { current: Set<string> }
) {
  const count = refCounts.get(code) ?? 0
  if (count <= 1) {
    try { socket?.emit('unsubscribe', code) } catch {}
    subscribed.current.delete(code)
    refCounts.delete(code)
    const set = listenerMap.get(code)
    if (set) {
      if (myHandler) set.delete(myHandler)
      set.forEach(fn => {
        try { socket?.off(`oddsUpdate${code}`, fn) } catch {}
      })
      listenerMap.delete(code)
    }
  } else {
    if (myHandler && listenerMap.get(code)) {
      listenerMap.get(code)!.delete(myHandler)
      try { socket?.off(`oddsUpdate${code}`, myHandler) } catch {}
    }
    refCounts.set(code, count - 1)
    subscribed.current.delete(code)
  }
}

function resubscribeAll(socket: Socket) {
  for (const code of listenerMap.keys()) {
    socket.emit('subscribe', code)
  }
}

function getOrCreateSocket(baseUrl?: string): Socket | null {
  if (sharedDisabled) return null
  if (sharedSocket?.connected || sharedSocket?.active) return sharedSocket
  if (sharedSocket) {
    try { sharedSocket.disconnect() } catch {}
    sharedSocket = null
  }
  const raw = (baseUrl || (import.meta.env.VITE_ODDS_WS as string) || '').trim()
  if (!raw) return null
  const socketUrl = raw.endsWith('/odds') ? raw : `${raw}/odds`
  try {
    sharedSocket = io(socketUrl, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 4000,
    })
    sharedSocket.on('reconnect', () => {
      if (sharedSocket) resubscribeAll(sharedSocket)
    })
    sharedSocket.on('reconnect_failed', () => {
      sharedDisabled = true
    })
  } catch {
    sharedSocket = null
    sharedDisabled = true
  }
  return sharedSocket
}

export function resetOddsSocket() {
  sharedDisabled = false
  refCounts.clear()
  listenerMap.clear()
  if (sharedSocket) {
    try { sharedSocket.disconnect() } catch {}
    sharedSocket = null
  }
}

export function useOddsSocket(
  marketCodes: string[],
  opts?: { socketUrl?: string; eventId?: string; once?: boolean }
) {
  const [marketOdds, setMarketOdds] = useState<MarketOddsMap>({})
  const socketRef = useRef<Socket | null>(null)
  const subscribed = useRef<Set<string>>(new Set())
  const snapshotted = useRef<Set<string>>(new Set())
  const disabledRef = useRef<boolean>(false)
  const pendingRef = useRef<MarketOddsMap>({})
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    if (disabledRef.current || sharedDisabled) return
    const socket = getOrCreateSocket(opts?.socketUrl)
    if (!socket) { disabledRef.current = true; return }
    socketRef.current = socket
    const myHandlers = new Map<string, (data: any) => void>()

    const flush = () => {
      flushTimeoutRef.current = null
      if (!mountedRef.current) return
      // Take the batch before setState: StrictMode runs updaters twice, and an updater that
      // clears pendingRef finds it empty on the second run and drops the update.
      const batch = pendingRef.current
      pendingRef.current = {}
      const updates = Object.entries(batch).filter(([, value]) => value !== undefined)
      if (updates.length === 0) return
      setMarketOdds(prev => ({ ...prev, ...Object.fromEntries(updates) }))
    }
    const scheduleFlush = () => {
      if (flushTimeoutRef.current != null) clearTimeout(flushTimeoutRef.current)
      flushTimeoutRef.current = setTimeout(flush, THROTTLE_MS)
    }
    const applyUpdate = (code: string, data: any) => {
      pendingRef.current[code] = data
      scheduleFlush()
    }

    // Subscribe to markets (matching ibf-goa-user pattern)
    marketCodes.forEach(code => {
      if (!subscribed.current.has(code)) {
        socket.emit('subscribe', code)
        subscribed.current.add(code)

        const eventName = `oddsUpdate${code}`
        const onUpdate = (data: any) => {
          applyUpdate(code, data)
          if (opts?.once && !snapshotted.current.has(code)) {
            snapshotted.current.add(code)
            try { socket.off(eventName, onUpdate) } catch {}
            subscribed.current.delete(code)
            const set = listenerMap.get(code)
            if (set) {
              set.delete(onUpdate)
              if (set.size === 0) listenerMap.delete(code)
            }
            // The socket is shared: other hooks may still need this channel after our snapshot.
            const n = (refCounts.get(code) || 1) - 1
            if (n <= 0) {
              refCounts.delete(code)
              try { socket.emit('unsubscribe', code) } catch {}
            } else refCounts.set(code, n)
          }
        }
        myHandlers.set(code, onUpdate)
        if (!listenerMap.has(code)) listenerMap.set(code, new Set())
        listenerMap.get(code)!.add(onUpdate)
        socket.on(eventName, onUpdate)
        refCounts.set(code, (refCounts.get(code) || 0) + 1)
      }
    })

    // Subscribe to event-scoped bookmaker and fancy channels like ibf-goa-user
    if (opts?.eventId) {
      const fancyKey = `fancy-${opts.eventId}`
      const bookmakerKey = `bookmaker-${opts.eventId}`

      if (!subscribed.current.has(fancyKey)) {
        socket.emit('subscribe', fancyKey)
        subscribed.current.add(fancyKey)
        const eventName = `oddsUpdate${fancyKey}`
        const onUpdate = (data: any) => {
          applyUpdate(fancyKey, data)
          if (opts?.once && !snapshotted.current.has(fancyKey)) {
            snapshotted.current.add(fancyKey)
            try { socket.off(eventName, onUpdate) } catch {}
            subscribed.current.delete(fancyKey)
            const set = listenerMap.get(fancyKey)
            if (set) {
              set.delete(onUpdate)
              if (set.size === 0) listenerMap.delete(fancyKey)
            }
            // The socket is shared: other hooks may still need this channel after our snapshot.
            const n = (refCounts.get(fancyKey) || 1) - 1
            if (n <= 0) {
              refCounts.delete(fancyKey)
              try { socket.emit('unsubscribe', fancyKey) } catch {}
            } else refCounts.set(fancyKey, n)
          }
        }
        myHandlers.set(fancyKey, onUpdate)
        if (!listenerMap.has(fancyKey)) listenerMap.set(fancyKey, new Set())
        listenerMap.get(fancyKey)!.add(onUpdate)
        socket.on(eventName, onUpdate)
        refCounts.set(fancyKey, (refCounts.get(fancyKey) || 0) + 1)
      }

      if (!subscribed.current.has(bookmakerKey)) {
        socket.emit('subscribe', bookmakerKey)
        subscribed.current.add(bookmakerKey)
        const eventName = `oddsUpdate${bookmakerKey}`
        const onUpdate = (data: any) => {
          const payload = (data && (data as any).data) ? (data as any).data : data
          applyUpdate(bookmakerKey, payload)
          if (opts?.once && !snapshotted.current.has(bookmakerKey)) {
            snapshotted.current.add(bookmakerKey)
            try { socket.off(eventName, onUpdate) } catch {}
            subscribed.current.delete(bookmakerKey)
            const set = listenerMap.get(bookmakerKey)
            if (set) {
              set.delete(onUpdate)
              if (set.size === 0) listenerMap.delete(bookmakerKey)
            }
            // The socket is shared: other hooks may still need this channel after our snapshot.
            const n = (refCounts.get(bookmakerKey) || 1) - 1
            if (n <= 0) {
              refCounts.delete(bookmakerKey)
              try { socket.emit('unsubscribe', bookmakerKey) } catch {}
            } else refCounts.set(bookmakerKey, n)
          }
        }
        myHandlers.set(bookmakerKey, onUpdate)
        if (!listenerMap.has(bookmakerKey)) listenerMap.set(bookmakerKey, new Set())
        listenerMap.get(bookmakerKey)!.add(onUpdate)
        socket.on(eventName, onUpdate)
        refCounts.set(bookmakerKey, (refCounts.get(bookmakerKey) || 0) + 1)
      }
    }

    // Unsubscribe from removed markets (keep event scopes until unmount)
    const keep = new Set<string>([
      opts?.eventId ? `fancy-${opts.eventId}` : '',
      opts?.eventId ? `bookmaker-${opts.eventId}` : ''
    ].filter(Boolean))
    const removedSubscriptions = Array.from(subscribed.current).filter(code => !marketCodes.includes(code) && !keep.has(code))
    removedSubscriptions.forEach(code => {
      const myHandler = myHandlers.get(code) ?? null
      cleanupChannel(socket, code, myHandler, subscribed)
      myHandlers.delete(code)
      setMarketOdds(prev => {
        const newMap = { ...prev }
        delete newMap[code]
        return newMap
      })
    })

    return () => {
      mountedRef.current = false
      if (flushTimeoutRef.current != null) {
        clearTimeout(flushTimeoutRef.current)
        flushTimeoutRef.current = null
      }
      const s = socketRef.current || sharedSocket
      const allCodes = new Set([
        ...marketCodes,
        ...(opts?.eventId ? [`fancy-${opts.eventId}`, `bookmaker-${opts.eventId}`] : []),
      ])
      for (const code of allCodes) {
        if (!subscribed.current.has(code)) continue
        const myHandler = myHandlers.get(code) ?? null
        cleanupChannel(s, code, myHandler, subscribed)
      }
      // Do not call setMarketOdds on unmount - component is gone and React may warn
    }
  }, [marketCodes.join('|'), opts?.socketUrl, opts?.once, opts?.eventId])

  return marketOdds
}