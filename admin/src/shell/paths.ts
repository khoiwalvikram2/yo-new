/** Drops ?query and #hash and trailing slashes; '' becomes '/'. */
export function normalizePath(path: string): string {
  const cut = path.search(/[?#]/)
  let p = cut === -1 ? path : path.slice(0, cut)
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p === '' ? '/' : p
}

/** p === t || (t !== '/' && p.startsWith(t + '/')) on normalised paths. */
export function pathMatches(pathname: string, to: string): boolean {
  const p = normalizePath(pathname)
  const t = normalizePath(to)
  return p === t || (t !== '/' && p.startsWith(t + '/'))
}
