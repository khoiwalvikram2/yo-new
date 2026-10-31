import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { parseBaseEnv } from '../validation/env.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

function getEncryptionKey(): Buffer {
  const env = parseBaseEnv()
  if (process.env.PAYMENT_CREDENTIALS_KEY) {
    try {
      return Buffer.from(process.env.PAYMENT_CREDENTIALS_KEY, 'base64')
    } catch {
      throw new Error('PAYMENT_CREDENTIALS_KEY must be valid base64')
    }
  }
  const fallbackSecret = env.JWT_SECRET || process.env.JWT_SECRET || 'dev-secret-change-in-production'
  return scryptSync(fallbackSecret, 'payment-credentials-salt', 32)
}

export function encrypt(plaintext: string): string {
  if (!plaintext) {
    throw new Error('Cannot encrypt empty string')
  }

  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)

  try {
    const cipher = createCipheriv(ALGORITHM, key, iv)
    cipher.setAAD(Buffer.from('otp-provider-credentials', 'utf8'))

    let encrypted = cipher.update(plaintext, 'utf8', 'base64')
    encrypted += cipher.final('base64')
    const tag = cipher.getAuthTag()

    const result = `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted}`
    key.fill(0)
    iv.fill(0)
    return result
  } catch (error) {
    key.fill(0)
    iv.fill(0)
    throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

export function decrypt(encryptedData: string): string {
  if (!encryptedData) {
    throw new Error('Cannot decrypt empty string')
  }

  const parts = encryptedData.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format')
  }

  const [ivBase64, tagBase64, ciphertext] = parts

  let iv: Buffer
  let tag: Buffer

  try {
    iv = Buffer.from(ivBase64, 'base64')
    tag = Buffer.from(tagBase64, 'base64')
  } catch {
    throw new Error('Invalid IV or tag encoding')
  }

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`)
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`Invalid tag length: expected ${TAG_LENGTH}, got ${tag.length}`)
  }

  const key = getEncryptionKey()

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAAD(Buffer.from('otp-provider-credentials', 'utf8'))
    decipher.setAuthTag(tag)

    let decrypted = decipher.update(ciphertext, 'base64', 'utf8')
    decrypted += decipher.final('utf8')

    key.fill(0)
    iv.fill(0)
    tag.fill(0)

    return decrypted
  } catch (error) {
    key.fill(0)
    iv.fill(0)
    tag.fill(0)
    throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Invalid or corrupted data'}`)
  }
}

export function maskCredential(value: string | null | undefined): string {
  if (!value) return '••••••••'
  if (value.length <= 8) return '••••••••'
  return `${value.slice(0, 4)}${'•'.repeat(Math.max(0, value.length - 8))}${value.slice(-4)}`
}

