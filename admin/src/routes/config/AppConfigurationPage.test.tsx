import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import type { ReactNode } from 'react'
import { APP_CONFIG } from '@/lib/graphql/appConfig'
import { appConfigurationResponse, CONFIG_PREVIEW_DATA, type ConfigFixtureOptions } from '../../../test/appConfigurationPreviewData'
import { MATCHBOOK_COLORS, PLAYER_THEME_PRESETS } from '../../../../shared/src/theme/playerTheme'
import AppConfigurationPage from './AppConfigurationPage'
import { CONFIG_DEFINITIONS, sectionInitialValues, sectionPayload } from './appConfigurationModel'
const BLUE = PLAYER_THEME_PRESETS.find((preset) => preset.id === 'royal-blue')!.colors
const state = vi.hoisted(() => ({ roles: ['Super Admin'], allowed: true, guards: [] as unknown[], compress: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('@/shared/core/authStore', () => ({ useAuthStore: () => ({ roles: state.roles }) }))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children, ...props }: { children: ReactNode; fallback?: ReactNode }) => { state.guards.push(props); return state.allowed ? children : props.fallback ?? null } }))
vi.mock('@/shared/services/notification', () => ({ notify: { success: state.success, error: state.error, info: state.info } }))
vi.mock('@/shared/utils/imageCompression', () => ({ compressImageToDataUrl: state.compress }))
let calls: { name: string; input: Record<string, unknown>; variables: Record<string, unknown>; target?: string; quiet?: boolean }[]
let options: ConfigFixtureOptions
/** An untargeted reader of the same AppConfig query (the current tenant's), mounted beside the page. */
function CurrentTenantConfig() { useQuery(APP_CONFIG, { errorPolicy: 'all' }); return null }
function page(path = '/config/app-configuration?whitelabelId=target-tenant', cache = new InMemoryCache(), beside?: ReactNode) {
  const link = new ApolloLink((operation) => new Observable((observer) => {
    calls.push({ name: operation.operationName, input: JSON.parse(JSON.stringify(operation.variables.input || {})) as Record<string, unknown>, variables: operation.variables, target: operation.getContext().targetWhitelabelId, quiet: operation.getContext().skipNotification })
    queueMicrotask(() => { try { observer.next(appConfigurationResponse(operation, options)); observer.complete() } catch (error) { observer.error(error) } })
  }))
  return render(<MockedProvider link={link} cache={cache}><MemoryRouter initialEntries={[path]}>{beside}<Routes><Route path="/config/app-configuration" element={<AppConfigurationPage />} /><Route path="/config/whitelabels" element={<div>Whitelabel list</div>} /></Routes></MemoryRouter></MockedProvider>)
}
async function ready() { await screen.findByRole('heading', { name: 'Logo & Favicon' }) }
function section(label: string) { fireEvent.click(within(screen.getByRole('navigation', { name: 'App configuration sections' })).getByRole('button', { name: label })) }
function change(label: string, value: string) { fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } }) }
beforeEach(() => { calls = []; options = {}; state.roles = ['Super Admin']; state.allowed = true; state.guards = []; vi.clearAllMocks(); state.compress.mockResolvedValue('data:image/png;base64,cHJldmlldw==') })

describe('App Configuration full working UI', () => {
  test('loads target context and retains all fifteen sections without implicit writes', async () => {
    page(); await ready(); assert.equal(within(screen.getByRole('navigation')).getAllByRole('button').length, 15)
    assert.ok(screen.getByText('Managing: Preview partner with a long descriptive name'))
    assert.equal(calls.find((call) => call.name === 'GetWhitelabel')?.variables.id, 'target-tenant')
    assert.ok(calls.filter((call) => ['AppConfig', 'GetWhitelabel'].includes(call.name)).every((call) => call.target === 'target-tenant'))
    assert.equal(calls.some((call) => call.name.startsWith('Update')), false)
  })
  test('the targeted read is never merged into an untargeted AppConfig in flight at the same moment (SYS-21)', async () => {
    // Apollo merges identical in-flight queries whatever their context; merged, the page would show the current
    // tenant's config under the managed whitelabel's banner.
    page(undefined, undefined, <CurrentTenantConfig />); await ready()
    const reads = calls.filter((call) => call.name === 'AppConfig')
    assert.equal(reads.length, 2, 'both reads reach the server')
    assert.deepEqual(reads.map((call) => call.target ?? null).sort(), ['target-tenant', null].sort())
  })
  test("a Super Admin's target config stays out of the cache the shell and other pages read", async () => {
    const cache = new InMemoryCache(); page(undefined, cache); await ready()
    assert.equal('appConfig' in (cache.extract().ROOT_QUERY ?? {}), false, "the managed whitelabel's config replaced the current tenant's in the cache")
  })
  test('brand saves unchanged asset/theme contracts and omits untouched banners', async () => {
    page(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' })); await waitFor(() => assert.ok(state.success.mock.calls.length))
    const tenant = calls.find((call) => call.name === 'UpdateWhitelabel')!
    assert.equal(tenant.input.id, 'target-tenant'); assert.equal(tenant.target, 'target-tenant')
    assert.equal(calls.find((call) => call.name === 'UpdateAppConfig')?.target, 'target-tenant', 'the theme is saved to the same whitelabel as the logo')
    assert.deepEqual(calls.find((call) => call.name === 'UpdateAppConfig')?.input, { playerTheme: { presetId: 'matchbook', sportsIconStyle: 'default', colors: MATCHBOOK_COLORS } })
  })
  test('each save is reported once, by the page: the notification link stays quiet for its writes (SYS-05)', async () => {
    page(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' })); await waitFor(() => assert.ok(state.success.mock.calls.length))
    section('SEO & Social'); fireEvent.click(screen.getByRole('button', { name: 'Save SEO & Social' }))
    await waitFor(() => assert.equal(calls.filter((call) => call.name === 'UpdateAppConfig').length, 2))
    const writes = calls.filter((call) => call.name.startsWith('Update'))
    assert.equal(writes.length, 4)
    assert.ok(writes.every((call) => call.quiet === true && call.target === 'target-tenant'), 'a write was left to the notification link as well')
    assert.ok(calls.filter((call) => !call.name.startsWith('Update')).every((call) => call.quiet === undefined), 'reads are untouched')
  })
  test("a refused branding write is reported in the server's words", async () => {
    options.appNameRefused = true; page(); await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' }))
    await waitFor(() => assert.deepEqual(state.error.mock.calls, [['Name refused']]))
    assert.equal(state.success.mock.calls.length, 0)
  })
  test('branding compression presets, removals and two theme tabs remain functioning', async () => {
    page(); await ready(); fireEvent.change(screen.getByLabelText('Upload Logo'), { target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] } })
    await waitFor(() => assert.equal((screen.getByAltText('Logo') as HTMLImageElement).src, 'data:image/png;base64,cHJldmlldw=='))
    assert.equal(state.compress.mock.calls[0][1], 'logo')
    fireEvent.change(screen.getByLabelText('Upload Favicon'), { target: { files: [new File(['favicon'], 'favicon.png', { type: 'image/png' })] } })
    await waitFor(() => assert.equal(state.compress.mock.calls.length, 2)); assert.equal(state.compress.mock.calls[1][1], 'favicon')
    fireEvent.change(screen.getByLabelText('Upload Pre-Login Banner'), { target: { files: [new File(['banner'], 'banner.png', { type: 'image/png' })] } })
    await waitFor(() => assert.equal(state.compress.mock.calls.length, 3)); assert.equal(state.compress.mock.calls[2][1], 'banner')
    fireEvent.click(screen.getByRole('tab', { name: 'Light Theme' })); change('Page', '#fafafa')
    const post = screen.getByAltText('Post-Login Banner preview').closest('div')!
    fireEvent.click(within(post).getByRole('button', { name: 'Remove Banner' })); fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' }))
    await waitFor(() => assert.ok(calls.some((call) => call.name === 'UpdateAppConfig')))
    const input = calls.find((call) => call.name === 'UpdateAppConfig')!.input
    assert.equal(input.preLoginBannerUrl, 'data:image/png;base64,cHJldmlldw=='); assert.equal(input.postLoginBannerUrl, null)
    const theme = input.playerTheme as { presetId: string; colors: { light: { page: string } } }
    assert.equal(theme.colors.light.page, '#FAFAFA'); assert.equal(theme.presetId, 'custom')
  })
  test('non-image and failed compression do not replace existing assets', async () => {
    page(); await ready(); const original = (screen.getByAltText('Logo') as HTMLImageElement).src
    fireEvent.change(screen.getByLabelText('Upload Logo'), { target: { files: [new File(['text'], 'text.txt', { type: 'text/plain' })] } }); assert.equal(state.compress.mock.calls.length, 0)
    state.compress.mockRejectedValue(new Error('Compression refused'))
    fireEvent.change(screen.getByLabelText('Upload Logo'), { target: { files: [new File(['bad'], 'bad.png', { type: 'image/png' })] } })
    await waitFor(() => assert.ok(state.error.mock.calls.some(([message]) => message === 'Compression refused')))
    assert.equal((screen.getByAltText('Logo') as HTMLImageElement).src, original)
  })
  test('a stored logo, favicon or banner that will not load is a placeholder naming it, never a broken image (SYS-18)', async () => {
    page(); await ready()
    for (const name of ['Logo', 'Favicon', 'Post-Login Banner preview']) {
      fireEvent.error(screen.getByAltText(name))
      assert.equal(screen.queryByAltText(name), null, `${name} left a broken image`)
      const placeholder = screen.getByRole('img', { name })
      assert.equal(placeholder.textContent, name)
    }
    // The tile keeps its actions, so the asset can be replaced.
    assert.ok(screen.getByRole('button', { name: 'Replace Logo' }))
  })
  test.each(Object.keys(CONFIG_DEFINITIONS).filter((tab) => tab !== 'seo'))('%s section saves all original registered fields only with target header', async (name) => {
    page(); await ready(); const tab = name as keyof typeof CONFIG_DEFINITIONS
    const labels: Record<string, string> = { general: 'General Settings', contact: 'Contact Settings', features: 'Feature Toggles', analytics: 'Analytics', payments: 'Payments & KYC', risk: 'Risk & Limits', notify: 'Email & SMS', 'admin-notify': 'Admin Notifications', webhooks: 'Webhooks', observability: 'Observability', maintenance: 'Maintenance', news: 'News Ticker', pwa: 'PWA Settings' }
    section(labels[name]); fireEvent.click(screen.getByRole('button', { name: CONFIG_DEFINITIONS[tab].saveText }))
    await waitFor(() => assert.ok(calls.some((call) => call.name === 'UpdateAppConfig')))
    const expected = JSON.parse(JSON.stringify(sectionPayload(tab, sectionInitialValues(tab, CONFIG_PREVIEW_DATA, {}))))
    assert.deepEqual(calls.find((call) => call.name === 'UpdateAppConfig')!.input, expected)
    assert.equal(calls.find((call) => call.name === 'UpdateAppConfig')!.target, 'target-tenant')
  })
  test('SEO saves blank app name to whitelabel first, never to app_config, and preserves social fields', async () => {
    page(); await ready(); section('SEO & Social'); change('App Name', '   '); change('Twitter', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save SEO & Social' })); await waitFor(() => assert.ok(calls.some((call) => call.name === 'UpdateAppConfig')))
    const writes = calls.filter((call) => call.name.startsWith('Update')); assert.equal(writes[0].name, 'UpdateWhitelabel'); assert.deepEqual(writes[0].input, { id: 'target-tenant', name: '' })
    assert.equal('appName' in writes[1].input, false); assert.equal((writes[1].input.socialLinks as Record<string, unknown>).twitter, null)
  })
  test('SMTP chips accept comma/space/Enter, deduplicate, validate and remove', async () => {
    page(); await ready(); section('Email & SMS'); change('Alert Recipients', 'invalid'); fireEvent.keyDown(screen.getByRole('textbox', { name: 'Alert Recipients' }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Save Notifications' })); await screen.findByText('Invalid email: invalid'); assert.equal(calls.some((call) => call.name === 'UpdateAppConfig'), false)
    fireEvent.click(screen.getByRole('button', { name: 'Remove invalid' })); change('Alert Recipients', 'other@example.test,ops@example.test ')
    fireEvent.click(screen.getByRole('button', { name: 'Save Notifications' })); await waitFor(() => assert.ok(calls.some((call) => call.name === 'UpdateAppConfig')))
    assert.deepEqual((calls.find((call) => call.name === 'UpdateAppConfig')!.input.notifications as Record<string, unknown>).alertRecipients, ['ops@example.test', 'other@example.test'])
  })
  test('save refusal preserves draft and provides retry rather than false completion', async () => {
    options.refused = true; page(); await ready(); section('Contact Settings'); change('Support Phone Number', 'draft phone')
    fireEvent.click(screen.getByRole('button', { name: 'Save Contact Settings' })); await screen.findByText('Settings refused')
    assert.equal((screen.getByRole('textbox', { name: 'Support Phone Number' }) as HTMLInputElement).value, 'draft phone')
    options.refused = false; fireEvent.click(screen.getByRole('button', { name: 'Save Contact Settings' })); await waitFor(() => assert.equal(calls.filter((call) => call.name === 'UpdateAppConfig').length, 2))
  })
  test('branding required colors focus the invalid control and rapid saves create one mutation pair', async () => {
    page(); await ready(); change('Action', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' })); await screen.findByText('Please choose a color')
    assert.equal(document.activeElement, screen.getByRole('textbox', { name: 'Action' })); assert.equal(calls.some((call) => call.name.startsWith('Update')), false)
    change('Action', '#123456'); const save = screen.getByRole('button', { name: 'Save Branding & Theme' })
    fireEvent.click(save); fireEvent.click(save)
    await waitFor(() => assert.equal(calls.filter((call) => call.name === 'UpdateAppConfig').length, 1))
    assert.equal(calls.filter((call) => call.name === 'UpdateWhitelabel').length, 1)
  })
  test('brand draft persists across other tabs and Reset to Default returns to Matchbook', async () => {
    page(); await ready(); change('Action', '#1E40AF'); section('Risk & Limits'); section('Branding & Theme')
    assert.equal((screen.getByRole('textbox', { name: 'Action' }) as HTMLInputElement).value, '#1E40AF')
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Default' })); assert.equal((screen.getByRole('textbox', { name: 'Action' }) as HTMLInputElement).value, '#C51A1B')
    fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' })); await waitFor(() => assert.ok(calls.some((call) => call.name === 'UpdateAppConfig')))
    const theme = calls.find((call) => call.name === 'UpdateAppConfig')!.input.playerTheme as { presetId: string; colors: { action: string } }
    assert.equal(theme.colors.action, '#C51A1B'); assert.equal(theme.presetId, 'matchbook')
  })
  test('brand colors must be hex and readable; a valid one is saved normalised', async () => {
    page(); await ready(); change('Action', 'not a color'); fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' }))
    await screen.findByText('Use a hex color such as #C51A1B'); assert.equal(calls.some((call) => call.name.startsWith('Update')), false)
    change('Action', '#C51A1B'); change('Chrome', '#DDDDDD'); fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' }))
    await screen.findByText('Menu text is hard to read on this color; choose a darker shade')
    assert.equal(document.activeElement, screen.getByRole('textbox', { name: 'Chrome' })); assert.equal(calls.some((call) => call.name.startsWith('Update')), false)
    change('Chrome', '#2B2F35'); change('Action', '#1d4ed8'); fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' }))
    await waitFor(() => assert.ok(calls.some((call) => call.name === 'UpdateAppConfig')))
    assert.equal((calls.find((call) => call.name === 'UpdateAppConfig')!.input.playerTheme as { colors: { action: string } }).colors.action, '#1D4ED8')
  })
  test('a bright action color saves, because button text switches to dark ink', async () => {
    page(); await ready(); change('Action', '#0DCE97'); fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' }))
    await waitFor(() => assert.ok(calls.some((call) => call.name === 'UpdateAppConfig')))
    assert.equal((calls.find((call) => call.name === 'UpdateAppConfig')!.input.playerTheme as { colors: { action: string } }).colors.action, '#0DCE97')
    assert.equal(screen.queryByText(/Button text is hard to read/), null)
  })
  test('failed app-name save stops the SEO sequence and retains values', async () => {
    options.appNameRefused = true; page(); await ready(); section('SEO & Social'); change('App Name', 'Changed name')
    fireEvent.click(screen.getByRole('button', { name: 'Save SEO & Social' })); await screen.findByText('Name refused')
    assert.equal(calls.some((call) => call.name === 'UpdateAppConfig'), false)
    assert.equal((screen.getByRole('textbox', { name: 'App Name' }) as HTMLInputElement).value, 'Changed name')
  })
  test('the section menu marks the current section and the head names it', async () => {
    page(); await ready(); const nav = screen.getByRole('navigation', { name: 'App configuration sections' })
    assert.equal(within(nav).getByRole('button', { name: 'Branding & Theme' }).getAttribute('aria-current'), 'true')
    section('Risk & Limits')
    assert.equal(within(nav).getByRole('button', { name: 'Risk & Limits' }).getAttribute('aria-current'), 'true')
    assert.equal(within(nav).getByRole('button', { name: 'Branding & Theme' }).getAttribute('aria-current'), null)
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Risk & Limits' }))
    assert.ok(screen.getByRole('switch', { name: 'Enable Cashout' }))
  })
  test('Discard is off on a clean form and undoes both the theme draft and a removed banner', async () => {
    page(); await ready(); const discard = screen.getByRole('button', { name: 'Discard' })
    assert.equal((discard as HTMLButtonElement).disabled, true); assert.ok(screen.getByText('Settings are up to date'))
    change('Action', '#1E40AF'); fireEvent.click(within(screen.getByAltText('Pre-Login Banner preview').closest('div')!).getByRole('button', { name: 'Remove Banner' }))
    assert.ok(screen.getByText('Unsaved changes')); assert.equal(screen.queryByAltText('Pre-Login Banner preview'), null)
    fireEvent.click(discard)
    assert.equal((screen.getByRole('textbox', { name: 'Action' }) as HTMLInputElement).value, '#C51A1B'); assert.ok(screen.getByAltText('Pre-Login Banner preview'))
    assert.ok(screen.getByText('Settings are up to date'))
  })
  test('a preset fills every key color; an edit turns it into Custom', async () => {
    page(); await ready(); const presets = screen.getByRole('group', { name: 'Preset' })
    assert.equal((within(presets).getByRole('radio', { name: /^Matchbook Red/ }) as HTMLInputElement).checked, true)
    fireEvent.click(within(presets).getByRole('radio', { name: /^Royal Blue/ }))
    assert.equal((screen.getByRole('textbox', { name: 'Action' }) as HTMLInputElement).value, '#1D4ED8')
    assert.equal((screen.getByRole('textbox', { name: 'Page' }) as HTMLInputElement).value, BLUE.dark.page, 'the dark tab shows the preset dark page')
    change('Action', '#1E40AF')
    assert.equal(within(presets).getAllByRole('radio').some((radio) => (radio as HTMLInputElement).checked), false)
    assert.ok(screen.getByText('Custom colors. Choose a preset to start again from it.'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' })); await waitFor(() => assert.ok(calls.some((call) => call.name === 'UpdateAppConfig')))
    const theme = calls.find((call) => call.name === 'UpdateAppConfig')!.input.playerTheme as { presetId: string; colors: { action: string; dark: { page: string } } }
    assert.equal(theme.presetId, 'custom'); assert.equal(theme.colors.action, '#1E40AF'); assert.equal(theme.colors.dark.page, BLUE.dark.page)
  })
  test('an unreadable light-theme color switches to the Light tab and focuses the field', async () => {
    page(); await ready(); fireEvent.click(screen.getByRole('tab', { name: 'Light Theme' })); change('Text', '#EEEEEE')
    fireEvent.click(screen.getByRole('tab', { name: 'Dark Theme' })); fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' }))
    await screen.findByText('Text is hard to read on the page or panel color')
    assert.equal(screen.getByRole('tab', { name: 'Light Theme' }).getAttribute('aria-selected'), 'true')
    assert.equal(document.activeElement, screen.getByRole('textbox', { name: 'Text' }))
  })
  test('colors saved by the old editor are offered, never applied on their own', async () => {
    page(); await ready()
    assert.equal((screen.getByRole('textbox', { name: 'Action' }) as HTMLInputElement).value, '#C51A1B', 'opens on what players see')
    fireEvent.click(screen.getByRole('button', { name: 'Use colors from the old editor' }))
    assert.equal((screen.getByRole('textbox', { name: 'Action' }) as HTMLInputElement).value, '#123456')
    assert.equal(calls.some((call) => call.name.startsWith('Update')), false)
    assert.equal(screen.queryByRole('button', { name: 'Use colors from the old editor' }), null)
    fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' })); await waitFor(() => assert.ok(calls.some((call) => call.name === 'UpdateAppConfig')))
    const theme = calls.find((call) => call.name === 'UpdateAppConfig')!.input.playerTheme as { presetId: string; colors: { action: string; light: { page: string; panel: string } } }
    assert.equal(theme.presetId, 'custom'); assert.equal(theme.colors.action, '#123456'); assert.equal(theme.colors.light.page, '#FAFAFB'); assert.equal(theme.colors.light.panel, '#FFFFFF')
  })
  test('a stored theme opens as saved, with its preset and icon set selected', async () => {
    options.playerTheme = { presetId: 'royal-blue', sportsIconStyle: '3d', colors: BLUE }; page(); await ready()
    assert.equal((screen.getByRole('textbox', { name: 'Action' }) as HTMLInputElement).value, '#1D4ED8')
    assert.equal((within(screen.getByRole('group', { name: 'Preset' })).getByRole('radio', { name: /^Royal Blue/ }) as HTMLInputElement).checked, true)
    assert.equal((within(screen.getByRole('group', { name: 'Sports icon style' })).getByRole('radio', { name: /^3D Colorful/ }) as HTMLInputElement).checked, true)
    assert.equal(screen.queryByRole('button', { name: 'Use colors from the old editor' }), null)
  })
  test('an unreadable stored theme is reported and the editor shows Matchbook', async () => {
    options.playerTheme = { primary: '#123456' }; page(); await ready()
    assert.ok(screen.getByText('Saved theme could not be fully read'))
    assert.equal((screen.getByRole('textbox', { name: 'Action' }) as HTMLInputElement).value, '#C51A1B')
  })
  test('Sports Icons previews three sports per set and saves the chosen set', async () => {
    page(); await ready(); const group = screen.getByRole('group', { name: 'Sports icon style' })
    assert.equal(group.querySelectorAll('img').length, 9)
    assert.equal((within(group).getByRole('radio', { name: /^Default/ }) as HTMLInputElement).checked, true)
    fireEvent.click(within(group).getByRole('radio', { name: /^3D Colorful/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' })); await waitFor(() => assert.ok(calls.some((call) => call.name === 'UpdateAppConfig')))
    assert.equal((calls.find((call) => call.name === 'UpdateAppConfig')!.input.playerTheme as { sportsIconStyle: string }).sportsIconStyle, '3d')
  })
  test('the banner card says the banners are popups', async () => {
    page(); await ready()
    assert.ok(screen.getByText('Shown as a popup on the user panel: one to visitors before they sign in, one right after a player signs in.'))
    assert.ok(screen.getByText('Popup before sign-in')); assert.ok(screen.getByText('Popup after sign-in'))
  })
  test('whitelabel admin retains restricted tabs and cross-target redirect; update guards remain on four sections', async () => {
    state.roles = ['whitelabel_admin']; page(); await ready(); await waitFor(() => assert.ok(state.error.mock.calls.some(([message]) => String(message).includes('Access Denied'))))
    assert.equal(within(screen.getByRole('navigation')).getAllByRole('button').length, 8)
    assert.equal(within(screen.getByRole('navigation')).queryByRole('button', { name: 'General Settings' }), null)
    assert.ok(within(screen.getByRole('navigation')).getByRole('button', { name: 'News Ticker' }), 'a whitelabel admin runs their own news')
    state.allowed = false; section('Payments & KYC'); assert.equal(screen.queryByRole('heading', { name: 'Deposit & Withdrawal Limits' }), null)
    assert.deepEqual((state.guards.at(-1) as { required: unknown }).required, [{ domain: 'config.app', actions: ['update'] }])
    assert.ok(screen.getByText("You can't change these settings"))
  })
})
