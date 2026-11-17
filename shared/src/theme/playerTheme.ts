// shared/src/theme/playerTheme.ts
/**
 * The player panel's theme: presets, a few key colours, and the Matchbook --mb-* tokens derived from them.
 * Used by admin-backend (validation on save), user-backend (the app setting), the admin editor and preview,
 * and the player panel (one <style>). Design: docs/superpowers/specs/2026-11-01-app-config-theme-banners-icons-design.md.
 * Browser-safe and imported without file extensions; see color.ts.
 */
import { z } from 'zod'
import { contrast, darken, ensureContrast, ensureContrastOn, lighten, luminance, mix, normalizeHex } from './color'
import { SPORTS_ICON_STYLES, type SportsIconStyle } from './sportsIcons'

export const THEME_MODES = ['light', 'dark'] as const
export type ThemeMode = (typeof THEME_MODES)[number]
export type ModeColors = { page: string; panel: string; text: string; line: string }
export type PlayerThemeColors = { action: string; link: string; chrome: string; light: ModeColors; dark: ModeColors }
export type PlayerTheme = { presetId?: string; sportsIconStyle?: SportsIconStyle; colors?: PlayerThemeColors }
export type PlayerThemePreset = { id: string; name: string; colors: PlayerThemeColors }

export const MATCHBOOK_PRESET_ID = 'matchbook'
export const CUSTOM_PRESET_ID = 'custom'

/** Today's Matchbook look (user/src/styles/matchbook-tokens.css). The default: it injects nothing. */
export const MATCHBOOK_COLORS: PlayerThemeColors = {
  action: '#C51A1B', link: '#1B6FAE', chrome: '#2B2F35',
  light: { page: '#ECECED', panel: '#FFFFFF', text: '#333333', line: '#DDDDDD' },
  dark: { page: '#141619', panel: '#1E2125', text: '#D6D8DC', line: '#32363D' },
}

export const PLAYER_THEME_PRESETS: readonly PlayerThemePreset[] = [
  { id: MATCHBOOK_PRESET_ID, name: 'Matchbook Red', colors: MATCHBOOK_COLORS },
  { id: 'royal-blue', name: 'Royal Blue', colors: {
    action: '#1D4ED8', link: '#0369A1', chrome: '#1E293B',
    light: { page: '#EEF1F6', panel: '#FFFFFF', text: '#1F2937', line: '#D9DEE7' },
    dark: { page: '#0F1520', panel: '#172030', text: '#D5DCE6', line: '#2A3547' } } },
  { id: 'emerald', name: 'Emerald', colors: {
    action: '#047857', link: '#1B6FAE', chrome: '#1F2A27',
    light: { page: '#ECEFEE', panel: '#FFFFFF', text: '#2F3533', line: '#D8DEDB' },
    dark: { page: '#121816', panel: '#1A2220', text: '#D3DBD8', line: '#2D3835' } } },
  { id: 'royal-purple', name: 'Royal Purple', colors: {
    action: '#6D28D9', link: '#1B6FAE', chrome: '#2A2438',
    light: { page: '#EEEDF2', panel: '#FFFFFF', text: '#302D38', line: '#DDDAE5' },
    dark: { page: '#15131B', panel: '#1F1C27', text: '#DAD7E2', line: '#353042' } } },
  { id: 'teal', name: 'Teal', colors: {
    action: '#0F766E', link: '#1B6FAE', chrome: '#1F2D33',
    light: { page: '#EBEFF0', panel: '#FFFFFF', text: '#2E3436', line: '#D7DFE1' },
    dark: { page: '#11181A', panel: '#1A2326', text: '#D3DBDD', line: '#2C383C' } } },
  { id: 'saffron', name: 'Saffron', colors: {
    action: '#B45309', link: '#1B6FAE', chrome: '#2E2A26',
    light: { page: '#EFEDEA', panel: '#FFFFFF', text: '#36322E', line: '#E0DBD4' },
    dark: { page: '#171512', panel: '#221F1B', text: '#DEDAD4', line: '#3A352F' } } },
]

const hexColor = z.string().transform((value, context) => {
  const hex = normalizeHex(value)
  if (!hex) {
    context.addIssue({ code: 'custom', message: 'Use a hex color such as #C51A1B' })
    return z.NEVER
  }
  return hex
})
const modeColorsShape = { page: hexColor, panel: hexColor, text: hexColor, line: hexColor }
const strictModeColors = z.object(modeColorsShape).strict()
const lenientModeColors = z.object(modeColorsShape)
export const playerThemeColorsSchema = z.object({
  action: hexColor, link: hexColor, chrome: hexColor, light: strictModeColors, dark: strictModeColors,
}).strict()
/** The read path: unknown keys are stripped instead of refused, so an extra stored key does not drop the palette. */
const lenientColorsSchema = z.object({
  action: hexColor, link: hexColor, chrome: hexColor, light: lenientModeColors, dark: lenientModeColors,
})
const presetIdSchema = z.string().trim().regex(/^[a-z0-9-]{1,40}$/)
const iconStyleSchema = z.enum(SPORTS_ICON_STYLES)
/** What admin-backend accepts on save (strict: unknown keys are refused). */
export const playerThemeSchema = z.object({
  presetId: presetIdSchema.optional(),
  sportsIconStyle: iconStyleSchema.optional(),
  colors: playerThemeColorsSchema.optional(),
}).strict()

/** The same colours, upper-case 6-digit hex where they are hex, in one key order. */
export function normalizePlayerThemeColors(colors: PlayerThemeColors): PlayerThemeColors {
  const hex = (value: string) => normalizeHex(value) ?? value
  const mode = (m: ModeColors): ModeColors => ({ page: hex(m.page), panel: hex(m.panel), text: hex(m.text), line: hex(m.line) })
  return { action: hex(colors.action), link: hex(colors.link), chrome: hex(colors.chrome), light: mode(colors.light), dark: mode(colors.dark) }
}

const WHITE = '#FFFFFF'
const BLACK = '#000000'
const READABLE = 4.5
/** The menu's secondary text colour, which sits on the --mb-chrome-2 step. */
const MENU_TEXT = '#B9BCC3'

/** Dark ink for button text on a bright action colour. */
export const ACTION_TEXT_DARK = '#141518'

/** The text colour on the action colour: white when it reaches READABLE, else whichever of white and dark ink reads better. */
export function onActionColor(action: string): string {
  const white = contrast(WHITE, action)
  if (white >= READABLE) return WHITE
  return white >= contrast(ACTION_TEXT_DARK, action) ? WHITE : ACTION_TEXT_DARK
}

/** Why these colours cannot be saved, by field path ('action', 'light.text', ...); empty when they can. */
export function playerThemeErrors(colors: PlayerThemeColors): Record<string, string> {
  const errors: Record<string, string> = {}
  if (
    contrast(WHITE, colors.chrome) < READABLE ||
    contrast(WHITE, mix(colors.chrome, WHITE, 0.17)) < READABLE ||
    contrast(MENU_TEXT, mix(colors.chrome, WHITE, 0.1)) < READABLE
  ) errors.chrome = 'Menu text is hard to read on this color; choose a darker shade'
  for (const mode of THEME_MODES) {
    const surfaces = colors[mode]
    for (const name of ['page', 'panel'] as const) {
      const light = luminance(surfaces[name])
      if (mode === 'light' && light < 0.5) errors[`light.${name}`] = 'The light theme needs a light color here'
      if (mode === 'dark' && light > 0.1) errors[`dark.${name}`] = 'The dark theme needs a dark color here'
    }
    const lightestStep = mode === 'dark' ? [mix(surfaces.panel, WHITE, 0.1)] : []
    if (Math.min(...[surfaces.page, surfaces.panel, ...lightestStep].map((surface) => contrast(surfaces.text, surface))) < READABLE) {
      errors[`${mode}.text`] = 'Text is hard to read on the page or panel color'
    }
  }
  return errors
}

/**
 * Every token the theme controls, for one mode. Brand shades and chrome tokens are the same in both modes;
 * matchbook-tokens.css and panel-refresh.css point everything else that is brand red or charcoal at these
 * (--mb-red-hover, --mb-bar, --nova-accent, --brand-primary, the chrome scopes), so :root is enough.
 */
export function playerThemeTokens(colors: PlayerThemeColors, mode: ThemeMode) {
  const c = normalizePlayerThemeColors(colors)
  const m = c[mode]
  const dark = mode === 'dark'
  // The weakest surfaces text can sit on. Light: panel, page and the soft step (an sRGB mix can be slightly
  // darker than both ends). Dark: panel, the lightest dark step, and the page (the workspace background).
  const surfaces = dark ? [m.panel, mix(m.panel, WHITE, 0.1), m.page] : [m.panel, m.page, mix(m.panel, m.page, 0.55)]
  const link = ensureContrastOn(dark ? lighten(c.link, 0.3) : c.link, surfaces)
  // Button text on the action colour: white, or dark ink on a bright action colour.
  const onAction = onActionColor(c.action)
  // A shade of the action that carries the button text: it moves back toward the action (amount 0, which always passes
  // with its own on-action colour) until the text keeps READABLE.
  const keepReadable = (shadeAt: (amount: number) => string, amount: number) => {
    let shade = shadeAt(amount)
    for (let step = Math.round(amount * 100) - 1; step >= 0 && contrast(onAction, shade) < READABLE; step -= 1) shade = shadeAt(step / 100)
    return shade
  }
  // The brightest hover shade (up to +12%) that still carries the button text.
  const bright = keepReadable((amount) => lighten(c.action, amount), 0.12)
  const brand = (target: string, amount: number) => keepReadable((at) => mix(c.action, target, at), amount)
  // A pale wash of the action colour (the active sport pill) that keeps the action colour readable on it.
  let wash = mix(c.action, WHITE, 0.89)
  for (let amount = 0.9; amount <= 0.96 && contrast(c.action, wash) < READABLE; amount += 0.01) wash = mix(c.action, WHITE, amount)
  return {
    '--mb-red': c.action,
    '--mb-on-red': onAction,
    '--mb-brand-deep': keepReadable((amount) => darken(c.action, amount), 0.15),
    '--mb-brand-press': keepReadable((amount) => darken(c.action, amount), 0.19),
    '--mb-brand-bright': bright,
    // Brand shades in the player CSS (matchbook-tokens.css names each role). Amounts fit Matchbook's literals.
    '--mb-brand-top': brand(WHITE, 0.08),
    '--mb-brand-top-acct': brand(WHITE, 0.07),
    '--mb-brand-top-action': brand(WHITE, 0.05),
    '--mb-brand-top-hot': brand(WHITE, 0.13),
    '--mb-brand-top-hover': brand(BLACK, 0.02),
    '--mb-brand-low': brand(BLACK, 0.11),
    '--mb-brand-edge': brand(BLACK, 0.09),
    '--mb-brand-accent': mix(c.action, WHITE, 0.15),
    '--mb-brand-lift': brand(WHITE, 0.13),
    '--mb-brand-lift-2': brand(WHITE, 0.15),
    '--mb-brand-glow': brand(WHITE, 0.24),
    '--mb-brand-hover-fill': brand(WHITE, 0.05),
    '--mb-brand-active': brand(BLACK, 0.14),
    '--mb-brand-night': brand(BLACK, 0.18),
    '--mb-brand-dusk': brand(BLACK, 0.29),
    '--mb-brand-ember': brand(BLACK, 0.37),
    '--mb-brand-lobby': brand(BLACK, 0.2),
    '--mb-brand-motion': brand(BLACK, 0.06),
    '--mb-brand-top-matka': brand(WHITE, 0.08),
    '--mb-brand-matka-edge': brand(BLACK, 0.075),
    '--mb-brand-shade': brand(BLACK, 0.34),
    '--mb-brand-shadow': brand(BLACK, 0.29),
    '--mb-brand-shadow-2': brand(BLACK, 0.24),
    '--mb-brand-wash': wash,
    '--mb-nav-active': ensureContrast(lighten(c.action, 0.41), c.chrome, READABLE, WHITE),
    '--mb-red-text': ensureContrastOn(dark ? lighten(c.action, 0.35) : c.action, surfaces),
    '--mb-link': link,
    '--mb-focus': link,
    '--mb-chrome': c.chrome,
    '--mb-chrome-2': mix(c.chrome, WHITE, 0.1),
    '--mb-chrome-3': mix(c.chrome, WHITE, 0.17),
    '--mb-chrome-soft': mix(c.chrome, WHITE, 0.03),
    '--mb-chrome-deep': darken(c.chrome, 0.15),
    '--mb-chrome-line': mix(c.chrome, WHITE, 0.06),
    '--mb-chrome-line-2': mix(c.chrome, WHITE, 0.15),
    // Chrome surfaces and lines the player CSS used to write as charcoal literals (matchbook-tokens.css names each role).
    '--mb-chrome-field': mix(c.chrome, WHITE, 0.06),
    '--mb-chrome-field-hover': mix(c.chrome, WHITE, 0.11),
    '--mb-chrome-edge': darken(c.chrome, 0.28),
    '--mb-chrome-foot': darken(c.chrome, 0.25),
    '--mb-chrome-ticker': darken(c.chrome, 0.4),
    '--mb-chrome-band': mix(c.chrome, WHITE, 0.04),
    '--mb-chrome-sunk': darken(c.chrome, 0.19),
    '--mb-chrome-rule': mix(c.chrome, WHITE, 0.09),
    '--mb-chrome-tile': mix(c.chrome, WHITE, 0.07),
    '--mb-chrome-well': darken(c.chrome, 0.34),
    '--mb-chrome-base': darken(c.chrome, 0.38),
    '--mb-chrome-hero-top': darken(c.chrome, 0.09),
    '--mb-chrome-hero-low': darken(c.chrome, 0.48),
    '--mb-chrome-hero-end': darken(c.chrome, 0.57),
    '--mb-chrome-panel': darken(c.chrome, 0.27),
    '--mb-chrome-line-3': mix(c.chrome, WHITE, 0.15),
    '--mb-chrome-line-4': mix(c.chrome, WHITE, 0.26),
    '--mb-chrome-line-5': mix(c.chrome, WHITE, 0.3),
    '--mb-chrome-red': ensureContrast(lighten(c.action, 0.35), c.chrome, READABLE, WHITE),
    '--mb-chrome-link': ensureContrast(lighten(c.link, 0.4), c.chrome, READABLE, WHITE),
    '--mb-page': m.page,
    '--mb-panel': m.panel,
    '--mb-panel-2': dark ? mix(m.panel, WHITE, 0.02) : mix(m.panel, m.page, 0.15),
    '--mb-soft': dark ? mix(m.panel, WHITE, 0.05) : mix(m.panel, m.page, 0.55),
    '--mb-hover': dark ? mix(m.panel, WHITE, 0.07) : mix(m.panel, m.page, 0.35),
    '--mb-field': dark ? mix(m.page, m.panel, 0.3) : m.panel,
    '--mb-drawer': dark ? mix(m.panel, WHITE, 0.06) : m.panel,
    '--mb-drawer-row': m.panel,
    '--mb-drawer-row-hover': dark ? mix(m.panel, WHITE, 0.1) : mix(m.panel, m.page, 0.15),
    '--mb-disabled-bg': dark ? mix(m.panel, WHITE, 0.06) : darken(m.page, 0.045),
    '--mb-neutral-bg': dark ? mix(m.panel, WHITE, 0.06) : m.page,
    '--mb-text': m.text,
    '--mb-ink': mix(m.text, dark ? WHITE : BLACK, 0.6),
    '--mb-muted': ensureContrastOn(mix(m.text, m.panel, dark ? 0.25 : 0.3), surfaces),
    '--mb-faint': ensureContrastOn(mix(m.text, m.panel, dark ? 0.3 : 0.35), surfaces),
    '--mb-disabled-fg': mix(m.text, m.panel, dark ? 0.45 : 0.5),
    '--mb-neutral-ink': mix(m.text, m.panel, dark ? 0.08 : 0.12),
    '--mb-line': m.line,
    '--mb-line-2': mix(m.line, m.text, 0.08),
    '--mb-line-3': mix(m.line, m.text, 0.3),
  }
}

/** The brand tokens under button text (button gradients, hover fills); each keeps --mb-on-red at READABLE or better. */
export const ON_ACTION_BRAND_TOKENS = [
  '--mb-red', '--mb-brand-deep', '--mb-brand-press', '--mb-brand-bright',
  '--mb-brand-top', '--mb-brand-top-acct', '--mb-brand-top-action', '--mb-brand-top-hot', '--mb-brand-top-hover',
  '--mb-brand-low', '--mb-brand-edge', '--mb-brand-lift', '--mb-brand-lift-2', '--mb-brand-glow', '--mb-brand-hover-fill',
  '--mb-brand-active', '--mb-brand-night', '--mb-brand-dusk', '--mb-brand-ember', '--mb-brand-lobby', '--mb-brand-motion',
  '--mb-brand-top-matka', '--mb-brand-matka-edge',
] as const

export type PlayerThemeToken = keyof ReturnType<typeof playerThemeTokens>
type KeyInput = 'action' | 'link' | 'chrome' | 'page' | 'panel' | 'text' | 'line'

const SURFACE: readonly KeyInput[] = ['page', 'panel']
const TEXT: readonly KeyInput[] = ['text', 'page', 'panel']
const CHROME: readonly KeyInput[] = ['chrome']
const LINE: readonly KeyInput[] = ['line', 'text']

/** The key colours each token is derived from (page/panel/text/line mean that mode's value). */
export const TOKEN_INPUTS: Record<PlayerThemeToken, readonly KeyInput[]> = {
  '--mb-red': ['action'],
  '--mb-on-red': ['action'],
  '--mb-brand-deep': ['action'],
  '--mb-brand-press': ['action'],
  '--mb-brand-bright': ['action'],
  '--mb-brand-top': ['action'],
  '--mb-brand-top-acct': ['action'],
  '--mb-brand-top-action': ['action'],
  '--mb-brand-top-hot': ['action'],
  '--mb-brand-top-hover': ['action'],
  '--mb-brand-low': ['action'],
  '--mb-brand-edge': ['action'],
  '--mb-brand-accent': ['action'],
  '--mb-brand-lift': ['action'],
  '--mb-brand-lift-2': ['action'],
  '--mb-brand-glow': ['action'],
  '--mb-brand-hover-fill': ['action'],
  '--mb-brand-active': ['action'],
  '--mb-brand-night': ['action'],
  '--mb-brand-dusk': ['action'],
  '--mb-brand-ember': ['action'],
  '--mb-brand-lobby': ['action'],
  '--mb-brand-motion': ['action'],
  '--mb-brand-top-matka': ['action'],
  '--mb-brand-matka-edge': ['action'],
  '--mb-brand-shade': ['action'],
  '--mb-brand-shadow': ['action'],
  '--mb-brand-shadow-2': ['action'],
  '--mb-brand-wash': ['action'],
  '--mb-nav-active': ['action', 'chrome'],
  '--mb-red-text': ['action', 'page', 'panel'],
  '--mb-link': ['link', 'page', 'panel'],
  '--mb-focus': ['link', 'page', 'panel'],
  '--mb-chrome': CHROME,
  '--mb-chrome-2': CHROME,
  '--mb-chrome-3': CHROME,
  '--mb-chrome-soft': CHROME,
  '--mb-chrome-deep': CHROME,
  '--mb-chrome-line': CHROME,
  '--mb-chrome-line-2': CHROME,
  '--mb-chrome-field': CHROME,
  '--mb-chrome-field-hover': CHROME,
  '--mb-chrome-edge': CHROME,
  '--mb-chrome-foot': CHROME,
  '--mb-chrome-ticker': CHROME,
  '--mb-chrome-band': CHROME,
  '--mb-chrome-sunk': CHROME,
  '--mb-chrome-rule': CHROME,
  '--mb-chrome-tile': CHROME,
  '--mb-chrome-well': CHROME,
  '--mb-chrome-base': CHROME,
  '--mb-chrome-hero-top': CHROME,
  '--mb-chrome-hero-low': CHROME,
  '--mb-chrome-hero-end': CHROME,
  '--mb-chrome-panel': CHROME,
  '--mb-chrome-line-3': CHROME,
  '--mb-chrome-line-4': CHROME,
  '--mb-chrome-line-5': CHROME,
  '--mb-chrome-red': ['action', 'chrome'],
  '--mb-chrome-link': ['link', 'chrome'],
  '--mb-page': SURFACE,
  '--mb-panel': SURFACE,
  '--mb-panel-2': SURFACE,
  '--mb-soft': SURFACE,
  '--mb-hover': SURFACE,
  '--mb-field': SURFACE,
  '--mb-drawer': SURFACE,
  '--mb-drawer-row': SURFACE,
  '--mb-drawer-row-hover': SURFACE,
  '--mb-disabled-bg': SURFACE,
  '--mb-neutral-bg': SURFACE,
  // --mb-text is the text colour itself, so it needs only that input.
  '--mb-text': ['text'],
  '--mb-ink': TEXT,
  '--mb-muted': TEXT,
  '--mb-faint': TEXT,
  '--mb-disabled-fg': TEXT,
  '--mb-neutral-ink': TEXT,
  '--mb-line': LINE,
  '--mb-line-2': LINE,
  '--mb-line-3': LINE,
}

function inputValue(colors: PlayerThemeColors, mode: ThemeMode, input: KeyInput): string {
  return input === 'action' || input === 'link' || input === 'chrome' ? colors[input] : colors[mode][input]
}

/**
 * Per mode, the tokens whose INPUTS differ from Matchbook's, not whose derived value differs: a derived value
 * that happens to equal Matchbook's would otherwise leave Matchbook's hand-tuned CSS on a new panel. The emitted
 * value is the derived one.
 */
export function playerThemeOverrides(colors: PlayerThemeColors): Record<ThemeMode, Record<string, string>> {
  const overrides: Record<ThemeMode, Record<string, string>> = { light: {}, dark: {} }
  const c = normalizePlayerThemeColors(colors)
  for (const mode of THEME_MODES) {
    const tokens: Record<string, string> = playerThemeTokens(c, mode)
    for (const token of Object.keys(TOKEN_INPUTS) as PlayerThemeToken[]) {
      if (TOKEN_INPUTS[token].some((input) => inputValue(c, mode, input) !== inputValue(MATCHBOOK_COLORS, mode, input))) {
        overrides[mode][token] = tokens[token] ?? ''
      }
    }
  }
  return overrides
}

const MODE_SELECTORS: Record<ThemeMode, string> = { light: 'html:root:not(.dark)', dark: 'html.dark:root' }

/** The <style> text for these colours; '' means "Matchbook default" (nothing to inject). */
export function playerThemeCss(colors: PlayerThemeColors | null | undefined): string {
  const valid = playerThemeColorsSchema.safeParse(colors)
  if (!valid.success) return ''
  const overrides = playerThemeOverrides(valid.data)
  return THEME_MODES.map((mode) => {
    const entries = Object.entries(overrides[mode])
    return entries.length ? `${MODE_SELECTORS[mode]}{${entries.map(([token, value]) => `${token}:${value}`).join(';')}}` : ''
  }).filter(Boolean).join('\n')
}

/** A stored theme read leniently: each valid part is kept, a bad part is dropped; null when nothing is stored. */
export function resolvePlayerTheme(stored: unknown): PlayerTheme | null {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null
  const raw = stored as Record<string, unknown>
  const theme: PlayerTheme = {}
  const presetId = presetIdSchema.safeParse(raw.presetId)
  if (presetId.success) theme.presetId = presetId.data
  const icons = iconStyleSchema.safeParse(raw.sportsIconStyle)
  if (icons.success) theme.sportsIconStyle = icons.data
  const colors = lenientColorsSchema.safeParse(raw.colors)
  if (colors.success && Object.keys(playerThemeErrors(colors.data)).length === 0) theme.colors = colors.data
  return theme
}

/** The preset whose colours these are exactly (letter case aside), else 'custom'. */
export function matchingPresetId(colors: PlayerThemeColors): string {
  const key = JSON.stringify(normalizePlayerThemeColors(colors))
  return PLAYER_THEME_PRESETS.find((item) => JSON.stringify(normalizePlayerThemeColors(item.colors)) === key)?.id ?? CUSTOM_PRESET_ID
}
