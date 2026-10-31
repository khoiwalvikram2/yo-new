import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  // Use shared schema only (no local schemas in user-backend)
  schema: '../shared/src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  breakpoints: true,
})

