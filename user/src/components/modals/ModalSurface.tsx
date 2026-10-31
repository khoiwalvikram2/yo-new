import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  titleId?: string
  description?: string
  size?: 'sm' | 'md' | 'lg' | 'auth'
  className?: string
  children: ReactNode
  closeLabel?: string
  dismissible?: boolean
  hideHeader?: boolean
}

const scrollLocks = new WeakMap<Document, { count: number; original: string }>()

export default function ModalSurface({ open, onClose, title, titleId, description, size = 'md', className = '', children, closeLabel, dismissible = true, hideHeader = false }: Props) {
  const { t } = useTranslation()
  const generatedId = useId()
  const headingId = titleId || `modal-title-${generatedId}`
  const descriptionId = `modal-description-${generatedId}`
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  const openRef = useRef(open)
  closeRef.current = onClose
  openRef.current = open

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return
    const owner = dialog.ownerDocument
    const returnFocus = owner.activeElement as HTMLElement | null
    const lock = scrollLocks.get(owner) || { count: 0, original: owner.body.style.overflow }
    lock.count += 1
    scrollLocks.set(owner, lock)
    owner.body.style.overflow = 'hidden'
    if (!dialog.open) dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
      lock.count = Math.max(0, lock.count - 1)
      if (lock.count === 0) {
        owner.body.style.overflow = lock.original
        scrollLocks.delete(owner)
      }
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [open])

  if (!open) return null
  const surface = <dialog ref={dialogRef} className="nova-modal-layer" aria-modal="true" aria-labelledby={headingId}
    aria-describedby={description && !hideHeader ? descriptionId : undefined}
    onCancel={event => { event.preventDefault(); if (dismissible) closeRef.current() }}
    onClose={event => { if (!event.currentTarget.open && openRef.current && dismissible) closeRef.current() }}
    onMouseDown={event => { if (event.target === event.currentTarget && dismissible) closeRef.current() }}>
    <section className={`nova-modal-surface nova-modal-${size} ${className}`}>
      {!hideHeader && <header className="nova-modal-header">
        <div><h2 id={headingId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
        {dismissible && <button type="button" className="nova-modal-close" aria-label={closeLabel || t('common.close')} onClick={() => closeRef.current()}><X size={20} aria-hidden="true" /></button>}
      </header>}
      {children}
    </section>
  </dialog>
  return typeof document === 'undefined' ? surface : createPortal(surface, document.body)
}
