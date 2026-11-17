import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react'
import { IconUpload, IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import { IconButton } from './IconButton'
import { ImagePreview } from './ImagePreview'
import { Spinner } from './Spinner'
import { StoredImage } from './StoredImage'
import { strokeFor } from './icons'
import styles from './FileField.module.css'
import { acceptsFile, formatFileSize } from './fileFieldUtils'

export type FileFieldFit = 'cover' | 'contain'

/** One row of the file list: a stored asset, a processed upload or a file still on its way. */
export interface FileFieldItem {
  /** Stable key. @default the row's position */
  id?: string
  name: ReactNode
  /** The secondary line: a size, a status. Replaced by `error` when that is set. */
  meta?: ReactNode
  /** Thumbnail image: a stored URL or a data URI. */
  src?: string
  /** Alternative text for `src`. Without it the thumbnail is decorative. */
  alt?: string
  /** Opens `src` full size in the shared preview dialog. Needs `alt`. */
  zoomable?: boolean
  dialogTitle?: ReactNode
  /** Replaces the thumbnail entirely (a placeholder, an image with its own load handling). */
  thumbnail?: ReactNode
  /** 0-100 draws the progress bar. */
  progress?: number
  /** Tints the row as failed and shows this message in place of `meta`. */
  error?: ReactNode
  onRemove?: () => void
  /** @default `Remove ${name}` for a string name, otherwise 'Remove file' */
  removeLabel?: string
}

export interface FileFieldProps {
  /** The visible field label (the group's legend); it also names the file input. */
  label: ReactNode
  /** The file input's accessible name when it should differ from the visible label. */
  inputLabel?: string
  /** The file input's form name; a focus request on the input lands on the drop zone. */
  name?: string
  accept?: string
  multiple?: boolean
  /** Bytes. A larger file is not passed on; it gets an error row naming its size and the limit. */
  maxSize?: number
  disabled?: boolean
  /** An upload or compression is running: the zone shows a spinner and ignores new files. */
  busy?: boolean
  /** @default 'Uploading…' */
  busyLabel?: string
  /** The drop zone's main line. @default 'Drop an image here or browse' (wording follows accept/multiple) */
  prompt?: ReactNode
  /** The hint line inside the drop zone; it describes the zone's button. */
  help?: ReactNode
  error?: ReactNode
  /** How thumbnails fill their tile. @default 'cover' */
  fit?: FileFieldFit
  /** Controlled rows. When omitted the field lists the files it accepted itself. */
  files?: FileFieldItem[]
  /** Progress of the self-listed files' upload (ignored when `files` is controlled). */
  progress?: number
  /** Receives the files just picked or dropped that passed the field's own checks. */
  onFiles: (files: File[]) => void
  /** A self-listed file was removed. */
  onRemove?: (file: File) => void
  className?: string
}

interface PickedFile {
  key: string
  file: File
  url: string | null
}

interface Rejection {
  key: string
  name: string
  message: string
}

function imagesOnly(accept: string | undefined) {
  const tokens = (accept ?? '').split(',').map((token) => token.trim()).filter(Boolean)
  return tokens.length > 0 && tokens.every((token) => token.startsWith('image/'))
}

// jsdom and older embedded browsers have no object URLs; the row then shows the extension tile.
function objectUrl(file: File): string | null {
  if (!file.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') return null
  return URL.createObjectURL(file)
}

function revoke(url: string | null) {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

function extension(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1, dot + 5).toUpperCase() : 'FILE'
}

function carriesFiles(event: DragEvent<HTMLElement>) {
  const types = event.dataTransfer?.types
  return !types || Array.from(types).includes('Files')
}

/**
 * File picker with a drop zone. A real, labelled `<input type="file">` stays in the form (out of sight
 * and out of the tab order) so form names and tests keep working; the zone's button opens it and takes
 * drops. Rows show the current files with thumbnails, an optional progress bar and a remove action.
 */
export function FileField({
  label,
  inputLabel,
  name,
  accept,
  multiple = false,
  maxSize,
  disabled = false,
  busy = false,
  busyLabel = 'Uploading…',
  prompt,
  help,
  error,
  fit = 'cover',
  files,
  progress,
  onFiles,
  onRemove,
  className,
}: FileFieldProps) {
  const baseId = useId()
  const legendId = `${baseId}-label`
  const promptId = `${baseId}-prompt`
  const hasHint = (help !== undefined && help !== null) || busy
  const hintId = hasHint ? `${baseId}-hint` : undefined
  const hasError = error !== undefined && error !== null
  const errorId = hasError ? `${baseId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const pickedRef = useRef<PickedFile[]>([])
  const keyRef = useRef(0)
  const dragDepth = useRef(0)
  const [picked, setPicked] = useState<PickedFile[]>([])
  const [rejections, setRejections] = useState<Rejection[]>([])
  const [over, setOver] = useState(false)
  const controlled = files !== undefined
  const inert = disabled || busy

  // Whatever is still listed at unmount gives its object URL back.
  useEffect(() => {
    const listedFiles = pickedRef
    return () => listedFiles.current.forEach((entry) => revoke(entry.url))
  }, [])

  const commitPicked = (next: PickedFile[]) => {
    pickedRef.current = next
    setPicked(next)
  }

  const nextKey = () => {
    keyRef.current += 1
    return String(keyRef.current)
  }

  const receive = (incoming: File[], dropped: boolean) => {
    const candidates = multiple ? incoming : incoming.slice(0, 1)
    if (!candidates.length) return
    const accepted: File[] = []
    const rejected: Rejection[] = []
    for (const file of candidates) {
      if (dropped && !acceptsFile(file, accept)) {
        rejected.push({ key: nextKey(), name: file.name, message: 'This file type is not accepted here.' })
      } else if (maxSize !== undefined && file.size > maxSize) {
        rejected.push({
          key: nextKey(),
          name: file.name,
          message: `${formatFileSize(file.size)} is over the ${formatFileSize(maxSize)} limit.`,
        })
      } else {
        accepted.push(file)
      }
    }
    setRejections(rejected)
    if (!accepted.length) return
    if (!controlled) {
      const entries = accepted.map((file) => ({ key: nextKey(), file, url: objectUrl(file) }))
      if (!multiple) pickedRef.current.forEach((entry) => revoke(entry.url))
      commitPicked(multiple ? [...pickedRef.current, ...entries] : entries)
    }
    onFiles(accepted)
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? [])
    // Clear the input so choosing the same file again still reports a change.
    event.currentTarget.value = ''
    receive(selected, false)
  }

  const handleDragEnter = (event: DragEvent<HTMLButtonElement>) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    dragDepth.current += 1
    if (!inert) setOver(true)
  }

  // Always claim a file drag, even while inert, so a missed drop never opens the file in the tab.
  const handleDragOver = (event: DragEvent<HTMLButtonElement>) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = inert ? 'none' : 'copy'
  }

  const handleDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setOver(false)
  }

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    dragDepth.current = 0
    setOver(false)
    if (inert) return
    receive(Array.from(event.dataTransfer?.files ?? []), true)
  }

  // A removed row takes its button with it; focus returns to the zone rather than the page.
  const afterRemove = (remove: () => void) => () => {
    remove()
    buttonRef.current?.focus()
  }

  const removePicked = (key: string) => {
    const entry = pickedRef.current.find((candidate) => candidate.key === key)
    if (!entry) return
    revoke(entry.url)
    commitPicked(pickedRef.current.filter((candidate) => candidate.key !== key))
    onRemove?.(entry.file)
  }

  const listed: FileFieldItem[] = files !== undefined
    ? files
    : picked.map((entry) => ({
      id: entry.key,
      name: entry.file.name,
      meta: formatFileSize(entry.file.size),
      src: entry.url ?? undefined,
      thumbnail: entry.url ? undefined : <span className={styles.ext}>{extension(entry.file.name)}</span>,
      progress,
      onRemove: () => removePicked(entry.key),
    }))
  const rejectedRows: FileFieldItem[] = rejections.map((rejection) => ({
    id: `rejected-${rejection.key}`,
    name: rejection.name,
    error: rejection.message,
    thumbnail: <span className={styles.ext}>{extension(rejection.name)}</span>,
    removeLabel: `Dismiss ${rejection.name}`,
    onRemove: () => setRejections((current) => current.filter((candidate) => candidate.key !== rejection.key)),
  }))
  const rows = [...listed, ...rejectedRows]

  const noun = imagesOnly(accept) ? (multiple ? 'images' : 'an image') : multiple ? 'files' : 'a file'

  return (
    <fieldset className={clsx(styles.root, className)} disabled={disabled}>
      <legend id={legendId} className={styles.legend}>
        {label}
      </legend>

      <input
        ref={inputRef}
        className={styles.input}
        type="file"
        name={name}
        accept={accept}
        multiple={multiple}
        disabled={inert}
        tabIndex={-1}
        aria-hidden="true"
        aria-label={inputLabel}
        aria-labelledby={inputLabel ? undefined : legendId}
        onChange={handleChange}
        onFocus={() => buttonRef.current?.focus()}
      />

      <button
        ref={buttonRef}
        type="button"
        className={clsx(styles.drop, over && styles.over)}
        disabled={disabled}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        aria-labelledby={promptId}
        aria-describedby={describedBy}
        aria-invalid={hasError || undefined}
        onClick={() => {
          if (!inert) inputRef.current?.click()
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span className={styles.icon} aria-hidden="true">
          {busy ? <Spinner size="md" decorative /> : <IconUpload size={20} stroke={strokeFor(20)} />}
        </span>
        <strong className={styles.prompt} id={promptId}>
          {prompt ?? (
            <>
              Drop {noun} here or <span className={styles.browse}>browse</span>
            </>
          )}
        </strong>
        {hasHint ? (
          <span className={styles.hint} id={hintId}>
            {busy ? busyLabel : help}
          </span>
        ) : null}
      </button>

      <span className={styles.visuallyHidden} role="status">
        {busy ? busyLabel : ''}
      </span>

      {hasError ? (
        <span className={styles.error} id={errorId} role="alert">
          {error}
        </span>
      ) : null}

      {rows.length ? (
        <div className={styles.files} role="list">
          {rows.map((item, index) => (
            <FileRow
              key={item.id ?? index}
              item={item}
              fit={fit}
              busy={busy}
              onRemove={item.onRemove ? afterRemove(item.onRemove) : undefined}
            />
          ))}
        </div>
      ) : null}
    </fieldset>
  )
}

function FileRow({
  item,
  fit,
  busy,
  onRemove,
}: {
  item: FileFieldItem
  fit: FileFieldFit
  busy: boolean
  onRemove?: () => void
}) {
  const hasError = item.error !== undefined && item.error !== null
  const removeLabel = item.removeLabel ?? (typeof item.name === 'string' ? `Remove ${item.name}` : 'Remove file')
  const progress = item.progress === undefined ? undefined : Math.min(100, Math.max(0, item.progress))
  // A stored image that will not load fills the tile with a placeholder naming it, never a broken image (SYS-18).
  const thumbnail = item.thumbnail ?? (item.src ? (
    item.zoomable && item.alt ? (
      <ImagePreview className={styles.zoom} src={item.src} alt={item.alt} fit={fit} dialogTitle={item.dialogTitle} />
    ) : (
      <StoredImage src={item.src} alt={item.alt ?? ''} placeholderClassName={styles.thumbPlaceholder} />
    )
  ) : null)

  // The row is a div so an image's nearest block ancestor is its own row (thumbnail and actions together).
  return (
    <div role="listitem" className={clsx(styles.file, hasError && styles.fileError)}>
      <span className={clsx(styles.thumb, styles[fit])}>{thumbnail}</span>
      <span className={styles.main}>
        <span className={styles.name}>{item.name}</span>
        {hasError ? (
          <span className={styles.sub} role="alert">
            {item.error}
          </span>
        ) : item.meta !== undefined && item.meta !== null ? (
          <span className={styles.sub}>{item.meta}</span>
        ) : null}
        {progress !== undefined ? (
          <span
            className={styles.bar}
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <span className={styles.barFill} style={{ width: `${progress}%` }} />
          </span>
        ) : null}
      </span>
      {onRemove ? (
        <IconButton
          size="sm"
          label={removeLabel}
          icon={<IconX size={15} stroke={strokeFor(15)} />}
          disabled={busy}
          onClick={onRemove}
        />
      ) : null}
    </div>
  )
}
