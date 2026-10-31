import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

type MarketOddsMap = Record<string, unknown>;

let sharedSocket: Socket | null = null;
const refCounts = new Map<string, number>();
const listenerMap = new Map<string, Set<(data: unknown) => void>>();
let sharedDisabled = false;

const THROTTLE_MS = 100;

function cleanupChannel(
  socket: Socket | null,
  key: string,
  subscribed: { current: Set<string> }
): void {
  const count = refCounts.get(key) || 0;
  if (count <= 1) {
    try {
      socket?.emit('unsubscribe', key);
    } catch {
      // ignore
    }
    subscribed.current.delete(key);
    refCounts.delete(key);
    const listeners = listenerMap.get(key);
    if (listeners) {
      listeners.forEach((fn) => {
        try {
          socket?.off(`oddsUpdate${key}`, fn as (data: unknown) => void);
        } catch {
          // ignore
        }
      });
      listenerMap.delete(key);
    }
  } else {
    refCounts.set(key, count - 1);
  }
}

function getOrCreateSocket(baseUrl?: string): Socket | null {
  if (sharedDisabled) return null;
  if (sharedSocket) return sharedSocket;
  
  // Use external odds provider URL (same as user-side)
  const raw = (baseUrl || (import.meta.env.VITE_ODDS_WS as string) || '').trim();
  if (!raw) {
    return null;
  }
  
  const socketUrl = raw.endsWith('/odds') ? raw : `${raw}/odds`;
  
  try {
    
    sharedSocket = io(socketUrl, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: false,
      timeout: 4000,
    });

    sharedSocket.on('connect_error', () => {
      try {
        sharedSocket?.disconnect();
      } catch {
        // ignore
      }
      sharedSocket = null;
      sharedDisabled = true;
    });

    return sharedSocket;
  } catch {
    sharedDisabled = true;
    return null;
  }
}

export function useOddsSocket(
  marketCodes: string[],
  opts?: { socketUrl?: string; eventId?: string; once?: boolean }
) {
  const [marketOdds, setMarketOdds] = useState<MarketOddsMap>({});
  const socketRef = useRef<Socket | null>(null);
  const subscribed = useRef<Set<string>>(new Set());
  const snapshotted = useRef<Set<string>>(new Set());
  const disabledRef = useRef<boolean>(false);
  const pendingRef = useRef<MarketOddsMap>({});
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (disabledRef.current || sharedDisabled) return;
    const socket = getOrCreateSocket(opts?.socketUrl);
    if (!socket) {
      disabledRef.current = true;
      return;
    }
    socketRef.current = socket;
    const eventIdForCleanup = opts?.eventId ?? null;

    const flush = () => {
      flushTimeoutRef.current = null;
      if (!mountedRef.current) return;
      setMarketOdds((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const key of Object.keys(pendingRef.current)) {
          if (pendingRef.current[key] !== undefined) {
            next[key] = pendingRef.current[key];
            changed = true;
          }
        }
        if (changed) pendingRef.current = {};
        return changed ? next : prev;
      });
    };
    /** True throttle: at most one flush per THROTTLE_MS (do not reset timer on every message). */
    const scheduleFlush = () => {
      if (flushTimeoutRef.current != null) return;
      flushTimeoutRef.current = setTimeout(flush, THROTTLE_MS);
    };
    const applyUpdate = (code: string, data: unknown) => {
      pendingRef.current[code] = data;
      scheduleFlush();
    };

    // Subscribe to markets
    marketCodes.forEach((code) => {
      if (!subscribed.current.has(code)) {
        socket.emit('subscribe', code);
        subscribed.current.add(code);

        const eventName = `oddsUpdate${code}`;
        const onUpdate = (data: unknown) => {
          applyUpdate(code, data);
          if (opts?.once && !snapshotted.current.has(code)) {
            snapshotted.current.add(code);
            try {
              socket.off(eventName, onUpdate);
            } catch {
              // ignore
            }
            try {
              socket.emit('unsubscribe', code);
            } catch {
              // ignore
            }
            subscribed.current.delete(code);
          }
        };
        
        if (!listenerMap.has(code)) listenerMap.set(code, new Set());
        listenerMap.get(code)!.add(onUpdate);
        socket.on(eventName, onUpdate);
        refCounts.set(code, (refCounts.get(code) || 0) + 1);
      }
    });

    // Subscribe to event-scoped fancy and bookmaker channels
    if (opts?.eventId) {
      const fancyKey = `fancy-${opts.eventId}`;
      const bookmakerKey = `bookmaker-${opts.eventId}`;

      if (!subscribed.current.has(fancyKey)) {
        socket.emit('subscribe', fancyKey);
        subscribed.current.add(fancyKey);
        const eventName = `oddsUpdate${fancyKey}`;
        const onUpdate = (data: unknown) => {
          applyUpdate(fancyKey, data);
          if (opts?.once && !snapshotted.current.has(fancyKey)) {
            snapshotted.current.add(fancyKey);
            try {
              socket.off(eventName, onUpdate);
            } catch {
              // ignore
            }
            try {
              socket.emit('unsubscribe', fancyKey);
            } catch {
              // ignore
            }
            subscribed.current.delete(fancyKey);
          }
        };
        if (!listenerMap.has(fancyKey)) listenerMap.set(fancyKey, new Set());
        listenerMap.get(fancyKey)!.add(onUpdate);
        socket.on(eventName, onUpdate);
        refCounts.set(fancyKey, (refCounts.get(fancyKey) || 0) + 1);
      }

      if (!subscribed.current.has(bookmakerKey)) {
        socket.emit('subscribe', bookmakerKey);
        subscribed.current.add(bookmakerKey);
        const eventName = `oddsUpdate${bookmakerKey}`;
        const onUpdate = (data: unknown) => {
          const payload = data && typeof data === 'object' && 'data' in data ? (data as { data: unknown }).data : data;
          applyUpdate(bookmakerKey, payload);
          if (opts?.once && !snapshotted.current.has(bookmakerKey)) {
            snapshotted.current.add(bookmakerKey);
            try {
              socket.off(eventName, onUpdate);
            } catch {
              // ignore
            }
            try {
              socket.emit('unsubscribe', bookmakerKey);
            } catch {
              // ignore
            }
            subscribed.current.delete(bookmakerKey);
          }
        };
        if (!listenerMap.has(bookmakerKey)) listenerMap.set(bookmakerKey, new Set());
        listenerMap.get(bookmakerKey)!.add(onUpdate);
        socket.on(eventName, onUpdate);
        refCounts.set(bookmakerKey, (refCounts.get(bookmakerKey) || 0) + 1);
      }
    }

    // Unsubscribe from removed markets and from event-scoped channels
    return () => {
      mountedRef.current = false;
      if (flushTimeoutRef.current != null) {
        clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = null;
      }
      marketCodes.forEach((code) => {
        cleanupChannel(socket, code, subscribed);
      });
      if (eventIdForCleanup) {
        cleanupChannel(socket, `fancy-${eventIdForCleanup}`, subscribed);
        cleanupChannel(socket, `bookmaker-${eventIdForCleanup}`, subscribed);
      }
    };
  }, [marketCodes.join(','), opts?.eventId, opts?.socketUrl, opts?.once]);

  return marketOdds;
}

