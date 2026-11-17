import { useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'
import { Dialog } from './Dialog'
import { StoredImage } from './StoredImage'
import styles from './ImagePreview.module.css'

export type ImagePreviewFit = 'cover' | 'contain'

export interface ImagePreviewProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  src: string
  /** Required alternative text is preserved on the full-size image. */
  alt: string
  /** Accessible name for the dialog. @default 'Image preview' */
  dialogTitle?: ReactNode
  /** Accessible action prefix for the thumbnail button. @default 'Open preview' */
  openLabel?: string
  /** @default 'cover' */
  fit?: ImagePreviewFit
}

/**
 * A keyboard-operable thumbnail that opens the full image in the shared modal Dialog. An image that will not load
 * (or no image) is a placeholder naming it, with nothing to open, rather than a broken thumbnail (SYS-18).
 */
export function ImagePreview({
  src,
  alt,
  dialogTitle = 'Image preview',
  openLabel = 'Open preview',
  fit = 'cover',
  className,
  ...rest
}: ImagePreviewProps) {
  const [open, setOpen] = useState(false)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  if (!src || failedSrc === src) {
    return (
      <div {...rest} className={clsx(styles.preview, className)}>
        <StoredImage src={null} alt={alt} className={styles.missing} />
      </div>
    )
  }

  return (
    <div {...rest} className={clsx(styles.preview, className)}>
      <button
        ref={triggerRef}
        className={styles.thumbnailButton}
        type="button"
        aria-label={`${openLabel}: ${alt}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <img
          className={clsx(styles.thumbnail, styles[fit])}
          src={src}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
        />
      </button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={dialogTitle}
        size="lg"
        themeFrom={triggerRef}
        restoreFocusTo={triggerRef}
      >
        <div className={styles.fullFrame}>
          <img
            className={styles.fullImage}
            src={src}
            alt={alt}
            decoding="async"
          />
        </div>
      </Dialog>
    </div>
  )
}
