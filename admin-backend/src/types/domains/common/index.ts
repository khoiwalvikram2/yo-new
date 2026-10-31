export { commonTypes } from '@src/types/domains/common/common.js'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const currencyTypes = readFileSync(join(__dirname, 'currency.graphql'), 'utf-8')
