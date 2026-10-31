import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const otpTypes = readFileSync(join(__dirname, 'otp.graphql'), 'utf-8')

