export function sportsEventIdentifier(value: string): { kind: 'uuid' | 'code' | 'slug'; value: string } | null {
  const identifier = String(value || '').trim()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) return { kind: 'uuid', value: identifier }
  if (!/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(identifier)) return null
  return { kind: /^\d+$/.test(identifier) ? 'code' : 'slug', value: identifier }
}
