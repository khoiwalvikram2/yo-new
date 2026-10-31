import './loadEnv.js'
import { pool } from '../src/db/client.js'

async function resetDb() {
  console.log('Resetting database schema...')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DROP SCHEMA IF EXISTS public CASCADE;')
    await client.query('CREATE SCHEMA public;')
    await client.query('GRANT ALL ON SCHEMA public TO public;')
    await client.query('COMMIT')
    console.log('✅ Database schema reset complete')
    console.log('   Next: run migrations from shared: npm run migrate:push')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('❌ Failed to reset database:', err)
    process.exitCode = 1
  } finally {
    client.release()
    try { await pool.end() } catch {}
  }
}

resetDb()
