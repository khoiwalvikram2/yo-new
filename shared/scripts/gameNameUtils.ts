/**
 * Shared helper for casino seed scripts: exclude games whose names use non-Latin scripts
 * (CJK, Arabic, Cyrillic, etc.) so they are not ingested or linked.
 */
const NON_LATIN =
  /[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u0600-\u06FF]/

export function isLatinGameName(name: string): boolean {
  if (typeof name !== 'string' || !name.trim()) return false
  return !NON_LATIN.test(name)
}
