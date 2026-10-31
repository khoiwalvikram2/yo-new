import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

/**
 * Tests resolve modules exactly the way the browser build does.
 *
 * This is the whole reason the CRM runs Vitest while the backends run
 * `node --test`: @apollo/client 3.14 ships no "exports" map, so Node's ESM
 * loader falls back to a .cjs bundle whose named exports its lexer cannot see,
 * and `import { useQuery } from '@apollo/client'` throws before a single
 * component renders. Vite reads the package's `module` field and gets real ESM
 * — the same file it puts in the bundle. Reusing the app's own Vite config here
 * means a test exercises the module graph the users get, not an approximation
 * of it.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./vitest.setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // antd pulls in a lot; the first render in a file is slow and the rest
      // are fast.
      testTimeout: 15_000,
      restoreMocks: true,
      /**
       * One line, and only one: jsdom does not implement `getComputedStyle`
       * with pseudo-elements, and antd asks for it on nearly every render. It
       * says nothing about the code under test and it drowns the output, which
       * is how a real warning goes unread. Everything else still prints.
       */
      onConsoleLog(log) {
        if (log.includes("getComputedStyle() method: with pseudo-elements")) return false
      },
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx', 'src/vite-env.d.ts'],
        reporter: ['text-summary', 'json-summary'],
      },
    },
  })
)
