import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const referralsTypeDefs = readFileSync(join(__dirname, 'referrals.graphql'), 'utf-8')
