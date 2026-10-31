import { userTypes } from './domains/user/index.js'
import { queryTypes } from './operations/index.js'
import { userAppTypeDefs } from '@shared/types/domains/userApp/index.js'

export const typeDefs = /* GraphQL */ `
  ${userTypes}
  ${queryTypes}
  ${userAppTypeDefs}
`

