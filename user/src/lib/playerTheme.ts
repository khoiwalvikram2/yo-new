// The whitelabel's player theme (App Configuration → Branding & Theme): one <style> that overrides the Matchbook
// tokens in matchbook-tokens.css. Derivation and validation live in shared/src/theme/playerTheme.ts.
import { playerThemeCss, resolvePlayerTheme, type PlayerTheme } from '../../../shared/src/theme/playerTheme'
import { resolveSportsIconStyle, type SportsIconStyle } from '../../../shared/src/theme/sportsIcons'

export const PLAYER_THEME_STYLE_ID = 'mb-player-theme'

/** The `playerTheme` app setting as user-backend sends it (a JSON string), or an already parsed object. */
export function parsePlayerThemeSetting(value: unknown): PlayerTheme | null {
  if (typeof value !== 'string') return resolvePlayerTheme(value)
  try {
    return resolvePlayerTheme(JSON.parse(value))
  } catch {
    return null
  }
}

/** Writes the theme's overrides into one <style> kept last in <head>; removes it for Matchbook (nothing to override). */
export function applyPlayerTheme(theme: PlayerTheme | null | undefined, doc: Document = document): void {
  const css = playerThemeCss(theme?.colors)
  const existing = doc.getElementById(PLAYER_THEME_STYLE_ID)
  if (!css) {
    existing?.remove()
    return
  }
  const style = existing ?? doc.createElement('style')
  style.id = PLAYER_THEME_STYLE_ID
  if (style.textContent !== css) style.textContent = css
  if (doc.head.lastElementChild !== style) doc.head.appendChild(style)
}

export function playerSportsIconStyle(theme: PlayerTheme | null | undefined): SportsIconStyle {
  return resolveSportsIconStyle(theme?.sportsIconStyle)
}
