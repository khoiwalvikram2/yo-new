import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { CONFIG_PREVIEW_DATA } from '../../../test/appConfigurationPreviewData'
import { MATCHBOOK_COLORS, PLAYER_THEME_PRESETS } from '../../../../shared/src/theme/playerTheme'
import { CONFIG_DEFINITIONS, CONFIG_MENU, brandingInitialValues, brandingThemeInput, legacyThemeColors, storedThemeUnreadable, configRoles, configurationColorValid, sectionInitialValues, sectionPayload, sectionSchema, settingsEmailValid, settingsUrlValid, tabVisible } from './appConfigurationModel'

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
  test('brand values come from the stored player theme, else Matchbook; legacy colors are only offered', () => {
    const none = brandingInitialValues({ logoUrl: 'logo', faviconUrl: null }, CONFIG_PREVIEW_DATA)
    assert.equal(none.presetId, 'matchbook'); assert.equal(none.sportsIconStyle, 'default'); assert.equal(none.action, MATCHBOOK_COLORS.action)
    assert.deepEqual(none.light, MATCHBOOK_COLORS.light); assert.equal(none.logoUrl, 'logo'); assert.equal(none.faviconUrl, null)
    const blue = PLAYER_THEME_PRESETS.find((preset) => preset.id === 'royal-blue')!.colors
    const stored = brandingInitialValues({}, { playerTheme: { presetId: 'royal-blue', sportsIconStyle: '3d', colors: blue } })
    assert.equal(stored.presetId, 'royal-blue'); assert.equal(stored.sportsIconStyle, '3d'); assert.deepEqual(stored.dark, blue.dark)
    assert.deepEqual(brandingThemeInput({ ...stored, action: '#1d4ed8' }), { presetId: 'royal-blue', sportsIconStyle: '3d', colors: blue })
    const legacy = legacyThemeColors(CONFIG_PREVIEW_DATA.theme)!
    assert.equal(legacy.action, '#123456'); assert.equal(legacy.light.page, '#FAFAFB'); assert.equal(legacy.dark.text, '#EEEEEF')
    assert.equal(legacy.light.panel, MATCHBOOK_COLORS.light.panel); assert.equal(legacy.link, MATCHBOOK_COLORS.link)
    assert.equal(legacyThemeColors(null), null); assert.equal(legacyThemeColors({}), null)
    assert.equal(storedThemeUnreadable({ playerTheme: { primary: '#123456' } }), true)
    assert.equal(storedThemeUnreadable({ playerTheme: null }), false); assert.equal(storedThemeUnreadable({}), false)
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
