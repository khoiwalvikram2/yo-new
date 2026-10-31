/**
 * Load .env for seed/reset scripts. Uses shared/.env only (no dependency on admin-backend).
 * Import this first in any script that uses the DB client.
 */
import { config } from 'dotenv'

config() // shared/.env when cwd is shared
