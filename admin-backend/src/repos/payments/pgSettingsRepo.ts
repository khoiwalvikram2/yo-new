import { eq } from 'drizzle-orm'
import { db } from '@/db/client.js'
import { whitelabelPgSettings } from '@/db/schema.js'
import { encrypt, decrypt, maskCredential } from '@shared/security/cryptoVault.js'
import { generateWebhookToken, buildWebhookUrl } from './pgSettingsTokens.js'

// Re-exported so consumers can keep importing them from the repo module.
export { generateWebhookToken, buildWebhookUrl }

export interface PgSettingsView {
  id: string
  tenant: string
  provider: string
  enabled: boolean
  payinGateway: string
  payoutEnabled: boolean
  payoutGateway: string
  minPayout: number | null
  maxPayout: number | null
  displayName: string
  secretSiteKeyMasked: string | null
  hasSecretSiteKey: boolean
  webhookToken: string
  minDeposit: number | null
  maxDeposit: number | null
  redirectSuccessUrl: string | null
  redirectFailureUrl: string | null
  updatedAt: string
}

function toView(row: typeof whitelabelPgSettings.$inferSelect): PgSettingsView {
  let masked: string | null = null
  if (row.secretSiteKeyEncrypted) {
    try { masked = maskCredential(decrypt(row.secretSiteKeyEncrypted)) } catch { masked = '••••••••' }
  }
  return {
    id: String(row.id),
    tenant: row.tenant,
    provider: row.provider,
    enabled: row.enabled,
    payinGateway: row.payinGateway,
    payoutEnabled: row.payoutEnabled,
    payoutGateway: row.payoutGateway,
    minPayout: row.minPayout != null ? Number(row.minPayout) : null,
    maxPayout: row.maxPayout != null ? Number(row.maxPayout) : null,
    displayName: row.displayName,
    secretSiteKeyMasked: masked,
    hasSecretSiteKey: !!row.secretSiteKeyEncrypted,
    webhookToken: row.webhookToken,
    minDeposit: row.minDeposit != null ? Number(row.minDeposit) : null,
    maxDeposit: row.maxDeposit != null ? Number(row.maxDeposit) : null,
    redirectSuccessUrl: row.redirectSuccessUrl,
    redirectFailureUrl: row.redirectFailureUrl,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Read settings for a tenant, lazily creating a default row (with a fresh token) if absent. */
export async function getOrCreatePgSettings(tenant: string): Promise<PgSettingsView> {
  const [existing] = await db.select().from(whitelabelPgSettings).where(eq(whitelabelPgSettings.tenant, tenant)).limit(1)
  if (existing) return toView(existing)
  // Race-safe: a concurrent first-time call may insert first. onConflictDoNothing makes
  // our insert a no-op in that case; we then re-select the row that won.
  await db.insert(whitelabelPgSettings)
    .values({ tenant, webhookToken: generateWebhookToken() })
    .onConflictDoNothing({ target: whitelabelPgSettings.tenant })
  const [created] = await db.select().from(whitelabelPgSettings).where(eq(whitelabelPgSettings.tenant, tenant)).limit(1)
  if (!created) throw new Error('Failed to create PG settings row')
  return toView(created)
}

/** Decrypted merchant project key for server-side WeLivePay calls; null when not configured. Never return it to a client. */
export async function getPgMerchantKey(tenant: string): Promise<string | null> {
  const [row] = await db.select({ key: whitelabelPgSettings.secretSiteKeyEncrypted }).from(whitelabelPgSettings).where(eq(whitelabelPgSettings.tenant, tenant)).limit(1)
  return row?.key ? decrypt(row.key) : null
}

export interface UpsertPgSettingsInput {
  tenant: string
  enabled?: boolean
  payinGateway?: string
  payoutEnabled?: boolean
  payoutGateway?: string
  minPayout?: number | null
  maxPayout?: number | null
  displayName?: string
  secretSiteKey?: string | null   // plaintext; only update when provided & non-empty
  minDeposit?: number | null
  maxDeposit?: number | null
  redirectSuccessUrl?: string | null
  redirectFailureUrl?: string | null
  updatedByUserId?: string | null
}

export async function upsertPgSettings(input: UpsertPgSettingsInput): Promise<PgSettingsView> {
  await getOrCreatePgSettings(input.tenant) // ensure row + token exist
  const patch: Partial<typeof whitelabelPgSettings.$inferInsert> = { updatedAt: new Date() }
  if (input.enabled !== undefined) patch.enabled = input.enabled
  if (input.payinGateway !== undefined) patch.payinGateway = input.payinGateway
  if (input.payoutEnabled !== undefined) patch.payoutEnabled = input.payoutEnabled
  if (input.payoutGateway !== undefined) patch.payoutGateway = input.payoutGateway
  if (input.minPayout !== undefined) patch.minPayout = input.minPayout == null ? null : String(input.minPayout)
  if (input.maxPayout !== undefined) patch.maxPayout = input.maxPayout == null ? null : String(input.maxPayout)
  if (input.displayName !== undefined) patch.displayName = input.displayName
  if (input.minDeposit !== undefined) patch.minDeposit = input.minDeposit == null ? null : String(input.minDeposit)
  if (input.maxDeposit !== undefined) patch.maxDeposit = input.maxDeposit == null ? null : String(input.maxDeposit)
  if (input.redirectSuccessUrl !== undefined) patch.redirectSuccessUrl = input.redirectSuccessUrl
  if (input.redirectFailureUrl !== undefined) patch.redirectFailureUrl = input.redirectFailureUrl
  if (input.updatedByUserId !== undefined) patch.updatedByUserId = input.updatedByUserId
  if (input.secretSiteKey) patch.secretSiteKeyEncrypted = encrypt(input.secretSiteKey)

  const [updated] = await db.update(whitelabelPgSettings)
    .set(patch).where(eq(whitelabelPgSettings.tenant, input.tenant)).returning()
  if (!updated) throw new Error('PG settings row not found after upsert')
  return toView(updated)
}

export async function regenerateWebhookToken(tenant: string): Promise<PgSettingsView> {
  await getOrCreatePgSettings(tenant)
  const [updated] = await db.update(whitelabelPgSettings)
    .set({ webhookToken: generateWebhookToken(), updatedAt: new Date() })
    .where(eq(whitelabelPgSettings.tenant, tenant)).returning()
  if (!updated) throw new Error('PG settings row not found')
  return toView(updated)
}
