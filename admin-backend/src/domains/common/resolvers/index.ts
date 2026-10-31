import { commonQueryResolvers } from '@src/domains/common/resolvers/queries.js'
import { commonSubscriptionResolvers } from '@src/domains/common/resolvers/subscriptions.js'
import { currencyResolvers } from '@src/domains/common/resolvers/currency.js'
import { JSONResolver } from 'graphql-scalars'
import { requirePermission } from '@src/domains/common/auth.js'
import { requireReadPermission } from '@src/domains/common/auth.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { hasPermission } from '@src/domains/common/auth.js'

// Helper to convert stored S3 keys (or base64/data URLs) into displayable URLs
async function convertS3KeyToUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null

  // Already a usable URL or data URI
  if (key.startsWith('http://') || key.startsWith('https://') || key.startsWith('data:')) {
    return key
  }

  try {
    // Prefer presigned URL so private buckets also work
    const { generatePresignedGetUrl, getS3ObjectUrl } = await import('@src/services/storage/s3.js')
    try {
      const presigned = await generatePresignedGetUrl(key, 7 * 24 * 3600) // 7 days
      if (presigned) return presigned
    } catch {}
    // Fallback to public URL construction (for public buckets/CloudFront)
    return getS3ObjectUrl(key)
  } catch (err) {
    return key
  }
}

/**
 * May this caller read a whitelabel's money?
 *
 * `Query.whitelabel(id)` takes no `ctx` at all and is deliberately reachable
 * before sign-in — the login page needs the brand's name, logo and theme for the
 * host being addressed. But the `Whitelabel` type mixes that branding with the
 * brand's credit line and sharing configuration, and the field resolvers below
 * fetched those from the database on demand.
 *
 * Measured with no session at all: `whitelabel("grandwinn-com")` returned
 * creditLimit 100,000,000, creditUsed 4,872,703.47, creditAvailable
 * 95,127,296.53 and every sharing rate — real figures, to an anonymous caller,
 * for a brand whose id is its own domain name and therefore guessable.
 *
 * The operation stays open, because branding genuinely is needed first. The
 * money is what gets authorised: the caller's own tenant and an explicit
 * permission, or platform-wide standing. Every one of these fields is nullable
 * in the schema, so a caller who may not see them gets null rather than an error
 * on a page that only wanted a logo.
 */
function mayReadWhitelabelMoney(root: any, ctx: any): boolean {
  if (!ctx?.user) return false
  const perms = ctx?.permissions ?? []
  if (hasPermission(perms, 'all', '*')) return true
  const callerTenant =
    getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? null
  if (!callerTenant || String(root?.id ?? '') !== String(callerTenant)) return false
  return (
    hasPermission(perms, 'credit.management', 'view') ||
    hasPermission(perms, 'agents.credit', 'view')
  )
}

/** The same question for the brand's sharing configuration. */
function mayReadWhitelabelSharing(root: any, ctx: any): boolean {
  if (!ctx?.user) return false
  const perms = ctx?.permissions ?? []
  if (hasPermission(perms, 'all', '*')) return true
  const callerTenant =
    getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? null
  if (!callerTenant || String(root?.id ?? '') !== String(callerTenant)) return false
  return hasPermission(perms, 'agents.sharing', 'view')
}

export const commonResolvers = {
  JSON: JSONResolver,
  Query: {
    ...commonQueryResolvers,
    ...currencyResolvers.Query,
    async partnerSettlements(_: any, __: any, ctx: any) {
      requireReadPermission(ctx, 'settlements.center', 'view')
      const { listSettlements } = await import('@src/repos/settlements/settlementsRepo.js')
      const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
      return listSettlements(tenant)
    },
    async whitelabel(_: any, { id }: any) {
      const { getWhitelabelById } = await import('@src/repos/common/whitelabelRepo.js')
      const row = await getWhitelabelById(id)
      if (!row) return null

      return {
        ...row,
        logoUrl: await convertS3KeyToUrl(row.logoUrl),
        faviconUrl: await convertS3KeyToUrl(row.faviconUrl),
      }
    }
  },
  Mutation: {
    ...currencyResolvers.Mutation,
    async adjustWhitelabelCredit(_: any, { input }: any, ctx: any) {
      // This sets a whitelabel's credit limit and had no authorization of any
      // kind: measured, it was reachable with `ctx.user` undefined — no session
      // at all — and failed on missing input rather than on permission.
      //
      // `settlements.credit:create` (flat `credit:write`) rather than
      // `credit.management:view`, for two reasons. It is a write, so a view
      // permission is the wrong shape. And of the live roles, the ones holding
      // `credit:read` but deliberately not `credit:write` — both Finance
      // Managers — are configured that way on purpose; honouring the split is
      // the point. Whitelabel Admin holds neither, which is correct: this tops
      // up a brand's own credit line, and a brand's admin granting it to
      // themselves is the self-dealing the permission exists to prevent.
      requirePermission(ctx, 'settlements.credit', 'create')
      const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js')
      const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
      const { getWhitelabelById } = await import('@src/repos/common/whitelabelRepo.js')
      const { recordAuditDb } = await import('@src/repos/audit/auditRepo.js')
      
      try {
        const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo())
        
        // Adjust credit limit
        await whitelabelCreditService.adjustCreditLimit(
          input.whitelabelId,
          input.creditLimit,
          input.reason || 'Credit limit adjustment by Super Admin'
        )
        
        // Get updated whitelabel
        const whitelabel = await getWhitelabelById(input.whitelabelId)
        if (!whitelabel) {
          return { success: false, message: 'Whitelabel not found', whitelabel: null }
        }
        
        // Audit log
        const tenant = ctx?.tenant || input.whitelabelId || 'default'
        await recordAuditDb({
          tenant,
          actorId: ctx?.user?.id || ctx?.user?.sub || 'system',
          domain: 'whitelabels',
          action: 'adjust_credit',
          resourceType: 'whitelabel',
          resourceId: input.whitelabelId,
          after: {
            whitelabelId: input.whitelabelId,
            creditLimit: input.creditLimit,
            reason: input.reason,
          },
        })
        
        return {
          success: true,
          message: 'Whitelabel credit adjusted successfully',
          whitelabel: {
            ...whitelabel,
            logoUrl: await convertS3KeyToUrl(whitelabel.logoUrl),
            faviconUrl: await convertS3KeyToUrl(whitelabel.faviconUrl),
          },
        }
      } catch (error: any) {
        return {
          success: false,
          message: error.message || 'Failed to adjust whitelabel credit',
          whitelabel: null,
        }
      }
    },
    async createWhitelabel(_: any, { input }: any, ctx: any) {
      requirePermission(ctx, 'config.whitelabels', 'create')
      const { upsertWhitelabel, setWhitelabelSharingConfig, copyDefaultCasinoGameSettingsToWhitelabel } = await import('@src/repos/common/whitelabelRepo.js')
      const { ensureAdminUser } = await import('@src/repos/users/usersRepo.js')
      const { seedDefaultRBAC } = await import('@src/repos/rbac/rbacRepo.js')
      try {
        await upsertWhitelabel({
          id: input.id,
          name: input.name,
          domain: input.domain,
          logoUrl: input.logoUrl ?? null,
          faviconUrl: input.faviconUrl ?? null,
        })
        
        // Set initial credit if provided
        if (input.creditLimit != null && input.creditLimit > 0) {
          const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js')
          const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
          const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo())
          await whitelabelCreditService.allocateCredit(
            input.id,
            input.creditLimit,
            'Initial credit allocation on whitelabel creation'
          )
        }
        
        // Set per-domain sharing rates if provided
        if (input.sharingRates && Array.isArray(input.sharingRates)) {
          for (const rateInput of input.sharingRates) {
            if (rateInput.domain && rateInput.shareRate != null) {
              await setWhitelabelSharingConfig({
                whitelabelId: input.id,
                domain: rateInput.domain as 'sports' | 'casino' | 'matka',
                shareRate: rateInput.shareRate / 100, // Convert percentage to decimal
              })
            }
          }
        }
        
        await seedDefaultRBAC(input.id)
        await ensureAdminUser({
          email: input.partnerAdminEmail,
          name: input.partnerAdminName,
          password: input.partnerAdminPassword,
          roleName: 'Whitelabel Admin',
          tenant: input.id,
        })
        // Copy default tenant's casino game settings as template (only for existing games, NOT NULL-safe)
        await copyDefaultCasinoGameSettingsToWhitelabel(input.id)
        return { success: true, message: 'Whitelabel created', whitelabel: { id: input.id, name: input.name, domain: input.domain, logoUrl: input.logoUrl, faviconUrl: input.faviconUrl } }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Failed to create whitelabel', whitelabel: null }
      }
    },
    async resetWhitelabelAdminPassword(_: any, args: any, ctx: any) {
      const { z } = await import('zod')
      const p = z.object({
        whitelabelId: z.string().min(1, 'whitelabelId is required'),
        // .nullish() accepts string | null | undefined — the frontend sends null when the
        // optional Admin Email field is left blank (auto-select the single whitelabel admin).
        adminEmail: z.string().nullish(),
        newPassword: z.string().min(6, 'New password must be at least 6 characters'),
        adminPassword: z.string().min(1, 'Your password is required to confirm'),
      }).safeParse(args)
      if (!p.success) {
        throw new Error(p.error.issues.map((e) => e.message).join(', '))
      }
      const { whitelabelId, newPassword, adminPassword } = p.data
      // Normalize null/empty to undefined so target selection treats it as "not provided".
      const adminEmail = p.data.adminEmail?.trim() || undefined

      // Super-admin gate (same check used elsewhere in this file)
      const isSuperAdmin = ctx?.user?.roles?.some((r: string) =>
        r === 'Super Admin' || String(r).toLowerCase() === 'super_admin' ||
        (String(r).toLowerCase().includes('super') && String(r).toLowerCase().includes('admin'))
      )
      if (!isSuperAdmin) {
        throw new Error('Unauthorized: Only Super Admin can reset a whitelabel admin password')
      }

      // Verify the caller's own password (caller is an admin user)
      const { getUserPasswordHashDb, updateUserPasswordDb, setRequirePasswordResetDb, incrementTokenVersionDb } = await import('@src/repos/users/usersRepo.js')
      const { hashPassword, verifyPassword } = await import('@src/domains/common/auth.js')
      const callerId = ctx?.user?.sub
      if (!callerId) throw new Error('Unauthorized: Not authenticated')
      const callerHash = await getUserPasswordHashDb(Number(callerId))
      if (!callerHash) throw new Error('Caller not found')
      if (!(await verifyPassword(adminPassword, callerHash))) {
        throw new Error('Invalid admin password. Please enter your correct login password to confirm.')
      }

      // Find the target whitelabel admin user(s) in this tenant
      const { listAdminUsers } = await import('@src/repos/rbac/rbacRepo.js')
      const adminUsers = await listAdminUsers(whitelabelId)
      const whitelabelAdmins = adminUsers.filter((u) =>
        (u.roles ?? []).some((r: any) => String(r?.name).trim() === 'Whitelabel Admin')
      )

      const { selectWhitelabelAdminTarget } = await import('@src/domains/common/resolvers/whitelabelAdminTarget.js')
      const target = selectWhitelabelAdminTarget(
        whitelabelAdmins.map((u) => ({ id: u.id, email: u.email ?? null })),
        adminEmail,
        whitelabelId
      )

      const targetId = target.id
      const targetEmail = target.email ?? null

      // Reset password, invalidate existing sessions, clear forced-reset flag
      const newHash = await hashPassword(newPassword)
      // The target is an admin of `whitelabelId`, resolved and checked above.
      await updateUserPasswordDb(targetId, newHash, whitelabelId)
      // The target is an admin of `whitelabelId`, which is the tenant this flow
      // has already resolved and checked the caller against.
      await incrementTokenVersionDb(targetId, whitelabelId)
      await setRequirePasswordResetDb(targetId, false, whitelabelId)

      // Audit
      const { recordAuditDb } = await import('@src/repos/audit/auditRepo.js')
      recordAuditDb({
        tenant: whitelabelId,
        actorId: String(callerId),
        domain: 'whitelabel.security',
        action: 'reset_whitelabel_admin_password',
        resourceType: 'user',
        resourceId: String(targetId),
        after: { passwordReset: true, targetEmail },
      }).catch(() => {})

      return { success: true, message: 'Whitelabel admin password reset successfully' }
    },
    async generateCasinoCategories(_: any, { tenantId }: { tenantId: string }, ctx: any) {
      const { hasPermission } = await import('@src/domains/common/auth.js')
      const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js')
      const { getWhitelabelById } = await import('@src/repos/common/whitelabelRepo.js')
      if (!hasPermission(ctx?.permissions ?? [], 'casino.categories', 'update') && !hasPermission(ctx?.permissions ?? [], 'config.whitelabels', 'update')) {
        return { success: false, message: 'Forbidden: insufficient permissions', categoriesCreated: null, gamesAssigned: null, nonLatinDisabled: null }
      }
      const tid = typeof tenantId === 'string' ? tenantId.trim() : ''
      if (!tid) {
        return { success: false, message: 'Whitelabel ID is required', categoriesCreated: null, gamesAssigned: null, nonLatinDisabled: null }
      }
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const isSuperAdmin = ctx?.user?.roles?.some((r: string) =>
        r === 'Super Admin' || String(r).toLowerCase() === 'super_admin' ||
        (String(r).toLowerCase().includes('super') && String(r).toLowerCase().includes('admin'))
      )
      const callerTenant = ctx?.tenant ?? null
      const allowAnyTenant = isSuperAdmin && directorTenant === null
      if (!allowAnyTenant) {
        const allowedTenant = directorTenant ?? callerTenant
        if (allowedTenant != null && tid !== allowedTenant) {
          return { success: false, message: 'Forbidden: cannot generate categories for another whitelabel', categoriesCreated: null, gamesAssigned: null, nonLatinDisabled: null }
        }
      }
      const whitelabel = await getWhitelabelById(tid)
      if (!whitelabel) {
        return { success: false, message: 'Whitelabel not found', categoriesCreated: null, gamesAssigned: null, nonLatinDisabled: null }
      }
      try {
        const { provisionCasinoCategoriesFromProvidersForTenant } = await import('@src/repos/casino/casinoRepo.js')
        const result = await provisionCasinoCategoriesFromProvidersForTenant(tid)
        const message =
          result.categoriesCreated === 0 && result.gamesAssigned === 0
            ? 'No categories created. Enable at least one casino provider (Gap or GMAG) for this whitelabel in Casino Providers, then try again.'
            : `Categories created: ${result.categoriesCreated}, games assigned: ${result.gamesAssigned}, non-Latin disabled: ${result.nonLatinDisabled}`
        return {
          success: true,
          message,
          categoriesCreated: result.categoriesCreated,
          gamesAssigned: result.gamesAssigned,
          nonLatinDisabled: result.nonLatinDisabled,
        }
      } catch (e: any) {
        return {
          success: false,
          message: e?.message || 'Failed to generate casino categories',
          categoriesCreated: null,
          gamesAssigned: null,
          nonLatinDisabled: null,
        }
      }
    },
    async updateWhitelabel(_: any, { input }: any, ctx: any) {
      requirePermission(ctx, 'config.whitelabels', 'update')
      const { getWhitelabelById, upsertWhitelabel, setWhitelabelSharingConfig } = await import('@src/repos/common/whitelabelRepo.js')
      const { recordAuditDb } = await import('@src/repos/audit/auditRepo.js')
      
      try {
        // Get existing whitelabel
        const existing = await getWhitelabelById(input.id)
        if (!existing) {
          return { success: false, message: 'Whitelabel not found', whitelabel: null }
        }
        
        // Update only provided fields
        await upsertWhitelabel({
          id: input.id,
          name: input.name ?? existing.name,
          domain: input.domain ?? existing.domain,
          logoUrl: input.logoUrl !== undefined ? input.logoUrl : existing.logoUrl,
          faviconUrl: input.faviconUrl !== undefined ? input.faviconUrl : existing.faviconUrl,
          status: existing.status,
        })
        
        // Update sharing rates if provided
        if (input.sharingRates && Array.isArray(input.sharingRates)) {
          for (const rateInput of input.sharingRates) {
            if (rateInput.domain && rateInput.shareRate != null) {
              await setWhitelabelSharingConfig({
                whitelabelId: input.id,
                domain: rateInput.domain as 'sports' | 'casino' | 'matka',
                shareRate: rateInput.shareRate / 100, // Convert percentage to decimal
              })
            }
          }
        }
        
        // Get updated whitelabel
        const updated = await getWhitelabelById(input.id)
        
        // Audit log
        const tenant = ctx?.tenant || input.id || 'default'
        await recordAuditDb({
          tenant,
          actorId: ctx?.user?.id || ctx?.user?.sub || 'system',
          domain: 'whitelabels',
          action: 'update',
          resourceType: 'whitelabel',
          resourceId: input.id,
          before: existing,
          after: updated,
        })
        
        return {
          success: true,
          message: 'Whitelabel updated successfully',
          whitelabel: updated ? {
            ...updated,
            logoUrl: await convertS3KeyToUrl(updated.logoUrl),
            faviconUrl: await convertS3KeyToUrl(updated.faviconUrl),
          } : null,
        }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Failed to update whitelabel', whitelabel: null }
      }
    },
    async generateSettlement(_: any, { input }: any, ctx: any) {
      // Creates the settlement its sibling `markSettlementSettled` then closes,
      // and named no permission while that one did.
      requirePermission(ctx, 'settlements.agent', 'create')
      const { generateSettlement } = await import('@src/repos/settlements/settlementsRepo.js')
      const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
      try {
        const s = await generateSettlement(tenant, input.start, input.end, input.sharePercent, input.notes)
        return { success: true, message: 'Settlement generated', settlement: s }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Failed to generate settlement', settlement: null }
      }
    },
    async markSettlementSettled(_: any, { id }: any, ctx: any) {
      requirePermission(ctx, 'settlements.agent', 'create')
      const { markSettlementSettled } = await import('@src/repos/settlements/settlementsRepo.js')
      const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
      const s = await markSettlementSettled(Number(id), tenant)
      if (!s) return { success: false, message: 'Settlement not found', settlement: null }
      return { success: true, message: 'Settlement marked as settled', settlement: s }
    },
    async exportSettlementsCSV(_: any, { start, end }: any, ctx: any) {
      requirePermission(ctx, 'settlements.center', 'view')
      const { exportSettlementsCSV } = await import('@src/repos/settlements/settlementsRepo.js')
      const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
      return exportSettlementsCSV(tenant, start, end)
    },
    async updateAdminPreferences(_: any, { input }: any, ctx: any) {
      // SECURITY: Only Super Admin can update their preferences
      const roleNames = ctx?.user?.roles || []
      const isSuperAdmin = roleNames.some((r: string) => 
        r === 'Super Admin' || r.toLowerCase() === 'super_admin' || 
        (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
      )
      
      if (!isSuperAdmin) {
        return {
          success: false,
          message: 'Unauthorized: Only Super Admin can update preferences',
          preferences: { directorMode: 'core', selectedWhitelabelId: null },
        }
      }
      
      // CRITICAL: Use ctx.user.sub (JWT standard field) instead of ctx.user.userId
      const userId = ctx?.user?.sub ? Number(ctx.user.sub) : null
      if (!userId || !Number.isFinite(userId)) {
        return {
          success: false,
          message: 'Invalid user ID',
          preferences: { directorMode: 'core', selectedWhitelabelId: null },
        }
      }
      
      // Validate directorMode
      if (input.directorMode !== 'core' && input.directorMode !== 'whitelabel') {
        return {
          success: false,
          message: 'Invalid directorMode. Must be "core" or "whitelabel"',
          preferences: { directorMode: 'core', selectedWhitelabelId: null },
        }
      }
      
      // If switching to core mode, clear selectedWhitelabelId
      const selectedWhitelabelId = input.directorMode === 'core' ? null : (input.selectedWhitelabelId || null)
      
      // Validate whitelabel exists if provided
      if (selectedWhitelabelId) {
        const { getWhitelabelById } = await import('@src/repos/common/whitelabelRepo.js')
        const whitelabel = await getWhitelabelById(selectedWhitelabelId)
        if (!whitelabel) {
          return {
            success: false,
            message: 'Invalid whitelabel ID',
            preferences: { directorMode: input.directorMode, selectedWhitelabelId: null },
          }
        }
      }
      
      try {
        const { updateAdminPreferencesDb } = await import('@src/repos/users/usersRepo.js')
        const preferences = await updateAdminPreferencesDb(userId, {
          directorMode: input.directorMode,
          selectedWhitelabelId,
        })
        
        // CRITICAL: Return the actual saved values from database
        const savedDirectorMode = preferences.directorMode || input.directorMode || 'core'
        
        
        // CRITICAL: Return the saved value from database
        // Use the value returned from database (which should be the saved value)
        const savedSelectedWhitelabelId = preferences.selectedWhitelabelId !== null && preferences.selectedWhitelabelId !== undefined
          ? preferences.selectedWhitelabelId
          : (input.selectedWhitelabelId || null)
        
        
        return {
          success: true,
          message: 'Admin preferences updated successfully',
          preferences: {
            directorMode: savedDirectorMode,
            selectedWhitelabelId: savedSelectedWhitelabelId,
          },
        }
      } catch (error: any) {
        return {
          success: false,
          message: error.message || 'Failed to update admin preferences',
          preferences: { directorMode: 'core', selectedWhitelabelId: null },
        }
      }
    },
  },
  Subscription: commonSubscriptionResolvers,
  Whitelabel: {
    // Field resolvers ensure logo/favicons are always usable URLs for any query
    logoUrl: async (root: any) => convertS3KeyToUrl(root.logoUrl),
    faviconUrl: async (root: any) => convertS3KeyToUrl(root.faviconUrl),
    // Credit fields - fetch from database if not already loaded
    creditLimit: async (root: any, _args: any, ctx: any) => {
      if (!mayReadWhitelabelMoney(root, ctx)) return null
      if (root.creditLimit != null) return Number(root.creditLimit) || 0
      const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
      const repo = new WhitelabelCreditRepo()
      const credit = await repo.getCreditFields(root.id)
      return credit ? credit.creditLimit : 0
    },
    creditUsed: async (root: any, _args: any, ctx: any) => {
      if (!mayReadWhitelabelMoney(root, ctx)) return null
      if (root.creditUsed != null) return Number(root.creditUsed) || 0
      const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
      const repo = new WhitelabelCreditRepo()
      const credit = await repo.getCreditFields(root.id)
      return credit ? credit.creditUsed : 0
    },
    creditAvailable: async (root: any, _args: any, ctx: any) => {
      if (!mayReadWhitelabelMoney(root, ctx)) return null
      if (root.creditAvailable != null) return Number(root.creditAvailable) || 0
      const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
      const repo = new WhitelabelCreditRepo()
      const credit = await repo.getCreditFields(root.id)
      return credit ? credit.creditAvailable : 0
    },
    creditAlertThreshold: async (root: any, _args: any, ctx: any) => {
      if (!mayReadWhitelabelMoney(root, ctx)) return null
      if (root.creditAlertThreshold != null) return Number(root.creditAlertThreshold) || 80
      const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
      const repo = new WhitelabelCreditRepo()
      const credit = await repo.getCreditFields(root.id)
      return credit ? credit.creditAlertThreshold : 80
    },
    // Theme is now fetched from app_config, not whitelabel table
    theme: async (root: any, __: any, ctx: any) => {
      const { getAppConfigDb } = await import('@src/repos/app-config/appConfigRepo.js')
      const tenant = root.id || ctx?.whitelabel?.id || 'default'
      const config = await getAppConfigDb(tenant)
      return config.theme || null
    },
    baseCurrency: async (root: any) => {
      const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js')
      return getWhitelabelCurrency(root.id)
    },
    timeZone: async (root: any) => {
      const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js')
      return getWhitelabelTimezone(root.id)
    },
    sharingRates: async (root: any, _args: any, ctx: any) => {
      if (!mayReadWhitelabelSharing(root, ctx)) return null
      const { getWhitelabelSharingConfig } = await import('@src/repos/common/whitelabelRepo.js')
      const now = new Date()
      const rates = []
      try {
        for (const domain of ['sports', 'casino', 'matka'] as const) {
          const config = await getWhitelabelSharingConfig(root.id, domain, now)
          // Always include all three domains, use 0 if no config exists
          const rate = config ? Number(config.shareRate) * 100 : 0
          rates.push({
            domain,
            rate,
          })
        }
      } catch {
        // Return all three domains with 0 rates on error
        return [
          { domain: 'sports', rate: 0 },
          { domain: 'casino', rate: 0 },
          { domain: 'matka', rate: 0 },
        ]
      }
      return rates
    },
  },
  Market: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  Game: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  ProviderMeta: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  Jackpot: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  CategoryNode: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  CategoryTree: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  Limit: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  Promotion: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  Content: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  User: { 
    tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null,
    username: (user: any) => user.username || null,
    wallet: async (user: any, _args: any, _ctx: any, info: any) => {
      if (user.wallet) return user.wallet
      const { players } = await import('@src/stores/index.js')
      const w = await players.getWallet(user.id)
      return w ? {
        userId: user.id,
        currency: w.currency,
        balance: Number((w as any).balance ?? (w as any).cash ?? 0),
        bonus: Number((w as any).bonus ?? 0),
        exposure: Number(w.exposure ?? 0),
        updatedAt: w.updatedAt,
      } : null
    }
  },
  Wallet: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  Role: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  AuthPayload: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  UserBasic: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  Agent: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  CommissionPlan: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  AgentTree: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  ReferralLink: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  BonusCampaign: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  PlayerBonus: {
    campaign: async (parent: any, _: any, ctx: any) => {
      if (parent.campaignId == null) return null
      const { getBonusCampaignDb } = await import('@src/repos/marketing/bonusesRepo.js')
      const { getEffectiveTenant } = await import('@src/domains/common/directorModeUtils.js')
      const tenant = getEffectiveTenant(ctx) || 'default'
      const campaign = await getBonusCampaignDb(Number(parent.campaignId), tenant)
      if (!campaign) return null
      const c = campaign as any
      return {
        ...campaign,
        id: String(campaign.id),
        budgetNumeric: Number(campaign.budgetNumeric || 0),
        amount: c.amount ? Number(c.amount) : null,
        percentage: c.percentage ? Number(c.percentage) : null,
        depositConditionAmount: c.depositConditionAmount ? Number(c.depositConditionAmount) : null,
        wagering: c.wagering ? Number(c.wagering) : null,
        validFrom: c.validFrom ? (c.validFrom instanceof Date ? c.validFrom.toISOString() : c.validFrom) : null,
        validTo: c.validTo ? (c.validTo instanceof Date ? c.validTo.toISOString() : c.validTo) : null,
        startDate: c.startDate ? (c.startDate instanceof Date ? c.startDate.toISOString() : c.startDate) : null,
        endDate: c.endDate ? (c.endDate instanceof Date ? c.endDate.toISOString() : c.endDate) : null,
        expiryBonusDays: c.expiryBonusDays ?? null,
        directSubType: c.directSubType ? String(c.directSubType) : null,
        createdAt: (campaign.createdAt as Date).toISOString(),
        updatedAt: (campaign.updatedAt as Date).toISOString(),
        casinoGameIds: (campaign.rulesJson as any)?.casinoGameIds || [],
        matkaGameIds: (campaign.rulesJson as any)?.matkaGameIds || [],
        casinoGameWeights: (campaign.rulesJson as any)?.casinoGameWeights || null,
        matkaBidTypeWeights: (campaign.rulesJson as any)?.matkaBidTypeWeights || null,
        distributedAt: c.distributedAt ? (c.distributedAt instanceof Date ? c.distributedAt.toISOString() : c.distributedAt) : null,
      }
    },
  },
  Draw: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  RateVersion: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  Result: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  SettlementBatch: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  ResultApproval: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
  OverviewKPIs: { tenant: (_: any, __: any, ctx: any) => ctx?.whitelabel?.id ?? null },
}
