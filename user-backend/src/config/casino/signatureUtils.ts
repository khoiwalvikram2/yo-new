import { createSign, createVerify } from 'crypto'
import fs from 'node:fs'
import path from 'node:path'

const LOG_PREFIX = '[CasinoSignature]'

/**
 * Recursively sort object keys for canonical JSON serialization (Gap Casino contract).
 */
export function deepSortObject(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(deepSortObject)
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = deepSortObject((obj as Record<string, unknown>)[key])
        return result
      }, {})
  }
  return obj
}

/**
 * Canonical string for signing/verification: sorted keys, then JSON.stringify.
 */
export function stringifyCanonical(obj: unknown): string {
  const result = JSON.stringify(deepSortObject(obj))
  return result
}

function getOurPrivateKey(): string {
  
  const fromEnv = process.env.CASINO_PRIVATE_KEY
  if (fromEnv && typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.trim()
  }
  
  const keyPath = process.env.CASINO_PRIVATE_KEY_PATH
  if (keyPath && typeof keyPath === 'string' && keyPath.trim().length > 0) {
    const resolved = path.isAbsolute(keyPath.trim())
      ? keyPath.trim()
      : path.resolve(process.cwd(), keyPath.trim())
    
    if (!fs.existsSync(resolved)) {
      throw new Error(`Casino private key file not found: ${resolved}`)
    }
    
    const key = fs.readFileSync(resolved, 'utf8')
    return key
  }
  
  throw new Error(
    'Casino private key not configured: set CASINO_PRIVATE_KEY (PEM string) or CASINO_PRIVATE_KEY_PATH (path to .pem file)'
  )
}

/**
 * Create RSA-SHA256 signature over dataString (base64 output).
 * Uses our private key (CASINO_PRIVATE_KEY or CASINO_PRIVATE_KEY_PATH) for outbound requests and callback responses.
 */
export function createCasinoSignature(dataString: string): string {
  try {
    const privateKeyPem = getOurPrivateKey()
    const sign = createSign('RSA-SHA256')
    sign.update(dataString)
    const signature = sign.sign(privateKeyPem, 'base64')
    return signature
  } catch (err) {
    throw err
  }
}

/**
 * Verify Gap callback signature using casino's public key (RSA-SHA256, base64 signature).
 * CASINO_SECRET in env should be the casino's public key PEM.
 */
export function checkCasinoSignature(
  dataString: string,
  signature: string,
  casinoPublicKey: string
): boolean {
  
  if (!signature || typeof signature !== 'string') {
    return false
  }
  
  try {
    const verify = createVerify('RSA-SHA256')
    verify.update(dataString)
    const isValid = verify.verify(casinoPublicKey, signature, 'base64')
    return isValid
  } catch {
    return false
  }
}
