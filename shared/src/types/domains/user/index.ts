import fs from 'fs'

export const userTypeDefs = fs.readFileSync(new URL('./user.graphql', import.meta.url), 'utf8')

