/**
 * Query resolvers that have been reviewed as read-only for the public-surface
 * diagnostic. This is intentionally an allowlist: a newly added Query is not
 * probed until someone verifies that it cannot create data, update a projection,
 * or call an external provider.
 *
 * Do not add profile, statement, referral-link, or casino-launch resolvers here.
 * Some GraphQL Queries are commands in disguise (for example lazy wallet/link
 * creation), so the operation type and a name heuristic are not a safety boundary.
 */
export const VERIFIED_PURE_QUERY_NAMES = [
  "checkPhoneAvailable",
  "appSettings",
  "allAppSettings",
  "appSettingsVersion",
  "advertisements",
  "welivepayConfig",
  "casinoGames",
  "casinoCategories",
  "casinoProviders",
  "casinoSummary",
  "sportsList",
  "sportsEventDetail",
  "cashoutConfig",
  "sportsSettings",
  "vipTiers",
  "sportsExtraUrls",
] as const;

const verifiedPureQueryNameSet = new Set<string>(VERIFIED_PURE_QUERY_NAMES);

export type ProbeResolver = (parent: unknown, args: unknown, context: unknown, info: unknown) => unknown;

/**
 * Returns only reviewed-pure resolver functions and records every other Query
 * as skipped. Unknown future resolvers are deliberately skipped by default.
 */
export function selectVerifiedPureQueryResolvers(queryResolvers: Record<string, unknown>): {
  probeable: Array<[string, ProbeResolver]>;
  skipped: string[];
} {
  const probeable: Array<[string, ProbeResolver]> = [];
  const skipped: string[] = [];

  for (const [name, resolver] of Object.entries(queryResolvers)) {
    if (typeof resolver !== "function") continue;
    if (!verifiedPureQueryNameSet.has(name)) {
      skipped.push(`Query.${name} (not on the verified-pure allowlist)`);
      continue;
    }
    probeable.push([name, resolver as ProbeResolver]);
  }

  return { probeable, skipped };
}
