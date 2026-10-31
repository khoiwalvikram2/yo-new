import { useEffect, useCallback } from 'react'

export function useSearchShortcut(
  isOpen: boolean,
  onToggle?: () => void,
  onEscape?: () => void
) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Cmd/Ctrl+K to toggle search
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        onToggle?.()
        return
      }

      // Escape to close
      if (event.key === 'Escape' && isOpen) {
        event.preventDefault()
        onEscape?.()
        return
      }
    },
    [isOpen, onToggle, onEscape]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])
}

