import {
  getEffectiveTenantForDirector,
  shouldSkipTenantFiltering,
} from '@src/domains/common/directorModeUtils.js';

export type SnapshotEventFilter = {
  tenant?: string;
  whitelabelId?: string;
};

/**
 * Filters for reporting_snapshot_events rows (and run lists scoped by child events).
 * Returns null when Super Admin in core mode with no explicit GraphQL tenant/whitelabel args.
 */
export function resolveSnapshotEventFilters(
  ctx: any,
  args?: { tenant?: string | null; whitelabelId?: string | null },
): SnapshotEventFilter | null {
  if (shouldSkipTenantFiltering(ctx)) {
    const tenant = args?.tenant ?? undefined;
    const whitelabelId = args?.whitelabelId ?? undefined;
    const out: SnapshotEventFilter = {};
    if (tenant) out.tenant = tenant;
    if (whitelabelId) out.whitelabelId = whitelabelId;
    return Object.keys(out).length ? out : null;
  }
  const directorWl = getEffectiveTenantForDirector(ctx);
  if (directorWl) {
    return { whitelabelId: directorWl };
  }
  const tenant = args?.tenant ?? ctx?.tenant ?? undefined;
  const whitelabelId =
    args?.whitelabelId ?? ctx?.whitelabel?.id ?? ctx?.whitelabelId ?? undefined;
  const out: SnapshotEventFilter = {};
  if (tenant) out.tenant = tenant;
  if (whitelabelId) out.whitelabelId = whitelabelId;
  return Object.keys(out).length ? out : null;
}

export function eventFilterToRepoScope(
  filter: SnapshotEventFilter | null,
): { tenant?: string; whitelabelId?: string } | undefined {
  if (!filter) return undefined;
  const out: { tenant?: string; whitelabelId?: string } = {};
  if (filter.tenant) out.tenant = filter.tenant;
  if (filter.whitelabelId) out.whitelabelId = filter.whitelabelId;
  if (!out.tenant && !out.whitelabelId) return undefined;
  return out;
}
