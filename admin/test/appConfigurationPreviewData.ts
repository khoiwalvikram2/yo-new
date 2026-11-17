import type { FetchResult, Operation } from '@apollo/client'
import type { SelectionSetNode } from 'graphql'
function complete(selection: SelectionSetNode, value: unknown): unknown {
  if (value == null) return null
  if (Array.isArray(value)) return value.map((item) => complete(selection, item))
  const source = value as Record<string, unknown>
  return Object.fromEntries(selection.selections.filter((node) => node.kind === 'Field').map((field) => {
    const key = field.alias?.value || field.name.value
    const raw = field.name.value === '__typename' ? source[key] || 'ConfigurationFixture' : source[key] ?? null
    return [key, field.selectionSet ? complete(field.selectionSet, raw) : raw]
  }))
}
export const CONFIG_ASSET = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="240" height="90"%3E%3Ctext x="12" y="48"%3EPreview brand%3C/text%3E%3C/svg%3E'
export const CONFIG_PREVIEW_DATA = {
  defaultLocale: 'en', timeZone: 'Asia/Kolkata', baseCurrency: 'INR', supportEmail: 'help@example.test', supportPhone: '+91 90000 00000', whatsappSupportPhone: '+91 90000 00001',
  seoTitle: 'Preview title', seoDescription: 'Preview SEO description', ogImageUrl: 'https://example.test/og.png', socialLinks: { twitter: 'https://example.test/social' },
  features: { sportsEnabled: true, casinoEnabled: true, matkaEnabled: true, agentsEnabled: true, referralsEnabled: true, bonusesEnabled: true, registerEnabled: true },
  analytics: { gtmId: 'GTM-PREVIEW', ga4Id: 'G-PREVIEW', metaPixelId: '100', mixpanelId: 'preview', amplitudeApiKey: 'preview-key' },
  payments: { depositMin: 100, depositMax: 100000, withdrawalMin: 500, withdrawalMax: 50000, depositFeePercent: 0, withdrawalFeePercent: 0.5, kycRequiredToWithdraw: true, roundingStrategy: 'round', upiPayoutsDisabled: false, bankPayoutsDisabled: false, hideAddUpi: false, hideAddBank: false, maxDailyWithdrawalRequests: 3 },
  risk: { overallExposureCap: 1000000, dailyStakeLimit: 50000, weeklyStakeLimit: 200000, cashoutEnabled: true },
  notifications: { host: 'smtp.example.test', port: 587, username: 'preview', fromEmail: 'noreply@example.test', alertRecipients: ['ops@example.test'] },
  adminUiNotifications: { enabled: true, placement: 'topRight', durationMs: 4500, showSuccess: true, showError: true, showInfo: true, showWarning: true, muteCategories: [], soundEnabled: false },
  webhooks: { endpointUrl: 'https://example.test/webhook', events: ['bet.placed', 'deposit.completed'] }, observability: { sentryDsn: 'https://example.test/monitor', logLevel: 'info', metricsEnabled: true },
  maintenance: false, maintenanceMessage: 'Scheduled maintenance', newsTicker: 'Welcome to the preview', pwa: { shortName: 'Preview', themeColor: '#1945ab', backgroundColor: '#fcfcfc' },
  theme: { primary: '#123456', success: '#147852', warning: '#af5700', danger: '#d41111', dark: { bgPage: '#111112', textPrimary: '#eeeeef', textSecondary: '#a2a2a3', border: '#343435' }, light: { bgPage: '#fafafb', textPrimary: '#171718', textSecondary: '#626263', border: '#e3e3e4' } },
  preLoginBannerUrl: CONFIG_ASSET, postLoginBannerUrl: CONFIG_ASSET,
}
export interface ConfigFixtureOptions { refused?: boolean; appNameRefused?: boolean; configFailure?: boolean; playerTheme?: unknown }
export function appConfigurationResponse(operation: Operation, options: ConfigFixtureOptions = {}): FetchResult {
  let result: Record<string, unknown>
  const tenant = (id: string) => ({ id, name: 'Preview partner with a long descriptive name', domain: 'preview.example.test', logoUrl: CONFIG_ASSET, faviconUrl: CONFIG_ASSET, theme: CONFIG_PREVIEW_DATA.theme })
  switch (operation.operationName) {
    case 'AppConfig': if (options.configFailure) throw new Error('Preview config unavailable'); result = { appConfig: { ...CONFIG_PREVIEW_DATA, playerTheme: options.playerTheme ?? null } }; break
    case 'WhitelabelCurrent': result = { whitelabelCurrent: tenant('own-tenant') }; break
    case 'GetWhitelabel': result = { whitelabel: tenant(operation.variables.id) }; break
    case 'UpdateAppConfig': result = { updateAppConfig: { success: !options.refused, message: options.refused ? 'Settings refused' : 'Settings saved successfully' } }; break
    case 'UpdateWhitelabel': result = { updateWhitelabel: { success: !options.appNameRefused, message: options.appNameRefused ? 'Name refused' : 'Whitelabel saved', whitelabel: { id: operation.variables.input.id } } }; break
    default: throw new Error(`Unexpected app configuration operation: ${operation.operationName}`)
  }
  const definition = operation.query.definitions.find((node) => node.kind === 'OperationDefinition')
  if (!definition || definition.kind !== 'OperationDefinition') throw new Error('Missing operation')
  return { data: complete(definition.selectionSet, result) as Record<string, unknown> }
}
