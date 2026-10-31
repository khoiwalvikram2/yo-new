/**
 * The role-name predicate that decides platform-wide access.
 *
 * Three copies of this test existed — in `buildAuthContext`, in
 * `getEffectiveTenantForDirector` and in `shouldSkipTenantFiltering` — and a
 * caller matching it is treated as a platform Super Admin: `buildAuthContext`
 * then honours the `X-Admin-Mode` and `X-Whitelabel-ID` headers, letting them
 * operate inside any tenant they name.
 *
 * That makes the *name* a privilege, and nothing validated names. A role editor
 * could create a role called "Supervisor Admin" — which matches, because
 * "supervisor" contains "super" — holding no permissions at all, assign it to
 * themselves, and pass every permission check on the way while gaining the
 * ability to switch tenants. `ensureMayUseRoleName` closes that; this module
 * exists so the predicate it enforces and the predicate the header trusts can
 * never drift apart.
 */
export function isSuperAdminRoleName(roleName: string): boolean {
  const lower = (roleName || '').toLowerCase()
  return (
    roleName === 'Super Admin' ||
    lower === 'super_admin' ||
    (lower.includes('super') && lower.includes('admin'))
  )
}

/** Whether any of a caller's role names grants platform-wide standing. */
export function hasSuperAdminRoleName(roleNames: readonly string[] | undefined | null): boolean {
  return (roleNames ?? []).some(isSuperAdminRoleName)
}
