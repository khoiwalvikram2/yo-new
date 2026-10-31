import { buildNotificationsQueryResolvers } from './queries';
import { buildNotificationsMutationResolvers } from './mutations';
import { notificationsSubscriptionResolvers } from './subscriptions';
import { ensureAgentCanMutate } from '@src/domains/common/auth.js';

const queryResolvers = buildNotificationsQueryResolvers();
const rawMutationResolvers = buildNotificationsMutationResolvers();

function wrapNotificationsMutations(mutations: Record<string, (...args: any[]) => any>) {
	return Object.fromEntries(
		Object.entries(mutations).map(([key, fn]) => [
			key,
			async (parent: any, args: any, ctx: any, info: any) => {
				if (!ctx?.user) throw new Error('Unauthorized: authentication required');
				ensureAgentCanMutate(ctx);
				return fn(parent, args, ctx, info);
			},
		])
	);
}

const mutationResolvers = wrapNotificationsMutations(rawMutationResolvers);

export const notificationsResolvers = {
	Query: {
		...queryResolvers,
	},
	Mutation: {
		...mutationResolvers,
	},
	Subscription: {
		...notificationsSubscriptionResolvers,
	},
};
