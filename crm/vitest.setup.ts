import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * The gaps between jsdom and a real browser that antd actually falls into.
 *
 * None of these are conveniences. Without `matchMedia` antd's responsive grid
 * throws on mount; without `ResizeObserver` its Table and Dropdown do; and
 * without the unmount below, every rendered tree from every previous test stays
 * in the document, so `getByText` starts finding several matches and tests fail
 * for reasons that have nothing to do with the code under test.
 */

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
})
