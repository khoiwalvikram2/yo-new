/* Pure helpers of FileField, kept out of the component file so it exports components only (fast refresh). */

/** 1024-based, one decimal below ten: 512 B, 7.5 KB, 2 MB. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
  return `${rounded} ${units[unit]}`
}

/** The picker applies `accept` itself; a drop bypasses it, so dropped files are checked against the same list. */
export function acceptsFile(file: File, accept: string | undefined): boolean {
  const tokens = (accept ?? '').split(',').map((token) => token.trim().toLowerCase()).filter(Boolean)
  if (!tokens.length) return true
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  return tokens.some((token) => {
    if (token.startsWith('.')) return name.endsWith(token)
    if (token.endsWith('/*')) return type.startsWith(token.slice(0, -1))
    return type === token
  })
}
