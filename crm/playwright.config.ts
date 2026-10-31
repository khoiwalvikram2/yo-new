import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests against the running stack.
 *
 * Everything else in this workspace mocks the server: Vitest hands components a
 * canned Apollo response and asks what they render. That leaves a seam nothing
 * checks — the real request going out over HTTP, through the surface guard that
 * separates a CRM caller from an admin one, into the resolvers, and back. A
 * mocked test cannot see a CORS header, a missing `x-client-type`, or a token
 * the server rejects, because in a mocked test none of those exist.
 *
 * These need the backend on 4002 and the CRM dev server on 5175, and the
 * fixture accounts from `admin-backend: npx tsx scripts/seedE2eCrmUsers.ts`.
 * They are deliberately not part of `npm test`: a suite that fails when a server
 * is down teaches people to ignore it.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.CRM_E2E_URL ?? 'http://localhost:5175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
