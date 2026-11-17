/**
 * What makes a whitelabel's VIP tier ladder valid (MAR-12).
 *
 * The Validation card on /vip/tiers used to run these rules over the process-wide in-memory
 * mock tiers (stores/vipStore.ts), never the tenant's vip_tiers rows, so it could not report a
 * real problem: with two tiers at level 4 it still said "All good". And nothing refused the
 * duplicate in the first place. Both now read the tenant's own tiers.
 *
 * The rules follow how tiers are used. A player's automatic tier is the highest-level active
 * tier whose minimum monthly deposit they reach, and the "next tier" is the first one above
 * theirs by level (shared/vip/depositAccess.ts, user-backend vipRepo), so:
 *   - two tiers at one level make the ladder ambiguous and one of them unreachable as "next";
 *   - an active tier asking less than an active tier below it is skipped by every player who
 *     qualifies for both;
 *   - names are compared trimmed and case-insensitive, as the default-tier seeding does.
 */

export type VipTierIssue = { code: 'DUP_NAME' | 'DUP_LEVEL' | 'ASC_DEPOSIT'; message: string; tierId?: string }

export type ValidatedTier = {
  id: string
  name: string
  level: number
  minMonthlyDeposit: number
  status?: string | null
}

export const tierNameKey = (name: string) => name.trim().toLowerCase()

function byLevel(a: ValidatedTier, b: ValidatedTier) {
  return a.level - b.level || a.name.localeCompare(b.name)
}

/** Every problem in one tenant's tiers, in level order. An empty list means the ladder is sound. */
export function vipTierIssues(tiers: readonly ValidatedTier[]): VipTierIssue[] {
  const issues: VipTierIssue[] = []
  const sorted = [...tiers].sort(byLevel)
  const firstByName = new Map<string, ValidatedTier>()
  const firstByLevel = new Map<number, ValidatedTier>()
  for (const tier of sorted) {
    const sameName = firstByName.get(tierNameKey(tier.name))
    if (sameName) {
      issues.push({ code: 'DUP_NAME', message: `Duplicate name "${tier.name}": also used by the level ${sameName.level} tier`, tierId: tier.id })
    } else {
      firstByName.set(tierNameKey(tier.name), tier)
    }
    const sameLevel = firstByLevel.get(tier.level)
    if (sameLevel) {
      issues.push({ code: 'DUP_LEVEL', message: `Duplicate level ${tier.level}: ${sameLevel.name} and ${tier.name}`, tierId: tier.id })
    } else {
      firstByLevel.set(tier.level, tier)
    }
  }
  let below: ValidatedTier | undefined
  for (const tier of sorted.filter(t => t.status == null || t.status === 'active')) {
    if (below && tier.minMonthlyDeposit < below.minMonthlyDeposit) {
      issues.push({
        code: 'ASC_DEPOSIT',
        message: `Min deposit should ascend: ${tier.name} (level ${tier.level}) asks ${tier.minMonthlyDeposit}, less than ${below.name} (level ${below.level}) at ${below.minMonthlyDeposit}`,
        tierId: tier.id,
      })
    }
    if (!below || tier.minMonthlyDeposit >= below.minMonthlyDeposit) below = tier
  }
  return issues
}

/**
 * Why a tier may not take this name or level beside the tenant's other tiers, or null when it may.
 * `others` must not contain the tier being edited, so an edit that keeps its own level passes.
 */
export function vipTierIdentityConflict(
  others: readonly ValidatedTier[],
  candidate: { name?: string | null; level?: number | null },
): string | null {
  if (candidate.level != null) {
    const sameLevel = others.find(t => t.level === candidate.level)
    if (sameLevel) {
      return `Level ${candidate.level} is already used by the ${sameLevel.name} tier. Choose another level, or change ${sameLevel.name}'s level first.`
    }
  }
  if (candidate.name != null) {
    const sameName = others.find(t => tierNameKey(t.name) === tierNameKey(candidate.name as string))
    if (sameName) return `A tier named "${sameName.name}" already exists. Choose another name.`
  }
  return null
}
