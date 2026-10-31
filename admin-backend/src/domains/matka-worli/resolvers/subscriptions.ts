import { authorizedWorliInstance } from './queries.js'
export const worliSubscriptionResolvers = {
  worliInstanceUpdated: {
    subscribe: async function (_root: any, { id }: any, ctx: any) {
      await authorizedWorliInstance(id, ctx)
      const topic = `WORLI_INSTANCE_${id}`
      const iterator = await ctx.pubsub.subscribe(topic)
      return iterator
    },
    resolve: (payload: any) => payload.worliInstanceUpdated,
  },
  worliBetCreated: {
    subscribe: async function (_root: any, { instanceId }: any, ctx: any) {
      await authorizedWorliInstance(instanceId, ctx)
      const topic = `WORLI_BET_CREATED_${instanceId}`
      const iterator = await ctx.pubsub.subscribe(topic)
      return iterator
    },
    resolve: (payload: any) => payload.worliBetCreated,
  },
}

