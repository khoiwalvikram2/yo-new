import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export { matkaTypes } from '@src/types/domains/matka/matka.js'

export const matkaResultsTypes = readFileSync(join(__dirname, 'results.graphql'), 'utf-8')
