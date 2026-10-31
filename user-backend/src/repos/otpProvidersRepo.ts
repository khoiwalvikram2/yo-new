import { desc, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { otpProviders } from '@shared/db/schema.js'
import { decrypt } from '@shared/security/cryptoVault.js'

export type ActiveOtpProvider =
  | {
      provider: 'TWILIO'
      accountSid: string
      authToken: string
      senderId?: string | null
    }
  | {
      provider: 'AWS_SNS'
      accessKey: string
      secretKey: string
      region?: string | null
    }
  | {
      provider: 'MSG91'
      apiKey: string
      senderId?: string | null
      templateId?: string | null
      baseUrl?: string | null
    }
  | {
      provider: 'TWO_FACTOR'
      apiKey: string
      apiSecret?: string | null
      senderId?: string | null
      templateId?: string | null
      baseUrl?: string | null
    }

function decryptNullable(value?: string | null) {
  if (!value) return null
  
  // Check if value looks encrypted (format: iv:tag:encrypted with 3 parts)
  const isEncryptedFormat = value.includes(':') && value.split(':').length === 3
  
  try {
    const decrypted = decrypt(value)
    // Verify decryption worked - encrypted values are usually longer and contain special chars
    // Decrypted API keys are usually shorter alphanumeric strings
    if (decrypted && decrypted.length < 200 && !decrypted.includes(':')) {
      return decrypted
    }
    // If decrypted value still looks encrypted, decryption might have failed silently
    throw new Error('Decryption produced invalid result')
  } catch (error: any) {
    if (isEncryptedFormat) {
      // If it's clearly encrypted format but decryption failed, this is an error
      throw new Error(`Cannot decrypt OTP provider credentials: ${error?.message}. Ensure encryption keys match between admin and user backends.`)
    }
    // Value might already be plain text (local/dev), so return it
    return value
  }
}

export async function getActiveOtpProvider(tenant: string): Promise<ActiveOtpProvider | null> {
  // OTP provider is shared across all tenants - no tenant filter
  const otpTable = otpProviders as any
  const row = await (db as any)
    .select()
    .from(otpTable)
    .where(eq(otpTable.active, true))
    .orderBy(desc(otpTable.priority), desc(otpTable.updatedAt))
    .limit(1)
    .then((rows: any[]) => rows[0])

  if (!row) {
    return null
  }

  switch (row.provider) {
    case 'TWILIO':
      return {
        provider: 'TWILIO',
        accountSid: decryptNullable(row.accountSid) ?? '',
        authToken: decryptNullable(row.authToken) ?? '',
        senderId: row.senderId,
      }
    case 'AWS_SNS':
      return {
        provider: 'AWS_SNS',
        accessKey: decryptNullable(row.accessKey) ?? '',
        secretKey: decryptNullable(row.secretKey) ?? '',
        region: row.region,
      }
    case 'MSG91':
      return {
        provider: 'MSG91',
        apiKey: decryptNullable(row.apiKey) ?? '',
        senderId: row.senderId,
        templateId: row.templateId,
        baseUrl: row.baseUrl,
      }
    case 'TWO_FACTOR':
      const decryptedApiKey = decryptNullable(row.apiKey) ?? ''
      const decryptedApiSecret = decryptNullable(row.apiSecret)
      // Debug: log first few chars to verify decryption (don't log full key)
      if (decryptedApiKey) {
      }
      return {
        provider: 'TWO_FACTOR',
        apiKey: decryptedApiKey,
        apiSecret: decryptedApiSecret,
        senderId: row.senderId,
        templateId: row.templateId,
        baseUrl: row.baseUrl,
      }
    default:
      return null
  }
}

