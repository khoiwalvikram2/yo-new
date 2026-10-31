import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { appConfigurationResponse, CONFIG_PREVIEW_DATA, type ConfigFixtureOptions } from '../../../test/appConfigurationPreviewData'
import AppConfigurationPage from './AppConfigurationPage'
import { CONFIG_DEFINITIONS, sectionInitialValues, sectionPayload } from './appConfigurationModel'
const state = vi.hoisted(() => ({ roles: ['Super Admin'], allowed: true, guards: [] as unknown[], compress: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('@/shared/core/authStore', () => ({ useAuthStore: () => ({ roles: state.roles }) }))
vi.mock('@/shared/core/RBACGuard', () => ({ RBACGuard: ({ children, ...props }: { children: ReactNode; fallback?: ReactNode }) => { state.guards.push(props); return state.allowed ? children : props.fallback ?? null } }))
vi.mock('@/shared/services/notification', () => ({ notify: { success: state.success, error: state.error, info: state.info } }))
vi.mock('@/shared/utils/imageCompression', () => ({ compressImageToDataUrl: state.compress }))
let calls: { name: string; input: Record<string, unknown>; variables: Record<string, unknown>; headers: Record<string, string> }[]
let options: ConfigFixtureOptions
function page(path = '/config/app-configuration?whitelabelId=target-tenant') {
  const link = new ApolloLink((operation) => new Observable((observer) => {
    calls.push({ name: operation.operationName, input: JSON.parse(JSON.stringify(operation.variables.input || {})) as Record<string, unknown>, variables: operation.variables, headers: operation.getContext().headers })
    queueMicrotask(() => { try { observer.next(appConfigurationResponse(operation, options)); observer.complete() } catch (error) { observer.error(error) } })
  }))
  return render(<MockedProvider link={link} cache={new InMemoryCache()}><MemoryRouter initialEntries={[path]}><Routes><Route path="/config/app-configuration" element={<AppConfigurationPage />} /><Route path="/config/whitelabels" element={<div>Whitelabel list</div>} /></Routes></MemoryRouter></MockedProvider>)
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
    assert.ok(calls.filter((call) => ['AppConfig', 'GetWhitelabel'].includes(call.name)).every((call) => call.headers['x-whitelabel-id'] === 'target-tenant'))
    assert.equal(calls.some((call) => call.name.startsWith('Update')), false)
  })
  test('brand saves unchanged asset/theme contracts and omits untouched banners', async () => {
    page(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' })); await waitFor(() => assert.ok(state.success.mock.calls.length))
    const tenant = calls.find((call) => call.name === 'UpdateWhitelabel')!
    assert.equal(tenant.input.id, 'target-tenant'); assert.equal(tenant.headers['x-whitelabel-id'], 'target-tenant')
    assert.deepEqual(calls.find((call) => call.name === 'UpdateAppConfig')?.input, { theme: CONFIG_PREVIEW_DATA.theme })
  })
  test('branding compression presets, removals and two theme tabs remain functioning', async () => {
    page(); await ready(); fireEvent.change(screen.getByLabelText('Upload Logo'), { target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] } })
    await waitFor(() => assert.equal((screen.getByAltText('Logo') as HTMLImageElement).src, 'data:image/png;base64,cHJldmlldw=='))
    assert.equal(state.compress.mock.calls[0][1], 'logo')
    fireEvent.change(screen.getByLabelText('Upload Favicon'), { target: { files: [new File(['favicon'], 'favicon.png', { type: 'image/png' })] } })
    await waitFor(() => assert.equal(state.compress.mock.calls.length, 2)); assert.equal(state.compress.mock.calls[1][1], 'favicon')
    fireEvent.change(screen.getByLabelText('Upload Pre-Login Banner'), { target: { files: [new File(['banner'], 'banner.png', { type: 'image/png' })] } })
    await waitFor(() => assert.equal(state.compress.mock.calls.length, 3)); assert.equal(state.compress.mock.calls[2][1], 'banner')
    fireEvent.click(screen.getByRole('tab', { name: 'Light Theme' })); change('Background', '#fafafa')
    const post = screen.getByAltText('Post-Login Banner preview').closest('div')!
    fireEvent.click(within(post).getByRole('button', { name: 'Remove Banner' })); fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' }))
    await waitFor(() => assert.ok(calls.some((call) => call.name === 'UpdateAppConfig')))
    const input = calls.find((call) => call.name === 'UpdateAppConfig')!.input
    assert.equal(input.preLoginBannerUrl, 'data:image/png;base64,cHJldmlldw=='); assert.equal(input.postLoginBannerUrl, null)
    assert.equal(((input.theme as Record<string, unknown>).light as Record<string, unknown>).bgPage, '#fafafa')
  })
  test('non-image and failed compression do not replace existing assets', async () => {
    page(); await ready(); const original = (screen.getByAltText('Logo') as HTMLImageElement).src
    fireEvent.change(screen.getByLabelText('Upload Logo'), { target: { files: [new File(['text'], 'text.txt', { type: 'text/plain' })] } }); assert.equal(state.compress.mock.calls.length, 0)
    state.compress.mockRejectedValue(new Error('Compression refused'))
    fireEvent.change(screen.getByLabelText('Upload Logo'), { target: { files: [new File(['bad'], 'bad.png', { type: 'image/png' })] } })
    await waitFor(() => assert.ok(state.error.mock.calls.some(([message]) => message === 'Compression refused')))
    assert.equal((screen.getByAltText('Logo') as HTMLImageElement).src, original)
  })
  test.each(Object.keys(CONFIG_DEFINITIONS).filter((tab) => tab !== 'seo'))('%s section saves all original registered fields only with target header', async (name) => {
    page(); await ready(); const tab = name as keyof typeof CONFIG_DEFINITIONS
    const labels: Record<string, string> = { general: 'General Settings', contact: 'Contact Settings', features: 'Feature Toggles', analytics: 'Analytics', payments: 'Payments & KYC', risk: 'Risk & Limits', notify: 'Email & SMS', 'admin-notify': 'Admin Notifications', webhooks: 'Webhooks', observability: 'Observability', maintenance: 'Maintenance', news: 'News Ticker', pwa: 'PWA Settings' }
    section(labels[name]); fireEvent.click(screen.getByRole('button', { name: CONFIG_DEFINITIONS[tab].saveText }))
    await waitFor(() => assert.ok(calls.some((call) => call.name === 'UpdateAppConfig')))
    const expected = JSON.parse(JSON.stringify(sectionPayload(tab, sectionInitialValues(tab, CONFIG_PREVIEW_DATA, {}))))
    assert.deepEqual(calls.find((call) => call.name === 'UpdateAppConfig')!.input, expected)
    assert.equal(calls.find((call) => call.name === 'UpdateAppConfig')!.headers['x-whitelabel-id'], 'target-tenant')
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
    page(); await ready(); change('Primary', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' })); await screen.findByText('Please choose a color')
    assert.equal(document.activeElement, screen.getByRole('textbox', { name: 'Primary' })); assert.equal(calls.some((call) => call.name.startsWith('Update')), false)
    change('Primary', '#123456'); const save = screen.getByRole('button', { name: 'Save Branding & Theme' })
    fireEvent.click(save); fireEvent.click(save)
    await waitFor(() => assert.equal(calls.filter((call) => call.name === 'UpdateAppConfig').length, 1))
    assert.equal(calls.filter((call) => call.name === 'UpdateWhitelabel').length, 1)
  })
  test('brand draft persists across other tabs and Reset to Default keeps legacy persisted defaults', async () => {
    page(); await ready(); change('Primary', '#abcdef'); section('Risk & Limits'); section('Branding & Theme')
    assert.equal((screen.getByRole('textbox', { name: 'Primary' }) as HTMLInputElement).value, '#abcdef')
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Default' })); assert.equal((screen.getByRole('textbox', { name: 'Primary' }) as HTMLInputElement).value, '#FF3B30')
    fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' })); await waitFor(() => assert.ok(calls.some((call) => call.name === 'UpdateAppConfig')))
    assert.equal((calls.find((call) => call.name === 'UpdateAppConfig')!.input.theme as Record<string, unknown>).primary, '#FF3B30')
  })
  test('brand text editor rejects malformed colors and preserves a valid RGB string exactly', async () => {
    page(); await ready(); change('Primary', 'not a color'); fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' }))
    await screen.findByText('Please enter a valid color'); assert.equal(calls.some((call) => call.name.startsWith('Update')), false)
    change('Primary', 'rgba(12, 34, 56, 0.5)'); fireEvent.click(screen.getByRole('button', { name: 'Save Branding & Theme' }))
    await waitFor(() => assert.ok(calls.some((call) => call.name === 'UpdateAppConfig')))
    assert.equal((calls.find((call) => call.name === 'UpdateAppConfig')!.input.theme as Record<string, unknown>).primary, 'rgba(12, 34, 56, 0.5)')
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
    change('Primary', '#abcdef'); fireEvent.click(within(screen.getByAltText('Pre-Login Banner preview').closest('div')!).getByRole('button', { name: 'Remove Banner' }))
    assert.ok(screen.getByText('Unsaved changes')); assert.equal(screen.queryByAltText('Pre-Login Banner preview'), null)
    fireEvent.click(discard)
    assert.equal((screen.getByRole('textbox', { name: 'Primary' }) as HTMLInputElement).value, '#123456'); assert.ok(screen.getByAltText('Pre-Login Banner preview'))
    assert.ok(screen.getByText('Settings are up to date'))
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
