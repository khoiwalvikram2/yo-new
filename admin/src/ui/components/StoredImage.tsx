import { useState, type ImgHTMLAttributes, type ReactNode } from 'react'
import { IconPhotoOff } from '@tabler/icons-react'
import clsx from 'clsx'
import { strokeFor } from './icons'
import styles from './StoredImage.module.css'

export interface StoredImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'children'> {
  /** A data URI or a URL. Empty (nothing stored, or a legacy file the server no longer serves) shows the placeholder. */
  src: string | null | undefined
  /** The image's alternative text, which the placeholder shows. Empty marks a decorative image. */
  alt: string
  /** Replaces the default placeholder, for a tile that has its own empty state (an icon, the brand's name). */
  fallback?: ReactNode
  /** Extra classes for the default placeholder. `className` applies to it as well, so it keeps the image's box. */
  placeholderClassName?: string
}

/**
 * A stored image (an advertisement, a banner, a logo, a QR code, a category icon) that never shows a broken image
 * (SYS-18): with no source, or when the source will not load, a neutral placeholder with the alt text takes its
 * place. A new source gets a fresh try.
 */
export function StoredImage({ src, alt, fallback, className, placeholderClassName, onError, ...rest }: StoredImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (!src || failedSrc === src) {
    if (fallback !== undefined) return <>{fallback}</>
    return (
      <span
        className={clsx(styles.placeholder, className, placeholderClassName)}
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        title={alt || undefined}
        data-image-placeholder=""
      >
        <IconPhotoOff className={styles.icon} size={16} stroke={strokeFor(16)} aria-hidden="true" />
        {alt ? <span className={styles.text} aria-hidden="true">{alt}</span> : null}
      </span>
    )
  }

  return (
    <img
      {...rest}
      src={src}
      alt={alt}
      className={className}
      onError={(event) => {
        setFailedSrc(src)
        onError?.(event)
      }}
    />
  )
}
