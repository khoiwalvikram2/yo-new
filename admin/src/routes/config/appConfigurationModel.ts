import { z } from 'zod'
import defaults from './appConfigurationDefaults.json'
import { normalizeHex } from '../../../../shared/src/theme/color'
import {
  CUSTOM_PRESET_ID, MATCHBOOK_COLORS, MATCHBOOK_PRESET_ID, normalizePlayerThemeColors, playerThemeErrors, playerThemeSchema,
  resolvePlayerTheme, type ModeColors, type PlayerTheme, type PlayerThemeColors,
} from '../../../../shared/src/theme/playerTheme'
import { SPORTS_ICON_STYLES, type SportsIconStyle } from '../../../../shared/src/theme/sportsIcons'

export type ConfigRecord = Record<string, unknown>
export type ConfigValue = string | number | boolean | null | undefined | string[]
export type SectionValues = Record<string, ConfigValue>
export type ConfigTab = 'branding' | 'general' | 'contact' | 'features' | 'seo' | 'news' | 'analytics' | 'webhooks' | 'observability' | 'payments' | 'risk' | 'notify' | 'admin-notify' | 'maintenance' | 'pwa'
export interface ConfigField {
  name: string
  label: string
  kind?: 'text' | 'textarea' | 'number' | 'switch' | 'select' | 'search-select' | 'password' | 'recipients' | 'color'
  options?: readonly { value: string; label: string }[]
  placeholder?: string
  help?: string
  defaultValue?: ConfigValue
  min?: number
  max?: number
  step?: number
  precision?: number
  maxLength?: number
  required?: boolean
  validation?: 'email' | 'url'
}
export interface ConfigSection { title: string; sub?: string; fields: readonly ConfigField[] }
export interface ConfigDefinition { saveText: string; sections: readonly ConfigSection[]; namespace?: string }

const choices = (values: readonly string[]) => values.map((value) => ({ value, label: value }))
const choiceLabels = (values: ReadonlyArray<readonly [string, string]>) => values.map(([value, label]) => ({ value, label }))
const numeric = (name: string, label: string, placeholder: string, min = 0): ConfigField => ({ name, label, kind: 'number', placeholder, min })
const toggle = (name: string, label: string, defaultValue?: boolean, help?: string): ConfigField => ({ name, label, kind: 'switch', defaultValue, help })

export const CONFIG_MENU: ReadonlyArray<{ group: string; items: ReadonlyArray<{ key: ConfigTab; label: string }> }> = [
  { group: 'Identity', items: [{ key: 'branding', label: 'Branding & Theme' }, { key: 'general', label: 'General Settings' }, { key: 'contact', label: 'Contact Settings' }] },
  { group: 'Content', items: [{ key: 'features', label: 'Feature Toggles' }, { key: 'seo', label: 'SEO & Social' }, { key: 'news', label: 'News Ticker' }] },
  { group: 'Integrations', items: [{ key: 'analytics', label: 'Analytics' }, { key: 'webhooks', label: 'Webhooks' }, { key: 'observability', label: 'Observability' }] },
  { group: 'Operations', items: [{ key: 'payments', label: 'Payments & KYC' }, { key: 'risk', label: 'Risk & Limits' }, { key: 'notify', label: 'Email & SMS' }, { key: 'admin-notify', label: 'Admin Notifications' }] },
  { group: 'System', items: [{ key: 'maintenance', label: 'Maintenance' }, { key: 'pwa', label: 'PWA Settings' }] },
]

// These are persisted USER-PANEL configuration values, not admin UI paint. They match the old
// settings' defaults verbatim. Only native color control values and GraphQL payloads consume them.
export const DEFAULT_THEME_COLORS = defaults.theme
export const INITIAL_PRIMARY = defaults.initialPrimary
export const PWA_DEFAULTS = defaults.pwa

export const CONFIG_DEFINITIONS: Record<Exclude<ConfigTab, 'branding'>, ConfigDefinition> = {
  general: { saveText: 'Save Platform Settings', sections: [{ title: 'Platform Settings', fields: [
    { name: 'defaultLocale', label: 'Default Locale', kind: 'select', placeholder: 'Select locale', options: choiceLabels([['en', 'English'], ['hi', 'Hindi'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German']]) },
    { name: 'timeZone', label: 'Time Zone', kind: 'search-select', placeholder: 'Select timezone', options: choiceLabels([['Asia/Kolkata', 'Asia/Kolkata (IST)'], ['America/New_York', 'America/New_York (EST)'], ['Europe/London', 'Europe/London (GMT)'], ['Asia/Dubai', 'Asia/Dubai (GST)'], ['Australia/Sydney', 'Australia/Sydney (AEDT)']]) },
    { name: 'baseCurrency', label: 'Base Currency', kind: 'select', required: true, placeholder: 'Select currency', options: choiceLabels([['INR', 'INR - Indian Rupee'], ['USD', 'USD - US Dollar'], ['EUR', 'EUR - Euro'], ['GBP', 'GBP - British Pound'], ['AUD', 'AUD - Australian Dollar'], ['CAD', 'CAD - Canadian Dollar']]) },
  ] }] },
  contact: { saveText: 'Save Contact Settings', sections: [{ title: 'Contact Information', fields: [
    { name: 'supportEmail', label: 'Support Email', validation: 'email', placeholder: 'support@example.com' },
    { name: 'supportPhone', label: 'Support Phone Number', placeholder: '+91 12345 67890' },
    { name: 'whatsappSupportPhone', label: 'WhatsApp Support Number', placeholder: '+91 98765 43210' },
  ] }] },
  features: { namespace: 'features', saveText: 'Save Feature Toggles', sections: [{ title: 'Module Enablement', fields: [
    toggle('sportsEnabled', 'Sports Exchange', true, 'Enable sports betting markets'), toggle('casinoEnabled', 'Casino', true, 'Enable casino games'), toggle('matkaEnabled', 'Matka', true, 'Enable matka draws'), toggle('agentsEnabled', 'Agents', true, 'Enable agent hierarchy'), toggle('referralsEnabled', 'Referrals', true, 'Enable referral system'), toggle('bonusesEnabled', 'Bonuses', true, 'Enable bonus campaigns'), toggle('registerEnabled', 'User Registration', true, 'Show the register option in the user panel'),
  ] }] },
  seo: { saveText: 'Save SEO & Social', sections: [
    { title: 'App Identity', fields: [{ name: 'appName', label: 'App Name', placeholder: 'e.g. GrandWinn', help: 'Shown across the user app (login/register, titles, etc.). Leave blank to display no app name anywhere on the user site.' }] },
    { title: 'SEO Settings', fields: [{ name: 'seoTitle', label: 'Default SEO Title', placeholder: 'My Gaming Platform - Best Online Casino' }, { name: 'ogImageUrl', label: 'OpenGraph Image URL', placeholder: 'https://example.com/og-image.jpg' }, { name: 'seoDescription', label: 'Default SEO Description', kind: 'textarea', placeholder: 'Your one-stop destination for sports betting, casino games, and more...' }] },
    { title: 'Social Media Links', fields: [
      { name: 'twitter', label: 'Twitter', placeholder: 'https://twitter.com/yourhandle' }, { name: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/yourpage' }, { name: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/yourprofile' }, { name: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/yourchannel' }, { name: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/company/yourcompany' }, { name: 'telegram', label: 'Telegram', placeholder: 'https://t.me/yourchannel' },
    ] },
  ] },
  analytics: { namespace: 'analytics', saveText: 'Save Analytics', sections: [{ title: 'Analytics Integration', fields: [
    { name: 'gtmId', label: 'Google Tag Manager ID', placeholder: 'GTM-XXXXXXX' }, { name: 'ga4Id', label: 'Google Analytics 4 ID', placeholder: 'G-XXXXXXXXXX' }, { name: 'metaPixelId', label: 'Meta Pixel ID', placeholder: '123456789012345' }, { name: 'mixpanelId', label: 'Mixpanel Project ID', placeholder: 'abc123def456' }, { name: 'amplitudeApiKey', label: 'Amplitude API Key', placeholder: 'Enter Amplitude API key' },
  ] }] },
  payments: { namespace: 'payments', saveText: 'Save Payments & KYC', sections: [
    { title: 'Deposit & Withdrawal Limits', fields: [numeric('depositMin', 'Min Deposit', '100'), numeric('depositMax', 'Max Deposit', '100000'), numeric('withdrawalMin', 'Min Withdrawal', '500'), numeric('withdrawalMax', 'Max Withdrawal', '50000'), { ...numeric('maxDailyWithdrawalRequests', 'Max Daily Withdrawal Requests', 'Unlimited', 1), precision: 0, help: 'Maximum payout requests a user can raise per calendar day (whitelabel timezone). Leave empty for unlimited.' }] },
    { title: 'Fees & Policies', fields: [{ ...numeric('depositFeePercent', 'Deposit Fee %', '0'), max: 100, step: 0.1 }, { ...numeric('withdrawalFeePercent', 'Withdrawal Fee %', '0'), max: 100, step: 0.1 }, { name: 'roundingStrategy', label: 'Rounding Strategy', kind: 'select', placeholder: 'Select', options: choiceLabels([['round', 'Round'], ['ceil', 'Ceil'], ['floor', 'Floor']]) }, toggle('kycRequiredToWithdraw', 'Require KYC for Withdrawals')] },
    { title: 'Withdrawal payment methods (user panel)', sub: 'Control whether users can add UPI or bank payout accounts and whether existing accounts of each type can be used for withdrawals. Changes apply per whitelabel.', fields: [
      toggle('upiPayoutsDisabled', 'Disable all UPI payouts', false, 'Users cannot withdraw to UPI; existing UPI accounts appear disabled in the user panel.'), toggle('bankPayoutsDisabled', 'Disable all bank payouts', false, 'Users cannot withdraw to bank; existing bank accounts appear disabled in the user panel.'), toggle('hideAddUpi', 'Hide Add UPI', false, 'Hides the Add UPI action in the user withdrawal accounts tab.'), toggle('hideAddBank', 'Hide Add bank account', false, 'Hides the Add Account (bank) action in the user withdrawal accounts tab.'),
    ] },
  ] },
  risk: { namespace: 'risk', saveText: 'Save Risk Settings', sections: [{ title: 'Risk Management Defaults', fields: [numeric('overallExposureCap', 'Overall Exposure Cap', '1000000'), numeric('dailyStakeLimit', 'Daily Stake Limit', '50000'), numeric('weeklyStakeLimit', 'Weekly Stake Limit', '200000'), toggle('cashoutEnabled', 'Enable Cashout')] }] },
  notify: { namespace: 'notifications', saveText: 'Save Notifications', sections: [{ title: 'Email (SMTP)', fields: [
    { name: 'smtpHost', label: 'SMTP Host', placeholder: 'smtp.gmail.com' }, { name: 'smtpPort', label: 'SMTP Port', kind: 'number', placeholder: '587' }, { name: 'smtpUsername', label: 'Username', placeholder: 'your-email@example.com' }, { name: 'smtpPassword', label: 'Password', kind: 'password', placeholder: 'Enter new password', help: 'Leave empty to keep existing' }, { name: 'smtpFromEmail', label: 'From Email', placeholder: 'noreply@example.com' }, { name: 'smtpAlertRecipients', label: 'Alert Recipients', kind: 'recipients', help: 'Admins who should receive critical risk alerts (Enter & press Enter/Comma)', placeholder: 'ops@example.com', defaultValue: [] },
  ] }] },
  'admin-notify': { namespace: 'adminUiNotifications', saveText: 'Save Preferences', sections: [
    { title: 'Admin Notification Preferences', fields: [{ name: 'placement', label: 'Placement', kind: 'select', defaultValue: 'topRight', options: choiceLabels([['topLeft', 'Top Left'], ['topRight', 'Top Right'], ['bottomLeft', 'Bottom Left'], ['bottomRight', 'Bottom Right']]) }, { ...numeric('durationMs', 'Duration (ms)', '4500', 1000), max: 10000, defaultValue: 4500 }, toggle('soundEnabled', 'Sound Enabled', false)] },
    { title: 'Notification Types', fields: [toggle('showSuccess', 'Success', true), toggle('showError', 'Error', true), toggle('showInfo', 'Info', true), toggle('showWarning', 'Warning', true)] },
  ] },
  webhooks: { namespace: 'webhooks', saveText: 'Save Webhooks', sections: [{ title: 'Webhook Configuration', fields: [
    { name: 'endpointUrl', label: 'Endpoint URL', placeholder: 'https://your-webhook-endpoint.com/webhook', validation: 'url' }, { name: 'secret', label: 'Signing Secret', kind: 'password', placeholder: 'Enter new secret', help: 'Leave empty to keep existing' }, { name: 'events', label: 'Subscribed Events (comma-separated)', kind: 'textarea', placeholder: 'user.created, bet.placed, withdrawal.requested, deposit.completed' },
  ] }] },
  observability: { namespace: 'observability', saveText: 'Save Observability', sections: [{ title: 'Logging & Monitoring', fields: [{ name: 'sentryDsn', label: 'Sentry DSN', placeholder: 'https://xxxxx@sentry.io/xxxxx' }, { name: 'logLevel', label: 'Log Level', kind: 'select', defaultValue: 'info', options: choices(['debug', 'info', 'warn', 'error']) }, toggle('metricsEnabled', 'Enable Metrics Collection', true)] }] },
  maintenance: { saveText: 'Save Maintenance Settings', sections: [{ title: 'Maintenance Mode', fields: [toggle('maintenance', 'Enable Maintenance Mode', false), { name: 'maintenanceMessage', label: 'Maintenance Message', kind: 'textarea', placeholder: "We are currently performing scheduled maintenance. We'll be back soon!", help: 'Displayed to users when maintenance mode is active' }] }] },
  // Its own tab since 2026-10-29 (it was the last field of Maintenance). The user panel splits it by line.
  news: { saveText: 'Save News Ticker', sections: [{ title: 'News Ticker', sub: 'The News band that scrolls under the user panel header.', fields: [{ name: 'newsTicker', label: 'News Messages', kind: 'textarea', maxLength: 1024, placeholder: 'Welcome to our platform!\nPlay responsibly. 18+ only.', help: 'One message per line; each scrolls as its own item. Leave empty to hide the News band in the user panel.' }] }] },
  pwa: { namespace: 'pwa', saveText: 'Save PWA Settings', sections: [{ title: 'Progressive Web App Settings', fields: [{ name: 'shortName', label: 'Short Name', placeholder: 'MyApp' }, { name: 'themeColor', label: 'Theme Color', kind: 'color', defaultValue: PWA_DEFAULTS.themeColor }, { name: 'backgroundColor', label: 'Background Color', kind: 'color', defaultValue: PWA_DEFAULTS.backgroundColor }] }] },
}

export function record(value: unknown): ConfigRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as ConfigRecord : {} }
export function text(value: unknown): string { return typeof value === 'string' ? value : '' }
export function configRoles(roles: string[]) {
  const first = roles[0] || ''
  return {
    isWhitelabelAdmin: first.toLowerCase() === 'whitelabel admin' || first === 'whitelabel_admin',
    isSuperAdmin: roles.some((role) => role === 'Super Admin' || role.toLowerCase() === 'super_admin' || (role.toLowerCase().includes('super') && role.toLowerCase().includes('admin'))),
  }
}
export function tabVisible(tab: ConfigTab, roles: ReturnType<typeof configRoles>): boolean {
  return roles.isSuperAdmin || !roles.isWhitelabelAdmin || !['general', 'features', 'observability', 'webhooks', 'admin-notify', 'notify', 'pwa'].includes(tab)
}
export function sectionInitialValues(tab: Exclude<ConfigTab, 'branding'>, config: ConfigRecord, whitelabel: ConfigRecord): SectionValues {
  const definition = CONFIG_DEFINITIONS[tab]
  const source = definition.namespace ? record(config[definition.namespace]) : config
  const values: SectionValues = {}
  for (const field of definition.sections.flatMap((section) => section.fields)) {
    const value = source[field.name]
    values[field.name] = value === undefined ? field.defaultValue : value as ConfigValue
  }
  if (tab === 'general' || tab === 'contact') for (const key of Object.keys(values)) values[key] = values[key] || undefined
  if (tab === 'seo') {
    values.appName = text(whitelabel.name)
    for (const key of ['seoTitle', 'seoDescription', 'ogImageUrl']) values[key] = text(config[key])
    for (const key of ['twitter', 'facebook', 'instagram', 'youtube', 'linkedin', 'telegram']) values[key] = text(record(config.socialLinks)[key])
  }
  if (tab === 'payments') {
    for (const key of ['upiPayoutsDisabled', 'bankPayoutsDisabled', 'hideAddUpi', 'hideAddBank']) values[key] = Boolean(source[key])
    values.maxDailyWithdrawalRequests = source.maxDailyWithdrawalRequests != null && Number(source.maxDailyWithdrawalRequests) > 0 ? Number(source.maxDailyWithdrawalRequests) : undefined
  }
  if (tab === 'notify') {
    values.smtpHost = source.host as ConfigValue; values.smtpPort = source.port as ConfigValue; values.smtpUsername = source.username as ConfigValue
    values.smtpPassword = undefined; values.smtpFromEmail = source.fromEmail as ConfigValue; values.smtpAlertRecipients = (source.alertRecipients || []) as string[]
  }
  if (tab === 'webhooks') values.events = Array.isArray(source.events) ? source.events.join(', ') : undefined
  return values
}
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Keep the former Antd field validator's URL/email acceptance (including // and www. URLs),
// without keeping its transitive package when the legacy UI is removed.
// Derived from @rc-component/async-validator (MIT), Copyright (c) 2014-present yiminghe.
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software
// and associated documentation files (the "Software"), to deal in the Software without restriction,
// including without limitation the rights to use, copy, modify, merge, publish, distribute,
// sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions: The above copyright notice and this
// permission notice shall be included in all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
// BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
const SETTINGS_URL = new RegExp("(?:^(?:(?:(?:[a-z]+:)?\\/\\/)|www\\.)(?:\\S+(?::\\S*)?@)?(?:localhost|(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}|(?:(?:[a-fA-F\\d]{1,4}:){7}(?:[a-fA-F\\d]{1,4}|:)|(?:[a-fA-F\\d]{1,4}:){6}(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}|:[a-fA-F\\d]{1,4}|:)|(?:[a-fA-F\\d]{1,4}:){5}(?::(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}|(?::[a-fA-F\\d]{1,4}){1,2}|:)|(?:[a-fA-F\\d]{1,4}:){4}(?:(?::[a-fA-F\\d]{1,4}){0,1}:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}|(?::[a-fA-F\\d]{1,4}){1,3}|:)|(?:[a-fA-F\\d]{1,4}:){3}(?:(?::[a-fA-F\\d]{1,4}){0,2}:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}|(?::[a-fA-F\\d]{1,4}){1,4}|:)|(?:[a-fA-F\\d]{1,4}:){2}(?:(?::[a-fA-F\\d]{1,4}){0,3}:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}|(?::[a-fA-F\\d]{1,4}){1,5}|:)|(?:[a-fA-F\\d]{1,4}:){1}(?:(?::[a-fA-F\\d]{1,4}){0,4}:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}|(?::[a-fA-F\\d]{1,4}){1,6}|:)|(?::(?:(?::[a-fA-F\\d]{1,4}){0,5}:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}|(?::[a-fA-F\\d]{1,4}){1,7}|:)))(?:%[0-9a-zA-Z]{1,})?|(?:(?:[a-z\\u00a1-\\uffff0-9][-_]*)*[a-z\\u00a1-\\uffff0-9]+)(?:\\.(?:[a-z\\u00a1-\\uffff0-9]-*)*[a-z\\u00a1-\\uffff0-9]+)*(?:\\.(?:[a-z\\u00a1-\\uffff]{2,})))(?::\\d{2,5})?(?:[/?#][^\\s\"]*)?$)", 'i')
const SETTINGS_EMAIL = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@(([[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+\.)+[a-zA-Z\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]{2,}))$/
export function settingsUrlValid(value: string): boolean { return value.length <= 2048 && SETTINGS_URL.test(value) }
export function settingsEmailValid(value: string): boolean { return value.length <= 320 && SETTINGS_EMAIL.test(value) }
export function configurationColorValid(value: string): boolean {
  if (!value.trim()) return false
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') return CSS.supports('color', value)
  // jsdom lacks CSS.supports; its native CSS declaration parser retains only valid colors.
  if (typeof document !== 'undefined') { const probe = document.createElement('span').style; probe.color = value; return probe.color !== '' }
  return false
}

export function sectionSchema(tab: Exclude<ConfigTab, 'branding'>) {
  return z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined(), z.array(z.string())])).superRefine((values, context) => {
    for (const field of CONFIG_DEFINITIONS[tab].sections.flatMap((section) => section.fields)) {
      const value = values[field.name]
      let message: string | undefined
      if (field.required && !value) message = `Please select ${field.label.toLowerCase()}`
      if (field.validation === 'email' && value && !settingsEmailValid(text(value))) message = 'Please enter a valid email'
      if (field.validation === 'url' && value && !settingsUrlValid(text(value))) message = 'Please enter a valid URL'
      if (field.kind === 'color' && value && !configurationColorValid(text(value))) message = 'Please enter a valid color'
      if (field.kind === 'recipients' && Array.isArray(value)) {
        const invalid = value.find((email) => !EMAIL_REGEX.test(email.trim()))
        if (invalid) message = `Invalid email: ${invalid}`
      }
      if (message) context.addIssue({ code: 'custom', path: [field.name], message })
    }
  })
}
export function sectionPayload(tab: Exclude<ConfigTab, 'branding'>, values: SectionValues): ConfigRecord {
  if (tab === 'seo') return {
    seoTitle: values.seoTitle || null, seoDescription: values.seoDescription || null, ogImageUrl: values.ogImageUrl || null,
    socialLinks: Object.fromEntries(['twitter', 'facebook', 'instagram', 'youtube', 'linkedin', 'telegram'].map((key) => [key, values[key] || null])),
  }
  if (tab === 'notify') return { notifications: {
    host: values.smtpHost, port: values.smtpPort, username: values.smtpUsername, password: values.smtpPassword, fromEmail: values.smtpFromEmail,
    alertRecipients: Array.isArray(values.smtpAlertRecipients) ? [...new Set(values.smtpAlertRecipients.map((email) => email.trim()).filter(Boolean))] : [],
  } }
  if (tab === 'webhooks') return { webhooks: { endpointUrl: values.endpointUrl, secret: values.secret, events: values.events ? text(values.events).split(',').map((event) => event.trim()) : [] } }
  if (tab === 'payments') return { payments: { ...values, maxDailyWithdrawalRequests: values.maxDailyWithdrawalRequests != null && Number(values.maxDailyWithdrawalRequests) > 0 ? Math.floor(Number(values.maxDailyWithdrawalRequests)) : null } }
  const namespace = CONFIG_DEFINITIONS[tab].namespace
  return namespace ? { [namespace]: values } : values
}

/** The Branding & Theme form: logo and favicon (whitelabel) plus the player theme (app config `playerTheme`). */
export interface BrandingValues {
  logoUrl: string | null
  faviconUrl: string | null
  presetId: string
  sportsIconStyle: SportsIconStyle
  action: string
  link: string
  chrome: string
  light: ModeColors
  dark: ModeColors
}
type BrandingColorValues = Pick<BrandingValues, 'action' | 'link' | 'chrome' | 'light' | 'dark'>

export function brandingColorValues(colors: PlayerThemeColors): BrandingColorValues {
  return { action: colors.action, link: colors.link, chrome: colors.chrome, light: { ...colors.light }, dark: { ...colors.dark } }
}
export function brandingColors(values: BrandingColorValues): PlayerThemeColors {
  return { action: values.action, link: values.link, chrome: values.chrome, light: { ...values.light }, dark: { ...values.dark } }
}

/** The editor opens on what players see now: the stored theme, else Matchbook (legacy colours are never applied here). */
export function brandingInitialValues(whitelabel: ConfigRecord, config: ConfigRecord): BrandingValues {
  const theme = resolvePlayerTheme(config.playerTheme)
  return {
    logoUrl: text(whitelabel.logoUrl) || null,
    faviconUrl: text(whitelabel.faviconUrl) || null,
    presetId: theme?.colors ? theme.presetId ?? CUSTOM_PRESET_ID : MATCHBOOK_PRESET_ID,
    sportsIconStyle: theme?.sportsIconStyle ?? 'default',
    ...brandingColorValues(theme?.colors ?? MATCHBOOK_COLORS),
  }
}

/** What Save sends as `playerTheme`. */
export function brandingThemeInput(values: BrandingValues): PlayerTheme {
  return { presetId: values.presetId, sportsIconStyle: values.sportsIconStyle, colors: normalizePlayerThemeColors(brandingColors(values)) }
}

/** A stored `playerTheme` the schema refuses: players get Matchbook, and saving replaces it. */
export function storedThemeUnreadable(config: ConfigRecord): boolean {
  return config.playerTheme != null && !playerThemeSchema.safeParse(config.playerTheme).success
}

/** Colours the old editor saved (app config `theme`), mapped onto the key colours; null when it saved none. */
export function legacyThemeColors(value: unknown): PlayerThemeColors | null {
  const theme = record(value)
  const action = normalizeHex(theme.primary)
  const hasMode = (name: 'light' | 'dark') => Object.keys(record(theme[name])).length > 0
  if (!action && !hasMode('light') && !hasMode('dark')) return null
  const mode = (name: 'light' | 'dark'): ModeColors => {
    const stored = record(theme[name])
    const base = MATCHBOOK_COLORS[name]
    return { page: normalizeHex(stored.bgPage) ?? base.page, panel: base.panel, text: normalizeHex(stored.textPrimary) ?? base.text, line: normalizeHex(stored.border) ?? base.line }
  }
  return { action: action ?? MATCHBOOK_COLORS.action, link: MATCHBOOK_COLORS.link, chrome: MATCHBOOK_COLORS.chrome, light: mode('light'), dark: mode('dark') }
}

const brandColor = z.string().superRefine((value, context) => {
  if (!value.trim()) context.addIssue({ code: 'custom', message: 'Please choose a color' })
  else if (!normalizeHex(value)) context.addIssue({ code: 'custom', message: 'Use a hex color such as #C51A1B' })
})
const modeColorFields = z.object({ page: brandColor, panel: brandColor, text: brandColor, line: brandColor })
/** Field checks, then the shared readability rules on the whole palette (errors land on their field paths). */
export const brandingSchema = z.object({
  logoUrl: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  presetId: z.string(),
  sportsIconStyle: z.enum(SPORTS_ICON_STYLES),
  action: brandColor, link: brandColor, chrome: brandColor,
  light: modeColorFields, dark: modeColorFields,
}).superRefine((values, context) => {
  const colors = normalizePlayerThemeColors(brandingColors(values))
  const all = [colors.action, colors.link, colors.chrome, ...Object.values(colors.light), ...Object.values(colors.dark)]
  if (all.some((color) => !normalizeHex(color))) return
  for (const [path, message] of Object.entries(playerThemeErrors(colors))) context.addIssue({ code: 'custom', path: path.split('.'), message })
})
export function errorMessage(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback }
