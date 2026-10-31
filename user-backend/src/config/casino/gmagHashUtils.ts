import { createHash, timingSafeEqual } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

/** Matches the provider's Unicode handling before hashing. */
function decodeUnicodeEscapes(value: string): string {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const object = value as Record<string, unknown>
  return '{' + Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',') + '}'
}

function plainString(body: Record<string, unknown>, secret: string, nested: (value: unknown) => string): string {
  return Object.keys(body).filter(key => key !== 'hash').sort().map(key => {
    const value = body[key]
    return `${key}=${value === null || value === undefined ? '' : typeof value === 'object' ? nested(value) : String(value)}`
  }).join('&') + secret
}

function digest(plain: string): string {
  return createHash('md5').update(decodeUnicodeEscapes(plain), 'utf8').digest('hex')
}

/** Used by existing outbound integrations with sorted nested keys. */
export function computeGmagHash(body: Record<string, unknown>, secret: string): string {
  return digest(plainString(body, secret, stableStringify))
}

/**
 * Extract top-level value slices structurally, rejecting duplicate keys at every
 * depth. A regular expression can select a nested key or the first of two keys,
 * while JSON.parse (and the accounting service) processes the last value.
 * JSON.parse validates syntax before this scanner is called.
 */
function rawValues(raw: string): Map<string, string> {
  let cursor = 0
  const top = new Map<string, string>()
  const whitespace = () => { while (cursor < raw.length && /\s/.test(raw[cursor])) cursor++ }
  const string = () => {
    const start = cursor++
    while (cursor < raw.length) {
      const char = raw[cursor++]
      if (char === '\\') cursor++
      else if (char === '"') break
    }
    return raw.slice(start, cursor)
  }
  const value = (depth: number): void => {
    if (depth > 64) throw new Error('Callback JSON is too deeply nested')
    whitespace()
    const opening = raw[cursor]
    if (opening === '{' || opening === '[') {
      const object = opening === '{', closing = object ? '}' : ']'
      const keys = new Set<string>()
      cursor++;whitespace()
      while (raw[cursor] !== closing) {
        let key: string | undefined
        if (object) {
          key = JSON.parse(string())
          if (keys.has(key!)) throw new Error('Duplicate callback JSON key')
          keys.add(key!);whitespace();cursor++;whitespace()
        }
        const start = cursor
        value(depth + 1)
        if (depth === 0 && key !== undefined) top.set(key, raw.slice(start, cursor))
        whitespace()
        if (raw[cursor] !== ',') break
        cursor++;whitespace()
      }
      cursor++
    } else if (opening === '"') string()
    else while (cursor < raw.length && !/[,}\]\s]/.test(raw[cursor])) cursor++
  }
  value(0)
  return top
}

/**
 * Accept serialization variants of the exact received values. Never round,
 * replace or omit transaction amounts to make a template's signature match.
 */
export function verifyGmagHash(body: Record<string, unknown>, queryHash: string, secret: string, rawBody?: string): boolean {
  const received = typeof queryHash === 'string' ? queryHash.trim().toLowerCase() : ''
  if (!/^[a-f0-9]{32}$/.test(received) || !secret) return false
  const candidates: string[] = []
  if (rawBody) {
    try {
      const parsed: unknown = JSON.parse(rawBody)
      if (!parsed || Array.isArray(parsed) || !isDeepStrictEqual(parsed, body)) return false
      const values = rawValues(rawBody)
      for (const normalized of [false, true]) {
        const plain = Object.keys(body).filter(key => key !== 'hash').sort().map(key => {
          const raw = values.get(key)!
          const value = body[key]
          const text = value === null || value === undefined ? '' : typeof value !== 'object' ? String(value)
            : normalized ? JSON.stringify(value) : raw
          return `${key}=${text}`
        }).join('&') + secret
        candidates.push(plain)
      }
    } catch { return false }
  }
  candidates.push(plainString(body, secret, stableStringify), plainString(body, secret, JSON.stringify))
  return candidates.some(candidate => timingSafeEqual(Buffer.from(digest(candidate), 'hex'), Buffer.from(received, 'hex')))
}
