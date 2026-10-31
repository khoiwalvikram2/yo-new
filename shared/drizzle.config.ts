/// <reference types="node" />
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import type { Config } from 'drizzle-kit'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set')
}

const url = new URL(connectionString)

/** SSL config for pg/drizzle. Inlined so drizzle.config has no extra module deps (avoids ./src/db/ssl.js resolution on server). */
function getSSLConfig(conn: string): false | { rejectUnauthorized: boolean; ca?: string } {
  const isProduction = process.env.NODE_ENV === 'production'
  const requiresSSL =
    isProduction ||
    conn.includes('sslmode=require') ||
    conn.includes('db.ondigitalocean.com')
  if (!requiresSSL) return false
  const caPath =
    process.env.DATABASE_CA_CERT ||
    path.join(process.cwd(), 'certs', 'ca-certificate.crt')
  if (fs.existsSync(caPath)) {
    const ca = fs.readFileSync(caPath, 'utf8')
    return { rejectUnauthorized: true, ca }
  }
  return { rejectUnauthorized: false }
}

const ssl = getSSLConfig(connectionString)

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl: ssl === false ? false : ssl,
  },
  verbose: true,
  strict: true,
} satisfies Config

