import { db } from '@/db/client.js'
import { otpProviders, type otpProviderEnum } from '@/db/schema.js'
import { and, desc, eq } from 'drizzle-orm'
import { encrypt, decrypt, maskCredential } from '@shared/security/cryptoVault.js'

export type OtpProvider = typeof otpProviders.$inferSelect
export type OtpProviderInput = {
  tenant: string
  provider: (typeof otpProviderEnum.enumValues)[number]
  accountSid?: string | null
  authToken?: string | null
  accessKey?: string | null
  secretKey?: string | null
  region?: string | null
  senderId?: string | null
  templateId?: string | null
  apiKey?: string | null
  apiSecret?: string | null
  baseUrl?: string | null
  active?: boolean
  priority?: number
}

function formatString(value?: string | null) {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function nextSecret(value: string | null | undefined, existing?: string | null) {
  const formatted = formatString(value)
  if (formatted === undefined) {
    return existing ?? null
  }
  if (formatted === null) {
    return null
  }
  return encrypt(formatted)
}

function nextPlain(value: string | null | undefined, existing?: string | null) {
  const formatted = formatString(value)
  if (formatted === undefined) {
    return existing ?? null
  }
  return formatted
}

function nextNumber(value: number | null | undefined, existing?: number | null, fallback = 0) {
  if (value === undefined || value === null) {
    return existing ?? fallback
  }
  return value
}

function nextBoolean(value: boolean | undefined, existing?: boolean | null, fallback = false) {
  if (value === undefined) {
    return existing ?? fallback
  }
  return value
}

function decryptNullable(value?: string | null) {
  return value ? decrypt(value) : null
}

export async function listOtpProviders(tenant: string) {
  const rows = await db
    .select()
    .from(otpProviders)
    .where(eq(otpProviders.tenant, tenant))
    .orderBy(desc(otpProviders.active), desc(otpProviders.priority), desc(otpProviders.updatedAt))

  return rows.map((r) => ({
    ...r,
    authToken: undefined,
    secretKey: undefined,
    apiSecret: undefined,
    accountSidMasked: maskCredential(decryptNullable(r.accountSid)),
    accessKeyMasked: maskCredential(decryptNullable(r.accessKey)),
    authTokenMasked: maskCredential(decryptNullable(r.authToken)),
    secretKeyMasked: maskCredential(decryptNullable(r.secretKey)),
    apiKeyMasked: maskCredential(decryptNullable(r.apiKey)),
    apiSecretMasked: maskCredential(decryptNullable(r.apiSecret)),
  }))
}

export async function upsertOtpProvider(input: OtpProviderInput) {
  const now = new Date()

  const existing = await db
    .select()
    .from(otpProviders)
    .where(and(eq(otpProviders.tenant, input.tenant), eq(otpProviders.provider, input.provider)))

  const current = existing[0]

  const payload = {
    accountSid: nextSecret(input.accountSid, current?.accountSid),
    authToken: nextSecret(input.authToken, current?.authToken),
    accessKey: nextSecret(input.accessKey, current?.accessKey),
    secretKey: nextSecret(input.secretKey, current?.secretKey),
    apiKey: nextSecret(input.apiKey, current?.apiKey),
    apiSecret: nextSecret(input.apiSecret, current?.apiSecret),
    region: nextPlain(input.region, current?.region),
    senderId: nextPlain(input.senderId, current?.senderId),
    templateId: nextPlain(input.templateId, current?.templateId),
    baseUrl: nextPlain(input.baseUrl, current?.baseUrl),
    active: nextBoolean(input.active, current?.active, false),
    priority: nextNumber(input.priority, current?.priority ?? 0, 0),
    updatedAt: now,
  }

  if (payload.active) {
    await db.update(otpProviders).set({ active: false, updatedAt: now }).where(eq(otpProviders.tenant, input.tenant))
  }

  if (current) {
    await db.update(otpProviders).set(payload).where(eq(otpProviders.id, current.id))
  } else {
    await db.insert(otpProviders).values({
      tenant: input.tenant,
      provider: input.provider,
      ...payload,
      createdAt: now,
    })
  }

  return { success: true, message: current ? 'OTP provider updated' : 'OTP provider added' }
}

export async function getActiveOtpProvider(tenant: string) {
  const row = await db
    .select()
    .from(otpProviders)
    .where(and(eq(otpProviders.tenant, tenant), eq(otpProviders.active, true)))
    .orderBy(desc(otpProviders.priority), desc(otpProviders.updatedAt))
    .limit(1)
    .then((r) => r[0])

  if (!row) return null

  return {
    ...row,
    accountSid: decryptNullable(row.accountSid),
    authToken: decryptNullable(row.authToken),
    accessKey: decryptNullable(row.accessKey),
    secretKey: decryptNullable(row.secretKey),
    apiKey: decryptNullable(row.apiKey),
    apiSecret: decryptNullable(row.apiSecret),
  }
}

