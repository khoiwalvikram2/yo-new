import { userAppQueryResolvers } from './queries.js'
import { userAppMutationResolvers } from './mutations.js'

export const userAppResolvers = {
  Query: {
    ...userAppQueryResolvers,
  },
  Mutation: {
    ...userAppMutationResolvers,
  },
}

