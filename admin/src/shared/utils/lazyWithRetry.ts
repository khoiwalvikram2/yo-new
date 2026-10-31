import { lazy } from 'react'
import type { LazyExoticComponent, ComponentType } from 'react'

const isChunkLoadError = (err: unknown): boolean => {
  if (err instanceof Error) {
    const msg = err.message?.toLowerCase() ?? ''
    return (
      msg.includes('loading chunk') ||
      msg.includes('chunkloaderror') ||
      msg.includes('dynamic import') ||
      msg.includes('failed to fetch dynamically imported module')
    )
  }
  return false
}

/**
 * Wraps React.lazy() with retries for chunk load failures (e.g. network blip, deploy).
 * Retries up to `retries` times with `delayMs` between attempts.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  retries = 2,
  delayMs = 1000
): LazyExoticComponent<T> {
  return lazy(async () => {
    let lastErr: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await factory()
      } catch (err) {
        lastErr = err
        if (attempt < retries && isChunkLoadError(err)) {
          await new Promise((r) => setTimeout(r, delayMs))
          continue
        }
        throw err
      }
    }
    throw lastErr
  }) as LazyExoticComponent<T>
}
