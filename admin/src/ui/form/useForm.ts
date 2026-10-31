import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ZodIssue, ZodType } from 'zod'
import {
  deepClone,
  deepEqual,
  getAtPath,
  isUnsafePathSegment,
  pathIntersects,
  setAtPath,
} from './paths'
import type { ArrayItemAtPath, ArrayPath, Path, PathValue } from './paths'

export const FORM_ERROR_PATH = '_form'

export interface UseFormOptions<V> {
  schema: ZodType<V>
  initialValues: V
  onSubmit: (values: V) => void | Promise<void>
}

export interface FieldBinding<V, P extends Path<V>> {
  id: string
  name: P
  value: PathValue<V, P>
  onChange: (value: PathValue<V, P>) => void
  onBlur: () => void
  error?: string
}

export interface FormArray<Item> {
  items: Item[]
  append: (value: Item) => void
  remove: (index: number) => void
  move: (from: number, to: number) => void
}

export interface FormApi<V> {
  values: V
  errors: Record<string, string>
  touched: Record<string, boolean>
  dirty: boolean
  submitting: boolean
  errorCount: number
  errorAnnouncement: string
  /** Use as the key of content inside a persistent live region so equal-count submit failures re-announce. */
  errorAnnouncementRevision: number
  formError?: string
  field: <P extends Path<V>>(name: P) => FieldBinding<V, P>
  getValue: <P extends Path<V>>(name: P) => PathValue<V, P>
  setValue: <P extends Path<V>>(name: P, value: PathValue<V, P>) => void
  setValues: (partial: Partial<V>) => void
  validate: (names?: Path<V>[]) => Promise<boolean>
  reset: (values?: V) => void
  array: <P extends ArrayPath<V>>(name: P) => FormArray<ArrayItemAtPath<V, P>>
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void
}

interface ValidationResult<V> {
  valid: boolean
  stale: boolean
  parsed: boolean
  data?: V
  firstPath?: string
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function issuePath(issue: ZodIssue): string {
  if (issue.path.length === 0) return FORM_ERROR_PATH
  const segments = issue.path.map(String)
  return segments.some(isUnsafePathSegment) ? FORM_ERROR_PATH : segments.join('.')
}

function errorsFromIssues(issues: readonly ZodIssue[], names?: readonly string[]): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>
  for (const issue of issues) {
    const path = issuePath(issue)
    if (
      names
      && (path === FORM_ERROR_PATH || !names.some((name) => pathIntersects(name, path)))
    ) continue
    if (result[path] === undefined) result[path] = issue.message
  }
  return result
}

function mergeValidationErrors(
  previous: Record<string, string>,
  next: Record<string, string>,
  names?: readonly string[],
): Record<string, string> {
  if (!names) return next

  const merged: Record<string, string> = Object.create(null) as Record<string, string>
  for (const [path, message] of Object.entries(previous)) {
    if (path === FORM_ERROR_PATH || names.some((name) => pathIntersects(name, path))) continue
    merged[path] = message
  }
  return Object.assign(merged, next)
}

function isMergeableObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof Date)
    && !(value instanceof RegExp)
}

function mergePartial<T>(current: T, partial: Partial<T>): T {
  if (!isMergeableObject(current) || !isMergeableObject(partial)) return deepClone(partial) as T

  let result = deepClone(current) as Record<string, unknown>
  const partialRecord = partial as Record<string, unknown>
  for (const key of Object.keys(partial)) {
    if (isUnsafePathSegment(key)) throw new TypeError(`Unsafe form value key: "${key}"`)
    const incoming = partialRecord[key]
    result = {
      ...result,
      [key]: isMergeableObject(result[key]) && isMergeableObject(incoming)
        ? mergePartial(result[key], incoming)
        : deepClone(incoming),
    }
  }
  return result as T
}

function withoutFormError(errors: Record<string, string>): Record<string, string> {
  if (errors[FORM_ERROR_PATH] === undefined) return errors
  const next = { ...errors }
  delete next[FORM_ERROR_PATH]
  return next
}

function moveIndex(index: number, from: number, to: number): number {
  if (index === from) return to
  if (from < to && index > from && index <= to) return index - 1
  if (from > to && index >= to && index < from) return index + 1
  return index
}

function remapArrayRecord<T>(
  record: Record<string, T>,
  arrayPath: string,
  mapIndex: (index: number) => number | null,
): Record<string, T> {
  const next: Record<string, T> = Object.create(null) as Record<string, T>
  const prefix = `${arrayPath}.`

  for (const [path, value] of Object.entries(record)) {
    if (!path.startsWith(prefix)) {
      next[path] = value
      continue
    }

    const remainder = path.slice(prefix.length)
    const [indexText, ...suffix] = remainder.split('.')
    if (!indexText || !/^(0|[1-9]\d*)$/.test(indexText)) {
      next[path] = value
      continue
    }
    const mappedIndex = mapIndex(Number(indexText))
    if (mappedIndex === null) continue
    const mappedPath = `${arrayPath}.${mappedIndex}${suffix.length ? `.${suffix.join('.')}` : ''}`
    next[mappedPath] = value
  }
  return next
}

function focusFirstInvalidControl(form: HTMLFormElement, errors: Record<string, string>): void {
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLElement)) continue
    const name = element.getAttribute('name')
    if (!name || errors[name] === undefined) continue
    if (
      (element instanceof HTMLInputElement
        || element instanceof HTMLSelectElement
        || element instanceof HTMLTextAreaElement
        || element instanceof HTMLButtonElement)
      && element.disabled
    ) continue
    if (element instanceof HTMLInputElement && element.type === 'hidden') continue
    element.focus({ preventScroll: true })
    return
  }
}

export function useForm<V>(options: UseFormOptions<V>): FormApi<V> {
  const { schema, initialValues, onSubmit } = options
  const idPrefix = useId().replaceAll(':', '') || 'form'
  const baselineRef = useRef<V>(deepClone(initialValues))
  const [values, setValuesState] = useState<V>(() => deepClone(initialValues))
  const [errors, setErrorsState] = useState<Record<string, string>>({})
  const [touched, setTouchedState] = useState<Record<string, boolean>>({})
  const [dirty, setDirty] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorAnnouncementRevision, setErrorAnnouncementRevision] = useState(0)
  const valuesRef = useRef(values)
  const errorsRef = useRef(errors)
  const touchedRef = useRef(touched)
  const valueGenerationRef = useRef(0)
  const validationRequestRef = useRef(0)
  const latestFullValidationRef = useRef(0)
  const latestScopedValidationRef = useRef(new Map<string, number>())
  const submitInFlightRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      valueGenerationRef.current += 1
      validationRequestRef.current += 1
      latestFullValidationRef.current = validationRequestRef.current
    }
  }, [])

  const updateErrors = useCallback((next: Record<string, string>) => {
    errorsRef.current = next
    if (mountedRef.current) setErrorsState(next)
  }, [])

  const updateTouched = useCallback((next: Record<string, boolean>) => {
    touchedRef.current = next
    if (mountedRef.current) setTouchedState(next)
  }, [])

  const commitValues = useCallback((next: V) => {
    valueGenerationRef.current += 1
    valuesRef.current = next
    if (mountedRef.current) {
      setValuesState(next)
      setDirty(!deepEqual(next, baselineRef.current))
    }

    const cleanedErrors = withoutFormError(errorsRef.current)
    if (cleanedErrors !== errorsRef.current) updateErrors(cleanedErrors)
    return valueGenerationRef.current
  }, [updateErrors])

  const runValidation = useCallback(async (
    names?: readonly Path<V>[],
    snapshot: V = valuesRef.current,
  ): Promise<ValidationResult<V>> => {
    const generation = valueGenerationRef.current
    const stringNames = names?.map(String)
    const request = validationRequestRef.current + 1
    validationRequestRef.current = request
    if (stringNames) {
      for (const name of stringNames) latestScopedValidationRef.current.set(name, request)
    } else {
      latestFullValidationRef.current = request
    }

    const requestIsStale = () => {
      if (!mountedRef.current || generation !== valueGenerationRef.current) return true
      if (!stringNames) return validationRequestRef.current !== request
      if (latestFullValidationRef.current > request) return true
      return [...latestScopedValidationRef.current].some(([scope, latest]) => (
        latest > request && stringNames.some((name) => pathIntersects(name, scope))
      ))
    }

    try {
      const parsed = await schema.safeParseAsync(snapshot)
      if (requestIsStale()) {
        return { valid: false, stale: true, parsed: false }
      }

      const nextScopedErrors = parsed.success
        ? {}
        : errorsFromIssues(parsed.error.issues, stringNames)
      const nextErrors = mergeValidationErrors(errorsRef.current, nextScopedErrors, stringNames)
      updateErrors(nextErrors)
      const firstPath = Object.keys(nextScopedErrors)[0]
      return {
        valid: firstPath === undefined,
        stale: false,
        parsed: parsed.success,
        data: parsed.success ? parsed.data : undefined,
        firstPath,
      }
    } catch (error) {
      if (requestIsStale()) {
        return { valid: false, stale: true, parsed: false }
      }
      const nextErrors = {
        ...errorsRef.current,
        [FORM_ERROR_PATH]: errorMessage(error, 'Unable to validate the form. Please try again.'),
      }
      updateErrors(nextErrors)
      return { valid: false, stale: false, parsed: false, firstPath: FORM_ERROR_PATH }
    }
  }, [schema, updateErrors])

  const validate = useCallback(async (names?: Path<V>[]) => {
    const result = await runValidation(names)
    return result.valid
  }, [runValidation])

  const setValue = useCallback(<P extends Path<V>>(name: P, value: PathValue<V, P>) => {
    const currentErrorNames = Object.keys(errorsRef.current)
      .filter((path) => path !== FORM_ERROR_PATH) as Path<V>[]
    const next = setAtPath(valuesRef.current, name, deepClone(value))
    commitValues(next)
    if (currentErrorNames.length) {
      const names = [...new Set<Path<V>>([...currentErrorNames, name])]
      void runValidation(names, next)
    }
  }, [commitValues, runValidation])

  const setValues = useCallback((partial: Partial<V>) => {
    const next = mergePartial(valuesRef.current, partial)
    const changedRoots = Object.keys(partial).filter((key) => !isUnsafePathSegment(key))
    const currentErrorNames = Object.keys(errorsRef.current)
      .filter((path) => path !== FORM_ERROR_PATH) as Path<V>[]
    commitValues(next)
    if (currentErrorNames.length) {
      const names = [...new Set<Path<V>>([...currentErrorNames, ...(changedRoots as Path<V>[])])]
      void runValidation(names, next)
    }
  }, [commitValues, runValidation])

  const reset = useCallback((nextValues?: V) => {
    const nextBaseline = deepClone(nextValues === undefined ? baselineRef.current : nextValues)
    if (nextValues !== undefined) baselineRef.current = deepClone(nextBaseline)
    valueGenerationRef.current += 1
    validationRequestRef.current += 1
    latestFullValidationRef.current = validationRequestRef.current
    valuesRef.current = nextBaseline
    errorsRef.current = {}
    touchedRef.current = {}
    if (mountedRef.current) {
      setValuesState(nextBaseline)
      setErrorsState({})
      setTouchedState({})
      setDirty(false)
    }
  }, [])

  const field = useCallback(<P extends Path<V>>(name: P): FieldBinding<V, P> => ({
    id: `${idPrefix}-${encodeURIComponent(String(name))}`,
    name,
    value: getAtPath(values, name),
    onChange: (value) => setValue(name, value),
    onBlur: () => {
      const path = String(name)
      if (!touchedRef.current[path]) updateTouched({ ...touchedRef.current, [path]: true })
      void runValidation([name])
    },
    error: errors[String(name)],
  }), [errors, idPrefix, runValidation, setValue, updateTouched, values])

  const array = useCallback(<P extends ArrayPath<V>>(name: P): FormArray<ArrayItemAtPath<V, P>> => {
    type Item = ArrayItemAtPath<V, P>
    const current = getAtPath(values, name)
    if (current !== undefined && !Array.isArray(current)) {
      throw new TypeError(`Form path "${String(name)}" does not contain an array`)
    }
    const items = (Array.isArray(current) ? current : []) as Item[]
    const arrayPath = String(name)
    const readCurrentItems = (): Item[] => {
      const latest = getAtPath(valuesRef.current, name)
      if (latest !== undefined && !Array.isArray(latest)) {
        throw new TypeError(`Form path "${arrayPath}" does not contain an array`)
      }
      return (Array.isArray(latest) ? latest : []) as Item[]
    }

    const commitArray = (nextItems: Item[], remap?: (index: number) => number | null) => {
      if (remap) {
        updateErrors(remapArrayRecord(errorsRef.current, arrayPath, remap))
        updateTouched(remapArrayRecord(touchedRef.current, arrayPath, remap))
      }
      const currentErrorNames = Object.keys(errorsRef.current)
        .filter((path) => path !== FORM_ERROR_PATH) as Path<V>[]
      const next = setAtPath(valuesRef.current, name, nextItems as PathValue<V, P>)
      commitValues(next)
      if (currentErrorNames.length) {
        const names = [...new Set<Path<V>>([...currentErrorNames, name])]
        void runValidation(names, next)
      }
    }

    return {
      items,
      append: (value) => commitArray([...readCurrentItems(), deepClone(value)]),
      remove: (index) => {
        const latestItems = readCurrentItems()
        if (!Number.isInteger(index) || index < 0 || index >= latestItems.length) return
        commitArray(latestItems.filter((_, itemIndex) => itemIndex !== index), (oldIndex) => {
          if (oldIndex === index) return null
          return oldIndex > index ? oldIndex - 1 : oldIndex
        })
      },
      move: (from, to) => {
        const latestItems = readCurrentItems()
        if (
          !Number.isInteger(from)
          || !Number.isInteger(to)
          || from < 0
          || to < 0
          || from >= latestItems.length
          || to >= latestItems.length
          || from === to
        ) return
        const nextItems = latestItems.slice()
        const [moved] = nextItems.splice(from, 1)
        if (moved === undefined) return
        nextItems.splice(to, 0, moved)
        commitArray(nextItems, (oldIndex) => moveIndex(oldIndex, from, to))
      },
    }
  }, [commitValues, runValidation, updateErrors, updateTouched, values])

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitInFlightRef.current) return

    submitInFlightRef.current = true
    if (mountedRef.current) setSubmitting(true)
    const form = event.currentTarget

    void (async () => {
      try {
        let result: ValidationResult<V>
        do {
          result = await runValidation(undefined, valuesRef.current)
        } while (result.stale && mountedRef.current)
        if (!mountedRef.current) return
        if (!result.valid || !result.parsed) {
          focusFirstInvalidControl(form, errorsRef.current)
          if (mountedRef.current) setErrorAnnouncementRevision((revision) => revision + 1)
          return
        }
        await onSubmit(result.data as V)
      } catch (error) {
        if (mountedRef.current) {
          updateErrors({
            ...errorsRef.current,
            [FORM_ERROR_PATH]: errorMessage(error, 'Unable to submit the form. Please try again.'),
          })
          setErrorAnnouncementRevision((revision) => revision + 1)
        }
      } finally {
        submitInFlightRef.current = false
        if (mountedRef.current) setSubmitting(false)
      }
    })()
  }, [onSubmit, runValidation, updateErrors])

  const errorCount = Object.keys(errors).length
  return {
    values,
    errors,
    touched,
    dirty,
    submitting,
    errorCount,
    errorAnnouncement: errorCount === 0
      ? ''
      : `${errorCount} form ${errorCount === 1 ? 'error' : 'errors'} found.`,
    errorAnnouncementRevision,
    formError: errors[FORM_ERROR_PATH],
    field,
    getValue: <P extends Path<V>>(name: P) => getAtPath(valuesRef.current, name),
    setValue,
    setValues,
    validate,
    reset,
    array,
    handleSubmit,
  }
}
