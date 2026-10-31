/** Pure helpers for the home's game-provider list (ProviderShowcase), kept apart so they can be tested directly. */

/** `tagged`: another provider shows the same logo (Evolution and Evolution Gaming), so the tile names itself too. */
export type ShowcaseProvider = { name: string; label: string; logo?: string; tagged?: boolean }

/** A provider name in letters and digits only: how logos are keyed. */
export const providerKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The API's names as people write them: wazdan → Wazdan, gg → GG, Novomatic_Asia → Novomatic Asia. */
export function providerLabel(name: string) {
  const clean = name.replace(/_/g, ' ').trim()
  if (clean.length <= 3) return clean.toUpperCase()
  return clean === clean.toLowerCase() ? clean[0].toUpperCase() + clean.slice(1) : clean
}

/** Unique names from the API, logo holders first, then A to Z by label; providers sharing a logo are tagged. */
export function buildProviders(names: string[], logos: Record<string, string>): ShowcaseProvider[] {
  const seen = new Set<string>()
  const providers = names.flatMap((raw): ShowcaseProvider[] => {
    const name = raw.trim()
    if (!name || seen.has(name)) return []
    seen.add(name)
    return [{ name, label: providerLabel(name), logo: logos[providerKey(name)] }]
  }).sort((a, b) => Number(Boolean(b.logo)) - Number(Boolean(a.logo)) || a.label.localeCompare(b.label))
  const uses = new Map<string, number>()
  for (const provider of providers) if (provider.logo) uses.set(provider.logo, (uses.get(provider.logo) ?? 0) + 1)
  return providers.map(provider => provider.logo && (uses.get(provider.logo) ?? 0) > 1 ? { ...provider, tagged: true } : provider)
}
