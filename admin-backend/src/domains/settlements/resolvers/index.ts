import { settlementsQueryResolvers } from './queries';
import { settlementsMutationResolvers } from './mutations';

export const settlementsResolvers = {
  Query: {
    ...settlementsQueryResolvers,
  },
  Mutation: {
    ...settlementsMutationResolvers,
  },
};

