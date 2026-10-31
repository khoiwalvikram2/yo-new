/** The same local/global visibility used by the Manual Results list. */
export function sportsResultReadScope(ctx: any) {
  // The existing workspace is unavailable in whitelabel director mode.
  if (ctx?.directorMode === 'whitelabel') return null
  const isSuper = ctx?.user?.roles?.some((role: string) => role === 'Super Admin' || role.toLowerCase() === 'super_admin' || (role.toLowerCase().includes('super') && role.toLowerCase().includes('admin')))
  if (isSuper && ctx?.directorMode === 'core') return { tenant: 'default', whitelabelId: 'default', isGlobal: true }
  return { tenant: ctx?.tenant || 'default', whitelabelId: ctx?.whitelabel?.id as string | undefined, includeGlobal: true }
}
