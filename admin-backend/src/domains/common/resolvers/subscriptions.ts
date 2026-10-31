import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js';
import { hasPermission } from '@src/domains/common/auth.js'
import { subscriptionAgentId, agentPlayerMatcher, createFilteredIterator } from '@src/realtime/agentScopedLive.js'

export const commonSubscriptionResolvers = {
  heartbeat: {
    subscribe: async function (_root: any, _args: any, ctx: any) {
      const stream = await ctx.pubsub.subscribe('HEARTBEAT')
      const iterator = typeof stream[Symbol.asyncIterator] === 'function' ? stream[Symbol.asyncIterator]() : stream
      const originalReturn = iterator.return?.bind(iterator)
      let active = true
      let cancellation: Promise<any> | undefined
      const interval = setInterval(() => {
        if (!active) return
        void Promise.resolve().then(() => {
          if (active) return ctx.pubsub.publish({ topic: 'HEARTBEAT', payload: { heartbeat: new Date().toISOString() } })
        }).catch(() => { /* The emitter may close while a socket disconnects. */ })
      }, 2000)
      iterator.return = () => {
        if (!cancellation) {
          active = false
          clearInterval(interval)
          cancellation = Promise.resolve().then(() => originalReturn ? originalReturn() : { value: undefined, done: true })
        }
        return cancellation
      }
      return iterator
    },
    resolve: (payload: any) => payload.heartbeat,
  },
  walletUpdated: {
    subscribe: async function (_root: any, _args: any, ctx: any) {
      // This subscribed to one global topic, so the permission now required to
      // open the subscription did not stop another tenant's balance events
      // arriving on it. Scoping the topic is what actually separates them.
      const platformWide = hasPermission(ctx?.permissions ?? [], 'all', '*')
      const tenant =
        getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
      const topic = platformWide ? 'WALLET_UPDATED_ALL' : `WALLET_UPDATED_${tenant}`
      const agentId = subscriptionAgentId(ctx)
      if (agentId) {
        const players = agentPlayerMatcher(agentId, tenant)
        return createFilteredIterator({
          topic: `WALLET_UPDATED_${tenant}`,
          extract: (message) => message?.payload?.walletUpdated ?? message?.walletUpdated,
          allow: (wallet) => (!wallet.tenant || wallet.tenant === tenant) && players.has(wallet.userId),
          wrap: (wallet) => ({ walletUpdated: wallet }),
        })
      }
      return ctx.pubsub.subscribe(topic)
    },
    resolve: (payload: any) => payload.walletUpdated,
  },
  whitelabelSharingUpdated: {
    subscribe: async function (_root: any, args: any, ctx: any) {
      const { whitelabelId } = args;
      
      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx);
      const effectiveWhitelabelId = directorTenant ?? (ctx?.whitelabel?.id ?? ctx?.tenant ?? whitelabelId);
      
      // Validate user has access to this whitelabel
      if (ctx?.user?.roles) {
        const roleNames = ctx.user.roles || [];
        const isWhitelabelAdmin = roleNames.some((r: string) => 
          r === 'Whitelabel Admin' || r.toLowerCase() === 'whitelabel_admin' || r.toLowerCase().includes('whitelabel')
        );
        
        if (isWhitelabelAdmin && effectiveWhitelabelId !== ctx?.whitelabel?.id) {
          throw new Error('Unauthorized: You can only subscribe to your own whitelabel sharing updates');
        }
      }
      
      const topic = `WHITELABEL_SHARING_${effectiveWhitelabelId}`;
      const iterator = await ctx.pubsub.subscribe(topic);
      return iterator;
    },
    resolve: async (payload: any) => {
      // If payload already has the data, return it
      if (payload?.whitelabelSharingUpdated) {
        return payload.whitelabelSharingUpdated;
      }
      
      // Otherwise, fetch fresh data (fallback)
      // This shouldn't normally happen, but provides a safety net
      try {
        const { getWhitelabelSharingConfig, getWhitelabelAllTimeSharingTotals, getWhitelabelCurrentPeriodSharingTotals } = await import('@src/repos/common/whitelabelRepo.js');
        const whitelabelId = payload?.whitelabelId || payload?.tenant;
        if (!whitelabelId) return null;
        
        const now = new Date();
        const sharingRates = [];
        for (const domain of ['sports', 'casino', 'matka'] as const) {
          try {
            const config = await getWhitelabelSharingConfig(whitelabelId, domain, now);
            if (config) {
              const rate = Number(config.shareRate);
              if (Number.isFinite(rate) && rate >= 0) {
                sharingRates.push({
                  domain,
                  rate: rate * 100,
                });
              } else {
                sharingRates.push({
                  domain,
                  rate: 0,
                });
              }
            } else {
              sharingRates.push({
                domain,
                rate: 0,
              });
            }
          } catch (err) {
            // Default to 0 rate on error
            sharingRates.push({
              domain,
              rate: 0,
            });
          }
        }
        
        const allTimeTotals = await getWhitelabelAllTimeSharingTotals(whitelabelId);
        const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js');
        const { getStartOfMonth, getEndOfMonth } = await import('@src/shared/dateUtils.js');
        const tzSub = await getWhitelabelTimezone(whitelabelId);
        const periodFromSub = getStartOfMonth(tzSub);
        const periodToSub = getEndOfMonth(tzSub);
        const currentPeriodTotals = await getWhitelabelCurrentPeriodSharingTotals(whitelabelId, periodFromSub, periodToSub);
        
        const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
        const currency = await getWhitelabelCurrency(whitelabelId);
        
        const allDomains = ['sports', 'casino', 'matka'] as const;
        const allTimeTotalsMap = new Map(allTimeTotals.map(t => [t.domain, t.totalAmount]));
        const currentPeriodTotalsMap = new Map(currentPeriodTotals.map(t => [t.domain, t.totalAmount]));
        
        return {
          sharingRates,
          allTimeTotals: allDomains.map(domain => ({
            domain,
            totalAmount: allTimeTotalsMap.get(domain) || 0,
          })),
          currentPeriodTotals: allDomains.map(domain => ({
            domain,
            totalAmount: currentPeriodTotalsMap.get(domain) || 0,
          })),
          currency,
        };
      } catch (err) {
        return null;
      }
    },
  },
  whitelabelCreditUpdated: {
    subscribe: async function (_root: any, args: any, ctx: any) {
      const { whitelabelId } = args;
      
      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx);
      const effectiveWhitelabelId = directorTenant ?? (ctx?.whitelabel?.id ?? ctx?.tenant ?? whitelabelId);
      
      // Validate user has access to this whitelabel
      if (ctx?.user?.roles) {
        const roleNames = ctx.user.roles || [];
        const isWhitelabelAdmin = roleNames.some((r: string) => 
          r === 'Whitelabel Admin' || r.toLowerCase() === 'whitelabel_admin' || r.toLowerCase().includes('whitelabel')
        );
        
        if (isWhitelabelAdmin && effectiveWhitelabelId !== ctx?.whitelabel?.id) {
          throw new Error('Unauthorized: You can only subscribe to your own whitelabel credit updates');
        }
      }
      
      const topic = `WHITELABEL_CREDIT_${effectiveWhitelabelId}`;
      const iterator = await ctx.pubsub.subscribe(topic);
      return iterator;
    },
    resolve: async (payload: any) => {
      // If payload already has the data, return it
      if (payload?.whitelabelCreditUpdated) {
        return payload.whitelabelCreditUpdated;
      }
      
      // Otherwise, fetch fresh data (fallback)
      try {
        const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js');
        const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js');
        const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo());
        const whitelabelId = payload?.whitelabelId || payload?.tenant;
        if (!whitelabelId) return null;
        
        const credit = await whitelabelCreditService.getCreditAllocation(whitelabelId);
        // Map isNearThreshold to isNearLimit for GraphQL schema compatibility
        return {
          creditLimit: credit.creditLimit,
          creditUsed: credit.creditUsed,
          creditAvailable: credit.creditAvailable,
          creditAlertThreshold: credit.creditAlertThreshold,
          usagePercentage: Math.round(credit.usagePercentage * 100) / 100,
          isNearLimit: credit.isNearThreshold, // Map isNearThreshold to isNearLimit
        };
      } catch (err) {
        return null;
      }
    },
  },
}
