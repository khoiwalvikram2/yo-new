import fs from 'node:fs'
import path from 'node:path'

export type SSLConfig = false | { rejectUnauthorized: boolean; ca?: string }

/**
 * Returns SSL config for pg/drizzle when connecting to PostgreSQL.
 * Use when DATABASE_URL has sslmode=require or for production (e.g. DigitalOcean).
 * Set DATABASE_CA_CERT to the path to your CA cert file, or put the cert at
 * <cwd>/certs/ca-certificate.crt (e.g. admin-backend/certs/, user-backend/certs/, shared/certs/).
 * If you still get "self-signed certificate in certificate chain", set
 * DATABASE_SSL_REJECT_UNAUTHORIZED=false to skip cert verification (less secure; use only when needed).
 */
export function getSSLConfig(connectionString: string): SSLConfig {
  const isProduction = process.env.NODE_ENV === 'production'
  const requiresSSL =
    isProduction ||
    connectionString.includes('sslmode=require') ||
    connectionString.includes('db.ondigitalocean.com')

  if (!requiresSSL) return false

  const skipVerify =
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false' ||
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === '0'
  if (skipVerify) return { rejectUnauthorized: false }

  const caPath =
    process.env.DATABASE_CA_CERT ||
    path.join(process.cwd(), 'certs', 'ca-certificate.crt')

  if (fs.existsSync(caPath)) {
    const ca = fs.readFileSync(caPath, 'utf8')
    return { rejectUnauthorized: true, ca }
  }

  return { rejectUnauthorized: false }
}
