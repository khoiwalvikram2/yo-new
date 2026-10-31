import { drizzle } from 'drizzle-orm/node-postgres'
import { createPool } from '@shared/db/createPool.js'
import { setSharedDb } from '@shared/db/registry.js'
import { getEnv } from '../config/env.js'
import * as schema from '@shared/db/schema.js'

const env = getEnv()

export const pool = createPool(env.DATABASE_URL, { applicationName: 'admin-backend' })
export const db = drizzle(pool, { schema })

// Register this application's handle so shared services (e.g. bonusService)
// resolve a database deterministically instead of probing for one.
setSharedDb(db)
