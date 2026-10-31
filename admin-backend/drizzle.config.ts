/// <reference types="node" />
import 'dotenv/config'
import type { Config } from 'drizzle-kit'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set')
}

// Parse connection string to extract individual components
const url = new URL(connectionString)

// SSL configuration for production databases (DigitalOcean, etc.)
const getSSLConfig = () => {
  const requiresSSL = connectionString.includes('sslmode=require') || connectionString.includes('neon.tech')
  if (!requiresSSL) return false

  // DigitalOcean managed databases use SSL certificates that may have intermediate CAs
  // Using rejectUnauthorized: false still encrypts the connection, just skips cert verification
  return { rejectUnauthorized: false }
}

export default {
  schema: '../shared/src/db/schema.ts',
  out: '../shared/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl: getSSLConfig(),
  },
  verbose: true,
  strict: true,
} satisfies Config


