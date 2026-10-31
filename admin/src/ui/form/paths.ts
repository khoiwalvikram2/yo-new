export type UnsafePathSegment = '__proto__' | 'prototype' | 'constructor'

type AtomicValue =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | Date
  | RegExp
  | Blob
  | File
  | ((...args: never[]) => unknown)

type SafeKey<T> = Exclude<Extract<keyof T, string>, UnsafePathSegment>

type PathInternal<T, Depth extends readonly unknown[] = []> = Depth['length'] extends 8
  ? never
  : T extends AtomicValue
    ? never
    : T extends readonly (infer Item)[]
      ?
          | `${number}`
          | (PathInternal<NonNullable<Item>, [...Depth, unknown]> extends infer Child extends string
              ? `${number}.${Child}`
              : never)
      : T extends object
        ? {
            [Key in SafeKey<T>]:
              | Key
              | (PathInternal<NonNullable<T[Key]>, [...Depth, unknown]> extends infer Child extends string
                  ? `${Key}.${Child}`
                  : never)
          }[SafeKey<T>]
        : never

/** A safe dot path into an object. Array positions are represented by numeric segments. */
export type Path<T> = T extends unknown ? PathInternal<NonNullable<T>> : never

type PathValueInternal<T, P extends string> = P extends `${infer Head}.${infer Tail}`
  ? T extends readonly (infer Item)[]
    ? Head extends `${number}`
      ? PathValue<Item, Tail>
      : never
    : Head extends keyof T
      ? PathValue<T[Head], Tail>
      : never
  : T extends readonly (infer Item)[]
    ? P extends `${number}`
      ? Item
      : never
    : P extends keyof T
      ? T[P]
      : never

/** Resolves each member independently when the value model is a union. */
export type PathValue<T, P extends string> = T extends unknown
  ? PathValueInternal<NonNullable<T>, P>
  : never

type ArrayPathFor<T, P extends Path<T>> = P extends unknown
  ? NonNullable<PathValue<T, P>> extends readonly unknown[]
    ? P
    : never
  : never

/** Only the safe paths whose resolved value is an array. */
export type ArrayPath<T> = ArrayPathFor<T, Path<T>>

export type ArrayItemAtPath<T, P extends Path<T>> = NonNullable<PathValue<T, P>> extends readonly (infer Item)[]
  ? Item
  : never

const unsafeSegments = new Set<string>(['__proto__', 'prototype', 'constructor'])
const arrayIndexPattern = /^(0|[1-9]\d*)$/

export function isUnsafePathSegment(segment: string): segment is UnsafePathSegment {
  return unsafeSegments.has(segment)
}

export function splitPath(path: string): string[] {
  if (!path) throw new TypeError('A form path cannot be empty')

  const segments = path.split('.')
  for (const segment of segments) {
    if (!segment) throw new TypeError(`Invalid form path: "${path}"`)
    if (isUnsafePathSegment(segment)) {
      throw new TypeError(`Unsafe form path segment: "${segment}"`)
    }
  }
  return segments
}

export function getAtPath<T, P extends Path<T>>(source: T, path: P): PathValue<T, P>
export function getAtPath(source: unknown, path: string): unknown {
  let current = source
  for (const segment of splitPath(path)) {
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null) return undefined
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null && !(value instanceof Date) && !(value instanceof RegExp)
}

function cloneContainer(value: unknown, nextSegment: string): Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return value.slice()
  if (isContainer(value)) return { ...value }
  return arrayIndexPattern.test(nextSegment) ? [] : {}
}

/** Returns a new root and clones only the containers along the changed path. */
export function setAtPath<T, P extends Path<T>>(source: T, path: P, value: PathValue<T, P>): T
export function setAtPath<T>(source: T, path: string, value: unknown): T {
  const segments = splitPath(path)

  const visit = (current: unknown, index: number): unknown => {
    const segment = segments[index]
    if (segment === undefined) return value
    if (Array.isArray(current) && !arrayIndexPattern.test(segment)) {
      throw new TypeError(`Array path segment must be a non-negative integer: "${segment}"`)
    }

    const clone = cloneContainer(current, segment)
    const child = isContainer(current) && Object.prototype.hasOwnProperty.call(current, segment)
      ? (current as Record<string, unknown>)[segment]
      : undefined
    ;(clone as Record<string, unknown>)[segment] = visit(child, index + 1)
    return clone
  }

  return visit(source, 0) as T
}

export function pathIntersects(left: string, right: string): boolean {
  splitPath(left)
  splitPath(right)
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`)
}

export function deepClone<T>(value: T): T {
  const seen = new WeakMap<object, object>()

  const clone = (input: unknown): unknown => {
    if (typeof input !== 'object' || input === null) return input
    if (input instanceof Date) return new Date(input.getTime())
    if (input instanceof RegExp) return new RegExp(input.source, input.flags)
    if (typeof Blob !== 'undefined' && input instanceof Blob) return input
    if (input instanceof Map) {
      if (seen.has(input)) return seen.get(input)
      const result = new Map<unknown, unknown>()
      seen.set(input, result)
      for (const [key, item] of input) result.set(clone(key), clone(item))
      return result
    }
    if (input instanceof Set) {
      if (seen.has(input)) return seen.get(input)
      const result = new Set<unknown>()
      seen.set(input, result)
      for (const item of input) result.add(clone(item))
      return result
    }

    if (seen.has(input)) return seen.get(input)
    const result: unknown[] | Record<PropertyKey, unknown> = Array.isArray(input)
      ? []
      : Object.create(Object.getPrototypeOf(input) === null ? null : Object.prototype)
    seen.set(input, result)
    for (const key of Reflect.ownKeys(input)) {
      if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: clone((input as Record<PropertyKey, unknown>)[key]),
      })
    }
    return result
  }

  return clone(value) as T
}

export function deepEqual(left: unknown, right: unknown): boolean {
  const compared = new WeakMap<object, WeakSet<object>>()

  const equal = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false
    if (a instanceof Date || b instanceof Date) {
      return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    }
    if (a instanceof RegExp || b instanceof RegExp) {
      return a instanceof RegExp && b instanceof RegExp && a.source === b.source && a.flags === b.flags
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false

    let rights = compared.get(a)
    if (rights?.has(b)) return true
    if (!rights) {
      rights = new WeakSet<object>()
      compared.set(a, rights)
    }
    rights.add(b)

    if (a instanceof Map || b instanceof Map) {
      if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false
      for (const [key, item] of a) {
        if (!b.has(key) || !equal(item, b.get(key))) return false
      }
      return true
    }
    if (a instanceof Set || b instanceof Set) {
      if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false
      return [...a].every((item) => b.has(item))
    }

    const aKeys = Reflect.ownKeys(a).filter((key) => Object.prototype.propertyIsEnumerable.call(a, key))
    const bKeys = Reflect.ownKeys(b).filter((key) => Object.prototype.propertyIsEnumerable.call(b, key))
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key)
        && equal((a as Record<PropertyKey, unknown>)[key], (b as Record<PropertyKey, unknown>)[key]),
    )
  }

  return equal(left, right)
}
