// shared/src/theme/color.ts
/**
 * Hex colour arithmetic for the player theme (shared/src/theme). Browser-safe on purpose: the admin and
 * player apps import these files directly, so they hold no Node imports and import each other without a
 * file extension (the player's test loader resolves only extensionless and .ts specifiers).
 */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const WHITE = '#FFFFFF'
const BLACK = '#000000'

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value.trim())
}

/** '#abc' → '#AABBCC'; null for anything that is not a 3- or 6-digit hex colour. */
export function normalizeHex(value: unknown): string | null {
  if (!isHex(value)) return null
  const digits = value.trim().slice(1)
  const full = digits.length === 3 ? digits.split('').map((digit) => digit + digit).join('') : digits
  return `#${full.toUpperCase()}`
}

type Rgb = [number, number, number]

function channels(hex: string): Rgb {
  const full = normalizeHex(hex)
  if (!full) throw new Error(`Not a hex colour: ${hex}`)
  return [parseInt(full.slice(1, 3), 16), parseInt(full.slice(3, 5), 16), parseInt(full.slice(5, 7), 16)]
}

function toHex([r, g, b]: Rgb): string {
  const part = (channel: number) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase()
}

/** `amount` of `b` mixed into `a` (0 gives a, 1 gives b), in sRGB like CSS color-mix. */
export function mix(a: string, b: string, amount: number): string {
  const [r1, g1, b1] = channels(a)
  const [r2, g2, b2] = channels(b)
  return toHex([r1 + (r2 - r1) * amount, g1 + (g2 - g1) * amount, b1 + (b2 - b1) * amount])
}

export const lighten = (hex: string, amount: number): string => mix(hex, WHITE, amount)
export const darken = (hex: string, amount: number): string => mix(hex, BLACK, amount)

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const linear = (channel: number) => {
    const s = channel / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = channels(hex)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** WCAG 2 contrast ratio, 1 to 21, the same whichever colour comes first. */
export function contrast(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * `color`, moved toward `target` (default: white on a dark background, black on a light one) in 5% steps until
 * it reaches `ratio` against `background`. Ratios up to about 4.58 are always reachable (pure white or black is
 * the limit near the luminance flip); above that the result may fall short and is then the pure target.
 */
export function ensureContrast(color: string, background: string, ratio = 4.5, target?: string): string {
  return ensureContrastOn(color, [background], ratio, target)
}

/**
 * Like ensureContrast, but the MINIMUM contrast over all `backgrounds` must reach `ratio`. The target is chosen
 * from backgrounds[0] when not given. Ratios above about 4.58 are not guaranteed (pure white or black is the
 * limit); the function then returns the pure target.
 */
export function ensureContrastOn(color: string, backgrounds: readonly string[], ratio = 4.5, target?: string): string {
  const start = normalizeHex(color)
  if (!start) throw new Error(`Not a hex colour: ${color}`)
  const first = backgrounds[0] ?? WHITE
  const end = target ?? (contrast(WHITE, first) >= contrast(BLACK, first) ? WHITE : BLACK)
  const worst = (candidate: string) => Math.min(...backgrounds.map((background) => contrast(candidate, background)))
  let current = start
  for (let step = 1; step <= 20 && worst(current) < ratio; step += 1) current = mix(start, end, step / 20)
  return current
}
