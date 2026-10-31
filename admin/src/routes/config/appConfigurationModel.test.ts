import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { CONFIG_PREVIEW_DATA } from '../../../test/appConfigurationPreviewData'
import { CONFIG_DEFINITIONS, CONFIG_MENU, DEFAULT_THEME_COLORS, brandingInitialValues, configRoles, configurationColorValid, sectionInitialValues, sectionPayload, sectionSchema, settingsEmailValid, settingsUrlValid, tabVisible } from './appConfigurationModel'

describe('App configuration section contracts', () => {
  test('original contact/webhook validator acceptance remains independent of Antd', () => {
    for (const url of ['https://example.com/hook', '//example.com/hook', 'www.example.com/path', 'ftp://localhost:21/hook', 'https://127.0.0.1:4000/api']) assert.ok(settingsUrlValid(url), url)
    for (const url of ['not a URL', 'mailto:ops@example.com', 'example.com', 'https://example.com/' + 'a'.repeat(2048)]) assert.equal(settingsUrlValid(url), false, url)
    assert.ok(settingsEmailValid('"quoted name"@example.com')); assert.ok(settingsEmailValid('ops+alerts@example.com'))
    assert.equal(settingsEmailValid('a..b@example.com'), false); assert.equal(settingsEmailValid('ops@example.c'), false)
  })
  test('valid persisted hex/RGB/named color strings are preserved; invalid new colors fail', () => {
    for (const value of ['#123456', '#abcd', 'rgb(12, 34, 56)', 'rgba(12, 34, 56, 0.5)', 'rebeccapurple', 'transparent']) assert.ok(configurationColorValid(value), value)
    assert.equal(configurationColorValid('not a color'), false)
    assert.equal(sectionSchema('pwa').safeParse({ themeColor: 'not a color' }).success, false)
    assert.deepEqual(sectionPayload('pwa', { themeColor: 'rebeccapurple', backgroundColor: 'rgba(1, 2, 3, 0.5)' }), { pwa: { themeColor: 'rebeccapurple', backgroundColor: 'rgba(1, 2, 3, 0.5)' } })
  })
  // Fifteen since News Ticker got its own tab (2026-10-29); whitelabel admins see it, to run their own news.
  test('all fifteen active sections and original per-role hidden tabs remain available', () => {
    const tabs = CONFIG_MENU.flatMap((group) => group.items.map((item) => item.key))
    assert.equal(tabs.length, 15); assert.equal(new Set(tabs).size, 15)
    assert.ok(tabs.includes('news'))
    assert.deepEqual(sectionPayload('news', { newsTicker: '' }), { newsTicker: '' }, 'a cleared ticker is saved as empty, which hides it')
    const white = configRoles(['Whitelabel Admin'])
    assert.deepEqual(tabs.filter((tab) => !tabVisible(tab, white)).sort(), ['admin-notify', 'features', 'general', 'notify', 'observability', 'pwa', 'webhooks'])
    assert.ok(tabs.every((tab) => tabVisible(tab, configRoles(['super_admin', 'whitelabel_admin']))))
  })
  test('only registered fields become each payload; unrendered legacy settings are not invented', () => {
    for (const [tab, definition] of Object.entries(CONFIG_DEFINITIONS)) {
      const key = tab as keyof typeof CONFIG_DEFINITIONS
      const values = sectionInitialValues(key, { ...CONFIG_PREVIEW_DATA, unused: 'must not be sent' }, { name: ' App ' })
      assert.deepEqual(Object.keys(values).sort(), definition.sections.flatMap((section) => section.fields.map((field) => field.name)).sort())
      const parsed = sectionSchema(key).safeParse(values)
      assert.ok(parsed.success, `${tab}: ${JSON.stringify(parsed.error)}`)
      assert.equal('unused' in sectionPayload(key, values), false)
    }
  })
  test('brand theme uses app-config values, legacy dark fallback, and existing distinct initial/reset primary', () => {
    const current = brandingInitialValues({ logoUrl: 'logo', faviconUrl: null }, CONFIG_PREVIEW_DATA)
    assert.deepEqual(current.dark, CONFIG_PREVIEW_DATA.theme.dark); assert.deepEqual(current.light, CONFIG_PREVIEW_DATA.theme.light)
    assert.equal(current.primary, '#123456'); assert.equal(current.logoUrl, 'logo'); assert.equal(current.faviconUrl, null)
    const fallback = brandingInitialValues({}, { theme: { bgPage: '#010203', textPrimary: '#abcdef' } })
    assert.equal(fallback.dark.bgPage, '#010203'); assert.equal(fallback.dark.textPrimary, '#abcdef')
    assert.deepEqual(fallback.light, DEFAULT_THEME_COLORS.light); assert.equal(fallback.primary, '#2952E3'); assert.equal(DEFAULT_THEME_COLORS.primary, '#FF3B30')
  })
  test('payments preserves nullable unlimited cap, integer floor, payouts and limits', () => {
    const values = sectionInitialValues('payments', CONFIG_PREVIEW_DATA, {})
    assert.deepEqual(sectionPayload('payments', { ...values, maxDailyWithdrawalRequests: 4.9 }), { payments: { ...values, maxDailyWithdrawalRequests: 4 } })
    assert.equal((sectionPayload('payments', { ...values, maxDailyWithdrawalRequests: null }).payments as Record<string, unknown>).maxDailyWithdrawalRequests, null)
    assert.equal(sectionInitialValues('payments', { payments: { maxDailyWithdrawalRequests: 0 } }, {}).maxDailyWithdrawalRequests, undefined)
  })
  test('SMTP secret is not fetched and recipient save trims/deduplicates without inventing SMS fields', () => {
    const values = sectionInitialValues('notify', CONFIG_PREVIEW_DATA, {})
    assert.equal(values.smtpPassword, undefined)
    assert.deepEqual(sectionPayload('notify', { ...values, smtpAlertRecipients: [' ops@example.test ', 'ops@example.test', 'other@example.test'] }), { notifications: { host: 'smtp.example.test', port: 587, username: 'preview', password: undefined, fromEmail: 'noreply@example.test', alertRecipients: ['ops@example.test', 'other@example.test'] } })
    assert.equal(sectionSchema('notify').safeParse({ ...values, smtpAlertRecipients: ['invalid'] }).success, false)
  })
  test('SEO blank-to-null and webhook comma splitting retain original behavior', () => {
    const seo = sectionPayload('seo', sectionInitialValues('seo', {}, { name: '' }))
    assert.deepEqual(seo, { seoTitle: null, seoDescription: null, ogImageUrl: null, socialLinks: { twitter: null, facebook: null, instagram: null, youtube: null, linkedin: null, telegram: null } })
    assert.deepEqual(sectionPayload('webhooks', { endpointUrl: 'https://example.test/hook', secret: undefined, events: ' bet.placed, , user.created ' }), { webhooks: { endpointUrl: 'https://example.test/hook', secret: undefined, events: ['bet.placed', '', 'user.created'] } })
    assert.equal(sectionSchema('webhooks').safeParse({ endpointUrl: 'not a URL' }).success, false)
    assert.equal(sectionSchema('contact').safeParse({ supportEmail: 'invalid' }).success, false)
  })
})
