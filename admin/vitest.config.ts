import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

/**
 * Tests resolve modules the way the browser build does: same `@` alias, same
 * React dedupe, same `define`. @apollo/client 3.14 has no "exports" map, so
 * plain `node --test` cannot import it; Vite can. Mirrors crm/vitest.config.ts.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./vitest.setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      testTimeout: 15_000,
      restoreMocks: true,
      onConsoleLog(log) {
        if (log.includes('getComputedStyle() method: with pseudo-elements')) return false
      },
    },
  })
)
