import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const searchTypes = readFileSync(join(__dirname, 'search.graphql'), 'utf-8')
