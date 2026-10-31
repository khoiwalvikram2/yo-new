/** A letter or a digit in any script. */
const ALPHANUMERIC = /[\p{L}\p{N}]/u
/** Every letter or digit, in order (String.prototype.match with a global regex returns them all). */
const ALPHANUMERICS = /[\p{L}\p{N}]/gu
/** The mockup's "G7" rule applies to names that end in an ASCII digit. */
const ENDS_IN_DIGIT = /[0-9]$/
const WHITESPACE = /\s+/

function firstAlphanumeric(text: string): string {
  return text.match(ALPHANUMERIC)?.[0] ?? ''
}

/**
 * Spec decision 14 (S:61, S "Rail" :427-432), applied to the trimmed name, result upper-cased.
 * "Alphanumeric" = /[\p{L}\p{N}]/u. Steps, first that applies wins:
 *   1. no alphanumeric character (null, undefined, '', whitespace, punctuation only) → fallback
 *   2. exactly one alphanumeric character → that character                      ("X" → "X", " 7 " → "7")
 *   3. the trimmed name ends in a digit (/[0-9]$/) → first alphanumeric + last digit
 *                                  ("GoldBet77" → "G7", "Win-99" → "W9", "Bet 365" → "B5")
 *   4. two or more whitespace-separated words that each contain an alphanumeric → the first alphanumeric of
 *      each of the first two such words                                          ("Royal Casino" → "RC", "Rahul S." → "RS")
 *   5. otherwise the first two alphanumerics                                     ("Winzo" → "WI", "GameDash" → "GA", "- Casino" → "CA")
 * The fallback is returned as given (brandInitials passes 'GD'; Avatar keeps '' and shows a user glyph).
 */
export function initialsOf(name: string | null | undefined, fallback = ''): string {
  const trimmed = (name ?? '').trim()
  const alphanumerics = trimmed.match(ALPHANUMERICS) ?? []

  if (alphanumerics.length === 0) return fallback
  if (alphanumerics.length === 1) return alphanumerics[0].toUpperCase()
  if (ENDS_IN_DIGIT.test(trimmed)) return (alphanumerics[0] + trimmed.slice(-1)).toUpperCase()

  const words = trimmed.split(WHITESPACE).filter((word) => ALPHANUMERIC.test(word))
  if (words.length >= 2) return (firstAlphanumeric(words[0]) + firstAlphanumeric(words[1])).toUpperCase()

  return (alphanumerics[0] + alphanumerics[1]).toUpperCase()
}
