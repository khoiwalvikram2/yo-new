import { userQueryResolvers } from './queries.js'
import { userMutationResolvers } from './mutations.js'

export const userResolvers = {
  Query: {
    ...userQueryResolvers,
  },
  Mutation: {
    ...userMutationResolvers,
  },
}

