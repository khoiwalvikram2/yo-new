import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const appConfigTypes = readFileSync(join(__dirname, 'app-config.graphql'), 'utf-8')

