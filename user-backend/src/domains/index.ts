import { playerMatkaResolvers } from './matka/resolvers.js'
import { userResolvers } from './user/resolvers/index.js'
import { userAppResolvers } from './userApp/resolvers/index.js'

export const domainResolvers = {
  Query: {
    ...userResolvers.Query,
    ...userAppResolvers.Query,
    ...playerMatkaResolvers.Query,
  },
  Mutation: {
    ...userResolvers.Mutation,
    ...userAppResolvers.Mutation,
    ...playerMatkaResolvers.Mutation,
  },
}

