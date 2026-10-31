import { test, expect, type Page } from '@playwright/test'

/**
 * Signing in, against the real server.
 *
 * The component tests already prove the login screen shows the right message
 * for each outcome. What they cannot prove is that the outcome ever arrives:
 * the request has to cross an origin, carry `x-client-type: crm` so the surface
 * guard treats it as a CRM caller rather than an admin one, and come back
 * through CORS. Every one of those has broken this app before, and every one of
 * them is invisible to a mocked Apollo link.
 *
 * Fixtures come from `admin-backend: npx tsx scripts/seedE2eCrmUsers.ts`.
 */

const ADMIN = { username: 'e2e-admin', password: 'E2e-Passw0rd!' }
const SECURITY_ONLY = { username: 'e2e-security', password: 'E2e-Passw0rd!' }

async function signIn(page: Page, who: { username: string; password: string }) {
  await page.goto('/')
  await expect(page.getByText('Sign in to your desk')).toBeVisible()
  await page.getByLabel('Username').fill(who.username)
  await page.getByLabel('Password').fill(who.password)
  await page.getByRole('button', { name: /sign in/i }).click()
}

test.beforeEach(async ({ page }) => {
  // The session is persisted, so each test starts from a clean browser.
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
})

test('an administrator signs in and reaches their desk', async ({ page }) => {
  await signIn(page, ADMIN)

  // Getting this far means the request left the browser, was accepted by CORS,
  // was recognised as a CRM caller, and came back with a session.
  await expect(page.getByText('Sign in to your desk')).toBeHidden()
  await expect(page.getByRole('menuitem', { name: 'Players' })).toBeVisible()
})

test('a wrong password is refused, and says so', async ({ page }) => {
  await signIn(page, { username: ADMIN.username, password: 'not-the-password' })

  // The server's own message, not one the screen invented — and the user stays
  // where they are rather than being let through.
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText('Sign in to your desk')).toBeVisible()
})

test('an account with only the security log lands there, not on players', async ({ page }) => {
  // The defect this replaces, end to end: every refusal used to redirect to
  // /players — a route that is itself gated — so this user was sent to a screen
  // the server refuses and shown an error with no navigation and no way out.
  await signIn(page, SECURITY_ONLY)

  await expect(page.getByRole('menuitem', { name: 'Security' })).toBeVisible()
  await expect(page).toHaveURL(/\/security$/)

  // And the screens they cannot open are not offered at all.
  await expect(page.getByRole('menuitem', { name: 'Players' })).toBeHidden()
  await expect(page.getByRole('menuitem', { name: 'Queue' })).toBeHidden()
})

test('asking for a screen you cannot open sends you to one you can', async ({ page }) => {
  await signIn(page, SECURITY_ONLY)
  await expect(page).toHaveURL(/\/security$/)

  // Typed straight into the address bar, which is the case a nav-only guard
  // would miss entirely.
  await page.goto('/players')
  await expect(page).toHaveURL(/\/security$/)

  // And they land on a working screen rather than on an error, which is what
  // the old redirect to a gated /players produced.
  await expect(page.getByText('Sign-in attempts')).toBeVisible()
})

test('signing out ends the session', async ({ page }) => {
  await signIn(page, ADMIN)
  await expect(page.getByRole('menuitem', { name: 'Players' })).toBeVisible()

  await page.locator('.ant-avatar').first().click()
  await page.getByText('Sign out').click()

  await expect(page.getByText('Sign in to your desk')).toBeVisible()

  // The token is gone, not merely hidden: reloading must not restore the desk.
  await page.reload()
  await expect(page.getByText('Sign in to your desk')).toBeVisible()
})
