import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const rbacTypes = readFileSync(join(__dirname, 'rbac.graphql'), 'utf-8')

