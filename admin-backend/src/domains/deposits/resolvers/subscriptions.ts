import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { getDepositRequestById } from '@/repos/deposits/depositRequestsRepo.js'
import { generatePresignedGetUrl } from '@/services/storage/s3.js'
import { getUserDb } from '@/repos/users/usersRepo.js'

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
      // a presigned URL for their payment proof.
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
        
        // Generate presigned URL for proof
        let proofUrl = null
        if (request.proofKey) {
          try {
            proofUrl = await generatePresignedGetUrl(request.proofKey, 3600)
          } catch {
            // Ignore errors
          }
        }
        
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
          proofUrl,
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

