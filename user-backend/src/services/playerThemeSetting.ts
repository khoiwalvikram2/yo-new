// user-backend/src/services/playerThemeSetting.ts
import { playerThemeSchema, resolvePlayerTheme, type PlayerTheme } from '@shared/theme/playerTheme.js'

// tenant -> JSON of the stored value last warned about. The settings poll runs every few seconds per player tab,
// so a bad stored value is logged once, and again only when it changes.
const warned = new Map<string, string>()

export function resetPlayerThemeWarnings(): void {
  warned.clear()
}

function warnOnce(tenant: string, stored: unknown, message: string, log: (message: string) => void): void {
  const key = JSON.stringify(stored)
  if (warned.get(tenant) === key) return
  warned.set(tenant, key)
  log(message)
}

/**
 * The player theme sent as the `playerTheme` app setting: each valid part of the stored value (the player app
 * treats a missing part as Matchbook). A stored value the strict schema refuses, or whose colours are no longer
 * readable, is logged once per distinct value, not fatal.
 */
export function playerThemeSetting(stored: unknown, tenant: string, log: (message: string) => void = console.warn): PlayerTheme | null {
  if (stored == null) return null
  const resolved = resolvePlayerTheme(stored)
  if (!playerThemeSchema.safeParse(stored).success) {
    warnOnce(tenant, stored, `[app-settings] ${tenant}: stored player_theme does not match the schema; sending its valid parts only`, log)
  } else if ((stored as { colors?: unknown }).colors && !resolved?.colors) {
    warnOnce(tenant, stored, `[app-settings] ${tenant}: stored player_theme colours are no longer readable; sending the rest without them`, log)
  }
  return resolved
}
