import { searchQueryResolvers } from './queries.js'

export const searchResolvers = {
  Query: {
    ...searchQueryResolvers,
  },
}
