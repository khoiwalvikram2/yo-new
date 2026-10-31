import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

/**
 * Gaps between jsdom and a real browser that this app falls into.
 *
 * - matchMedia: jsdom has none; useBreakpoint (src/shared/hooks/useBreakpoint.ts:45-47)
 *   calls it on mount.
 * - ResizeObserver / IntersectionObserver: jsdom has neither; floating-ui's
 *   autoUpdate and responsive charts use them.
 * - scrollIntoView: GlobalSearch's SearchResultItem calls it (SearchResultItem.tsx:50).
 * - cleanup, localStorage and data-theme: without them, trees, persisted zustand
 *   state and the <html> theme leak from one test into the next.
 * - dayjs utc/timezone: main.tsx registers these for the browser, but vitest never
 *   loads main.tsx, so anything reaching dayjs.tz (date.ts nowIST -> useIstClock ->
 *   DateTime) throws "dayjs.tz is not a function" without them.
 */

dayjs.extend(utc)
dayjs.extend(timezone)

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver
globalThis.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver

if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {}
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
})
