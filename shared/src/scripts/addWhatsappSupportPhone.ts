import 'dotenv/config'
import { pool } from '../db/client.js'

async function addWhatsappSupportPhoneColumn() {

  try {
    const client = await pool.connect()
    
    try {
      // Check if column already exists
      const checkResult = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'app_configs' 
        AND column_name = 'whatsapp_support_phone'
      `)

      if (checkResult.rows.length > 0) {
        return
      }

      // Add the column
      await client.query(`
        ALTER TABLE "app_configs" 
        ADD COLUMN "whatsapp_support_phone" varchar(64)
      `)

    } finally {
      client.release()
    }
  } catch (error) {
    throw error
  } finally {
    await pool.end()
  }
}

addWhatsappSupportPhoneColumn()
  .then(() => process.exit(0))
  .catch((error) => {
    process.exit(1)
  })

