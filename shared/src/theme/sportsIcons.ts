// shared/src/theme/sportsIcons.ts
/** The sport icon sets a whitelabel can choose (App Configuration → Sports Icons). Browser-safe; see color.ts. */
export const SPORTS_ICON_STYLES = ['default', 'flat', '3d'] as const
export type SportsIconStyle = (typeof SPORTS_ICON_STYLES)[number]

export const SPORTS_ICON_STYLE_OPTIONS: ReadonlyArray<{ value: SportsIconStyle; label: string; description: string }> = [
  { value: 'default', label: 'Default', description: 'The current single-color icons' },
  { value: 'flat', label: 'Flat Colorful', description: 'Simple colorful icons' },
  { value: '3d', label: '3D Colorful', description: 'Glossy colorful icons' },
]

/** Sports with a colourful icon in both sets: user/src/assets/images/{flat,3d}/<slug>.png. */
export const SPORTS_ICON_SLUGS = [
  'cricket', 'football', 'tennis', 'basketball', 'esports', 'horse-racing',
  'greyhound-racing', 'baseball', 'ice-hockey', 'volleyball', 'boxing', 'mma',
  'rugby', 'handball', 'darts', 'snooker', 'cycling', 'golf',
] as const
export type SportsIconSlug = (typeof SPORTS_ICON_SLUGS)[number]

const ALIASES: Record<string, SportsIconSlug> = {
  ...Object.fromEntries(SPORTS_ICON_SLUGS.map((slug) => [slug.replace(/-/g, ''), slug])),
  soccer: 'football',
  hockey: 'ice-hockey',
  mixedmartialarts: 'mma',
  rugbyleague: 'rugby',
  rugbyunion: 'rugby',
  horserace: 'horse-racing',
  greyhoundrace: 'greyhound-racing',
}

export function resolveSportsIconStyle(value: unknown): SportsIconStyle {
  return value === 'flat' || value === '3d' ? value : 'default'
}

/** The colourful icon's slug for a sport key or name ('horseracing', 'Soccer', 'ice-hockey'), or null. */
export function getSportsIconSlug(sport: string | null | undefined): SportsIconSlug | null {
  const key = (sport ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key] ?? null : null
}
