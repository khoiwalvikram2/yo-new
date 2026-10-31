import fs from 'fs'

export const userAppTypeDefs = fs.readFileSync(new URL('./userApp.graphql', import.meta.url), 'utf8')

