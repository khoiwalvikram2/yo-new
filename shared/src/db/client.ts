/**
 * Database client for scripts (seeds, resets, maintenance).
 * Load dotenv in script entry points before importing this module.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { createPool } from './createPool.js'
import { setSharedDb } from './registry.js'
import * as schema from './schema.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Set it in .env or environment.')
}

export const pool = createPool(connectionString, { applicationName: 'shared-scripts' })
export const db = drizzle(pool, { schema })

// Scripts share the same registry as the applications.
setSharedDb(db)
