// admin-backend/src/domains/app-config/playerThemeInput.ts
import { playerThemeErrors, playerThemeSchema, type PlayerTheme } from '@shared/theme/playerTheme.js'

/**
 * The player theme an admin saves (App Configuration → Branding & Theme). null clears it back to the Matchbook
 * default. Anything else must match the shared schema and keep every colour readable; the message names the field.
 */
export function parsePlayerThemeInput(value: unknown): PlayerTheme | null {
  if (value === null) return null
  const parsed = playerThemeSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`Invalid player theme: ${issue ? `${issue.path.join('.') || 'value'}: ${issue.message}` : 'unreadable value'}`)
  }
  if (parsed.data.colors) {
    const [failure] = Object.entries(playerThemeErrors(parsed.data.colors))
    if (failure) throw new Error(`Invalid player theme: colors.${failure[0]}: ${failure[1]}`)
  }
  return parsed.data
}
