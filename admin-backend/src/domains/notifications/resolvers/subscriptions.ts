import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'

export const notificationsSubscriptionResolvers = {
	notificationReceived: {
		subscribe: async function (this: any, _root: any, _args: any, ctx: any) {
			// CRITICAL: For Director Admin, use effective tenant based on mode
			const directorTenant = getEffectiveTenantForDirector(ctx)
			let tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
			if (typeof tenant !== 'string' || tenant.trim() === '') {
				tenant = 'default';
			} else {
				tenant = tenant.trim();
			}

			// Build topic based on user type
			let topic: string;
			if (ctx?.user?.type === 'user' && ctx?.user?.userId) {
				topic = `NOTIFICATION_USER_${ctx.user.userId}_${tenant}`;
			} else if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				topic = `NOTIFICATION_AGENT_${ctx.user.agentId}_${tenant}`;
			} else if (directorTenant || ctx?.whitelabel?.id) {
				topic = `NOTIFICATION_WHITELABEL_${directorTenant ?? ctx.whitelabel.id}_${tenant}`;
			} else {
				topic = `NOTIFICATION_DEFAULT_${tenant}`;
			}

			const hasCtxPubsub = !!ctx?.pubsub?.subscribe;
			const hasThisPubsub = !!(this && (this as any).pubsub && (this as any).pubsub.asyncIterator);

			if (hasCtxPubsub || hasThisPubsub) {
				const iterator = hasCtxPubsub
					? await ctx.pubsub.subscribe(topic)
					: (this as any).pubsub.asyncIterator(topic);
				return iterator;
			}

			// Fallback: return empty async iterator if pubsub not available
			return {
				async *[Symbol.asyncIterator]() {
					// Empty iterator - subscription will fall back to polling
				},
				next: async () => ({ done: true, value: undefined }),
			} as unknown as AsyncIterator<any>;
		},
		resolve: (payload: any) => {
			return payload.notificationReceived || payload;
		},
	},
};
