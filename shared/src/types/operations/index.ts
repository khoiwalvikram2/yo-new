import fs from 'fs'

export const userOperationTypes = fs.readFileSync(new URL('./user.graphql', import.meta.url), 'utf8')

