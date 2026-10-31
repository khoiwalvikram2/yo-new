export type StoredEvent = {
  id: string;
  eventName: string;
  league: string;
  sport: 'cricket' | 'football' | 'tennis' | 'basketball' | 'baseball' | 'hockey' | 'ice-hockey' | 'volleyball' | 'boxing' | 'mma' | 'rugby' | 'horseracing' | 'greyhoundracing' | 'darts' | 'snooker' | 'cycling' | 'golf' | 'esports';
  startISO: string;
  isLive?: boolean;
  runners?: Array<{
    name: string;
    back?: number;
    lay?: number;
  }>;
  // Optional backend event id for deep linking and server sync
  _eventId?: string;
};

const RECENTS_KEY = 'stakex:sports:recents';
const LIKES_KEY = 'stakex:sports:likes';
const MAX_RECENTS = 20;

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // Swallow JSON parse errors and return safe fallback
    return fallback;
  }
}

function safeWrite<T>(key: string, value: T) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota or serialization errors
  }
}

function emitUpdate(kind: 'recents' | 'likes') {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('stakex:sports:update', { detail: kind }));
  } catch {
    // Ignore dispatch errors in non-browser contexts
  }
}

export function getRecentEvents(): StoredEvent[] {
  return safeRead<StoredEvent[]>(RECENTS_KEY, []);
}

export function addRecentEvent(evt: StoredEvent) {
  const recents = getRecentEvents().filter(e => e.id !== evt.id);
  recents.unshift(evt);
  safeWrite(RECENTS_KEY, recents.slice(0, MAX_RECENTS));
  emitUpdate('recents');
}

export function setRecentEvents(events: StoredEvent[]) {
  safeWrite(RECENTS_KEY, events.slice(0, MAX_RECENTS));
  emitUpdate('recents');
}

export function getLikedEvents(): StoredEvent[] {
  // Scope likes per user so each user has an isolated bookmark list
  const userScopedKey = (() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('stakex_user') : null
      if (!raw) return `${LIKES_KEY}:guest`
      const user = JSON.parse(raw || '{}') as { id?: string }
      return `${LIKES_KEY}:${user?.id || 'guest'}`
    } catch {
      return `${LIKES_KEY}:guest`
    }
  })()
  return safeRead<StoredEvent[]>(userScopedKey, [])
}

export function isEventLiked(id: string): boolean {
  return getLikedEvents().some(e => e.id === id);
}

export function toggleLike(evt: StoredEvent) {
  const likes = getLikedEvents();
  const idx = likes.findIndex(e => e.id === evt.id);
  if (idx >= 0) {
    likes.splice(idx, 1);
  } else {
    likes.unshift(evt);
  }
  // Write back to the same user-scoped key
  const userScopedKey = (() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('stakex_user') : null
      if (!raw) return `${LIKES_KEY}:guest`
      const user = JSON.parse(raw || '{}') as { id?: string }
      return `${LIKES_KEY}:${user?.id || 'guest'}`
    } catch {
      return `${LIKES_KEY}:guest`
    }
  })()
  safeWrite(userScopedKey, likes);
  emitUpdate('likes');
}

export function setLikedEvents(events: StoredEvent[]) {
  const userScopedKey = (() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('stakex_user') : null
      if (!raw) return `${LIKES_KEY}:guest`
      const user = JSON.parse(raw || '{}') as { id?: string }
      return `${LIKES_KEY}:${user?.id || 'guest'}`
    } catch {
      return `${LIKES_KEY}:guest`
    }
  })()
  safeWrite(userScopedKey, events);
  emitUpdate('likes');
}

// Clean up bookmarks for events that no longer exist in the current sports data
export function cleanupStaleBookmarks(currentEvents: StoredEvent[]) {
  const bookmarked = getLikedEvents()
  const currentIds = new Set(currentEvents.map(e => e.id))
  const stale = bookmarked.filter(b => !currentIds.has(b.id))
  if (stale.length > 0) {
    const cleaned = bookmarked.filter(b => currentIds.has(b.id))
    setLikedEvents(cleaned)
    // debug removed
    return stale.length
  }
  return 0
}


