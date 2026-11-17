import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js';

export const agentsSubscriptionResolvers = {
  agentSharingUpdated: {
    subscribe: async function (_root: any, args: any, ctx: any) {
      const { agentId } = args;
      
      // Validate agent can access this agentId
      if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
        if (ctx.user.agentId !== agentId) {
          throw new Error('Unauthorized: You can only subscribe to your own sharing updates');
        }
      }
      
      const topic = `AGENT_SHARING_${agentId}`;
      const iterator = await ctx.pubsub.subscribe(topic);
      return iterator;
    },
    resolve: (payload: any) => {
      // Return the sharing info from payload
      if (payload?.agentSharingUpdated) {
        return payload.agentSharingUpdated;
      }
      // Fallback: return payload as-is (shouldn't happen normally)
      return payload;
    },
  },
  
  agentCommissionUpdated: {
    subscribe: async function (_root: any, args: any, ctx: any) {
      const { agentId } = args;
      
      // Validate agent can access this agentId
      if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
        if (ctx.user.agentId !== agentId) {
          throw new Error('Unauthorized: You can only subscribe to your own commission updates');
        }
      }
      
      const topic = `AGENT_COMMISSION_${agentId}`;
      const iterator = await ctx.pubsub.subscribe(topic);
      return iterator;
    },
    resolve: (payload: any) => {
      // Return the commission info from payload
      if (payload?.agentCommissionUpdated) {
        return payload.agentCommissionUpdated;
      }
      // Fallback: return payload as-is (shouldn't happen normally)
      return payload;
    },
  },
}

