import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { depositRequestHasProof } from '@/repos/deposits/depositRequestsRepo.js'
import { getUserDb } from '@/repos/users/usersRepo.js'
import { depositProofUrl } from './proofUrl.js'

export const depositsSubscriptionResolvers = {
  depositRequestUpdated: {
    subscribe: async function (_root: any, _args: any, ctx: any) {
      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)

      // The `tenant` argument is deliberately ignored. It used to be preferred
      // over the context, so the topic a socket joined came from the request
      // rather than from any token — and because mercurius never ran the
      // context function for WebSockets, there was no token to disagree with
      // it. Naming another whitelabel handed you its live deposit feed,
      // enriched by the resolver below with the player's name, email, phone and
      // their payment proof.
      //
      // A Super Admin still reaches other whitelabels, through director mode,
      // which is resolved from their own roles above.
      const tenant = directorTenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'

      const topic = `DEPOSIT_REQUEST_${tenant}`
      const iterator = await ctx.pubsub.subscribe(topic)
      return iterator
    },
    resolve: async (payload: any) => {
      if (payload?.depositRequestUpdated) {
        const request = payload.depositRequestUpdated
        
        // Fetch user info
        const user = request.userId ? await getUserDb(Number(request.userId), request.tenant).catch(() => null) : null
        
        // Whether the request has a proof to show, read from its row without the screenshot, as the list says it
        // (the event names only proof_key, and 'inline' means the image is in proof_data). The feed never carries
        // the image itself: the page asks depositRequestProof for it when a reviewer opens the request.
        const hasProof = await depositRequestHasProof(Number(request.id), request.tenant)
          .catch(() => depositProofUrl(request) !== null)

        return {
          id: String(request.id),
          tenant: request.tenant,
          userId: String(request.userId),
          amount: Number(request.amount),
          currency: request.currency,
          method: request.method,
          utr: request.utr,
          referenceId: request.referenceId,
          proofKey: request.proofKey,
          proofUrl: null,
          hasProof,
          status: request.status,
          reviewerId: request.reviewerId ? String(request.reviewerId) : null,
          reviewedAt: request.reviewedAt?.toISOString?.() || null,
          note: request.note,
          walletTxnId: request.walletTxnId ? String(request.walletTxnId) : null,
          createdAt: request.createdAt?.toISOString?.() || new Date().toISOString(),
          updatedAt: request.updatedAt?.toISOString?.() || new Date().toISOString(),
          user: user ? {
            id: String(user.id),
            name: user.name || user.username || null,
            email: user.email || null,
            phone: user.phone || null,
          } : null,
        }
      }
      return null
    },
  },
}

