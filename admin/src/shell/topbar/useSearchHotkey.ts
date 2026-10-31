import { useEffect, useState } from 'react'

export interface SearchHotkey {
  open: boolean
  setOpen: (open: boolean) => void
}

/**
 * Ctrl/Cmd+K toggles; ignored in INPUT/TEXTAREA while closed (Topbar.tsx:86-109 verbatim).
 *
 * Wiring this into the composed Topbar (Task 49): pass `open`/`setOpen` straight through to
 * GlobalSearch's `isOpen`/`onClose`. Do NOT also pass an `onToggle` into GlobalSearch's own
 * useSearchShortcut — it already runs a second document keydown listener that calls
 * preventDefault() on Ctrl/Cmd+K. Wiring onToggle there double-toggles the same keypress and
 * the two state changes cancel out (net effect: the shortcut appears to do nothing).
 */
export function useSearchHotkey(): SearchHotkey {
  const [open, setOpen] = useState(false)

  // Handle Cmd/Ctrl+K keyboard shortcut globally
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle if not in an input/textarea (except when search modal is open)
      const target = event.target as HTMLElement
      const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      const isSearchModalOpen = open

      // Allow shortcut even in search input when modal is open (to close it)
      if (isInInput && !isSearchModalOpen) {
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return { open, setOpen }
}
